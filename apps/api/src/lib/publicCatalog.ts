import type pg from "pg";
import { query, withTransaction } from "../db.js";
import { SELECT_BOOK, toBookDto, type BookDto, type BookRow } from "./bookDto.js";
import { broadcast, onBroadcast, publish } from "./events.js";
import { log } from "./log.js";
import { BlockedFileError, isFileBlocked } from "./moderation.js";

/**
 * The public library: every way a book gets in or out of it goes through here, so each keeps the
 * same rules:
 * - a file an administrator blocked is never listed (`BlockedFileError`, a 451 for the routes);
 * - `published_at` is the first publication, kept while the book stays listed and cleared when it
 *   leaves (the catalog shows a file once, as its earliest publication);
 * - the owner hears `book.updated` and everyone hears `public.changed`, which also drops the
 *   listing kept in memory here (and the views made of it), after the change is committed.
 *
 * Changes that must commit together with other writes run in `catalogTransaction`.
 */

/** What publishing needs to know about a book. */
export type Listable = Pick<BookRow, "id" | "user_id" | "sha256">;

/** Changes to the public library, inside one transaction. */
export type CatalogChanges = {
  /** Lists the book. Throws `BlockedFileError` first if its file is blocked; true if it was not listed yet. */
  publish(book: Listable): Promise<boolean>;
  /** Takes the book out of the public library; true if it was listed. */
  unpublish(book: Pick<BookRow, "id">): Promise<boolean>;
  /** Takes every publication of a file out (moderation); true if any was listed. */
  unpublishFile(sha256: string): Promise<boolean>;
  /** A listed book's catalog entry changed or it was deleted: `public.changed` with `data`. */
  changed(data: unknown): void;
  /** The book changed otherwise too: its owner hears it in the same `book.updated`, and the result carries it. */
  updated(book: Pick<BookRow, "id">): void;
};

/** What a catalog transaction committed: `fn`'s value, and the books whose owners were told (as they told them). */
export type CatalogResult<T> = { value: T; books: Map<string, BookDto> };

/**
 * Runs `fn` in one database transaction. Its catalog changes commit together with the other
 * writes `fn` makes on `db`, and owners and everyone hear about them only once it committed: one
 * `book.updated` per book whose listing changed (or that `updated` named), and at most one
 * `public.changed` (with the last data given). Telling them can't fail the change: it committed.
 *
 * Inside `fn`, read and write on `db` only: a query on the pool would wait for a second
 * connection while this one is held, and enough concurrent transactions would wait for ever.
 */
export async function catalogTransaction<T>(fn: (catalog: CatalogChanges, db: pg.PoolClient) => Promise<T>): Promise<CatalogResult<T>> {
  const changedBooks = new Set<string>();
  let broadcastData: { data: unknown } | null = null;
  const catalogChanges = (db: pg.PoolClient): CatalogChanges => ({
    async publish(book) {
      if (await isFileBlocked(book.sha256, db)) throw new BlockedFileError();
      const { rows } = await db.query<{ id: string }>(
        "UPDATE book SET is_public = true, published_at = COALESCE(published_at, now()) WHERE id = $1 AND NOT is_public RETURNING id",
        [book.id],
      );
      if (!rows.length) return false;
      changedBooks.add(book.id);
      broadcastData = { data: { bookId: book.id } };
      return true;
    },
    async unpublish(book) {
      const { rows } = await db.query<{ id: string }>(
        "UPDATE book SET is_public = false, published_at = NULL WHERE id = $1 AND is_public RETURNING id",
        [book.id],
      );
      if (!rows.length) return false;
      changedBooks.add(book.id);
      broadcastData = { data: { bookId: book.id } };
      return true;
    },
    async unpublishFile(sha256) {
      const { rows } = await db.query<{ id: string }>(
        "UPDATE book SET is_public = false, published_at = NULL WHERE sha256 = $1 AND is_public RETURNING id",
        [sha256],
      );
      if (!rows.length) return false;
      for (const r of rows) changedBooks.add(r.id);
      broadcastData = { data: { sha256 } };
      return true;
    },
    changed(data) {
      broadcastData = { data };
    },
    updated(book) {
      changedBooks.add(book.id);
    },
  });

  const value = await withTransaction((db) => fn(catalogChanges(db), db));
  const books = new Map<string, BookDto>();
  if (changedBooks.size) {
    try {
      const { rows } = await query<BookRow>(`${SELECT_BOOK} WHERE b.id = ANY($1)`, [[...changedBooks]]);
      for (const b of rows) {
        const dto = toBookDto(b);
        books.set(b.id, dto);
        publish(b.user_id, "book.updated", dto);
      }
    } catch (err) {
      // The owners' apps catch up when they next load the library.
      log.warn({ err }, "could not tell owners about their changed books");
    }
  }
  if (broadcastData) broadcast("public.changed", (broadcastData as { data: unknown }).data);
  return { value, books };
}

