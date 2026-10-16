import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { query } from "../db.js";
import { findOr404, obj, UUID_RE } from "../lib/http.js";
import { progressDto as toDto, saveReadingProgress, type Position, type ProgressRow } from "../lib/progress.js";

type ProgressBody = {
  locator: string;
  percentage: number;
  label?: string | null;
  deviceId: string;
  deviceName?: string | null;
  /** Client time (ms since epoch) when this position was reached. */
  clientUpdatedAt: number;
};

export async function progressRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get<{ Params: { id: string } }>("/api/books/:id/progress", async (request, reply) => {
    if (!UUID_RE.test(request.params.id)) return reply.code(404).send({ error: "not_found" });
    const { rows } = await query<ProgressRow>(
      "SELECT * FROM reading_progress WHERE user_id = $1 AND book_id = $2",
      [request.user.id, request.params.id],
    );
    return rows[0] ? toDto(request.params.id, rows[0]) : null;
  });

  /**
   * Saves the reading position. Last-write-wins on the *client* timestamp, so an
   * offline device that syncs late cannot overwrite a newer position from another device.
   * Responds with the stored position and whether this write was applied.
   */
  app.put<{ Params: { id: string }; Body: ProgressBody }>(
    "/api/books/:id/progress",
    {
      config: { rateLimit: { max: 240, timeWindow: "1 minute" } },
      schema: {
        body: obj(
          {
            locator: { type: "string", minLength: 1, maxLength: 2000 },
            percentage: { type: "number", minimum: 0, maximum: 1 },
            label: { type: ["string", "null"], maxLength: 200 },
            deviceId: { type: "string", minLength: 1, maxLength: 100 },
            deviceName: { type: ["string", "null"], maxLength: 100 },
            clientUpdatedAt: { type: "number" },
          },
          ["locator", "percentage", "deviceId", "clientUpdatedAt"],
        ),
      },
    },
    async (request, reply) => {
      const bookId = request.params.id;
      // The book must be the caller's; its stored position comes along (null fields when none).
      const owned = await findOr404<Position | { locator: null }>(
        reply,
        UUID_RE.test(bookId),
        `SELECT p.locator, p.percentage, p.updated_at FROM book b
         LEFT JOIN reading_progress p ON p.book_id = b.id AND p.user_id = b.user_id
         WHERE b.id = $1 AND b.user_id = $2`,
        [bookId, request.user.id],
      );
      if (!owned) return;

      const b = request.body;
      const prev = owned.locator === null ? null : (owned as Position);
      const p = { locator: b.locator, percentage: b.percentage, label: b.label ?? null, deviceId: b.deviceId, deviceName: b.deviceName ?? null, at: new Date(b.clientUpdatedAt) };
      const saved = await saveReadingProgress(request.user.id, bookId, p, prev);
      return { applied: saved.applied, progress: toDto(bookId, saved) };
    },
  );
}
