import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireUser } from "../auth.js";
import { query } from "../db.js";
import { publish } from "../lib/events.js";
import { addCopyAndReply } from "../lib/copies.js";
import { findOr404, TOKEN_RE } from "../lib/http.js";
import { loadOwnedBook, SELECT_BOOK, sendCover, toBookDto, type BookRow } from "./books.js";

/** Tells the owner's devices that the book's `isShared` flag changed. */
async function publishBook(userId: string, bookId: string) {
  const { rows } = await query<BookRow>(`${SELECT_BOOK} WHERE b.id = $1`, [bookId]);
  if (rows[0]) publish(userId, "book.updated", toBookDto(rows[0]));
}

/** The book behind a share token (the owner's copy), or a 404. */
const loadShared = (request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) =>
  findOr404<BookRow & { owner_name: string | null }>(
    reply,
    TOKEN_RE.test(request.params.token),
    `SELECT b.*, u.name AS owner_name
     FROM book_share s JOIN book b ON b.id = s.book_id JOIN "user" u ON u.id = b.user_id
     WHERE s.token = $1`,
    [request.params.token],
  );

export async function shareRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  // ---- Owner side ----

  app.get<{ Params: { id: string } }>("/api/books/:id/share", async (request, reply) => {
    const book = await loadOwnedBook(request, reply);
    if (!book) return;
    const { rows } = await query<{ token: string }>("SELECT token FROM book_share WHERE book_id = $1", [book.id]);
    return { token: rows[0]?.token ?? null };
  });

  /** Creates the book's share link, or returns the existing one. */
  app.post<{ Params: { id: string } }>("/api/books/:id/share", async (request, reply) => {
    const book = await loadOwnedBook(request, reply);
    if (!book) return;
    const { rows } = await query<{ token: string }>(
      `INSERT INTO book_share (token, book_id) VALUES ($1, $2)
       ON CONFLICT (book_id) DO UPDATE SET book_id = EXCLUDED.book_id
       RETURNING token`,
      [randomBytes(18).toString("base64url"), book.id],
    );
    if (!book.is_shared) await publishBook(request.user.id, book.id);
    return { token: rows[0]!.token };
  });

  /** Revokes the link. Copies already added by others are kept. */
  app.delete<{ Params: { id: string } }>("/api/books/:id/share", async (request, reply) => {
    const book = await loadOwnedBook(request, reply);
    if (!book) return;
    await query("DELETE FROM book_share WHERE book_id = $1", [book.id]);
    if (book.is_shared) await publishBook(request.user.id, book.id);
    return reply.code(204).send();
  });

  // ---- Recipient side ----

  app.get<{ Params: { token: string } }>("/api/shares/:token", async (request, reply) => {
    const book = await loadShared(request, reply);
    if (!book) return;
    const mine = await query<{ id: string }>("SELECT id FROM book WHERE user_id = $1 AND sha256 = $2", [
      request.user.id,
      book.sha256,
    ]);
    return {
      title: book.title,
      author: book.author,
      format: book.format,
      sizeBytes: Number(book.size_bytes),
      hasCover: book.has_cover,
      sharedBy: book.owner_name,
      ownBookId: mine.rows[0]?.id ?? null,
    };
  });

  app.get<{ Params: { token: string } }>("/api/shares/:token/cover", async (request, reply) => {
    const book = await loadShared(request, reply);
    if (book) return sendCover(request, reply, book);
  });

  /** Adds a copy of the shared book to the caller's library (idempotent). */
  app.post<{ Params: { token: string } }>(
    "/api/shares/:token/accept",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const src = await loadShared(request, reply);
      if (src) return addCopyAndReply(reply, src, request.user, src.owner_name);
    },
  );
}
