import { APIError, betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { fromNodeHeaders } from "better-auth/node";
import { bearer } from "better-auth/plugins";
import type { FastifyReply, FastifyRequest } from "fastify";
import { allowedOrigins, config, googleEnabled } from "./config.js";
import { pool } from "./db.js";
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
  databaseHooks: {
    // Welcome email for every new account, from the email form or Google.
    user: {
      create: {
        after: async (user) => {
          audit("auth.account_created", { userId: user.id });
          sendMailInBackground(welcomeEmail(user));
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

/** preHandler that rejects unauthenticated requests and sets request.user. */
export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!session) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  if (await isAccountBlocked(session.user.id)) {
    return reply.code(403).send({ error: "account_blocked" });
  }
  request.user = { id: session.user.id, email: session.user.email, name: session.user.name };
}
