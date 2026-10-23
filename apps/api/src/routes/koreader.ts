import type { FastifyInstance, FastifyRequest } from "fastify";
import { query } from "../db.js";
import { CONVERTED_FORMATS } from "../lib/comicConvert.js";
import { publish } from "../lib/events.js";
import { UUID_RE } from "../lib/http.js";
import {
  bookmarkLocatorFor,
  highlightLocatorFor,
  koBookmarkPage,
  koColor,
  koDate,
  koHighlightPosition,
  parseKoDate,
  webColor,
  type KoAnnotation,
} from "../lib/koreaderAnnotations.js";
import { bookmarkDto, type BookmarkRow } from "./bookmarks.js";
import { highlightDto, type HighlightRow } from "./highlights.js";
import { basicAuth, downloadName } from "./opds.js";

/**
 * The BookRaven KOReader plugin's API (koreader/bookraven.koplugin): highlights and bookmarks
 * synced both ways, and books sent to e-readers ("Send to Kindle", routes/deliveries.ts).
 * Signed in like the OPDS catalog: HTTP Basic with the account email and an app password, which
 * also tells the devices apart. Books are matched by KOReader's partial MD5, as kosync does.
 *
 * Sync (POST /api/koreader/sync), per book:
 *   → { document, since, changed: [annotation…], deleted: [id…] }
 *     `since` is the `cursor` of the device's last sync of this book (null the first time);
 *     `changed` its annotations added or edited since then (all of them the first time), each
 *     with a stable `id`; `deleted` the ids it synced before and has deleted since.
 *   ← { cursor, changed: [annotation…], deleted: [id…], skipped }
 *     everything changed or deleted on the server since `since` (in BookRaven or on another
 *     device), minus what this request sent. BookRaven's own highlights get an id here ("br-…").
 *     `skipped` counts those KOReader can't use (a position that couldn't be converted).
 * A deletion wins over an edit made elsewhere before the next sync.
 */

const MAX_ANNOTATIONS = 5000;

type BookRef = { id: string; title: string; format: string; sha256: string; size_bytes: string };

type LinkRow = {
  client_id: string;
  kind: "highlight" | "bookmark";
  highlight_id: string | null;
  bookmark_id: string | null;
  ko: Partial<KoAnnotation>;
  deleted_at: Date | null;
};

const position = { anyOf: [{ type: "string", maxLength: 2000 }, { type: "object", maxProperties: 20 }, { type: "null" }] };
const annotationSchema = {
  type: "object",
  required: ["id", "kind"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 100 },
    kind: { type: "string", enum: ["highlight", "bookmark"] },
    text: { type: ["string", "null"], maxLength: 10000 },
    note: { type: ["string", "null"], maxLength: 5000 },
    color: { type: ["string", "null"], maxLength: 30 },
    drawer: { type: ["string", "null"], maxLength: 30 },
    chapter: { type: ["string", "null"], maxLength: 500 },
    datetime: { type: ["string", "null"], maxLength: 40 },
    pos0: position,
    pos1: position,
    // The number first: Fastify coerces types, and would make a page number a string.
    page: { anyOf: [{ type: "integer", minimum: 0 }, { type: "string", maxLength: 2000 }, { type: "null" }] },
    pboxes: { type: "array", maxItems: 500 },
    percent: { type: ["number", "null"], minimum: 0, maximum: 1 },
  },
};

/**
 * KOReader's fields worth keeping for its other devices. BookRaven's row, when there is one, has
 * the last word on the text, note and color (see changesSince).
 */
const koFields = (a: KoAnnotation): Partial<KoAnnotation> => ({
  ...(a.text != null && { text: a.text }),
  ...(a.note != null && { note: a.note }),
  ...(a.drawer != null && { drawer: a.drawer }),
  ...(a.color != null && { color: a.color }),
  ...(a.chapter != null && { chapter: a.chapter }),
  ...(a.datetime != null && { datetime: a.datetime }),
  ...(a.pos0 != null && { pos0: a.pos0 }),
  ...(a.pos1 != null && { pos1: a.pos1 }),
  ...(a.page != null && { page: a.page }),
  ...(a.pboxes != null && { pboxes: a.pboxes }),
});

async function bookByDocument(request: FastifyRequest, document: string) {
  const { rows } = await query<BookRef>(
    "SELECT id, title, format, sha256, size_bytes FROM book WHERE user_id = $1 AND koreader_md5 = $2 ORDER BY created_at LIMIT 1",
    [request.user.id, document],
  );
  return rows[0] ?? null;
}

const cleanNote = (note: string | null | undefined) => note?.trim() || null;

