import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireUser } from "../auth.js";
import { isAdmin } from "../config.js";
import { query } from "../db.js";
import { aboutFile } from "../lib/bookAbout.js";
import { copyBookToUser } from "../lib/copies.js";
import { broadcast, publish } from "../lib/events.js";
import { BlockedFileError } from "../lib/moderation.js";
import { QuotaExceededError } from "../lib/quota.js";
import { SOURCE_NAMES } from "../lib/otherSources.js";
import { themesFor } from "../lib/themes.js";
import { bookKey } from "../lib/storage.js";
import { adminUserIds } from "./admin.js";
import { SELECT_BOOK, sendCover, sendFile, toBookDto, type BookRow } from "./books.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PublicRow = BookRow & {
  user_id: string;
  owner_name: string | null;
  language?: string | null;
  source_url?: string | null;
  /** Catalog the book was imported from (gutenberg, standardebooks, wikisource). */
  source?: string | null;
  themes?: string[];
  download_count?: number | null;
};

const toPublicDto = (r: PublicRow & { own_book_id: string | null }, viewer: { id: string; email: string }) => ({
  id: r.id,
  title: r.title,
  author: r.author,
  format: r.format,
  filename: r.original_filename,
  sizeBytes: Number(r.size_bytes),
  hasCover: r.has_cover,
  language: r.language ?? null,
  /** Where an imported public-domain book comes from. */
  source: r.source_url ? { name: SOURCE_NAMES[r.source ?? ""] ?? "Public domain", url: r.source_url } : null,
  /** Library sections: from the catalog for imported books, from tags for the others. */
  themes: [...new Set([...(r.themes ?? []), ...themesFor(r.tags ?? [])])],
  /** Downloads at the source (Gutenberg), a popularity signal; null for books people published. */
  popularity: r.download_count ?? null,
  description: r.description,
  publishedBy: r.owner_name,
  publishedAt: (r.published_at ?? r.created_at).toISOString(),
  /** The viewer's own copy of this file, if they have one. */
  ownBookId: r.own_book_id,
  isMine: r.user_id === viewer.id,
  /** The publisher and administrators can take a book out of the public library. */
  canRemove: r.user_id === viewer.id || isAdmin(viewer),
});

/** A published book by id, or a 404 (unpublished books are invisible here). */
async function loadPublic(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  if (!UUID_RE.test(request.params.id)) {
    reply.code(404).send({ error: "not_found" });
    return null;
  }
  const { rows } = await query<PublicRow>(
    `SELECT b.*, u.name AS owner_name FROM book b JOIN "user" u ON u.id = b.user_id
     WHERE b.id = $1 AND b.is_public`,
    [request.params.id],
  );
  if (!rows[0]) {
    reply.code(404).send({ error: "not_found" });
    return null;
  }
  return rows[0];
}

/**
 * Public library: books their owners published for every signed-in account.
 * Anyone can download the file or add a copy to their own library.
 */
