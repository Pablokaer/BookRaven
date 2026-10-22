import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireUser } from "../auth.js";
import { isAdmin } from "../config.js";
import { query } from "../db.js";
import { aboutFile } from "../lib/bookAbout.js";
import { addCopyAndReply } from "../lib/copies.js";
import { publish } from "../lib/events.js";
import { findOr404, obj, UUID_RE } from "../lib/http.js";
import { SOURCE_NAMES } from "../lib/otherSources.js";
import { catalogView, unpublishBook } from "../lib/publicCatalog.js";
import { themesFor } from "../lib/themes.js";
import { bookKey } from "../lib/storage.js";
import { adminUserIds } from "./admin.js";
import type { BookRow } from "../lib/bookDto.js";
import { sendCover, sendFile } from "./books.js";

type PublicRow = BookRow & {
  owner_name: string | null;
  language?: string | null;
  source_url?: string | null;
  /** Catalog the book was imported from (gutenberg, standardebooks, wikisource). */
  source?: string | null;
  themes?: string[];
  download_count?: number | null;
};

/** The columns the catalog shows, and whose book it is. */
type CatalogEntryRow = Pick<
  PublicRow,
  "id" | "user_id" | "sha256" | "title" | "author" | "format" | "original_filename" | "size_bytes" | "has_cover" | "language" | "tags"
  | "published_at" | "created_at" | "owner_name" | "source" | "source_url" | "themes" | "download_count"
>;

/** A public book as every viewer sees it. */
const catalogEntry = (r: CatalogEntryRow) => ({
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
  publishedBy: r.owner_name,
  publishedAt: (r.published_at ?? r.created_at).toISOString(),
});

/** The catalog's finished entries, made once per read of the listing (they are the same for every viewer). */
const catalogEntries = catalogView((rows) => rows.map((r) => ({ entry: catalogEntry(r), sha256: r.sha256, publisherId: r.user_id })));

/** What depends on who is looking. */
const viewerPart = (publisherId: string, ownBookId: string | null, viewer: { id: string; email: string }) => ({
  /** The viewer's own copy of this file, if they have one. */
  ownBookId,
  isMine: publisherId === viewer.id,
  /** The publisher and administrators can take a book out of the public library. */
  canRemove: publisherId === viewer.id || isAdmin(viewer),
});

/** A published book by id, or a 404 (unpublished books are invisible here). */
const loadPublic = (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) =>
  findOr404<PublicRow>(
    reply,
    UUID_RE.test(request.params.id),
    `SELECT b.*, u.name AS owner_name FROM book b JOIN "user" u ON u.id = b.user_id
     WHERE b.id = $1 AND b.is_public`,
    [request.params.id],
  );

/**
 * Public library: books their owners published for every signed-in account.
 * Anyone can download the file or add a copy to their own library.
 */
export async function publicRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get("/api/public", async (request) => {
    const [books, own] = await Promise.all([
      catalogEntries(),
      // The viewer's copies of published files (at most one per file).
      query<{ sha256: string; id: string }>(
        "SELECT m.sha256, m.id FROM book m WHERE m.user_id = $1 AND EXISTS (SELECT 1 FROM book p WHERE p.sha256 = m.sha256 AND p.is_public)",
        [request.user.id],
      ),
    ]);
    const ownBook = new Map(own.rows.map((r) => [r.sha256, r.id]));
    return books.map((b) => ({ ...b.entry, ...viewerPart(b.publisherId, ownBook.get(b.sha256) ?? null, request.user) }));
  });

  /** One public book, for its page: also how many people have it and its catalog subjects. */
  app.get<{ Params: { id: string } }>("/api/public/:id", async (request, reply) => {
    const r = await findOr404<PublicRow & { own_book_id: string | null }>(
      reply,
      UUID_RE.test(request.params.id),
      `SELECT b.*, u.name AS owner_name, cb.source, cb.source_url, cb.download_count,
              (SELECT m.id FROM book m WHERE m.user_id = $2 AND m.sha256 = b.sha256) AS own_book_id
       FROM book b JOIN "user" u ON u.id = b.user_id
       LEFT JOIN catalog_book cb ON cb.book_id = b.id
       WHERE b.id = $1 AND b.is_public`,
      [request.params.id, request.user.id],
    );
    if (!r) return;
    const about = await aboutFile(r.sha256, null); // everyone who has it, the viewer included
    // The description only here: the catalog list leaves it out (up to 4000 characters per book).
    return {
      ...catalogEntry(r),
      ...viewerPart(r.user_id, r.own_book_id, request.user),
      description: r.description,
      readers: about.readers,
      subjects: about.subjects,
    };
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
      if (src) return addCopyAndReply(reply, src, request.user, src.user_id === request.user.id ? null : src.owner_name);
    },
  );

  /** Reports a public book to the administrators (copyright, illegal content, ...). */
  app.post<{ Params: { id: string }; Body: { reason: string; details?: string } }>(
    "/api/public/:id/report",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        body: obj(
          {
            reason: { type: "string", enum: ["copyright", "illegal", "offensive", "spam", "other"] },
            details: { type: "string", maxLength: 2000 },
          },
          ["reason"],
        ),
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
    await unpublishBook(book);
    return reply.code(204).send();
  });
}