/** Applies one annotation KOReader added or changed. */
async function applyChange(userId: string, book: BookRef, a: KoAnnotation, link: LinkRow | undefined) {
  let highlightId: string | null = null;
  let bookmarkId: string | null = null;
  if (a.kind === "highlight") {
    const text = a.text?.trim() ?? "";
    const color = webColor(a.color);
    const note = cleanNote(a.note);
    let row: HighlightRow | undefined;
    if (link?.highlight_id) {
      row = (
        await query<HighlightRow>("UPDATE highlight SET color = $1, note = $2, updated_at = now() WHERE id = $3 AND user_id = $4 RETURNING *", [
          color,
          note,
          link.highlight_id,
          userId,
        ])
      ).rows[0];
    }
    if (!row) {
      const cfi = text ? await highlightLocatorFor(book, a) : null;
      if (cfi) {
        row = (
          await query<HighlightRow>(
            `INSERT INTO highlight (user_id, book_id, cfi, text, color, label, note, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, now()))
             ON CONFLICT (book_id, cfi) DO UPDATE SET color = EXCLUDED.color, note = COALESCE(EXCLUDED.note, highlight.note), updated_at = now()
             RETURNING *`,
            [userId, book.id, cfi, text, color, a.chapter?.trim() || null, note, parseKoDate(a.datetime)],
          )
        ).rows[0];
      }
    }
    if (row) {
      highlightId = row.id;
      publish(userId, "highlight.saved", highlightDto(row));
    }
  } else {
    const note = cleanNote(a.note);
    let row: BookmarkRow | undefined;
    if (link?.bookmark_id) {
      row = (
        await query<BookmarkRow>("UPDATE bookmark SET title = $1, updated_at = now() WHERE id = $2 AND user_id = $3 RETURNING *", [
          note?.slice(0, 200) ?? null,
          link.bookmark_id,
          userId,
        ])
      ).rows[0];
    }
    if (!row) {
      const locator = await bookmarkLocatorFor(book, a);
      if (locator) {
        row = (
          await query<BookmarkRow>(
            `INSERT INTO bookmark (user_id, book_id, locator, percentage, label, title, created_at) VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()))
             ON CONFLICT (user_id, book_id, locator) DO UPDATE SET title = EXCLUDED.title, label = COALESCE(bookmark.label, EXCLUDED.label), updated_at = now()
             RETURNING *`,
            [userId, book.id, locator, a.percent ?? 0, a.chapter?.trim().slice(0, 500) || null, note?.slice(0, 200) ?? null, parseKoDate(a.datetime)],
          )
        ).rows[0];
      }
    }
    if (row) {
      bookmarkId = row.id;
      publish(userId, "bookmark.saved", bookmarkDto(row));
    }
  }
  await query(
    `INSERT INTO koreader_annotation (user_id, book_id, client_id, kind, highlight_id, bookmark_id, ko) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, book_id, client_id) DO UPDATE SET kind = EXCLUDED.kind, highlight_id = EXCLUDED.highlight_id,
       bookmark_id = EXCLUDED.bookmark_id, ko = EXCLUDED.ko, updated_at = now(), deleted_at = NULL`,
    [userId, book.id, a.id, a.kind, highlightId, bookmarkId, JSON.stringify(koFields(a))],
  );
}

/** Deletes in BookRaven what KOReader deleted. */
async function applyDeletion(userId: string, book: BookRef, link: LinkRow) {
  if (link.highlight_id) {
    const { rows } = await query<{ id: string }>("DELETE FROM highlight WHERE id = $1 AND user_id = $2 RETURNING id", [link.highlight_id, userId]);
    if (rows[0]) publish(userId, "highlight.deleted", { id: rows[0].id, bookId: book.id });
  }
  if (link.bookmark_id) {
    const { rows } = await query<{ locator: string }>("DELETE FROM bookmark WHERE id = $1 AND user_id = $2 RETURNING locator", [link.bookmark_id, userId]);
    if (rows[0]) publish(userId, "bookmark.deleted", { bookId: book.id, locator: rows[0].locator });
  }
  await query(
    `UPDATE koreader_annotation SET deleted_at = now(), updated_at = now(), highlight_id = NULL, bookmark_id = NULL
     WHERE user_id = $1 AND book_id = $2 AND client_id = $3`,
    [userId, book.id, link.client_id],
  );
}

