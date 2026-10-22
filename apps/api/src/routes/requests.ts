import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireUser } from "../auth.js";
import { config, isAdmin } from "../config.js";
import { query } from "../db.js";
import { bookRequestEmail } from "../lib/emails.js";
import { broadcast, publish } from "../lib/events.js";
import { findOr404, obj, UUID_RE } from "../lib/http.js";
import { sendMailInBackground } from "../lib/mailer.js";
import { BlockedFileError } from "../lib/moderation.js";
import { publishBook } from "../lib/publicCatalog.js";
import { SELECT_BOOK, type BookRow } from "../lib/bookDto.js";

type RequestRow = {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  note: string | null;
  status: "open" | "fulfilled" | "closed";
  fulfilled_book_id: string | null;
  created_at: Date;
  requester: string | null;
  fulfiller: string | null;
  votes: string;
  voted: boolean;
  fulfilled_public: boolean;
};

const SELECT_REQUEST = `
  SELECT r.*, u.name AS requester, fu.name AS fulfiller,
         (SELECT count(*) FROM book_request_vote v WHERE v.request_id = r.id) AS votes,
         EXISTS (SELECT 1 FROM book_request_vote v WHERE v.request_id = r.id AND v.user_id = $1) AS voted,
         EXISTS (SELECT 1 FROM book b WHERE b.id = r.fulfilled_book_id AND b.is_public) AS fulfilled_public
  FROM book_request r
  JOIN "user" u ON u.id = r.user_id
  LEFT JOIN "user" fu ON fu.id = r.fulfilled_by`;

const toDto = (r: RequestRow, viewer: { id: string; email: string }) => ({
  id: r.id,
  title: r.title,
  author: r.author,
  note: r.note,
  status: r.status,
  requestedBy: r.requester,
  isMine: r.user_id === viewer.id,
  canClose: r.user_id === viewer.id || isAdmin(viewer),
  votes: Number(r.votes),
  voted: r.voted,
  /** The public book that answers the request, while it is still public. */
  fulfilledBookId: r.fulfilled_public ? r.fulfilled_book_id : null,
  fulfilledBy: r.fulfiller,
  createdAt: r.created_at.toISOString(),
});

/** "Please add this book" requests in the public library: anyone can ask, vote, or answer with a book. */
export async function requestRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  const load = (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) =>
    findOr404<RequestRow>(reply, UUID_RE.test(request.params.id), `${SELECT_REQUEST} WHERE r.id = $2`, [request.user.id, request.params.id]);

  app.get("/api/requests", async (request) => {
    const { rows } = await query<RequestRow>(
      `${SELECT_REQUEST}
       WHERE r.status <> 'closed'
       ORDER BY (r.status = 'open') DESC, votes DESC, r.created_at DESC
       LIMIT 500`,
      [request.user.id],
    );
    return rows.map((r) => toDto(r, request.user));
  });

  app.post<{ Body: { title: string; author?: string; note?: string } }>(
    "/api/requests",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        body: obj(
          {
            title: { type: "string", minLength: 1, maxLength: 300 },
            author: { type: "string", maxLength: 300 },
            note: { type: "string", maxLength: 1000 },
          },
          ["title"],
        ),
      },
    },
    async (request, reply) => {
      const { title, author, note } = request.body;
      if (!title.trim()) return reply.code(400).send({ error: "invalid_title" });
      const { rows } = await query<{ id: string }>(
        "INSERT INTO book_request (user_id, title, author, note) VALUES ($1, $2, $3, $4) RETURNING id",
        [request.user.id, title.trim(), author?.trim() || null, note?.trim() || null],
      );
      // Asking counts as a vote.
      await query("INSERT INTO book_request_vote (request_id, user_id) VALUES ($1, $2)", [rows[0]!.id, request.user.id]);
      broadcast("requests.changed", {});
      const requester = request.user.name.trim() || "Someone";
      for (const to of config.adminEmails) {
        if (to === request.user.email.toLowerCase()) continue;
        sendMailInBackground(bookRequestEmail(to, { title: title.trim(), author: author?.trim() || null, note: note?.trim() || null, requester }));
      }
      const created = await query<RequestRow>(`${SELECT_REQUEST} WHERE r.id = $2`, [request.user.id, rows[0]!.id]);
      return reply.code(201).send(toDto(created.rows[0]!, request.user));
    },
  );

  app.post<{ Params: { id: string } }>("/api/requests/:id/vote", async (request, reply) => {
    const r = await load(request, reply);
    if (!r) return;
    await query("INSERT INTO book_request_vote (request_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [r.id, request.user.id]);
    broadcast("requests.changed", {});
    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string } }>("/api/requests/:id/vote", async (request, reply) => {
    const r = await load(request, reply);
    if (!r) return;
    await query("DELETE FROM book_request_vote WHERE request_id = $1 AND user_id = $2", [r.id, request.user.id]);
    broadcast("requests.changed", {});
    return reply.code(204).send();
  });

  /** Answers a request with one of the caller's books, publishing it if needed. */
  app.post<{ Params: { id: string }; Body: { bookId: string } }>(
    "/api/requests/:id/fulfill",
    { schema: { body: obj({ bookId: { type: "string" } }, ["bookId"]) } },
    async (request, reply) => {
      const r = await load(request, reply);
      if (!r) return;
      if (r.status !== "open") return reply.code(409).send({ error: "not_open" });
      if (!UUID_RE.test(request.body.bookId)) return reply.code(404).send({ error: "book_not_found" });
      const { rows } = await query<BookRow>(`${SELECT_BOOK} WHERE b.id = $1 AND b.user_id = $2`, [
        request.body.bookId,
        request.user.id,
      ]);
      const book = rows[0];
      if (!book) return reply.code(404).send({ error: "book_not_found" });
      try {
        await publishBook(book); // a no-op if it already is public
      } catch (err) {
        if (err instanceof BlockedFileError) return reply.code(451).send({ error: "blocked_content" });
        throw err;
      }
      await query(
        "UPDATE book_request SET status = 'fulfilled', fulfilled_book_id = $2, fulfilled_by = $3, updated_at = now() WHERE id = $1",
        [r.id, book.id, request.user.id],
      );
      publish(r.user_id, "request.fulfilled", { requestId: r.id, title: r.title, bookId: book.id });
      broadcast("requests.changed", {});
      return reply.code(204).send();
    },
  );

  /** Closes a request (its author or an administrator). */
  app.delete<{ Params: { id: string } }>("/api/requests/:id", async (request, reply) => {
    const r = await load(request, reply);
    if (!r) return;
    if (r.user_id !== request.user.id && !isAdmin(request.user)) return reply.code(403).send({ error: "forbidden" });
    await query("UPDATE book_request SET status = 'closed', updated_at = now() WHERE id = $1", [r.id]);
    broadcast("requests.changed", {});
    return reply.code(204).send();
  });
}
