import { APIError, betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { fromNodeHeaders } from "better-auth/node";
import { bearer } from "better-auth/plugins";
import type { FastifyReply, FastifyRequest } from "fastify";
import { allowedOrigins, config, googleEnabled } from "./config.js";
import { pool } from "./db.js";
import { resetPasswordEmail, welcomeEmail } from "./lib/emails.js";
import { sendMailInBackground } from "./lib/mailer.js";
import { isAccountBlocked } from "./lib/moderation.js";

export const auth = betterAuth({
  appName: "Mico-livrão",
  baseURL: config.publicUrl,
  basePath: "/api/auth",
  secret: config.authSecret,
  database: pool,
  trustedOrigins: allowedOrigins,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    disableSignUp: !config.allowSignup,
    // "Forgot password": emails a one-hour link; using it signs out every other session.
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    // Not awaited: the answer must not depend on SMTP (see sendMailInBackground).
    sendResetPassword: async ({ user, url }) => {
      sendMailInBackground(resetPasswordEmail(user, url));
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
          sendMailInBackground(welcomeEmail(user));
        },
      },
    },
    // Blocked accounts cannot sign in (blocking also deletes their existing sessions).
    session: {
      create: {
        before: async (session) => {
          if (await isAccountBlocked(session.userId)) {
            throw new APIError("FORBIDDEN", { message: "This account has been blocked by an administrator.", code: "ACCOUNT_BLOCKED" });
          }
        },
      },
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
