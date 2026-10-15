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

const pageParams = {
  type: "object",
  required: ["id", "page"],
  properties: { id: { type: "string" }, page: { type: "string", pattern: "^[1-9][0-9]{0,5}$" } },
};

type PageRow = { page: number; version: number; updated_at: Date; strokes: Stroke[] };

/** Pages of a book (all, or those in $3) with their strokes in drawing order. Pages emptied by the eraser stay, with their version. */
const PAGES_SQL = `
  SELECT p.page, p.version, p.updated_at,
         COALESCE(jsonb_agg(s.stroke ORDER BY s.seq) FILTER (WHERE s.id IS NOT NULL), '[]'::jsonb) AS strokes
  FROM pdf_ink_page p
  LEFT JOIN pdf_ink_stroke s ON s.user_id = p.user_id AND s.book_id = p.book_id AND s.page = p.page
  WHERE p.user_id = $1 AND p.book_id = $2 AND ($3::int[] IS NULL OR p.page = ANY($3))
  GROUP BY p.page, p.version, p.updated_at
  ORDER BY p.page`;

/** Every page with handwriting, without the strokes: what a reader needs to open a book quickly. */
const SUMMARY_SQL = `
  SELECT p.page, p.version, p.updated_at, count(s.id)::int AS count
  FROM pdf_ink_page p
  LEFT JOIN pdf_ink_stroke s ON s.user_id = p.user_id AND s.book_id = p.book_id AND s.page = p.page
  WHERE p.user_id = $1 AND p.book_id = $2
  GROUP BY p.page, p.version, p.updated_at
  ORDER BY p.page`;

const toDto = (bookId: string, r: PageRow) => ({ bookId, page: r.page, version: r.version, strokes: r.strokes, updatedAt: r.updated_at.toISOString() });

/**
 * Pen annotations on PDF pages, stored one row per stroke. Devices send changes ("these strokes
 * were added, those were erased"), so two devices annotating a page (even offline) both keep their
 * strokes and replaying a change is harmless. Every change raises the page's version; the live
 * event carries the change and that version, so other devices apply changes in order and fetch
 * the page again when they missed one.
 */
export async function inkRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  /** All pages with their strokes; `?pages=3,4,5` only those pages; `?summary=1` every page's version and stroke count, no strokes. */
  app.get<{ Params: { id: string }; Querystring: { pages?: string; summary?: string } }>(
    "/api/books/:id/ink",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            pages: { type: "string", pattern: "^[1-9][0-9]{0,5}(,[1-9][0-9]{0,5}){0,199}$" },
            summary: { type: "string", enum: ["1", "true"] },
          },
        },
      },
    },
    async (request, reply) => {
      const book = await loadOwnedBook(request, reply);
      if (!book) return;
      if (request.query.summary) {
        const { rows } = await query<{ page: number; version: number; updated_at: Date; count: number }>(SUMMARY_SQL, [request.user.id, book.id]);
        return rows.map((r) => ({ bookId: book.id, page: r.page, version: r.version, count: r.count, updatedAt: r.updated_at.toISOString() }));
      }
      const pages = request.query.pages ? [...new Set(request.query.pages.split(",").map(Number))] : null;
      const { rows } = await query<PageRow>(PAGES_SQL, [request.user.id, book.id, pages]);
      return rows.map((r) => toDto(book.id, r));
    },
  );

  app.get<{ Params: { id: string; page: string } }>("/api/books/:id/ink/:page", { schema: { params: pageParams } }, async (request, reply) => {
    const book = await loadOwnedBook(request, reply);
    if (!book) return;
    const page = Number(request.params.page);
    const { rows } = await query<PageRow>(PAGES_SQL, [request.user.id, book.id, [page]]);
    return toDto(book.id, rows[0] ?? { page, version: 0, updated_at: new Date(0), strokes: [] });
  });

  app.post<{
    Params: { id: string; page: string };
    Body: { add?: Stroke[]; remove?: string[]; deviceId?: string };
  }>(
    "/api/books/:id/ink/:page",
    {
      bodyLimit: 4 * 1024 * 1024,
      schema: {
        params: pageParams,
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
      if ((request.body.add ?? []).some((s) => s.points.length % 3 !== 0)) return reply.code(400).send({ error: "points_must_be_triples" });
      // The last stroke with a given id wins, as on the devices.
      const add = [...new Map((request.body.add ?? []).map((s) => [s.id, { id: s.id, tool: s.tool, color: s.color.toLowerCase(), width: s.width, points: s.points }])).values()];
      const remove = [...new Set(request.body.remove ?? [])];
      const key = [request.user.id, book.id, page];

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Raising the version also locks the page: changes to one page run one at a time.
        const { rows } = await client.query<{ version: number; updated_at: Date }>(
          `INSERT INTO pdf_ink_page (user_id, book_id, page, version) VALUES ($1, $2, $3, 1)
           ON CONFLICT (user_id, book_id, page) DO UPDATE SET version = pdf_ink_page.version + 1, updated_at = now()
           RETURNING version, updated_at`,
          key,
        );
        // Erased strokes go, and re-added ones are replaced (they move on top, like on the devices).
        const gone = [...new Set([...remove, ...add.map((s) => s.id)])];
        if (gone.length) await client.query("DELETE FROM pdf_ink_stroke WHERE user_id = $1 AND book_id = $2 AND page = $3 AND id = ANY($4)", [...key, gone]);
        if (add.length) {
          await client.query(
            `INSERT INTO pdf_ink_stroke (user_id, book_id, page, id, stroke)
             SELECT $1, $2, $3, s.value ->> 'id', s.value FROM jsonb_array_elements($4::jsonb) WITH ORDINALITY AS s(value, n) ORDER BY s.n`,
            [...key, JSON.stringify(add)],
          );
        }
        const { rows: size } = await client.query<{ n: number; bytes: string }>(
          "SELECT count(*)::int AS n, COALESCE(sum(octet_length(stroke::text)), 0) AS bytes FROM pdf_ink_stroke WHERE user_id = $1 AND book_id = $2 AND page = $3",
          key,
        );
        if (size[0]!.n > MAX_STROKES_PER_PAGE || Number(size[0]!.bytes) > MAX_PAGE_INK_BYTES) {
          await client.query("ROLLBACK");
          return reply.code(413).send({ error: "page_ink_too_large" });
        }
        await client.query("COMMIT");
        const done = { bookId: book.id, page, version: rows[0]!.version, updatedAt: rows[0]!.updated_at.toISOString() };
        publish(request.user.id, "ink.updated", { ...done, add, remove, deviceId: request.body.deviceId ?? null });
        return done;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  );
}
