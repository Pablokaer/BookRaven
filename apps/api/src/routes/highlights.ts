import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { query } from "../db.js";
import { publish } from "../lib/events.js";
import { loadOwnedBook } from "./books.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLORS = ["yellow", "green", "blue", "pink"];

type HighlightRow = {
  id: string;
  book_id: string;
  cfi: string;
  text: string;
  color: string;
  label: string | null;
  created_at: Date;
};

const toDto = (r: HighlightRow) => ({
  id: r.id,
  bookId: r.book_id,
  cfi: r.cfi,
  text: r.text,
  color: r.color,
  label: r.label,
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
    return rows.map(toDto);
  });

  app.post<{ Params: { id: string }; Body: { cfi: string; text: string; color: string; label?: string | null } }>(
    "/api/books/:id/highlights",
    {
      schema: {
        body: {
          type: "object",
          required: ["cfi", "text", "color"],
          additionalProperties: false,
          properties: {
            cfi: { type: "string", minLength: 1, maxLength: 2000 },
            text: { type: "string", minLength: 1, maxLength: 10000 },
            color: { type: "string", enum: COLORS },
            label: { type: ["string", "null"], maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const book = await loadOwnedBook(request, reply);
      if (!book) return;
      const { cfi, text, color, label } = request.body;
      // Highlighting the exact same passage again just changes its color.
      const { rows } = await query<HighlightRow>(
        `INSERT INTO highlight (user_id, book_id, cfi, text, color, label) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (book_id, cfi) DO UPDATE SET color = EXCLUDED.color
         RETURNING *`,
        [request.user.id, book.id, cfi, text, color, label ?? null],
      );
      const dto = toDto(rows[0]!);
      publish(request.user.id, "highlight.saved", dto);
      return reply.code(201).send(dto);
    },
  );

  app.patch<{ Params: { id: string }; Body: { color: string } }>(
    "/api/highlights/:id",
    {
      schema: {
        body: {
          type: "object",
          required: ["color"],
          additionalProperties: false,
          properties: { color: { type: "string", enum: COLORS } },
        },
      },
    },
    async (request, reply) => {
      if (!UUID_RE.test(request.params.id)) return reply.code(404).send({ error: "not_found" });
      const { rows } = await query<HighlightRow>(
        "UPDATE highlight SET color = $1 WHERE id = $2 AND user_id = $3 RETURNING *",
        [request.body.color, request.params.id, request.user.id],
      );
      if (!rows[0]) return reply.code(404).send({ error: "not_found" });
      const dto = toDto(rows[0]);
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
    publish(request.user.id, "highlight.deleted", { id: request.params.id, bookId: rows[0].book_id });
    return reply.code(204).send();
  });
}
