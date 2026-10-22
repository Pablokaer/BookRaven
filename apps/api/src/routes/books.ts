import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireUser } from "../auth.js";
import { query } from "../db.js";
import { findOr404, obj, UUID_RE } from "../lib/http.js";
import { aboutFile } from "../lib/bookAbout.js";
import { bookDto, SELECT_BOOK, toBookDto, type BookDto, type BookRow } from "../lib/bookDto.js";
import { comicAsCbz, CONVERTED_FORMATS } from "../lib/comicConvert.js";
import { publish } from "../lib/events.js";
import { partialMd5OfFile } from "../lib/koreader.js";
import { BlockedFileError, isFileBlocked } from "../lib/moderation.js";
import { catalogChanged, catalogTransaction } from "../lib/publicCatalog.js";
import { QuotaExceededError, quotaBody, quotaFor, storageUsed, withQuota } from "../lib/quota.js";
import { DETECT_BYTES, detectFormat, imageMime, MIME_TYPES } from "../lib/formats.js";
import {
  bookKey,
  commitBookFile,
  commitCover,
  coverKey,
  coverType,
  objectSize,
  readObject,
  removeBookFile,
  removeCover,
  removeTemp,
  streamToTemp,
  type TempFile,
} from "../lib/storage.js";

class UnknownFolderError extends Error {}

const MAX_COVER_BYTES = 5 * 1024 * 1024;
/** Longest blurb kept (some EPUBs carry a whole chapter in their description). */
const MAX_DESCRIPTION = 4000;

/** Trims, collapses spaces and drops case-insensitive duplicates, keeping the first spelling. */
function normalizeTags(tags: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, " ");
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

export const loadOwnedBook = (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) =>
  findOr404<BookRow>(reply, UUID_RE.test(request.params.id), `${SELECT_BOOK} WHERE b.id = $1 AND b.user_id = $2`, [request.params.id, request.user.id]);

/**
 * Serves a stored object with HTTP Range support: the readers fetch books in pieces
 * (like a video player streams an MP4), only the parts around the page being read.
 */
export async function sendFile(
  request: FastifyRequest,
  reply: FastifyReply,
  key: string,
  mime: string,
  etag: string,
) {
  reply.header("Accept-Ranges", "bytes");
  reply.header("ETag", `"${etag}"`);
  reply.header("Cache-Control", "private, max-age=31536000, immutable");
  // Stored objects never change under a key, so a matching ETag needs no storage lookup.
  if (request.headers["if-none-match"] === `"${etag}"`) return reply.code(304).send();
  reply.header("Content-Type", mime);

  const size = await objectSize(key);
  if (size === null) return reply.code(404).send({ error: "file_missing" });

  const range = request.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (m[1] === "" && m[2] === "")) {
      reply.header("Content-Range", `bytes */${size}`);
      return reply.code(416).send();
    }
    let start: number;
    let end: number;
    if (m[1] === "") {
      // suffix range: last N bytes
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
    }
    if (start > end || start >= size) {
      reply.header("Content-Range", `bytes */${size}`);
      return reply.code(416).send();
    }
    reply.code(206);
    reply.header("Content-Range", `bytes ${start}-${end}/${size}`);
    reply.header("Content-Length", end - start + 1);
    return reply.send(await readObject(key, start, end));
  }

  reply.header("Content-Length", size);
  return reply.send(await readObject(key));
}

/** Serves a book's stored cover image. */
export async function sendCover(request: FastifyRequest, reply: FastifyReply, book: Pick<BookRow, "id" | "has_cover">) {
  if (!book.has_cover) return reply.code(404).send({ error: "no_cover" });
  const key = coverKey(book.id);
  const etag = `cover-${book.id}`;
  // A book's cover never changes either: sendFile answers a revalidation before the type is needed.
  if (request.headers["if-none-match"] === `"${etag}"`) return sendFile(request, reply, key, "", etag);
  const type = await coverType(book.id);
  if (!type) return reply.code(404).send({ error: "no_cover" });
  return sendFile(request, reply, key, type, etag);
}

