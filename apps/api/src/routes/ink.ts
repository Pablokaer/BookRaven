import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { pool, query } from "../db.js";
import { publish } from "../lib/events.js";
import { loadOwnedBook } from "./books.js";

/** Limits per page: plenty for handwriting, small enough to sync quickly. */
export const MAX_STROKES_PER_PAGE = 5000;
export const MAX_PAGE_INK_BYTES = 2 * 1024 * 1024;

export type Stroke = {
  id: string;
  tool: "pen" | "highlighter";
  /** #rrggbb */
  color: string;
  /** Line width as a fraction of the page width. */
  width: number;
  /** x, y (fractions of the page) and pen pressure (0–1), flattened: [x0, y0, p0, x1, y1, p1, …]. */
  points: number[];
};

const strokeSchema = {
  type: "object",
  required: ["id", "tool", "color", "width", "points"],
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1, maxLength: 64 },
    tool: { type: "string", enum: ["pen", "highlighter"] },
    color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
    width: { type: "number", minimum: 0.0005, maximum: 0.2 },
    points: { type: "array", minItems: 3, maxItems: 30000, items: { type: "number", minimum: -0.5, maximum: 1.5 } },
  },
};

type InkRow = { page: number; strokes: Stroke[]; updated_at: Date };
const toDto = (bookId: string, r: InkRow) => ({ bookId, page: r.page, strokes: r.strokes, updatedAt: r.updated_at.toISOString() });

/**
 * Pen annotations on PDF pages. Devices send changes ("these strokes were added, those were
 * erased") rather than whole pages, so two devices annotating the same page offline both keep
 * their strokes, and replaying a change is harmless.
 */
export async function inkRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get<{ Params: { id: string } }>("/api/books/:id/ink", async (request, reply) => {
    const book = await loadOwnedBook(request, reply);
    if (!book) return;
    const { rows } = await query<InkRow>("SELECT page, strokes, updated_at FROM pdf_ink WHERE book_id = $1 AND user_id = $2 ORDER BY page", [
      book.id,
      request.user.id,
    ]);
    return rows.map((r) => toDto(book.id, r));
  });

  app.post<{
    Params: { id: string; page: string };
    Body: { add?: Stroke[]; remove?: string[]; deviceId?: string };
  }>(
    "/api/books/:id/ink/:page",
    {
      bodyLimit: 4 * 1024 * 1024,
      schema: {
        params: {
          type: "object",
          required: ["id", "page"],
          properties: { id: { type: "string" }, page: { type: "string", pattern: "^[1-9][0-9]{0,5}$" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            add: { type: "array", maxItems: 500, items: strokeSchema },
            remove: { type: "array", maxItems: 5000, items: { type: "string", minLength: 1, maxLength: 64 } },
            deviceId: { type: "string", maxLength: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      const book = await loadOwnedBook(request, reply);
      if (!book) return;
      const page = Number(request.params.page);
      const add = request.body.add ?? [];
      const remove = new Set(request.body.remove ?? []);
      if (add.some((s) => s.points.length % 3 !== 0)) return reply.code(400).send({ error: "points_must_be_triples" });

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // One change at a time per page, so concurrent devices can't drop each other's strokes.
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`ink:${request.user.id}:${book.id}:${page}`]);
        const { rows } = await client.query<{ strokes: Stroke[] }>(
          "SELECT strokes FROM pdf_ink WHERE user_id = $1 AND book_id = $2 AND page = $3",
          [request.user.id, book.id, page],
        );
        const byId = new Map((rows[0]?.strokes ?? []).map((s) => [s.id, s]));
        for (const id of remove) byId.delete(id);
        for (const s of add) byId.set(s.id, { id: s.id, tool: s.tool, color: s.color.toLowerCase(), width: s.width, points: s.points });
        const strokes = [...byId.values()];
        const json = JSON.stringify(strokes);
        if (strokes.length > MAX_STROKES_PER_PAGE || json.length > MAX_PAGE_INK_BYTES) {
          await client.query("ROLLBACK");
          return reply.code(413).send({ error: "page_ink_too_large" });
        }
        let row: InkRow;
        if (strokes.length) {
          const res = await client.query<InkRow>(
            `INSERT INTO pdf_ink (user_id, book_id, page, strokes, updated_at) VALUES ($1, $2, $3, $4, now())
             ON CONFLICT (user_id, book_id, page) DO UPDATE SET strokes = EXCLUDED.strokes, updated_at = now()
             RETURNING page, strokes, updated_at`,
            [request.user.id, book.id, page, json],
          );
          row = res.rows[0]!;
        } else {
          await client.query("DELETE FROM pdf_ink WHERE user_id = $1 AND book_id = $2 AND page = $3", [request.user.id, book.id, page]);
          row = { page, strokes: [], updated_at: new Date() };
        }
        await client.query("COMMIT");
        const dto = toDto(book.id, row);
        publish(request.user.id, "ink.updated", { ...dto, deviceId: request.body.deviceId ?? null });
        return dto;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  );
}
