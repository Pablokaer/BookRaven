import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { auth } from "../auth.js";
import { config } from "../config.js";
import { audit } from "../lib/log.js";

/**
 * Failed password attempts, for the audit trail: a wrong password, email or reset link answers 400
 * or 401. Other refusals are not failed attempts: a blocked account (logged when its session is
 * refused, auth.ts), an unverified email, a rate limit. Successful sign-ins are logged when their
 * session is created (also for Google), and password resets by onPasswordReset (auth.ts).
 */
const FAILED: Record<string, string> = {
  "/api/auth/sign-in/email": "auth.sign_in_failed",
  "/api/auth/reset-password": "auth.password_reset_failed",
  "/api/auth/change-password": "auth.password_change_failed",
};
const CHANGE_PASSWORD = "/api/auth/change-password";

/**
 * Mounts Better Auth at /api/auth/*.
 * Runs in its own encapsulated context with a raw-body parser so Better Auth
 * receives the exact bytes the client sent (JSON, form posts from OAuth providers, ...).
 */
export async function authRoutes(app: FastifyInstance) {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  async function handle(request: FastifyRequest, reply: FastifyReply) {
      const url = new URL(request.url, `${request.protocol}://${request.headers.host}`);
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
        else headers.append(key, String(value));
      }
      // Better Auth reads the client's address (sessions, its rate limit, the audit trail) from
      // X-Forwarded-For: give it the one Fastify worked out from the proxies it trusts.
      headers.set("x-forwarded-for", request.ip);
      const body = request.body as Buffer | undefined;
      const req = new Request(url, {
        method: request.method,
        headers,
        // Request copies the bytes itself; the Buffer is never backed by shared memory.
        body: body && body.length > 0 ? (body as Uint8Array<ArrayBuffer>) : undefined,
      });

      const failure = request.method === "POST" ? FAILED[url.pathname] : undefined;
      const changingPassword = failure !== undefined && url.pathname === CHANGE_PASSWORD;
      // Whose password is being changed: the answer only says it when it works.
      const userId = changingPassword ? (await auth.api.getSession({ headers }))?.user.id : undefined;
      const response = await auth.handler(req);
      if (changingPassword && response.ok) audit("auth.password_changed", { userId, ip: request.ip });
      else if (failure && (response.status === 400 || response.status === 401)) {
        audit(failure, { userId, ip: request.ip, status: response.status }, "warn");
      }

      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== "set-cookie") reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header("set-cookie", cookies);

      const text = response.body ? await response.text() : null;
      return reply.send(text);
  }

  // The password endpoints are a brute-force target, so they get a tight limit per IP, well
  // below the catch-all (which also serves the frequent session check and must stay generous).
  // The tight limit is off under test, where the suite creates many accounts from one IP.
  const authMax = config.isTest ? 100_000 : 10;
  for (const path of ["/api/auth/sign-in/email", "/api/auth/sign-up/email", "/api/auth/forget-password", "/api/auth/request-password-reset", "/api/auth/reset-password"]) {
    app.route({ method: ["POST"], url: path, config: { rateLimit: { max: authMax, timeWindow: "1 minute" } }, handler: handle });
  }
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: handle,
  });
}