export async function bookRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get("/api/books", async (request) => {
    const { rows } = await query<BookRow>(
      `${SELECT_BOOK} WHERE b.user_id = $1
       ORDER BY COALESCE(p.updated_at, b.created_at) DESC`,
      [request.user.id],
    );
    return rows.map(toBookDto);
  });

  app.get<{ Params: { id: string } }>("/api/books/:id", async (request, reply) => {
    const book = await loadOwnedBook(request, reply);
    if (book) return { ...toBookDto(book), description: book.description };
  });

  /** For the book's page: its description, other readers, its public-library entry and its source. */
  app.get<{ Params: { id: string } }>("/api/books/:id/about", async (request, reply) => {
    const book = await loadOwnedBook(request, reply);
    if (book) return { description: book.description, ...(await aboutFile(book.sha256, request.user.id)) };
  });

  /**
   * Multipart upload. Fields: title, author, description (optional, extracted client-side),
   * cover (optional image), file (required book file).
   */
  app.post("/api/books", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    // Refuse early, before streaming the file, when the account is already full or the
    // request is clearly larger than what is left (the cover adds at most a few MB).
    const [quota, used] = await Promise.all([quotaFor(request.user), storageUsed(request.user.id)]);
    if (quota !== null) {
      const incoming = Number(request.headers["content-length"] ?? 0);
      if (used >= quota || incoming > quota - used + MAX_COVER_BYTES + 1024 * 1024) {
        return reply.code(413).send(quotaBody({ usedBytes: used, quotaBytes: quota }));
      }
    }

    const fields: Record<string, string> = {};
    let book: (TempFile & { filename: string; truncated: boolean }) | undefined;
    let cover: (TempFile & { truncated: boolean }) | undefined;

    try {
      for await (const part of request.parts()) {
        if (part.type === "field") {
          if (typeof part.value === "string") fields[part.fieldname] = part.value.slice(0, part.fieldname === "description" ? MAX_DESCRIPTION : 500);
          continue;
        }
        if (part.fieldname === "file" && !book) {
          const tmp = await streamToTemp(part.file, DETECT_BYTES);
          book = { ...tmp, filename: part.filename || "book", truncated: part.file.truncated };
        } else if (part.fieldname === "cover" && !cover) {
          const tmp = await streamToTemp(part.file, 16);
          cover = { ...tmp, truncated: part.file.truncated };
        } else {
          part.file.resume(); // drain unexpected files
        }
      }

      if (!book) return reply.code(400).send({ error: "missing_file" });
      if (book.truncated) return reply.code(413).send({ error: "file_too_large" });

      const format = detectFormat(book.head, book.filename);
      if (!format) return reply.code(415).send({ error: "unsupported_format" });

      if (await isFileBlocked(book.sha256)) return reply.code(451).send({ error: "blocked_content" });

      const existing = await query<{ id: string }>(
        "SELECT id FROM book WHERE user_id = $1 AND sha256 = $2",
        [request.user.id, book.sha256],
      );
      if (existing.rows[0]) {
        return reply.code(409).send({ error: "duplicate", bookId: existing.rows[0].id });
      }

      // Optional collection to put the book in (uploads dropped on a collection).
      const folderId = fields.folderId?.trim() || null;
      if (folderId) {
        const owned = UUID_RE.test(folderId)
          ? await query("SELECT 1 FROM folder WHERE id = $1 AND user_id = $2", [folderId, request.user.id])
          : { rowCount: 0 };
        if (!owned.rowCount) return reply.code(400).send({ error: "invalid_folder" });
      }

      const coverOk = cover && !cover.truncated && cover.size <= MAX_COVER_BYTES && imageMime(cover.head);
      const fallbackTitle = book.filename.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim() || "Untitled";

      const upload = book;
      const koreaderMd5 = await partialMd5OfFile(upload.tmpPath, upload.size);
      // Stored before the transaction, so no pooled connection waits on a long transfer (S3).
      // Content-addressed: when the book can't be added, the file goes again unless another book has it.
      const stored = await commitBookFile(upload);
      let id: string;
      try {
        // Exact check with the real size; the insert happens under the same per-user lock.
        id = await withQuota(request.user, upload.size, async (client) => {
          const { rows } = await client.query<{ id: string }>(
            `INSERT INTO book (user_id, title, author, format, original_filename, mime_type, size_bytes, sha256, has_cover, koreader_md5, folder_id, description)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
            [
              request.user.id,
              fields.title?.trim() || fallbackTitle,
              fields.author?.trim() || null,
              format,
              upload.filename.slice(0, 255),
              MIME_TYPES[format],
              upload.size,
              upload.sha256,
              Boolean(coverOk),
              koreaderMd5,
              folderId,
              // Multipart turns line breaks into CRLF.
              fields.description?.replace(/\r\n?/g, "\n").trim() || null,
            ],
          );
          return rows[0]!.id;
        });
      } catch (err) {
        if (stored && !(await query("SELECT 1 FROM book WHERE sha256 = $1 LIMIT 1", [upload.sha256])).rowCount) {
          await removeBookFile(upload.sha256).catch((e) => request.log.warn({ err: e }, "could not remove the file of a failed upload"));
        }
        if (err instanceof QuotaExceededError) return reply.code(413).send(quotaBody(err));
        throw err;
      }
      if (coverOk) {
        await commitCover(cover!.tmpPath, id);
        cover = undefined;
      }

      // Make the CBZ copy readers stream from now, so the first open doesn't wait for it.
      if (CONVERTED_FORMATS.has(format)) void comicAsCbz(upload.sha256).catch((err) => request.log.warn({ err }, "comic conversion failed"));

      const dto = await bookDto(id);
      publish(request.user.id, "book.created", dto);
      return reply.code(201).send(dto);
    } finally {
      // Clean up whatever was not moved into permanent storage.
      await removeTemp(book?.tmpPath);
      await removeTemp(cover?.tmpPath);
    }
  });

  app.patch<{ Params: { id: string }; Body: { title?: string; author?: string | null; folderId?: string | null; tags?: string[]; favorite?: boolean; isPublic?: boolean } }>(
    "/api/books/:id",
    {
      schema: {
        body: obj({
          title: { type: "string", minLength: 1, maxLength: 500 },
          author: { type: ["string", "null"], maxLength: 500 },
          folderId: { type: ["string", "null"], maxLength: 36 },
          tags: { type: "array", maxItems: 30, items: { type: "string", minLength: 1, maxLength: 40 } },
          favorite: { type: "boolean" },
          isPublic: { type: "boolean" },
        }),
      },
    },
    async (request, reply) => {
      const book = await loadOwnedBook(request, reply);
      if (!book) return;
      const { title, author, folderId, tags, favorite, isPublic } = request.body;
      let told: Map<string, BookDto>;
      try {
        ({ books: told } = await catalogTransaction(async (catalog, db) => {
          // First: a blocked file changes nothing (451).
          if (isPublic !== undefined) await (isPublic ? catalog.publish(book) : catalog.unpublish(book));
          if (folderId) {
            const folder = await db.query("SELECT 1 FROM folder WHERE id = $1 AND user_id = $2", [
              UUID_RE.test(folderId) ? folderId : null,
              request.user.id,
            ]);
            if (folder.rowCount === 0) throw new UnknownFolderError();
          }
          await db.query(
            `UPDATE book SET title = COALESCE($1, title),
                             author = CASE WHEN $3 THEN $2 ELSE author END,
                             folder_id = CASE WHEN $5 THEN $4::uuid ELSE folder_id END,
                             tags = COALESCE($6, tags),
                             favorite = COALESCE($8, favorite),
                             updated_at = now()
             WHERE id = $7`,
            [
              title ?? null,
              author ?? null,
              author !== undefined,
              folderId ?? null,
              folderId !== undefined,
              tags ? normalizeTags(tags) : null,
              book.id,
              favorite ?? null,
            ],
          );
          // A public book's catalog entry changed.
          if (book.is_public && (title !== undefined || author !== undefined || tags !== undefined)) catalog.changed({ bookId: book.id });
          // The owner hears one book.updated, with any listing change, and it is the answer too.
          catalog.updated(book);
        }));
      } catch (err) {
        if (err instanceof BlockedFileError) return reply.code(451).send({ error: "blocked_content" });
        if (err instanceof UnknownFolderError) return reply.code(400).send({ error: "unknown_folder" });
        throw err;
      }
      const dto = told.get(book.id);
      if (dto) return dto;
      // The catalog could not read it back to tell the owner: this read answers, and tells.
      const read = await bookDto(book.id);
      publish(request.user.id, "book.updated", read);
      return read;
    },
  );

  app.delete<{ Params: { id: string } }>("/api/books/:id", async (request, reply) => {
    const book = await loadOwnedBook(request, reply);
    if (!book) return;
    await query("DELETE FROM book WHERE id = $1", [book.id]);
    await removeCover(book.id);
    const others = await query("SELECT 1 FROM book WHERE sha256 = $1 LIMIT 1", [book.sha256]);
    if (others.rowCount === 0) await removeBookFile(book.sha256);
    publish(request.user.id, "book.deleted", { id: book.id });
    if (book.is_public) catalogChanged({ bookId: book.id });
    return reply.code(204).send();
  });

  /**
   * `?download=1` asks the browser to save the file instead of showing it. `?as=cbz` serves
   * a RAR/7z/TAR comic as CBZ (made on first use), which readers can fetch page by page.
   * Readers send many small range requests while reading, hence the higher rate limit and
   * the light query (no progress join).
   */
  app.get<{ Params: { id: string }; Querystring: { download?: string; as?: string } }>(
    "/api/books/:id/file",
    { config: { rateLimit: { max: 3000, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id } = request.params;
      const book = await findOr404<Pick<BookRow, "sha256" | "format" | "mime_type" | "original_filename">>(
        reply,
        UUID_RE.test(id),
        "SELECT sha256, format, mime_type, original_filename FROM book WHERE id = $1 AND user_id = $2",
        [id, request.user.id],
      );
      if (!book) return;

      let key = bookKey(book.sha256);
      let { mime_type: mime, original_filename: filename } = book;
      let etag = book.sha256;
      if (request.query.as === "cbz" && book.format !== "cbz") {
        if (!CONVERTED_FORMATS.has(book.format)) return reply.code(400).send({ error: "not_a_comic_archive" });
        const converted = await comicAsCbz(book.sha256);
        if (!converted) return reply.code(422).send({ error: "unconvertible" });
        key = converted;
        mime = MIME_TYPES.cbz;
        filename = filename.replace(/\.[^.]*$/, "") + ".cbz";
        etag = `${book.sha256}-cbz`;
      }
      reply.header(
        "Content-Disposition",
        `${request.query.download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      );
      return sendFile(request, reply, key, mime, etag);
    },
  );

  app.get<{ Params: { id: string } }>("/api/books/:id/cover", async (request, reply) => {
    const book = await loadOwnedBook(request, reply);
    if (!book) return;
    return sendCover(request, reply, book);
  });
}
