import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { query } from "../db.js";
import { publish } from "../lib/events.js";

type ProgressBody = {
  locator: string;
  percentage: number;
  label?: string | null;
  deviceId: string;
  deviceName?: string | null;
  /** Client time (ms since epoch) when this position was reached. */
  clientUpdatedAt: number;
};

type ProgressRow = {
  locator: string;
  percentage: number;
  label: string | null;
  device_id: string;
  device_name: string | null;
  updated_at: Date;
};

function toDto(bookId: string, r: ProgressRow) {
  return {
    bookId,
    locator: r.locator,
    percentage: r.percentage,
    label: r.label,
    deviceId: r.device_id,
    deviceName: r.device_name,
    updatedAt: r.updated_at.toISOString(),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
        body: {
          type: "object",
          required: ["locator", "percentage", "deviceId", "clientUpdatedAt"],
          additionalProperties: false,
          properties: {
            locator: { type: "string", minLength: 1, maxLength: 2000 },
            percentage: { type: "number", minimum: 0, maximum: 1 },
            label: { type: ["string", "null"], maxLength: 200 },
            deviceId: { type: "string", minLength: 1, maxLength: 100 },
            deviceName: { type: ["string", "null"], maxLength: 100 },
            clientUpdatedAt: { type: "number" },
          },
        },
      },
    },
    async (request, reply) => {
      const bookId = request.params.id;
      if (!UUID_RE.test(bookId)) return reply.code(404).send({ error: "not_found" });
      const owned = await query("SELECT 1 FROM book WHERE id = $1 AND user_id = $2", [bookId, request.user.id]);
      if (owned.rowCount === 0) return reply.code(404).send({ error: "not_found" });

      const b = request.body;
      // Never accept timestamps from the future (bad device clocks).
      const ts = new Date(Math.min(b.clientUpdatedAt, Date.now()));

      const upsert = await query<ProgressRow>(
        `INSERT INTO reading_progress (user_id, book_id, locator, percentage, label, device_id, device_name, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (user_id, book_id) DO UPDATE SET
           locator = EXCLUDED.locator, percentage = EXCLUDED.percentage, label = EXCLUDED.label,
           device_id = EXCLUDED.device_id, device_name = EXCLUDED.device_name, updated_at = EXCLUDED.updated_at
         WHERE reading_progress.updated_at < EXCLUDED.updated_at
         RETURNING *`,
        [request.user.id, bookId, b.locator, b.percentage, b.label ?? null, b.deviceId, b.deviceName ?? null, ts],
      );

      if (upsert.rows[0]) {
        const dto = toDto(bookId, upsert.rows[0]);
        publish(request.user.id, "progress.updated", dto);
        return { applied: true, progress: dto };
      }
      const current = await query<ProgressRow>(
        "SELECT * FROM reading_progress WHERE user_id = $1 AND book_id = $2",
        [request.user.id, bookId],
      );
      return { applied: false, progress: toDto(bookId, current.rows[0]!) };
    },
  );
}
