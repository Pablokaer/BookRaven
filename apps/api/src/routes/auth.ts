import type { FastifyInstance } from "fastify";
import { auth } from "../auth.js";

/**
 * Mounts Better Auth at /api/auth/*.
 * Runs in its own encapsulated context with a raw-body parser so Better Auth
 * receives the exact bytes the client sent (JSON, form posts from OAuth providers, ...).
 */
export async function authRoutes(app: FastifyInstance) {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    async handler(request, reply) {
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
    },
  });
}
