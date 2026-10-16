import fs from "node:fs/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireUser } from "../auth.js";
import { query } from "../db.js";
import { aboutFile } from "../lib/bookAbout.js";
import { comicAsCbz, CONVERTED_FORMATS } from "../lib/comicConvert.js";
import { broadcast, publish } from "../lib/events.js";
import { partialMd5OfFile } from "../lib/koreader.js";
import { isFileBlocked } from "../lib/moderation.js";
import { QuotaExceededError, quotaFor, storageUsed, withQuota } from "../lib/quota.js";
import { DETECT_BYTES, detectFormat, MIME_TYPES } from "../lib/formats.js";
import {
  bookKey,
  commitBookFile,
  commitCover,
  coverKey,
  objectSize,
  readHead,
  readObject,
  removeBookFile,
  removeCover,
  removeTemp,
  streamToTemp,
  type TempFile,
} from "../lib/storage.js";

const MAX_COVER_BYTES = 5 * 1024 * 1024;
/** Longest blurb kept (some EPUBs carry a whole chapter in their description). */
export const MAX_DESCRIPTION = 4000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BookRow = {
  id: string;
  title: string;
  author: string | null;
  format: string;
  original_filename: string;
  mime_type: string;
  size_bytes: string;
  sha256: string;
  has_cover: boolean;
  folder_id: string | null;
  tags: string[];
  favorite: boolean;
  shared_by_name: string | null;
  shared_at: Date | null;
  is_shared: boolean;
  is_public: boolean;
  published_at: Date | null;
  language: string | null;
  description: string | null;
  created_at: Date;
  p_locator: string | null;
  p_percentage: number | null;
  p_label: string | null;
  p_device_id: string | null;
  p_device_name: string | null;
  p_updated_at: Date | null;
};

export const SELECT_BOOK = `
  SELECT b.*, EXISTS (SELECT 1 FROM book_share s WHERE s.book_id = b.id) AS is_shared,
         p.locator AS p_locator, p.percentage AS p_percentage, p.label AS p_label,
         p.device_id AS p_device_id, p.device_name AS p_device_name, p.updated_at AS p_updated_at
  FROM book b
  LEFT JOIN reading_progress p ON p.book_id = b.id AND p.user_id = b.user_id`;

export function toBookDto(r: BookRow) {
  return {
    id: r.id,
    title: r.title,
    author: r.author,
    format: r.format,
    filename: r.original_filename,
    sizeBytes: Number(r.size_bytes),
    hasCover: r.has_cover,
    folderId: r.folder_id,
    tags: r.tags,
    favorite: r.favorite,
    /** This book has an active share link. */
    isShared: r.is_shared,
    /** Set when the book was added from someone else's share link. */
    sharedBy: r.shared_by_name,
    sharedAt: r.shared_at?.toISOString() ?? null,
    /** Published in the public library. */
    isPublic: r.is_public,
    language: r.language,
    description: r.description,
    createdAt: r.created_at.toISOString(),
    progress: r.p_locator
      ? {
          locator: r.p_locator,
          percentage: r.p_percentage ?? 0,
          label: r.p_label,
          deviceId: r.p_device_id,
          deviceName: r.p_device_name,
          updatedAt: r.p_updated_at!.toISOString(),
        }
      : null,
  };
}

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

function isImage(head: Buffer) {
  return (
    (head[0] === 0xff && head[1] === 0xd8) || // JPEG
    head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) || // PNG
    (head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP") ||
    head.toString("latin1", 0, 4) === "GIF8"
  );
}

function imageMime(head: Buffer) {
  if (head[0] === 0xff) return "image/jpeg";
  if (head[0] === 0x89) return "image/png";
  if (head.toString("latin1", 0, 4) === "RIFF") return "image/webp";
  return "image/gif";
}

