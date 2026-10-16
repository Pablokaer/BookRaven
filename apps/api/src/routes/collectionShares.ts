import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireUser } from "../auth.js";
import { query } from "../db.js";
import { publish } from "../lib/events.js";
import { copyBookToUser } from "../lib/copies.js";
import { findOr404, TOKEN_RE, UUID_RE } from "../lib/http.js";
import { BlockedFileError } from "../lib/moderation.js";
import { QuotaExceededError, quotaBody } from "../lib/quota.js";
import { SELECT_BOOK, sendCover, toBookDto, type BookRow } from "./books.js";

type SharedFolder = { id: string; name: string; user_id: string; owner_name: string | null };

/** The collection behind a share token, or a 404. */
const loadSharedFolder = (request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) =>
  findOr404<SharedFolder>(
    reply,
    TOKEN_RE.test(request.params.token),
    `SELECT f.id, f.name, f.user_id, u.name AS owner_name
     FROM folder_share s JOIN folder f ON f.id = s.folder_id JOIN "user" u ON u.id = f.user_id
     WHERE s.token = $1`,
    [request.params.token],
  );

/** The collection's books as they are now (books added later show up for everyone with the link). */
async function folderBooks(folder: SharedFolder) {
  return (await query<BookRow>(`${SELECT_BOOK} WHERE b.folder_id = $1 AND b.user_id = $2 ORDER BY lower(b.title)`, [folder.id, folder.user_id])).rows;
}

const loadOwnedFolder = (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) =>
  findOr404<{ id: string }>(reply, UUID_RE.test(request.params.id), "SELECT id FROM folder WHERE id = $1 AND user_id = $2", [request.params.id, request.user.id]);

export async function collectionShareRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  // ---- Owner side ----

  app.get<{ Params: { id: string } }>("/api/folders/:id/share", async (request, reply) => {
    const folder = await loadOwnedFolder(request, reply);
    if (!folder) return;
    const { rows } = await query<{ token: string }>("SELECT token FROM folder_share WHERE folder_id = $1", [folder.id]);
    return { token: rows[0]?.token ?? null };
  });

  /** Creates the collection's share link, or returns the existing one. */
  app.post<{ Params: { id: string } }>("/api/folders/:id/share", async (request, reply) => {
    const folder = await loadOwnedFolder(request, reply);
    if (!folder) return;
    const { rows } = await query<{ token: string }>(
      `INSERT INTO folder_share (token, folder_id) VALUES ($1, $2)
       ON CONFLICT (folder_id) DO UPDATE SET folder_id = EXCLUDED.folder_id
       RETURNING token`,
      [randomBytes(18).toString("base64url"), folder.id],
    );
    return { token: rows[0]!.token };
  });

  /** Revokes the link. Copies already added by others are kept. */
  app.delete<{ Params: { id: string } }>("/api/folders/:id/share", async (request, reply) => {
    const folder = await loadOwnedFolder(request, reply);
    if (!folder) return;
    await query("DELETE FROM folder_share WHERE folder_id = $1", [folder.id]);
    return reply.code(204).send();
  });

  // ---- Recipient side ----

  app.get<{ Params: { token: string } }>("/api/collection-shares/:token", async (request, reply) => {
    const folder = await loadSharedFolder(request, reply);
    if (!folder) return;
    const books = await folderBooks(folder);
    const mine = new Map(
      (
        await query<{ id: string; sha256: string }>("SELECT id, sha256 FROM book WHERE user_id = $1 AND sha256 = ANY($2)", [
          request.user.id,
          books.map((b) => b.sha256),
        ])
      ).rows.map((r) => [r.sha256, r.id]),
    );
    return {
      name: folder.name,
      sharedBy: folder.owner_name,
      isOwner: folder.user_id === request.user.id,
      books: books.map((b) => ({
        id: b.id,
        title: b.title,
        author: b.author,
        format: b.format,
        sizeBytes: Number(b.size_bytes),
        hasCover: b.has_cover,
        ownBookId: mine.get(b.sha256) ?? null,
      })),
    };
  });

  app.get<{ Params: { token: string; bookId: string } }>("/api/collection-shares/:token/books/:bookId/cover", async (request, reply) => {
    const folder = await loadSharedFolder(request, reply);
    if (!folder) return;
    const { bookId } = request.params;
    const book = await findOr404<Pick<BookRow, "id" | "has_cover">>(
      reply,
      UUID_RE.test(bookId),
      "SELECT id, has_cover FROM book WHERE id = $1 AND folder_id = $2 AND user_id = $3",
      [bookId, folder.id, folder.user_id],
    );
    if (book) return sendCover(request, reply, book);
  });

  /**
   * Adds copies of every book in the collection to a collection of the same name in the
   * caller's library (created if needed). Books already there are kept; re-accepting adds
   * only what is new. Stops at the storage quota and reports how far it got.
   */
  app.post<{ Params: { token: string } }>(
    "/api/collection-shares/:token/accept",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const folder = await loadSharedFolder(request, reply);
      if (!folder) return;
      const user = request.user;
      if (folder.user_id === user.id) return reply.code(409).send({ error: "own_collection" });

      // xmax is 0 on a row this statement inserted (an existing one is only locked by the no-op update).
      const target = (
        await query<{ id: string; name: string; created_at: Date; inserted: boolean }>(
          "INSERT INTO folder (user_id, name) VALUES ($1, $2) ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING *, (xmax = 0) AS inserted",
          [user.id, folder.name],
        )
      ).rows[0]!;
      if (target.inserted) publish(user.id, "folder.created", { id: target.id, name: target.name, createdAt: target.created_at.toISOString() });

      let added = 0;
      let blocked = 0;
      let quota: QuotaExceededError | null = null;
      const copies: { id: string; created: boolean }[] = [];
      for (const src of await folderBooks(folder)) {
        let result;
        try {
          result = await copyBookToUser(src, user, folder.owner_name);
        } catch (err) {
          if (err instanceof BlockedFileError) {
            blocked++;
            continue;
          }
          if (err instanceof QuotaExceededError) {
            quota = err;
            break;
          }
          throw err;
        }
        // New copies go into the collection; books the caller already had move there only if they were loose.
        await query("UPDATE book SET folder_id = $2 WHERE id = $1 AND (folder_id IS NULL OR $3)", [result.id, target.id, result.created]);
        copies.push(result);
        if (result.created) added++;
      }
      const rows = new Map((await query<BookRow>(`${SELECT_BOOK} WHERE b.id = ANY($1)`, [copies.map((c) => c.id)])).rows.map((r) => [r.id, r]));
      for (const c of copies) publish(user.id, c.created ? "book.created" : "book.updated", toBookDto(rows.get(c.id)!));

      const body = { folderId: target.id, added, blocked };
      if (quota) return reply.code(413).send({ ...body, ...quotaBody(quota) });
      return reply.code(added ? 201 : 200).send(body);
    },
  );
}
