import { randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { query } from "../db.js";
import { DETECT_BYTES, detectFormat, MIME_TYPES } from "./formats.js";
import { partialMd5OfFile } from "./koreader.js";
import { isFileBlocked } from "./moderation.js";
import {
  catalogEntries,
  cleanTitle,
  deathYearCutoff,
  displayName,
  fragmentOf,
  isPublicDomainEverywhere,
  tagsFrom,
  workKey,
  type CatalogEntry,
  type GutendexBook,
} from "./publicDomain.js";
import { IMPORT_PLAN, themesFor, type ImportStep, type Theme } from "./themes.js";
import { commitBookFile, commitCover, ensureStorageDirs, streamToTemp } from "./storage.js";

/**
 * Imports popular public-domain books from Project Gutenberg into the public library.
 * Metadata comes from Gutendex (a public API over Gutenberg's catalog); files come from
 * Gutenberg's official mirror, slowly, as Gutenberg asks of automated downloads.
 * Re-running it only adds what is missing.
 */

export const LIBRARY_EMAIL = "library@readsync.local";
const GUTENDEX = "https://gutendex.com";
/**
 * Gutenberg mirrors with the generated EPUBs and covers, tried in order (Gutenberg asks robots
 * to download from mirrors rather than www.gutenberg.org). Their speed varies a lot: in October
 * 2026 pglaf served about 35 KB/s while nabasny sent the same 9 MB book in under two seconds.
 */
const MIRRORS = ["https://gutenberg.nabasny.com", "https://gutenberg.pglaf.org"];
/** Gutenberg's whole catalog as CSV (updated daily), to pick candidates without paging through searches. */
const CATALOG_CSV = "https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv.gz";
/** Most catalog matches looked up on Gutendex per themed search (32 per request, which can take a minute). */
const MAX_CANDIDATES = 960;
const UA = "BookRaven/1.0 (self-hosted reader; public-domain import)";
const MAX_BYTES = 60 * 1024 * 1024;

export type ImportOptions = {
  languages: string[];
  /** How many books per language should be in the library (already imported ones count). */
  perLanguage: number;
  /** Themed searches done before the general "most popular" one (default: IMPORT_PLAN). */
  plan?: ImportStep[];
  /** Catalog pages to read per search at most (Gutendex is slow; 32 books per page). */
  maxPages?: number;
  fetch?: typeof fetch;
  log?: (msg: string) => void;
  /** Pause between downloads, to go easy on Gutenberg's servers. */
  delayMs?: number;
};

/** The system account that owns imported books. It has no password, so nobody can sign in as it. */
export async function ensureLibraryAccount() {
  const existing = await query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [LIBRARY_EMAIL]);
  if (existing.rows[0]) return existing.rows[0].id;
  const id = randomBytes(16).toString("hex");
  await query(`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, now(), now())`, [
    id,
    "BookRaven Library",
    LIBRARY_EMAIL,
  ]);
  return id;
}

