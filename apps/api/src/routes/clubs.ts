import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireUser } from "../auth.js";
import { query } from "../db.js";
import { copyOrReply } from "../lib/copies.js";
import { forgetClubMembership, memberIds, notifyMembers } from "../lib/clubs.js";
import { publish } from "../lib/events.js";
import { findOr404, obj, TOKEN_RE, UUID_RE } from "../lib/http.js";
import { sendCover, type BookRow } from "./books.js";
const newToken = () => randomBytes(15).toString("base64url");

type ClubRow = {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  sha256: string;
  book_title: string;
  book_author: string | null;
  cover_book_id: string | null;
  invite_token: string;
  created_at: Date;
};

function summary(c: ClubRow & { members?: string; my_book_id?: string | null }, viewer: string) {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    book: { title: c.book_title, author: c.book_author, hasCover: Boolean(c.cover_book_id) },
    isOwner: c.owner_id === viewer,
    members: c.members !== undefined ? Number(c.members) : undefined,
    /** The viewer's own copy of the book. */
    myBookId: c.my_book_id ?? null,
    createdAt: c.created_at.toISOString(),
  };
}

export async function clubRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  const loadMember = (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) =>
    findOr404<ClubRow & { my_book_id: string | null }>(
      reply,
      UUID_RE.test(request.params.id),
      `SELECT c.*, (SELECT b.id FROM book b WHERE b.user_id = $2 AND b.sha256 = c.sha256) AS my_book_id
       FROM club c JOIN club_member m ON m.club_id = c.id AND m.user_id = $2
       WHERE c.id = $1`,
      [request.params.id, request.user.id],
    );

  /** My clubs; `?bookId=` limits them to clubs reading that book. */
  app.get<{ Querystring: { bookId?: string } }>("/api/clubs", async (request) => {
    const byBook = request.query.bookId && UUID_RE.test(request.query.bookId) ? request.query.bookId : null;
    const { rows } = await query<ClubRow & { members: string; my_book_id: string | null }>(
      `SELECT c.*, (SELECT count(*) FROM club_member x WHERE x.club_id = c.id) AS members,
              (SELECT b.id FROM book b WHERE b.user_id = $1 AND b.sha256 = c.sha256) AS my_book_id
       FROM club c JOIN club_member m ON m.club_id = c.id AND m.user_id = $1
       ${byBook ? "WHERE c.sha256 = (SELECT sha256 FROM book WHERE id = $2 AND user_id = $1)" : ""}
       ORDER BY c.created_at DESC`,
      byBook ? [request.user.id, byBook] : [request.user.id],
    );
    return rows.map((c) => summary(c, request.user.id));
  });

  app.post<{ Body: { bookId: string; name: string; description?: string } }>(
    "/api/clubs",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        body: obj(
          { bookId: { type: "string" }, name: { type: "string", minLength: 1, maxLength: 100 }, description: { type: "string", maxLength: 1000 } },
          ["bookId", "name"],
        ),
      },
    },
    async (request, reply) => {
      const { bookId, name, description } = request.body;
      if (!UUID_RE.test(bookId)) return reply.code(404).send({ error: "book_not_found" });
      const { rows: books } = await query<Pick<BookRow, "id" | "sha256" | "title" | "author" | "has_cover">>(
        "SELECT id, sha256, title, author, has_cover FROM book WHERE id = $1 AND user_id = $2",
        [bookId, request.user.id],
      );
      const book = books[0];
      if (!book) return reply.code(404).send({ error: "book_not_found" });
      const { rows } = await query<ClubRow>(
        `INSERT INTO club (name, description, owner_id, sha256, book_title, book_author, cover_book_id, invite_token)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [name.trim(), description?.trim() || null, request.user.id, book.sha256, book.title, book.author, book.has_cover ? book.id : null, newToken()],
      );
      await query("INSERT INTO club_member (club_id, user_id) VALUES ($1, $2)", [rows[0]!.id, request.user.id]);
      forgetClubMembership([request.user.id]);
      return reply.code(201).send({ ...summary({ ...rows[0]!, members: "1", my_book_id: book.id }, request.user.id), inviteToken: rows[0]!.invite_token });
    },
  );

  /** Club page: members with their progress, and the discussion. */
  app.get<{ Params: { id: string } }>("/api/clubs/:id", async (request, reply) => {
    const club = await loadMember(request, reply);
    if (!club) return;
    const [{ rows: members }, { rows: messages }] = await Promise.all([
      query<{ id: string; name: string; joined_at: Date; percentage: number | null; updated_at: Date | null; label: string | null }>(
        `SELECT u.id, u.name, m.joined_at, p.percentage, p.updated_at, p.label
         FROM club_member m JOIN "user" u ON u.id = m.user_id
         LEFT JOIN book b ON b.user_id = m.user_id AND b.sha256 = $2
         LEFT JOIN reading_progress p ON p.book_id = b.id AND p.user_id = m.user_id
         WHERE m.club_id = $1
         ORDER BY p.percentage DESC NULLS LAST, m.joined_at`,
        [club.id, club.sha256],
      ),
      query<{ id: string; user_id: string | null; name: string | null; text: string; quote: string | null; locator: string | null; created_at: Date }>(
        `SELECT x.*, u.name FROM club_message x LEFT JOIN "user" u ON u.id = x.user_id
         WHERE x.club_id = $1 ORDER BY x.created_at DESC LIMIT 300`,
        [club.id],
      ),
    ]);
    return {
      ...summary(club, request.user.id),
      inviteToken: club.invite_token,
      members: members.map((m) => ({
        id: m.id,
        name: m.name,
        isOwner: m.id === club.owner_id,
        isMe: m.id === request.user.id,
        joinedAt: m.joined_at.toISOString(),
        progress: m.percentage,
        progressLabel: m.label,
        progressAt: m.updated_at?.toISOString() ?? null,
      })),
      messages: messages.reverse().map((x) => ({
        id: x.id,
        author: x.name ?? "Former member",
        isMine: x.user_id === request.user.id,
        canDelete: x.user_id === request.user.id || club.owner_id === request.user.id,
        text: x.text,
        quote: x.quote,
        locator: x.locator,
        createdAt: x.created_at.toISOString(),
      })),
    };
  });

  app.get<{ Params: { id: string } }>("/api/clubs/:id/cover", async (request, reply) => {
    const club = await loadMember(request, reply);
    if (!club) return;
    if (!club.cover_book_id) return reply.code(404).send({ error: "no_cover" });
    const { rows } = await query<Pick<BookRow, "id" | "has_cover">>("SELECT id, has_cover FROM book WHERE id = $1", [club.cover_book_id]);
    return rows[0] ? sendCover(request, reply, rows[0]) : reply.code(404).send({ error: "no_cover" });
  });

  app.post<{ Params: { id: string }; Body: { text: string; quote?: string; locator?: string } }>(
    "/api/clubs/:id/messages",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        body: obj(
          { text: { type: "string", minLength: 1, maxLength: 4000 }, quote: { type: "string", maxLength: 3000 }, locator: { type: "string", maxLength: 2000 } },
          ["text"],
        ),
      },
    },
    async (request, reply) => {
      const club = await loadMember(request, reply);
      if (!club) return;
      const text = request.body.text.trim();
      if (!text) return reply.code(400).send({ error: "empty" });
      await query("INSERT INTO club_message (club_id, user_id, text, quote, locator) VALUES ($1, $2, $3, $4, $5)", [
        club.id,
        request.user.id,
        text,
        request.body.quote?.trim() || null,
        request.body.locator || null,
      ]);
      await notifyMembers(club.id, "club.message", { clubId: club.id, clubName: club.name, author: request.user.name, fromId: request.user.id });
      return reply.code(201).send({ ok: true });
    },
  );

  app.delete<{ Params: { id: string; messageId: string } }>("/api/clubs/:id/messages/:messageId", async (request, reply) => {
    const club = await loadMember(request, reply);
    if (!club || !UUID_RE.test(request.params.messageId)) return club ? reply.code(404).send({ error: "not_found" }) : undefined;
    const res = await query("DELETE FROM club_message WHERE id = $1 AND club_id = $2 AND (user_id = $3 OR $4)", [
      request.params.messageId,
      club.id,
      request.user.id,
      club.owner_id === request.user.id,
    ]);
    if (!res.rowCount) return reply.code(404).send({ error: "not_found" });
    await notifyMembers(club.id, "club.message", { clubId: club.id });
    return reply.code(204).send();
  });

  // ---- invites ----

  app.get<{ Params: { token: string } }>("/api/clubs/invite/:token", async (request, reply) => {
    const c = await findOr404<ClubRow & { members: string; owner_name: string; is_member: boolean; my_book_id: string | null }>(
      reply,
      TOKEN_RE.test(request.params.token),
      `SELECT c.*, u.name AS owner_name, (SELECT count(*) FROM club_member x WHERE x.club_id = c.id) AS members,
              EXISTS (SELECT 1 FROM club_member x WHERE x.club_id = c.id AND x.user_id = $2) AS is_member,
              (SELECT b.id FROM book b WHERE b.user_id = $2 AND b.sha256 = c.sha256) AS my_book_id
       FROM club c JOIN "user" u ON u.id = c.owner_id WHERE c.invite_token = $1`,
      [request.params.token, request.user.id],
    );
    if (!c) return;
    return { ...summary(c, request.user.id), ownerName: c.owner_name, isMember: c.is_member };
  });

  /** Joins a club and adds the book to the new member's library if needed. */
  app.post<{ Params: { token: string } }>("/api/clubs/invite/:token/join", async (request, reply) => {
    const club = await findOr404<ClubRow & { owner_name: string }>(
      reply,
      TOKEN_RE.test(request.params.token),
      `SELECT c.*, u.name AS owner_name FROM club c JOIN "user" u ON u.id = c.owner_id WHERE c.invite_token = $1`,
      [request.params.token],
    );
    if (!club) return;

    // Any existing copy of the file works as the source.
    const { rows: src } = await query<BookRow>("SELECT * FROM book WHERE sha256 = $1 ORDER BY (id = $2) DESC LIMIT 1", [
      club.sha256,
      club.cover_book_id,
    ]);
    if (!src[0]) return reply.code(410).send({ error: "book_gone" });
    const copy = await copyOrReply(reply, src[0], request.user, club.owner_name);
    if (!copy) return;
    const joined = await query("INSERT INTO club_member (club_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [club.id, request.user.id]);
    forgetClubMembership([request.user.id]);
    if (joined.rowCount) await notifyMembers(club.id, "club.member", { clubId: club.id, name: request.user.name });
    return { clubId: club.id, bookId: copy.id };
  });

  app.post<{ Params: { id: string } }>("/api/clubs/:id/invite/reset", async (request, reply) => {
    const club = await loadMember(request, reply);
    if (!club) return;
    if (club.owner_id !== request.user.id) return reply.code(403).send({ error: "forbidden" });
    const token = newToken();
    await query("UPDATE club SET invite_token = $2 WHERE id = $1", [club.id, token]);
    return { inviteToken: token };
  });

  /** Leave (yourself) or remove a member (the owner). The owner deletes the club instead of leaving. */
  app.delete<{ Params: { id: string; userId: string } }>("/api/clubs/:id/members/:userId", async (request, reply) => {
    const club = await loadMember(request, reply);
    if (!club) return;
    const target = request.params.userId === "me" ? request.user.id : request.params.userId;
    if (target === club.owner_id) return reply.code(400).send({ error: "owner_cannot_leave" });
    if (target !== request.user.id && club.owner_id !== request.user.id) return reply.code(403).send({ error: "forbidden" });
    await query("DELETE FROM club_member WHERE club_id = $1 AND user_id = $2", [club.id, target]);
    forgetClubMembership([target]);
    await notifyMembers(club.id, "club.member", { clubId: club.id });
    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string } }>("/api/clubs/:id", async (request, reply) => {
    const club = await loadMember(request, reply);
    if (!club) return;
    if (club.owner_id !== request.user.id) return reply.code(403).send({ error: "forbidden" });
    const ids = await memberIds(club.id);
    await query("DELETE FROM club WHERE id = $1", [club.id]);
    forgetClubMembership(ids);
    for (const id of ids) publish(id, "club.deleted", { clubId: club.id });
    return reply.code(204).send();
  });
}
