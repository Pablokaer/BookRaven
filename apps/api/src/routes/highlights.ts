import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { query } from "../db.js";
import { publish } from "../lib/events.js";
import { obj, UUID_RE } from "../lib/http.js";
import { forgetOnKoreader } from "../lib/koreaderAnnotations.js";
import { loadOwnedBook } from "./books.js";
const COLORS = ["yellow", "green", "blue", "pink"];

export type HighlightRow = {
  id: string;
  book_id: string;
  cfi: string;
  text: string;
  color: string;
  label: string | null;
  note: string | null;
  created_at: Date;
};

export const highlightDto = (r: HighlightRow) => ({
  id: r.id,
  bookId: r.book_id,
  cfi: r.cfi,
  text: r.text,
  color: r.color,
  label: r.label,
  note: r.note,
  createdAt: r.created_at.toISOString(),
});

export async function highlightRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get<{ Params: { id: string } }>("/api/books/:id/highlights", async (request, reply) => {
    const book = await loadOwnedBook(request, reply);
    if (!book) return;
    const { rows } = await query<HighlightRow>("SELECT * FROM highlight WHERE book_id = $1 ORDER BY created_at", [
      book.id,
    ]);
    return rows.map(highlightDto);
  });

  app.post<{ Params: { id: string }; Body: { cfi: string; text: string; color: string; label?: string | null; note?: string | null } }>(
    "/api/books/:id/highlights",
    {
      schema: {
        body: obj(
          {
            cfi: { type: "string", minLength: 1, maxLength: 2000 },
            text: { type: "string", minLength: 1, maxLength: 10000 },
            color: { type: "string", enum: COLORS },
            label: { type: ["string", "null"], maxLength: 500 },
            note: { type: ["string", "null"], maxLength: 5000 },
          },
          ["cfi", "text", "color"],
        ),
      },
    },
    async (request, reply) => {
      const book = await loadOwnedBook(request, reply);
      if (!book) return;
      const { cfi, text, color, label, note } = request.body;
      // Highlighting the exact same passage again just updates it.
      const { rows } = await query<HighlightRow>(
        `INSERT INTO highlight (user_id, book_id, cfi, text, color, label, note) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (book_id, cfi) DO UPDATE SET color = EXCLUDED.color, note = COALESCE(EXCLUDED.note, highlight.note), updated_at = now()
         RETURNING *`,
        [request.user.id, book.id, cfi, text, color, label ?? null, note?.trim() || null],
      );
      const dto = highlightDto(rows[0]!);
      publish(request.user.id, "highlight.saved", dto);
      return reply.code(201).send(dto);
    },
  );

  /** Changes the color and/or the note (an empty note removes it). */
  app.patch<{ Params: { id: string }; Body: { color?: string; note?: string | null } }>(
    "/api/highlights/:id",
    {
      schema: {
        body: obj({ color: { type: "string", enum: COLORS }, note: { type: ["string", "null"], maxLength: 5000 } }, undefined, { minProperties: 1 }),
      },
    },
    async (request, reply) => {
      if (!UUID_RE.test(request.params.id)) return reply.code(404).send({ error: "not_found" });
      const { rows } = await query<HighlightRow>(
        `UPDATE highlight SET color = COALESCE($1, color), note = CASE WHEN $4 THEN $5 ELSE note END, updated_at = now()
         WHERE id = $2 AND user_id = $3 RETURNING *`,
        [
          request.body.color ?? null,
          request.params.id,
          request.user.id,
          request.body.note !== undefined,
          request.body.note?.trim() || null,
        ],
      );
      if (!rows[0]) return reply.code(404).send({ error: "not_found" });
      const dto = highlightDto(rows[0]);
      publish(request.user.id, "highlight.saved", dto);
      return dto;
    },
  );

  app.delete<{ Params: { id: string } }>("/api/highlights/:id", async (request, reply) => {
    if (!UUID_RE.test(request.params.id)) return reply.code(404).send({ error: "not_found" });
    const { rows } = await query<{ book_id: string }>(
      "DELETE FROM highlight WHERE id = $1 AND user_id = $2 RETURNING book_id",
      [request.params.id, request.user.id],
    );
    if (!rows[0]) return reply.code(404).send({ error: "not_found" });
    await forgetOnKoreader("highlight", request.params.id);
    publish(request.user.id, "highlight.deleted", { id: request.params.id, bookId: rows[0].book_id });
    return reply.code(204).send();
  });
}
