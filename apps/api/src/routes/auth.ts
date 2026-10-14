import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { auth } from "../auth.js";
import { config } from "../config.js";

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
      const body = request.body as Buffer | undefined;
      const req = new Request(url, {
        method: request.method,
        headers,
        body: body && body.length > 0 ? new Uint8Array(body) : undefined,
      });

      const response = await auth.handler(req);

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