/** The KOReader id of a BookRaven highlight or bookmark, made (and remembered) the first time one is sent. */
async function clientIdFor(userId: string, bookId: string, kind: "highlight" | "bookmark", id: string) {
  const clientId = `br-${id}`;
  await query(
    `INSERT INTO koreader_annotation (user_id, book_id, client_id, kind, highlight_id, bookmark_id) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [userId, bookId, clientId, kind, kind === "highlight" ? id : null, kind === "bookmark" ? id : null],
  );
  return clientId;
}

/** Everything changed on the server since `since`, for KOReader. */
async function changesSince(userId: string, book: BookRef, since: string | null, exclude: Set<string>) {
  const changed: KoAnnotation[] = [];
  let skipped = 0;

  const highlights = await query<HighlightRow & { client_id: string | null; ko: Partial<KoAnnotation> | null }>(
    // One KOReader id per highlight (two devices that made the same one share BookRaven's row).
    `SELECT * FROM (
       SELECT DISTINCT ON (h.id) h.*, k.client_id, k.ko FROM highlight h
       LEFT JOIN koreader_annotation k ON k.user_id = h.user_id AND k.book_id = h.book_id AND k.highlight_id = h.id
       WHERE h.user_id = $1 AND h.book_id = $2 AND ($3::timestamptz IS NULL OR h.updated_at > $3)
       ORDER BY h.id, k.updated_at DESC
     ) x ORDER BY created_at`,
    [userId, book.id, since],
  );
  for (const h of highlights.rows) {
    if (h.client_id && exclude.has(h.client_id)) continue;
    const ko = h.ko ?? {};
    // KOReader's own highlights keep their exact positions; BookRaven's are converted.
    const pos = ko.pos0 != null || ko.page != null ? null : await koHighlightPosition(book, h.cfi);
    if (ko.pos0 == null && ko.page == null && !pos) {
      skipped++;
      continue;
    }
    changed.push({
      id: h.client_id ?? (await clientIdFor(userId, book.id, "highlight", h.id)),
      kind: "highlight",
      drawer: "lighten",
      chapter: h.label,
      datetime: koDate(h.created_at),
      ...ko,
      ...pos,
      text: h.text,
      note: h.note,
      color: koColor(h.color, ko.color),
    });
  }

  const bookmarks = await query<BookmarkRow & { client_id: string | null; ko: Partial<KoAnnotation> | null }>(
    `SELECT * FROM (
       SELECT DISTINCT ON (b.id) b.*, k.client_id, k.ko FROM bookmark b
       LEFT JOIN koreader_annotation k ON k.user_id = b.user_id AND k.book_id = b.book_id AND k.bookmark_id = b.id
       WHERE b.user_id = $1 AND b.book_id = $2 AND ($3::timestamptz IS NULL OR b.updated_at > $3)
       ORDER BY b.id, k.updated_at DESC
     ) x ORDER BY created_at`,
    [userId, book.id, since],
  );
  for (const b of bookmarks.rows) {
    if (b.client_id && exclude.has(b.client_id)) continue;
    const ko = b.ko ?? {};
    const page = ko.page ?? (await koBookmarkPage(book, b.locator));
    if (page == null) {
      skipped++;
      continue;
    }
    changed.push({
      id: b.client_id ?? (await clientIdFor(userId, book.id, "bookmark", b.id)),
      kind: "bookmark",
      chapter: b.label,
      datetime: koDate(b.created_at),
      ...ko,
      page,
      note: b.title,
      percent: b.percentage,
    });
  }

  // KOReader's annotations BookRaven can't show, from the account's other devices.
  const koOnly = await query<LinkRow>(
    `SELECT * FROM koreader_annotation WHERE user_id = $1 AND book_id = $2 AND deleted_at IS NULL
       AND highlight_id IS NULL AND bookmark_id IS NULL AND ($3::timestamptz IS NULL OR updated_at > $3)`,
    [userId, book.id, since],
  );
  for (const k of koOnly.rows) if (!exclude.has(k.client_id)) changed.push({ ...k.ko, id: k.client_id, kind: k.kind });

  const deleted = since
    ? (
        await query<{ client_id: string }>(
          "SELECT client_id FROM koreader_annotation WHERE user_id = $1 AND book_id = $2 AND deleted_at > $3",
          [userId, book.id, since],
        )
      ).rows
        .map((r) => r.client_id)
        .filter((id) => !exclude.has(id))
    : [];
  return { changed, deleted, skipped };
}

export async function koreaderRoutes(app: FastifyInstance) {
  app.addHook("preHandler", basicAuth);

  /** "Test connection" in the plugin's settings. */
  app.get("/api/koreader/me", async (request) => ({ email: request.user.email, name: request.user.name }));

  app.post<{ Body: { document: string; since?: string | null; changed?: KoAnnotation[]; deleted?: string[] } }>(
    "/api/koreader/sync",
    {
      bodyLimit: 8 * 1024 * 1024,
      schema: {
        body: {
          type: "object",
          required: ["document"],
          properties: {
            document: { type: "string", minLength: 1, maxLength: 64 },
            since: { type: ["string", "null"], maxLength: 40 },
            changed: { type: "array", maxItems: MAX_ANNOTATIONS, items: annotationSchema },
            deleted: { type: "array", maxItems: MAX_ANNOTATIONS, items: { type: "string", minLength: 1, maxLength: 100 } },
          },
        },
      },
    },
    async (request, reply) => {
      const book = await bookByDocument(request, request.body.document);
      if (!book) return reply.code(404).send({ error: "unknown_document" });
      // Kept as the string it was given: a Date would drop the microseconds Postgres keeps.
      const since = request.body.since || null;
      if (since && Number.isNaN(new Date(since).getTime())) return reply.code(400).send({ error: "bad_since" });
      const userId = request.user.id;
      const changes = request.body.changed ?? [];
      const deletions = request.body.deleted ?? [];

      const ids = [...changes.map((a) => a.id), ...deletions];
      const links = new Map(
        (
          await query<LinkRow>("SELECT * FROM koreader_annotation WHERE user_id = $1 AND book_id = $2 AND client_id = ANY($3)", [
            userId,
            book.id,
            ids,
          ])
        ).rows.map((l) => [l.client_id, l]),
      );
      const sent = new Set(ids);
      const deletedHere: string[] = [];
      for (const a of changes) {
        const link = links.get(a.id);
        // Deleted in BookRaven (or on another device) since: the deletion wins, and goes back.
        if (link?.deleted_at) {
          sent.delete(a.id);
          deletedHere.push(a.id);
          continue;
        }
        await applyChange(userId, book, a, link);
      }
      for (const id of deletions) {
        const link = links.get(id);
        if (link && !link.deleted_at) await applyDeletion(userId, book, link);
      }

      // Taken before reading the changes (anything saved meanwhile comes again next time), to the microsecond.
      const cursor = (
        await query<{ now: string }>(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now`)
      ).rows[0]!.now;
      const result = await changesSince(userId, book, since, sent);
      return {
        book: { id: book.id, title: book.title },
        cursor,
        changed: result.changed,
        deleted: [...new Set([...result.deleted, ...deletedHere])],
        skipped: result.skipped,
      };
    },
  );

  /** Books sent to e-readers that this device (app password) hasn't downloaded yet, oldest first. */
  app.get("/api/koreader/sent", async (request) => {
    const { rows } = await query<{
      id: string;
      book_id: string;
      title: string;
      author: string | null;
      format: string;
      size_bytes: string;
      koreader_md5: string | null;
      created_at: Date;
    }>(
      `SELECT d.id, b.id AS book_id, b.title, b.author, b.format, b.size_bytes, b.koreader_md5, d.created_at
       FROM book_delivery d JOIN book b ON b.id = d.book_id AND b.user_id = d.user_id
       WHERE d.user_id = $1 AND NOT EXISTS (
         SELECT 1 FROM book_delivery_receipt r WHERE r.delivery_id = d.id AND r.app_password_id = $2)
       ORDER BY d.created_at`,
      [request.user.id, request.appPasswordId],
    );
    return rows.map((r) => {
      // KOReader reads CBZ, not RAR/7z/TAR comics: those come converted, like the OPDS catalog offers them.
      const cbz = CONVERTED_FORMATS.has(r.format);
      return {
        id: r.id,
        bookId: r.book_id,
        title: r.title,
        author: r.author,
        format: cbz ? "cbz" : r.format,
        sizeBytes: cbz ? null : Number(r.size_bytes),
        document: cbz ? null : r.koreader_md5,
        fileName: downloadName(r, cbz ? "cbz" : r.format),
        url: `/opds/books/${r.book_id}/file${cbz ? "?as=cbz" : ""}`,
        sentAt: r.created_at.toISOString(),
      };
    });
  });

  /** This device has the book now. */
  app.post<{ Params: { id: string } }>("/api/koreader/sent/:id/delivered", async (request, reply) => {
    if (!UUID_RE.test(request.params.id)) return reply.code(404).send({ error: "not_found" });
    const { rows } = await query<{ id: string }>("SELECT id FROM book_delivery WHERE id = $1 AND user_id = $2", [request.params.id, request.user.id]);
    if (!rows[0]) return reply.code(404).send({ error: "not_found" });
    await query("INSERT INTO book_delivery_receipt (delivery_id, app_password_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
      rows[0].id,
      request.appPasswordId,
    ]);
    publish(request.user.id, "delivery.changed", { id: rows[0].id });
    return reply.code(204).send();
  });
}
