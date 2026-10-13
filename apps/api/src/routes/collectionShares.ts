import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireUser } from "../auth.js";
import { query } from "../db.js";
import { publish } from "../lib/events.js";
import { copyBookToUser } from "../lib/copies.js";
import { BlockedFileError } from "../lib/moderation.js";
import { QuotaExceededError } from "../lib/quota.js";
import { SELECT_BOOK, sendCover, toBookDto, type BookRow } from "./books.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

type SharedFolder = { id: string; name: string; user_id: string; owner_name: string | null };

/** The collection behind a share token, or a 404. */
async function loadSharedFolder(request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) {
  const { token } = request.params;
  const { rows } = TOKEN_RE.test(token)
    ? await query<SharedFolder>(
        `SELECT f.id, f.name, f.user_id, u.name AS owner_name
         FROM folder_share s JOIN folder f ON f.id = s.folder_id JOIN "user" u ON u.id = f.user_id
         WHERE s.token = $1`,
        [token],
      )
    : { rows: [] };
  if (!rows[0]) {
    reply.code(404).send({ error: "not_found" });
    return null;
  }
  return rows[0];
}

/** The collection's books as they are now (books added later show up for everyone with the link). */
async function folderBooks(folder: SharedFolder) {
  return (await query<BookRow>(`${SELECT_BOOK} WHERE b.folder_id = $1 AND b.user_id = $2 ORDER BY lower(b.title)`, [folder.id, folder.user_id])).rows;
}

async function loadOwnedFolder(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const { id } = request.params;
  const { rows } = UUID_RE.test(id)
    ? await query<{ id: string }>("SELECT id FROM folder WHERE id = $1 AND user_id = $2", [id, request.user.id])
    : { rows: [] };
  if (!rows[0]) {
    reply.code(404).send({ error: "not_found" });
    return null;
  }
  return rows[0];
}

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
    const book = (await folderBooks(folder)).find((b) => b.id === request.params.bookId);
    if (!book) return reply.code(404).send({ error: "not_found" });
    return sendCover(request, reply, book);
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

      let target = (await query<{ id: string; name: string; created_at: Date }>("SELECT * FROM folder WHERE user_id = $1 AND name = $2", [user.id, folder.name])).rows[0];
      if (!target) {
        target = (
          await query<{ id: string; name: string; created_at: Date }>(
            "INSERT INTO folder (user_id, name) VALUES ($1, $2) ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING *",
            [user.id, folder.name],
          )
        ).rows[0]!;
        publish(user.id, "folder.created", { id: target.id, name: target.name, createdAt: target.created_at.toISOString() });
      }

      let added = 0;
      let blocked = 0;
      let quota: QuotaExceededError | null = null;
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
        const { rows } = await query<BookRow>(`${SELECT_BOOK} WHERE b.id = $1`, [result.id]);
        publish(user.id, result.created ? "book.created" : "book.updated", toBookDto(rows[0]!));
        if (result.created) added++;
      }

      const body = { folderId: target.id, added, blocked };
      if (quota) return reply.code(413).send({ ...body, error: "quota_exceeded", usedBytes: quota.usedBytes, quotaBytes: quota.quotaBytes });
      return reply.code(added ? 201 : 200).send(body);
    },
  );
}
