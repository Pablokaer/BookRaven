import { createHash } from "node:crypto";
import { APIError, betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { fromNodeHeaders } from "better-auth/node";
import { bearer } from "better-auth/plugins";
import type { FastifyReply, FastifyRequest } from "fastify";
import { allowedOrigins, config, googleEnabled } from "./config.js";
import { pool } from "./db.js";
import { TtlCache } from "./lib/cache.js";
import { forgetAppPasswords } from "./lib/devices.js";
import { resetPasswordEmail, verifyEmailEmail, welcomeEmail } from "./lib/emails.js";
import { audit, log } from "./lib/log.js";
import { sendMailInBackground } from "./lib/mailer.js";
import { isAccountBlocked } from "./lib/moderation.js";

/** The client's address: routes/auth.ts hands Better Auth Fastify's request.ip as X-Forwarded-For. */
const clientIp = (from: { headers?: Headers } | null | undefined) => from?.headers?.get("x-forwarded-for") ?? "";

export const auth = betterAuth({
  appName: "BookRaven",
  baseURL: config.publicUrl,
  basePath: "/api/auth",
  secret: config.authSecret,
  database: pool,
  trustedOrigins: allowedOrigins,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    disableSignUp: !config.allowSignup,
    requireEmailVerification: config.requireEmailVerification,
    // "Forgot password": emails a one-hour link; using it signs out every other session.
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    // Here the account is known; a reset link that doesn't work is logged by routes/auth.ts.
    onPasswordReset: async ({ user }, request) => {
      audit("auth.password_reset", { userId: user.id, ip: clientIp(request) });
    },
    // Not awaited: the answer must not depend on SMTP (see sendMailInBackground).
    sendResetPassword: async ({ user, url }) => {
      sendMailInBackground(resetPasswordEmail(user, url));
    },
  },
  emailVerification: {
    sendOnSignUp: config.requireEmailVerification,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      sendMailInBackground(verifyEmailEmail(user, url));
    },
  },
  socialProviders: googleEnabled
    ? {
        google: {
          clientId: config.google.clientId,
          clientSecret: config.google.clientSecret,
          disableSignUp: !config.allowSignup,
        },
      }
    : {},
  session: {
    expiresIn: 60 * 60 * 24 * 60, // 60 days: a reader app should not log you out often
    updateAge: 60 * 60 * 24,
  },
  // The session check reads the session and its user in one query instead of two.
  advanced: { database: { joins: true } },
  databaseHooks: {
    // Welcome email for every new account, from the email form or Google.
    user: {
      create: {
        after: async (user) => {
          audit("auth.account_created", { userId: user.id });
          sendMailInBackground(welcomeEmail(user));
        },
      },
      // A new name or email reaches requests at once, not when the cached sign-in expires.
      update: {
        after: async (user) => {
          forgetSessions(user.id);
          forgetAppPasswords(user.id);
        },
      },
    },
    // Blocked accounts cannot sign in (blocking also deletes their existing sessions).
    session: {
      create: {
        before: async (session, ctx) => {
          if (await isAccountBlocked(session.userId)) {
            audit("auth.blocked_sign_in", { userId: session.userId, ip: clientIp(ctx) }, "warn");
            throw new APIError("FORBIDDEN", { message: "This account has been blocked by an administrator.", code: "ACCOUNT_BLOCKED" });
          }
        },
        // Every way in (email, Google, sign-up) creates a session. So does changing the password,
        // which replaces the revoked sessions with a new one: that is logged as a password change.
        after: async (session, ctx) => {
          if (ctx?.path === "/change-password") return;
          audit("auth.signed_in", { userId: session.userId, ip: clientIp(ctx) });
        },
      },
      // Signing out, revoking sessions, changing or resetting the password: every deletion
      // Better Auth makes goes through here (the raw ones in routes/admin.ts call forgetSessions).
      delete: {
        after: async (session) => {
          forgetSessions(session.userId);
        },
      },
    },
  },
  // Its warnings and errors (e.g. "Invalid password") go to the server log. Not its info messages:
  // one of them is the email typed at sign-up when it already has an account.
  logger: {
    level: "warn",
    log: (level, message, ...args) => {
      const err = args.find((a) => a instanceof Error);
      log[level]({ ...(err ? { err } : {}), ...(args.length && !err ? { args } : {}) }, `[Better Auth] ${message}`);
    },
  },
  // Bearer tokens let the Capacitor app authenticate without third-party cookies.
  plugins: [bearer()],
  telemetry: { enabled: false },
});

export async function runAuthMigrations() {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}

export type SessionUser = { id: string; email: string; name: string };

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser;
  }
}

/**
 * Who signed in with these credentials (session cookie or bearer token), for 30 seconds: every
 * authenticated request needs it, and a reader fetches a book in many range requests. Ending a
 * session or blocking the account forgets the account's entries at once (forgetSessions), so
 * those still take effect on the very next request.
 */
const sessions = new TtlCache<{ user: SessionUser; blocked: boolean }>(5000);
const SESSION_TTL = 30_000;

/** Drops an account's cached sessions (signed out, blocked, password changed, deleted…). */
export function forgetSessions(userId: string) {
  sessions.forget((s) => s.user.id === userId);
}

/** The cache key of the credentials a request carries (the bearer plugin reads either header); null without any. */
const credentialsKey = ({ authorization, cookie }: FastifyRequest["headers"]) =>
  authorization || cookie ? createHash("sha256").update(`${authorization ?? ""}\n${cookie ?? ""}`).digest("base64url") : null;

/** preHandler that rejects unauthenticated requests and sets request.user. */
export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const key = credentialsKey(request.headers);
  let found = key ? sessions.get(key) : undefined;
  if (!found) {
    const version = sessions.version;
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const user = { id: session.user.id, email: session.user.email, name: session.user.name };
    found = { user, blocked: await isAccountBlocked(user.id) };
    // Never kept past the session's own expiry.
    if (key) sessions.set(key, found, Math.min(SESSION_TTL, session.session.expiresAt.getTime() - Date.now()), version);
  }
  if (found.blocked) {
    return reply.code(403).send({ error: "account_blocked" });
  }
  request.user = found.user;
}
