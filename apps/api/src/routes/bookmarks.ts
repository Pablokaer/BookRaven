import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { query } from "../db.js";
import { publish } from "../lib/events.js";
import { loadOwnedBook } from "./books.js";

/** More than enough for any book; stops a runaway client. */
export const MAX_BOOKMARKS_PER_BOOK = 2000;

type BookmarkRow = {
  id: string;
  book_id: string;
  locator: string;
  percentage: number;
  label: string | null;
  title: string | null;
  created_at: Date;
};

const toDto = (r: BookmarkRow) => ({
  id: r.id,
  bookId: r.book_id,
  locator: r.locator,
  percentage: r.percentage,
  label: r.label,
  title: r.title,
  createdAt: r.created_at.toISOString(),
});

/**
 * Bookmarked pages. A page is identified by its locator, so saving the same page again (or
 * replaying an offline device's queue) updates it instead of adding a copy.
 */
export async function bookmarkRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get<{ Params: { id: string } }>("/api/books/:id/bookmarks", async (request, reply) => {
    const book = await loadOwnedBook(request, reply);
    if (!book) return;
    const { rows } = await query<BookmarkRow>(
      "SELECT * FROM bookmark WHERE book_id = $1 AND user_id = $2 ORDER BY percentage, created_at",
      [book.id, request.user.id],
    );
    return rows.map(toDto);
  });

  /** Adds a bookmark, or updates the one on that page. A `title` of null clears it; leaving it out keeps it. */
  app.put<{ Params: { id: string }; Body: { locator: string; percentage: number; label?: string | null; title?: string | null } }>(
    "/api/books/:id/bookmarks",
    {
      schema: {
        body: {
          type: "object",
          required: ["locator", "percentage"],
          additionalProperties: false,
          properties: {
            locator: { type: "string", minLength: 1, maxLength: 2000 },
            percentage: { type: "number", minimum: 0, maximum: 1 },
            label: { type: ["string", "null"], maxLength: 500 },
            title: { type: ["string", "null"], maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const book = await loadOwnedBook(request, reply);
      if (!book) return;
      const { locator, percentage, label, title } = request.body;
      const { rows: count } = await query<{ n: number; here: boolean }>(
        "SELECT count(*)::int AS n, bool_or(locator = $3) AS here FROM bookmark WHERE book_id = $1 AND user_id = $2",
        [book.id, request.user.id, locator],
      );
      if (count[0]!.n >= MAX_BOOKMARKS_PER_BOOK && !count[0]!.here) return reply.code(409).send({ error: "too_many_bookmarks" });
      const { rows } = await query<BookmarkRow>(
        `INSERT INTO bookmark (user_id, book_id, locator, percentage, label, title) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, book_id, locator) DO UPDATE SET
           label = COALESCE(EXCLUDED.label, bookmark.label),
           title = CASE WHEN $7 THEN EXCLUDED.title ELSE bookmark.title END
         RETURNING *`,
        [request.user.id, book.id, locator, percentage, label?.trim() || null, title?.trim() || null, title !== undefined],
      );
      const dto = toDto(rows[0]!);
      publish(request.user.id, "bookmark.saved", dto);
      return dto;
    },
  );

  /** Removes the bookmark on a page (`?locator=`); removing one that is already gone is fine. */
  app.delete<{ Params: { id: string }; Querystring: { locator: string } }>(
    "/api/books/:id/bookmarks",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["locator"],
          properties: { locator: { type: "string", minLength: 1, maxLength: 2000 } },
        },
      },
    },
    async (request, reply) => {
      const book = await loadOwnedBook(request, reply);
      if (!book) return;
      const { locator } = request.query;
      const { rowCount } = await query("DELETE FROM bookmark WHERE book_id = $1 AND user_id = $2 AND locator = $3", [
        book.id,
        request.user.id,
        locator,
      ]);
      if (rowCount) publish(request.user.id, "bookmark.deleted", { bookId: book.id, locator });
      return reply.code(204).send();
    },
  );
}