export async function publicRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get("/api/public", async (request) => {
    // The same file published by several people is listed once (earliest publication).
    const { rows } = await query<PublicRow & { own_book_id: string | null }>(
      `SELECT * FROM (
         SELECT DISTINCT ON (b.sha256) b.*, u.name AS owner_name, cb.source, cb.source_url, cb.download_count,
                (SELECT m.id FROM book m WHERE m.user_id = $1 AND m.sha256 = b.sha256) AS own_book_id
         FROM book b JOIN "user" u ON u.id = b.user_id
         LEFT JOIN catalog_book cb ON cb.book_id = b.id
         WHERE b.is_public
         ORDER BY b.sha256, b.published_at
       ) t
       ORDER BY published_at DESC
       LIMIT 1000`,
      [request.user.id],
    );
    return rows.map((r) => toPublicDto(r, request.user));
  });

  /** One public book, for its page: also how many people have it and its catalog subjects. */
  app.get<{ Params: { id: string } }>("/api/public/:id", async (request, reply) => {
    if (!UUID_RE.test(request.params.id)) return reply.code(404).send({ error: "not_found" });
    const { rows } = await query<PublicRow & { own_book_id: string | null }>(
      `SELECT b.*, u.name AS owner_name, cb.source, cb.source_url, cb.download_count,
              (SELECT m.id FROM book m WHERE m.user_id = $2 AND m.sha256 = b.sha256) AS own_book_id
       FROM book b JOIN "user" u ON u.id = b.user_id
       LEFT JOIN catalog_book cb ON cb.book_id = b.id
       WHERE b.id = $1 AND b.is_public`,
      [request.params.id, request.user.id],
    );
    const r = rows[0];
    if (!r) return reply.code(404).send({ error: "not_found" });
    const about = await aboutFile(r.sha256, null); // everyone who has it, the viewer included
    return { ...toPublicDto(r, request.user), readers: about.readers, subjects: about.subjects };
  });

  app.get<{ Params: { id: string } }>("/api/public/:id/cover", async (request, reply) => {
    const book = await loadPublic(request, reply);
    if (book) return sendCover(request, reply, book);
  });

  /** Downloads the original file. */
  app.get<{ Params: { id: string } }>(
    "/api/public/:id/file",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const book = await loadPublic(request, reply);
      if (!book) return;
      reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(book.original_filename)}`);
      return sendFile(request, reply, bookKey(book.sha256), book.mime_type, book.sha256);
    },
  );

  /** Adds a copy to the caller's library (counts toward their storage limit). */
  app.post<{ Params: { id: string } }>(
    "/api/public/:id/add",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const src = await loadPublic(request, reply);
      if (!src) return;
      let result;
      try {
        result = await copyBookToUser(src, request.user, src.user_id === request.user.id ? null : src.owner_name);
      } catch (err) {
        if (err instanceof BlockedFileError) return reply.code(451).send({ error: "blocked_content" });
        if (err instanceof QuotaExceededError) {
          return reply.code(413).send({ error: "quota_exceeded", usedBytes: err.usedBytes, quotaBytes: err.quotaBytes });
        }
        throw err;
      }
      const { rows } = await query<BookRow>(`${SELECT_BOOK} WHERE b.id = $1`, [result.id]);
      const dto = toBookDto(rows[0]!);
      if (result.created) publish(request.user.id, "book.created", dto);
      return reply.code(result.created ? 201 : 200).send(dto);
    },
  );

  /** Reports a public book to the administrators (copyright, illegal content, ...). */
  app.post<{ Params: { id: string }; Body: { reason: string; details?: string } }>(
    "/api/public/:id/report",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          required: ["reason"],
          additionalProperties: false,
          properties: {
            reason: { type: "string", enum: ["copyright", "illegal", "offensive", "spam", "other"] },
            details: { type: "string", maxLength: 2000 },
          },
        },
      },
    },
    async (request, reply) => {
      const book = await loadPublic(request, reply);
      if (!book) return;
      if (book.user_id === request.user.id) return reply.code(400).send({ error: "own_book" });
      const res = await query(
        `INSERT INTO content_report (book_id, sha256, title, reporter_id, reason, details)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (reporter_id, sha256) WHERE status = 'open' DO NOTHING`,
        [book.id, book.sha256, book.title, request.user.id, request.body.reason, request.body.details?.trim() || null],
      );
      if (res.rowCount) for (const id of await adminUserIds()) publish(id, "admin.report", { title: book.title });
      return reply.code(201).send({ ok: true });
    },
  );

  /** Takes a book out of the public library (its publisher or an administrator). */
  app.delete<{ Params: { id: string } }>("/api/public/:id", async (request, reply) => {
    const book = await loadPublic(request, reply);
    if (!book) return;
    if (book.user_id !== request.user.id && !isAdmin(request.user)) return reply.code(403).send({ error: "forbidden" });
    await query("UPDATE book SET is_public = false, published_at = NULL WHERE id = $1", [book.id]);
    const { rows } = await query<BookRow>(`${SELECT_BOOK} WHERE b.id = $1`, [book.id]);
    publish(book.user_id, "book.updated", toBookDto(rows[0]!));
    broadcast("public.changed", { bookId: book.id });
    return reply.code(204).send();
  });
}