export async function importPublicDomain(opts: ImportOptions) {
  const get = opts.fetch ?? fetch;
  const log = opts.log ?? (() => {});
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await ensureStorageDirs();
  const ownerId = await ensureLibraryAccount();
  const summary = { imported: 0, skipped: 0, duplicates: 0, failed: 0 };

  async function getJson(url: string) {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await get(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(120_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { next: string | null; results: GutendexBook[] };
      } catch (err) {
        // Gutendex is a free service that is sometimes overloaded: back off and retry.
        if (attempt >= 6) throw err;
        log(`  catalog request failed (${(err as Error).message}), retrying in ${15 * attempt}s…`);
        await delay(15_000 * attempt);
      }
    }
  }

  /** Downloads to a temp file (first URL that works). */
  async function download(urls: string[], headBytes: number) {
    for (const url of urls) {
      try {
        const res = await get(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(180_000) });
        if (!res.ok || !res.body) continue;
        // Too big (some illustrated editions are 80+ MB): try the next URL, e.g. the edition without images.
        if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) {
          await res.body.cancel().catch(() => {});
          continue;
        }
        return await streamToTemp(Readable.fromWeb(res.body as unknown as WebReadableStream), headBytes);
      } catch {
        /* try the next URL */
      }
    }
    return null;
  }

  async function importOne(b: GutendexBook, lang: string, themes: Theme[]) {
    const epub = await download(
      [
        ...MIRRORS.flatMap((m) => [
          `${m}/cache/epub/${b.id}/pg${b.id}-images-3.epub`, // EPUB 3 with images
          `${m}/cache/epub/${b.id}/pg${b.id}.epub`, // without images, when the illustrated one is too big
        ]),
        b.formats["application/epub+zip"],
      ].filter(Boolean) as string[],
      DETECT_BYTES,
    );
    if (!epub) throw new Error("download failed");
    try {
      if (epub.size > MAX_BYTES || detectFormat(epub.head, "book.epub") !== "epub") throw new Error("not an EPUB");
      if (await isFileBlocked(epub.sha256)) throw new Error("blocked by an administrator");

      const title = cleanTitle(b.title).slice(0, 500);
      const author = b.authors.map((a) => displayName(a.name)).join(", ").slice(0, 500) || null;
      const filename = `${title.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 120).trim() || `gutenberg-${b.id}`}.epub`;

      let bookId = (await query<{ id: string }>("SELECT id FROM book WHERE user_id = $1 AND sha256 = $2", [ownerId, epub.sha256])).rows[0]?.id;
      if (!bookId) {
        const koreaderMd5 = await partialMd5OfFile(epub.tmpPath, epub.size);
        await commitBookFile(epub);
        const { rows } = await query<{ id: string }>(
          `INSERT INTO book (user_id, title, author, format, original_filename, mime_type, size_bytes, sha256, has_cover,
                             koreader_md5, is_public, published_at, language, tags, themes)
           VALUES ($1, $2, $3, 'epub', $4, $5, $6, $7, false, $8, true, now(), $9, $10, $11) RETURNING id`,
          [ownerId, title, author, filename, MIME_TYPES.epub, epub.size, epub.sha256, koreaderMd5, lang, tagsFrom(b), themes],
        );
        bookId = rows[0]!.id;
        const cover = await download([...MIRRORS.map((m) => `${m}/cache/epub/${b.id}/pg${b.id}.cover.medium.jpg`), b.formats["image/jpeg"]].filter(Boolean) as string[], 16);
        if (cover && cover.head[0] === 0xff && cover.head[1] === 0xd8) {
          await commitCover(cover.tmpPath, bookId);
          await query("UPDATE book SET has_cover = true WHERE id = $1", [bookId]);
        } else if (cover) {
          await fs.rm(cover.tmpPath, { force: true });
        }
      }

      await query(
        `INSERT INTO catalog_book (source, source_id, title, authors, translators, language, subjects, bookshelves, themes, download_count, source_url, book_id)
         VALUES ('gutenberg', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (source, source_id) DO UPDATE SET book_id = EXCLUDED.book_id, download_count = EXCLUDED.download_count,
           bookshelves = EXCLUDED.bookshelves, themes = EXCLUDED.themes`,
        [
          String(b.id),
          title,
          JSON.stringify(b.authors),
          JSON.stringify(b.translators),
          lang,
          b.subjects.slice(0, 20),
          b.bookshelves.slice(0, 20),
          themes,
          b.download_count,
          `https://www.gutenberg.org/ebooks/${b.id}`,
          bookId,
        ],
      );
      return title;
    } finally {
      await fs.rm(epub.tmpPath, { force: true });
    }
  }

  /** Refreshes popularity, shelves and themes of a book imported before. */
  async function refresh(b: GutendexBook, themes: Theme[]) {
    const { rows } = await query<{ book_id: string | null }>(
      `UPDATE catalog_book SET download_count = $2, bookshelves = $3, themes = (SELECT array(SELECT DISTINCT unnest(themes || $4::text[])))
       WHERE source = 'gutenberg' AND source_id = $1 RETURNING book_id`,
      [String(b.id), b.download_count, b.bookshelves.slice(0, 20), themes],
    );
    if (rows[0]?.book_id) {
      await query(
        `UPDATE book SET themes = (SELECT array(SELECT DISTINCT unnest(themes || $2::text[]))), tags = $3 WHERE id = $1`,
        [rows[0].book_id, themes, tagsFrom(b)],
      );
    }
  }

  const countFor = async (lang: string, theme?: Theme) =>
    Number(
      (
        await query<{ n: string }>(
          `SELECT count(*) AS n FROM catalog_book WHERE source = 'gutenberg' AND language = $1 AND book_id IS NOT NULL ${theme ? "AND $2 = ANY(themes)" : ""}`,
          theme ? [lang, theme] : [lang],
        )
      ).rows[0]!.n,
    );

  /** Gutenberg ids and works already in the public library. */
  async function libraryState() {
    const inLibrary = (
      await query<{ source_id: string; title: string; authors: GutendexBook["authors"]; language: string }>(
        "SELECT source_id, title, authors, language FROM catalog_book WHERE source = 'gutenberg' AND book_id IS NOT NULL",
      )
    ).rows;
    return {
      done: new Set(inLibrary.map((r) => r.source_id)),
      // Other editions of a work already in the library are skipped.
      works: new Set(inLibrary.map((r) => workKey(r.title, r.authors, r.language))),
    };
  }
  type LibraryState = Awaited<ReturnType<typeof libraryState>>;

  /** Imports one candidate if it qualifies (or refreshes it if it is already in the library). */
  async function consider(state: LibraryState, b: GutendexBook, lang: string, label: string, forced: Theme | null, only: (b: GutendexBook) => boolean) {
    const themes = [...new Set([...themesFor(b.subjects, b.bookshelves), ...(forced ? [forced] : [])])];
    if (state.done.has(String(b.id))) {
      await refresh(b, themes);
      return;
    }
    if (!b.languages.includes(lang) || !isPublicDomainEverywhere(b) || !only(b)) {
      summary.skipped++;
      return;
    }
    const work = workKey(cleanTitle(b.title), b.authors, lang);
    const fragment = fragmentOf(cleanTitle(b.title));
    if (fragment === "index" || fragment === "piece") {
      summary.skipped++;
      return;
    }
    // Another edition, or a piece (chapters, part, volume) of a book already in the library.
    if (state.works.has(work) || (typeof fragment === "object" && fragment && state.works.has(workKey(fragment.whole, b.authors, lang)))) {
      summary.duplicates++;
      return;
    }
    try {
      const title = await importOne(b, lang, themes);
      state.done.add(String(b.id));
      state.works.add(work);
      summary.imported++;
      log(`  [${lang} ${label} ${await countFor(lang, forced ?? undefined)}] ${title}`);
    } catch (err) {
      summary.failed++;
      log(`  ! ${b.id} ${b.title.slice(0, 60)}: ${(err as Error).message}`);
    }
    await delay(opts.delayMs ?? 1500);
  }

  /** Walks one Gutendex search (most popular first) until `enough()` or the pages run out. */
  async function walk(
    lang: string,
    url: string | null,
    label: string,
    forced: Theme | null,
    enough: () => Promise<boolean>,
    only: (b: GutendexBook) => boolean = () => true,
  ) {
    const state = await libraryState();
    let pages = 0;
    while (url && !(await enough()) && pages < (opts.maxPages ?? 10)) {
      let page: Awaited<ReturnType<typeof getJson>>;
      try {
        page = await getJson(url);
      } catch (err) {
        // Keep what was imported and go on with the next search; a later run fills the gap.
        log(`  ! ${label}: catalog unavailable (${(err as Error).message}), skipping the rest of this search`);
        summary.failed++;
        return;
      }
      pages++;
      for (const b of page.results) {
        if (await enough()) break;
        await consider(state, b, lang, label, forced, only);
      }
      url = page.next;
    }
  }

  let catalog: Promise<CatalogEntry[] | null> | null = null;
  /** Gutenberg's catalog file, downloaded once per run; null when it can't be had. */
  function loadCatalog() {
    catalog ??= (async () => {
      try {
        const res = await get(CATALOG_CSV, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(300_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const entries = catalogEntries(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8"));
        log(`Gutenberg catalog: ${entries.length} texts`);
        return entries;
      } catch (err) {
        log(`  ! Gutenberg catalog unavailable (${(err as Error).message}), using Gutendex searches`);
        return null;
      }
    })();
    return catalog;
  }

  /**
   * A themed search through Gutenberg's catalog file: matches are picked locally (topic in
   * the subjects or shelves, like Gutendex's topic search; authors dead long enough), then
   * only those are looked up on Gutendex, a page of 32 ids at a time, for the copyright
   * status, download counts and files. Much faster than paging through Gutendex searches,
   * where most results don't qualify. Returns false when the catalog is unavailable.
   */
  async function fromCatalog(lang: string, step: ImportStep, enough: () => Promise<boolean>) {
    if (await enough()) return true;
    const entries = await loadCatalog();
    if (!entries) return false;
    const state = await libraryState();
    const topic = step.topic.toLowerCase();
    const only = step.only ?? (() => true);
    const cutoff = deathYearCutoff();
    const candidates = entries.filter(
      (e) =>
        e.languages.includes(lang) &&
        !state.done.has(String(e.id)) &&
        [...e.subjects, ...e.bookshelves].some((t) => t.toLowerCase().includes(topic)) &&
        e.authors.length > 0 &&
        [...e.authors, ...e.translators].every((p) => p.death_year !== null && p.death_year <= cutoff) &&
        only(e as GutendexBook) &&
        !state.works.has(workKey(cleanTitle(e.title), e.authors, lang)),
    );
    if (candidates.length > MAX_CANDIDATES) log(`  ${candidates.length} catalog matches, looking up the first ${MAX_CANDIDATES}`);
    const books: GutendexBook[] = [];
    for (let i = 0; i < Math.min(candidates.length, MAX_CANDIDATES); i += 32) {
      const ids = candidates.slice(i, i + 32).map((e) => e.id);
      try {
        books.push(...(await getJson(`${GUTENDEX}/books/?ids=${ids.join(",")}`)).results);
      } catch (err) {
        log(`  ! ${step.theme}: Gutendex lookup failed (${(err as Error).message})`);
        summary.failed++;
      }
    }
    log(`  ${candidates.length} catalog matches, ${books.length} looked up`);
    // Most downloaded first, as with the searches.
    for (const b of books.sort((a, b) => b.download_count - a.download_count)) {
      if (await enough()) break;
      await consider(state, b, lang, step.theme, step.theme, only);
    }
    return true;
  }

  // Books imported before themes existed: classify them from their stored subjects.
  const old = await query<{ id: string; book_id: string | null; subjects: string[]; bookshelves: string[] }>(
    "SELECT id, book_id, subjects, bookshelves FROM catalog_book WHERE themes = '{}'",
  );
  for (const r of old.rows) {
    const themes = themesFor(r.subjects, r.bookshelves);
    if (!themes.length) continue;
    await query("UPDATE catalog_book SET themes = $2 WHERE id = $1", [r.id, themes]);
    if (r.book_id) await query("UPDATE book SET themes = $2 WHERE id = $1", [r.book_id, themes]);
  }

  const base = `${GUTENDEX}/books/?sort=popular&copyright=false&mime_type=application%2Fepub`;
  for (const lang of opts.languages) {
    log(`${lang}: ${await countFor(lang)} already in the library, target ${opts.perLanguage}`);
    for (const step of opts.plan ?? IMPORT_PLAN) {
      const quota = step.quota[lang];
      if (!quota) continue;
      log(`${lang} · ${step.theme} (“${step.topic}”): ${await countFor(lang, step.theme)}/${quota}`);
      const enough = async () => (await countFor(lang, step.theme)) >= quota;
      if (!(await fromCatalog(lang, step, enough))) {
        await walk(lang, `${base}&languages=${lang}&topic=${encodeURIComponent(step.topic)}`, step.theme, step.theme, enough, step.only);
      }
    }
    log(`${lang} · most popular overall`);
    await walk(lang, `${base}&languages=${lang}`, "popular", null, async () => (await countFor(lang)) >= opts.perLanguage);
    log(`${lang}: ${await countFor(lang)} books in the library`);
  }
  return summary;
}