export async function loadOwnedBook(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const { id } = request.params;
  if (!UUID_RE.test(id)) {
    reply.code(404).send({ error: "not_found" });
    return null;
  }
  const { rows } = await query<BookRow>(`${SELECT_BOOK} WHERE b.id = $1 AND b.user_id = $2`, [
    id,
    request.user.id,
  ]);
  if (!rows[0]) {
    reply.code(404).send({ error: "not_found" });
    return null;
  }
  return rows[0];
}

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
  reply.header("Content-Type", mime);
  // Stored objects never change under a key, so a matching ETag needs no storage lookup.
  if (request.headers["if-none-match"] === `"${etag}"`) return reply.code(304).send();

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
export async function sendCover(request: FastifyRequest, reply: FastifyReply, book: BookRow) {
  if (!book.has_cover) return reply.code(404).send({ error: "no_cover" });
  const key = coverKey(book.id);
  const head = await readHead(key, 16);
  if (!head) return reply.code(404).send({ error: "no_cover" });
  return sendFile(request, reply, key, imageMime(head), `cover-${book.id}`);
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
    if (book) return toBookDto(book);
  });

  /** For the book's page: other readers, its public-library entry and its source. */
  app.get<{ Params: { id: string } }>("/api/books/:id/about", async (request, reply) => {
    const book = await loadOwnedBook(request, reply);
    if (book) return aboutFile(book.sha256, request.user.id);
  });

  /**
   * Multipart upload. Fields: title, author, description (optional, extracted client-side),
   * cover (optional image), file (required book file).
   */
  app.post("/api/books", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    // Refuse early, before streaming the file, when the account is already full or the
    // request is clearly larger than what is left (the cover adds at most a few MB).
    const quota = await quotaFor(request.user);
    if (quota !== null) {
      const used = await storageUsed(request.user.id);
      const incoming = Number(request.headers["content-length"] ?? 0);
      if (used >= quota || incoming > quota - used + MAX_COVER_BYTES + 1024 * 1024) {
        return reply.code(413).send({ error: "quota_exceeded", usedBytes: used, quotaBytes: quota });
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

      const coverOk = cover && !cover.truncated && cover.size <= MAX_COVER_BYTES && isImage(cover.head);
      const fallbackTitle = book.filename.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim() || "Untitled";

      const upload = book;
      const koreaderMd5 = await partialMd5OfFile(upload.tmpPath, upload.size);
      let id: string;
      try {
        // Exact check with the real size; the insert happens under the same per-user lock.
        id = await withQuota(request.user, upload.size, async (client) => {
          await commitBookFile(upload);
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
        if (err instanceof QuotaExceededError) {
          return reply.code(413).send({ error: "quota_exceeded", usedBytes: err.usedBytes, quotaBytes: err.quotaBytes });
        }
        throw err;
      }
      if (coverOk) {
        await commitCover(cover!.tmpPath, id);
        cover = undefined;
      }

      // Make the CBZ copy readers stream from now, so the first open doesn't wait for it.
      if (CONVERTED_FORMATS.has(format)) void comicAsCbz(upload.sha256).catch((err) => request.log.warn({ err }, "comic conversion failed"));

      const created = await query<BookRow>(`${SELECT_BOOK} WHERE b.id = $1`, [id]);
      const dto = toBookDto(created.rows[0]!);
      publish(request.user.id, "book.created", dto);
      return reply.code(201).send(dto);
    } finally {
      // Clean up whatever was not moved into permanent storage.
      if (book) await fs.rm(book.tmpPath, { force: true });
      await removeTemp(cover?.tmpPath);
    }
  });

  app.patch<{ Params: { id: string }; Body: { title?: string; author?: string | null; folderId?: string | null; tags?: string[]; favorite?: boolean; isPublic?: boolean } }>(
    "/api/books/:id",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1, maxLength: 500 },
            author: { type: ["string", "null"], maxLength: 500 },
            folderId: { type: ["string", "null"], maxLength: 36 },
            tags: { type: "array", maxItems: 30, items: { type: "string", minLength: 1, maxLength: 40 } },
            favorite: { type: "boolean" },
            isPublic: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const book = await loadOwnedBook(request, reply);
      if (!book) return;
      const { title, author, folderId, tags, favorite, isPublic } = request.body;
      if (isPublic && (await isFileBlocked(book.sha256))) return reply.code(451).send({ error: "blocked_content" });
      if (folderId) {
        const folder = await query("SELECT 1 FROM folder WHERE id = $1 AND user_id = $2", [
          UUID_RE.test(folderId) ? folderId : null,
          request.user.id,
        ]);
        if (folder.rowCount === 0) return reply.code(400).send({ error: "unknown_folder" });
      }
      await query(
        `UPDATE book SET title = COALESCE($1, title),
                         author = CASE WHEN $3 THEN $2 ELSE author END,
                         folder_id = CASE WHEN $5 THEN $4::uuid ELSE folder_id END,
                         tags = COALESCE($6, tags),
                         favorite = COALESCE($8, favorite),
                         is_public = COALESCE($9, is_public),
                         published_at = CASE WHEN $9 IS NULL THEN published_at WHEN $9 THEN COALESCE(published_at, now()) ELSE NULL END,
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
          isPublic ?? null,
        ],
      );
      const { rows } = await query<BookRow>(`${SELECT_BOOK} WHERE b.id = $1`, [book.id]);
      const dto = toBookDto(rows[0]!);
      publish(request.user.id, "book.updated", dto);
      if (isPublic !== undefined && isPublic !== book.is_public) broadcast("public.changed", { bookId: book.id });
      return dto;
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
    if (book.is_public) broadcast("public.changed", { bookId: book.id });
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
      const { rows } = UUID_RE.test(id)
        ? await query<Pick<BookRow, "sha256" | "format" | "mime_type" | "original_filename">>(
            "SELECT sha256, format, mime_type, original_filename FROM book WHERE id = $1 AND user_id = $2",
            [id, request.user.id],
          )
        : { rows: [] };
      const book = rows[0];
      if (!book) return reply.code(404).send({ error: "not_found" });

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
