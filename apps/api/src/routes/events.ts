import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { subscribe } from "../lib/events.js";

/**
 * GET /api/events — Server-Sent Events stream for the signed-in user.
 * Events: progress.updated, settings.updated, book.created, book.updated, book.deleted.
 */
export async function eventRoutes(app: FastifyInstance) {
  app.get(
    "/api/events",
    { preHandler: requireUser, config: { rateLimit: false } },
    async (request, reply) => {
      // Keep headers already set by plugins (e.g. CORS) since we write to the raw socket.
      const inherited = reply.getHeaders();
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        ...(inherited as Record<string, string>),
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(`retry: 3000\nevent: ready\ndata: {}\n\n`);

      const unsubscribe = subscribe(request.user.id, reply);
      const heartbeat = setInterval(() => res.write(`: ping\n\n`), 25_000);

      request.raw.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    },
  );
}