/** Lists one book in the public library (see `CatalogChanges.publish`). */
export const publishBook = (book: Listable) => catalogTransaction((catalog) => catalog.publish(book)).then((r) => r.value);

/** Takes one book out of the public library (see `CatalogChanges.unpublish`). */
export const unpublishBook = (book: Pick<BookRow, "id">) => catalogTransaction((catalog) => catalog.unpublish(book)).then((r) => r.value);

/** Takes every publication of a file out of the public library (see `CatalogChanges.unpublishFile`). */
export const unpublishFile = (sha256: string) => catalogTransaction((catalog) => catalog.unpublishFile(sha256)).then((r) => r.value);

/** A listed book's catalog entry changed or it was deleted, outside of a catalog transaction. */
export function catalogChanged(data: unknown) {
  broadcast("public.changed", data);
}

// ---- listing ----

/** A listed book: the columns the catalogs show, and whose book it is. */
export type CatalogRow = Pick<
  BookRow,
  | "id" | "user_id" | "sha256" | "title" | "author" | "format" | "original_filename" | "mime_type" | "size_bytes" | "has_cover"
  | "language" | "tags" | "published_at" | "created_at"
> & {
  themes: string[];
  owner_name: string | null;
  /** Catalog the book was imported from (gutenberg, standardebooks, wikisource), if any. */
  source: string | null;
  source_url: string | null;
  download_count: number | null;
};

/** How many books the in-memory listing keeps (the web catalog shows these). */
export const CATALOG_SIZE = 1000;
const CATALOG_MAX_AGE = 5 * 60_000;

/**
 * Listed books, newest publication first. A file published by several people is listed once, as
 * its earliest publication. The dedup and the paging only look at ids (book_public_sha_idx); the
 * shown columns are fetched for the listed books only.
 */
const readCatalog = (offset: number, limit: number) =>
  query<CatalogRow>(
    `WITH pick AS (
       SELECT id, published_at FROM (
         SELECT DISTINCT ON (sha256) id, published_at FROM book
         WHERE is_public
         ORDER BY sha256, published_at
       ) d
       ORDER BY published_at DESC
       LIMIT $1 OFFSET $2
     )
     SELECT b.id, b.user_id, b.sha256, b.title, b.author, b.format, b.original_filename, b.mime_type, b.size_bytes, b.has_cover,
            b.language, b.tags, b.themes, b.published_at, b.created_at,
            u.name AS owner_name, cb.source, cb.source_url, cb.download_count
     FROM pick JOIN book b ON b.id = pick.id JOIN "user" u ON u.id = b.user_id
     LEFT JOIN LATERAL (
       SELECT c.source, c.source_url, c.download_count FROM catalog_book c WHERE c.book_id = b.id LIMIT 1
     ) cb ON true
     ORDER BY pick.published_at DESC`,
    [limit, offset],
  ).then(({ rows }) => rows);

/**
 * The first `CATALOG_SIZE` books are the same for every viewer: they are read once (requests
 * arriving meanwhile share the read) and kept until the public library changes (a `public.changed`
 * broadcast), or for 5 minutes, for changes nothing broadcasts (the import script runs in its own
 * process).
 */
let cached: { at: number; rows: Promise<CatalogRow[]> } | null = null;
onBroadcast("public.changed", () => {
  cached = null;
});

function firstBooks() {
  if (!cached || Date.now() - cached.at > CATALOG_MAX_AGE) {
    const read = { at: Date.now(), rows: readCatalog(0, CATALOG_SIZE) };
    cached = read;
    // A failed read is not kept: the next request tries again.
    read.rows.catch(() => {
      if (cached === read) cached = null;
    });
  }
  return cached.rows;
}

/** A page of the public library (the first `CATALOG_SIZE` books by default), as both the web catalog and OPDS list it. */
export async function listCatalog({ offset = 0, limit = CATALOG_SIZE }: { offset?: number; limit?: number } = {}) {
  if (offset + limit <= CATALOG_SIZE) return (await firstBooks()).slice(offset, offset + limit);
  return readCatalog(offset, limit);
}

/**
 * `build` over the first `CATALOG_SIZE` books, made once per read of them and kept as long as
 * they are: e.g. the web catalog's finished entries, so a request only adds what depends on the viewer.
 */
export function catalogView<V>(build: (rows: CatalogRow[]) => V): () => Promise<V> {
  const views = new WeakMap<Promise<CatalogRow[]>, Promise<V>>();
  return () => {
    const rows = firstBooks();
    let view = views.get(rows);
    if (!view) views.set(rows, (view = rows.then(build)));
    return view;
  };
}
