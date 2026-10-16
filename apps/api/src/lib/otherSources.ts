import fs from "node:fs/promises";
import { query } from "../db.js";
import { decodeEntities as decode, epubPackage, opfPeople } from "./epubInfo.js";
import { DETECT_BYTES, detectFormat } from "./formats.js";
import { delay, downloadFirst, ensureLibraryAccount, gutenbergCatalog, MAX_BYTES, retry, storePublicBook, UA } from "./gutenbergImport.js";
import { isFileBlocked } from "./moderation.js";
import { cleanTitle, deathYearCutoff, displayName, normalize as norm, type Person } from "./publicDomain.js";
import { ensureStorageDirs } from "./storage.js";
import { themesFor } from "./themes.js";

/**
 * More public-domain sources for the public library, beside Project Gutenberg:
 *
 * - Standard Ebooks: carefully produced English editions. Its open feed lists the newest
 *   releases; the whole catalog is a benefit of its Patrons Circle (give the member's email).
 * - Wikisource in Portuguese: works found through Wikidata (authors, translators, their death
 *   years), downloaded as EPUB from Wikisource's export service.
 *
 * The rule is the same as for Gutenberg: every author and translator died more than 70 full
 * years ago. Death years come from Gutenberg's catalog or Wikidata; anyone without one known
 * keeps the book out. A work already in the library from any source is not imported again.
 */

const SE_OPEN_FEED = "https://standardebooks.org/feeds/atom/new-releases";
const SE_CATALOG = "https://standardebooks.org/feeds/opds/all";
const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";
const WS_EXPORT = "https://ws-export.wmcloud.org/";
/** Wikisource exports smaller than this are poems, hymns or declarations, not books. */
const MIN_WIKISOURCE_BYTES = 40 * 1024;

export const SOURCE_NAMES: Record<string, string> = {
  gutenberg: "Project Gutenberg",
  standardebooks: "Standard Ebooks",
  wikisource: "Wikisource",
};

export type SourceOptions = {
  /** Most books to add from this source in one run. */
  limit: number;
  fetch?: typeof fetch;
  log?: (msg: string) => void;
  delayMs?: number;
  /** Death years known beforehand (e.g. from Gutenberg's catalog), by display name. */
  deaths?: Map<string, number | null>;
};

export type SourceSummary = { imported: number; skipped: number; duplicates: number; failed: number };

/** One work across sources: language, title without subtitle, authors as "First Last". */
export function crossKey(title: string, authors: string[], language: string) {
  const t = norm(cleanTitle(title).replace(/\s*[:;(].*$/, ""));
  return `${language}|${t}|${authors.map((a) => norm(displayName(a))).sort().join(" + ")}`;
}

/** Works already in the public library from any source. */
async function knownWorks() {
  const { rows } = await query<{ source: string; source_id: string; title: string; authors: Person[]; language: string }>(
    "SELECT source, source_id, title, authors, language FROM catalog_book WHERE book_id IS NOT NULL",
  );
  return {
    ids: new Set(rows.map((r) => `${r.source}:${r.source_id}`)),
    works: new Set(rows.map((r) => crossKey(r.title, r.authors.map((a) => a.name), r.language))),
  };
}

const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

export type FeedEntry = { id: string; url: string; title: string; authors: string[]; summary: string | null; subjects: string[]; epub: string | null; cover: string | null };

/** Standard Ebooks' Atom/OPDS entries: title, authors, summary, subjects, the compatible EPUB and the cover. */
export function parseStandardEbooksFeed(xml: string): { entries: FeedEntry[]; next: string | null } {
  const entries: FeedEntry[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1]!;
    const url = decode(/<id>([^<]+)<\/id>/.exec(e)?.[1] ?? "");
    const links = [...e.matchAll(/<link\b[^>]*>/g)].map((l) => l[0]);
    const epubs = links.filter((l) => attr(l, "type") === "application/epub+zip").map((l) => decode(attr(l, "href") ?? ""));
    // The "compatible" EPUB, not the advanced (EPUB 3 only) or Kobo ones.
    const epub = epubs.find((h) => !/_advanced\.epub|\.kepub\./.test(h)) ?? null;
    const image = links.find((l) => /opds-spec\.org\/image\b/.test(attr(l, "rel") ?? ""));
    const thumb = /<media:thumbnail\b[^>]*url="([^"]+)"/.exec(e)?.[1];
    entries.push({
      id: url.replace(/^https:\/\/standardebooks\.org\/ebooks\//, ""),
      url,
      title: decode(/<title[^>]*>([\s\S]*?)<\/title>/.exec(e)?.[1] ?? ""),
      authors: [...e.matchAll(/<author>\s*<name>([^<]+)<\/name>/g)].map((a) => decode(a[1]!)),
      summary: (() => {
        const s = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(e)?.[1];
        return s ? decode(s).slice(0, 4000) : null;
      })(),
      subjects: [...e.matchAll(/<category\b[^>]*term="([^"]+)"/g)].map((c) => decode(c[1]!)),
      epub,
      cover: image ? decode(attr(image, "href") ?? "") : thumb ? decode(thumb) : null,
    });
  }
  const nextLink = [...xml.matchAll(/<link\b[^>]*>/g)].map((l) => l[0]).find((l) => attr(l, "rel") === "next");
  return { entries: entries.filter((x) => x.title && x.url), next: nextLink ? decode(attr(nextLink, "href") ?? "") : null };
}

function tools(opts: SourceOptions) {
  const get = opts.fetch ?? fetch;
  const log = opts.log ?? (() => {});

  /**
   * Death years by name: the ones known beforehand, then Wikidata (people with that exact
   * label; with namesakes the latest death counts). Unknown names map to null.
   */
  async function deathsOf(names: string[]) {
    const out = new Map<string, number | null>();
    const ask: string[] = [];
    for (const n of names) {
      const known = opts.deaths?.get(norm(n));
      if (known !== undefined) out.set(n, known);
      else ask.push(n);
    }
    for (let i = 0; i < ask.length; i += 40) {
      const batch = ask.slice(i, i + 40);
      const values = batch.flatMap((n) => [`"${n.replace(/["\\]/g, "")}"@en`, `"${n.replace(/["\\]/g, "")}"@pt`]).join(" ");
      const sparql = `SELECT ?name (MAX(YEAR(?d)) AS ?died) WHERE { VALUES ?name { ${values} } ?p rdfs:label ?name ; wdt:P31 wd:Q5 ; wdt:P570 ?d . } GROUP BY ?name`;
      try {
        const res = await get(`${WIKIDATA_SPARQL}?query=${encodeURIComponent(sparql)}`, {
          headers: { "user-agent": UA, accept: "application/sparql-results+json" },
          signal: AbortSignal.timeout(60_000),
        });
        const json = (await res.json()) as { results: { bindings: { name?: { value: string }; died?: { value: string } }[] } };
        for (const r of json.results.bindings) {
          if (!r.name || !r.died) continue; // a group with no death year
          const n = batch.find((x) => x.replace(/["\\]/g, "") === r.name!.value);
          if (n) out.set(n, Math.max(out.get(n) ?? -Infinity, Number(r.died.value)));
        }
      } catch (err) {
        log(`  ! Wikidata unavailable (${(err as Error).message}): unknown death years skip their books`);
      }
    }
    for (const n of names) if (!out.has(n)) out.set(n, null);
    return out;
  }

  return { get, log, deathsOf };
}

/**
 * Death years from Gutenberg's catalog file, by normalized "First Last" name (namesakes:
 * the latest death counts). Saves asking Wikidata about most authors. Throws when the file
 * can't be had.
 */
export async function gutenbergDeaths(get: typeof fetch = fetch) {
  const deaths = new Map<string, number | null>();
  for (const e of await gutenbergCatalog(get)) {
    for (const p of [...e.authors, ...e.translators]) {
      if (p.death_year === null) continue;
      const key = norm(displayName(p.name));
      deaths.set(key, Math.max(deaths.get(key) ?? -Infinity, p.death_year));
    }
  }
  return deaths;
}

/** Everyone died more than 70 years ago (and is known). */
function allDeadLongEnough(people: Person[], cutoff = deathYearCutoff()) {
  return people.length > 0 && people.every((p) => p.death_year !== null && p.death_year <= cutoff);
}

export async function importStandardEbooks(opts: SourceOptions & { patronEmail?: string }): Promise<SourceSummary> {
  const { get, log, deathsOf } = tools(opts);
  await ensureStorageDirs();
  const ownerId = await ensureLibraryAccount();
  const summary: SourceSummary = { imported: 0, skipped: 0, duplicates: 0, failed: 0 };
  const known = await knownWorks();
  // Patrons give their email as the user name and no password.
  const auth: Record<string, string> = opts.patronEmail ? { authorization: `Basic ${Buffer.from(`${opts.patronEmail}:`).toString("base64")}` } : {};

  let url: string | null = opts.patronEmail ? SE_CATALOG : SE_OPEN_FEED;
  log(`Standard Ebooks: ${opts.patronEmail ? "whole catalog (Patrons Circle)" : "newest releases (the whole catalog needs a Patrons Circle email)"}`);
  while (url && summary.imported < opts.limit) {
    const res = await get(url, { headers: { "user-agent": UA, ...auth }, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      log(`  ! feed unavailable (HTTP ${res.status})`);
      summary.failed++;
      break;
    }
    const page = parseStandardEbooksFeed(await res.text());
    for (const e of page.entries) {
      if (summary.imported >= opts.limit) break;
      if (known.ids.has(`standardebooks:${e.id}`) || known.works.has(crossKey(e.title, e.authors, "en"))) {
        summary.duplicates++;
        continue;
      }
      if (!e.epub) {
        summary.skipped++;
        continue;
      }
      const file = await downloadFirst(get, [e.epub], DETECT_BYTES, auth);
      if (!file) {
        summary.failed++;
        log(`  ! ${e.title}: download failed`);
        continue;
      }
      try {
        if (file.size > MAX_BYTES || detectFormat(file.head, "book.epub") !== "epub" || (await isFileBlocked(file.sha256))) {
          summary.skipped++;
          continue;
        }
        // The feed has no translators; the EPUB's package document does.
        const opf = epubPackage(await fs.readFile(file.tmpPath));
        const people = opf ? opfPeople(opf) : { authors: e.authors, translators: [], language: "en" };
        const authorsNames = people.authors.length ? people.authors : e.authors;
        const deaths = await deathsOf([...authorsNames, ...people.translators]);
        const authors = authorsNames.map((n) => ({ name: n, birth_year: null, death_year: deaths.get(n) ?? null }));
        const translators = people.translators.map((n) => ({ name: n, birth_year: null, death_year: deaths.get(n) ?? null }));
        if (!allDeadLongEnough(authors) || !translators.every((t) => t.death_year !== null && t.death_year <= deathYearCutoff())) {
          summary.skipped++;
          log(`  - ${e.title}: not public domain everywhere (life + 70)`);
          continue;
        }
        const title = await storePublicBook(
          ownerId,
          file,
          {
            source: "standardebooks",
            sourceId: e.id,
            sourceUrl: e.url,
            title: e.title,
            authors,
            translators,
            language: people.language ?? "en",
            subjects: e.subjects,
            themes: themesFor(e.subjects),
            tags: e.subjects.filter((s) => !s.includes("--")),
            description: e.summary,
            popularity: 0,
          },
          e.cover ? [e.cover] : [],
          get,
          true,
        );
        known.works.add(crossKey(e.title, e.authors, "en"));
        summary.imported++;
        log(`  [se ${summary.imported}] ${title}`);
      } catch (err) {
        summary.failed++;
        log(`  ! ${e.title}: ${(err as Error).message}`);
      } finally {
        await fs.rm(file.tmpPath, { force: true });
      }
      await delay(opts.delayMs ?? 1500);
    }
    url = page.next;
  }
  return summary;
}

export type WikisourceWork = {
  page: string;
  title: string;
  authors: Person[];
  translators: Person[];
  /** Languages of the original work (ISO 639-1), when Wikidata knows them. */
  languages: string[];
  /** Languages its authors wrote in, a hint when the work's own language is missing. */
  authorLanguages: string[];
  genres: string[];
  description: string | null;
  /** Wikipedia/Wikisource links of the work: a popularity signal. */
  links: number;
};

/**
 * Portuguese Wikisource pages about one kind of item (literary works, or editions and
 * translations of them). Asked kind by kind: one query over all of Wikisource's pages
 * is too slow for Wikidata's 60-second limit.
 */
const wikisourceListQuery = (kind: string) => `
SELECT ?item ?page WHERE {
  ?item wdt:P31 wd:${kind} .
  ?article schema:about ?item ; schema:isPartOf <https://pt.wikisource.org/> ; schema:name ?page .
}`;
/** Literary work, and version/edition/translation. */
const WIKISOURCE_KINDS = ["Q7725634", "Q3331189"];

/** Authors, translators, original language, genres and popularity of up to ~150 items. */
const wikisourceDetailsQuery = (items: string[]) => `
SELECT ?item
  (GROUP_CONCAT(DISTINCT CONCAT(?aName, "|", COALESCE(STR(YEAR(?aDied)), "")); separator=";") AS ?authors)
  (GROUP_CONCAT(DISTINCT CONCAT(?tName, "|", COALESCE(STR(YEAR(?tDied)), "")); separator=";") AS ?translators)
  (GROUP_CONCAT(DISTINCT ?langCode; separator=";") AS ?languages)
  (GROUP_CONCAT(DISTINCT ?authorLangCode; separator=";") AS ?authorLanguages)
  (GROUP_CONCAT(DISTINCT ?genreName; separator=";") AS ?genres)
  (SAMPLE(?desc) AS ?description) (MAX(?sl) AS ?links)
WHERE {
  VALUES ?item { ${items.map((i) => `wd:${i}`).join(" ")} }
  OPTIONAL { ?item wdt:P629 ?w }
  BIND(COALESCE(?w, ?item) AS ?work)
  OPTIONAL {
    ?work wdt:P50 ?author . ?author rdfs:label ?aName . FILTER(LANG(?aName) = "pt")
    OPTIONAL { ?author wdt:P570 ?aDied }
    OPTIONAL { ?author wdt:P1412|wdt:P103 ?al . ?al wdt:P218 ?authorLangCode }
  }
  OPTIONAL { ?item wdt:P655 ?tr . ?tr rdfs:label ?tName . FILTER(LANG(?tName) = "pt") OPTIONAL { ?tr wdt:P570 ?tDied } }
  OPTIONAL { ?work wdt:P407 ?lang . ?lang wdt:P218 ?langCode }
  OPTIONAL { ?work wdt:P136 ?genre . ?genre rdfs:label ?genreName . FILTER(LANG(?genreName) = "pt") }
  OPTIONAL { ?item schema:description ?desc . FILTER(LANG(?desc) = "pt") }
  OPTIONAL { ?work wikibase:sitelinks ?sl }
}
GROUP BY ?item`;

type Binding = Record<string, { value: string } | undefined>;

/** Reads the query's rows: people as "Name|1908;Other|", languages as ISO 639-1 codes. */
export function wikisourceWorks(bindings: Binding[], pages: Map<string, string>): WikisourceWork[] {
  const people = (s: string | undefined) =>
    (s ?? "")
      .split(";")
      .filter(Boolean)
      .map((p) => {
        const [name, died] = p.split("|");
        return { name: name!.trim(), birth_year: null, death_year: died ? Number(died) : null };
      });
  const seen = new Set<string>();
  const works: WikisourceWork[] = [];
  for (const b of bindings) {
    const page = pages.get((b.item?.value ?? "").split("/").pop() ?? "");
    if (!page || seen.has(page)) continue;
    seen.add(page);
    const languages = (b.languages?.value ?? "").split(";").filter(Boolean);
    works.push({
      page,
      // The page name is the edition's title in Portuguese (P1476 is often the original's).
      title: page.replace(/\s*\([^)]*\)\s*$/, ""),
      authors: people(b.authors?.value),
      translators: people(b.translators?.value),
      languages,
      authorLanguages: (b.authorLanguages?.value ?? "").split(";").filter(Boolean),
      genres: (b.genres?.value ?? "").split(";").filter(Boolean),
      description: b.description?.value && b.description.value.length >= 40 ? b.description.value : null,
      links: Number(b.links?.value ?? 0),
    });
  }
  return works.sort((a, b) => b.links - a.links);
}

/**
 * Public domain everywhere: authors and translators dead long enough. Without a known
 * translator only works written in Portuguese qualify (an unnamed translation may be recent):
 * the work says so, or it says nothing and every author wrote in Portuguese.
 */
export function wikisourceEligible(w: WikisourceWork, cutoff = deathYearCutoff()) {
  if (!allDeadLongEnough(w.authors, cutoff)) return false;
  if (!w.translators.length) {
    return w.languages.length ? w.languages.includes("pt") : w.authorLanguages.length > 0 && w.authorLanguages.every((l) => l === "pt");
  }
  return w.translators.every((t) => t.death_year !== null && t.death_year <= cutoff);
}

export async function importWikisource(opts: SourceOptions): Promise<SourceSummary> {
  const { get, log } = tools(opts);
  await ensureStorageDirs();
  const ownerId = await ensureLibraryAccount();
  const summary: SourceSummary = { imported: 0, skipped: 0, duplicates: 0, failed: 0 };
  const known = await knownWorks();

  log("Wikisource (pt): asking Wikidata for works…");
  // The public endpoint is busy at times: back off and retry a few times.
  const sparql = (q: string) =>
    retry(
      async () => {
        const res = await get(`${WIKIDATA_SPARQL}?query=${encodeURIComponent(q)}`, {
          headers: { "user-agent": UA, accept: "application/sparql-results+json" },
          signal: AbortSignal.timeout(90_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return ((await res.json()) as { results: { bindings: Binding[] } }).results.bindings;
      },
      4,
      10_000,
      (message, seconds) => log(`  Wikidata busy (${message}), retrying in ${seconds}s…`),
    );
  const pages = new Map<string, string>();
  try {
    for (const kind of WIKISOURCE_KINDS) {
      for (const b of await sparql(wikisourceListQuery(kind))) {
        const id = b.item?.value.split("/").pop();
        const page = b.page?.value;
        // Subpages (chapters) and other namespaces are not books.
        if (id && page && !page.includes("/") && !page.includes(":")) pages.set(id, page);
      }
    }
  } catch (err) {
    log(`  ! Wikidata unavailable (${(err as Error).message})`);
    return { ...summary, failed: 1 };
  }
  const bindings: Binding[] = [];
  const ids = [...pages.keys()];
  for (let i = 0; i < ids.length; i += 150) {
    try {
      bindings.push(...(await sparql(wikisourceDetailsQuery(ids.slice(i, i + 150)))));
    } catch (err) {
      log(`  ! details for ${Math.min(150, ids.length - i)} works unavailable (${(err as Error).message})`);
    }
  }
  const works = wikisourceWorks(bindings, pages);
  const eligible = works.filter((w) => wikisourceEligible(w));
  log(`  ${works.length} works, ${eligible.length} public domain everywhere`);

  for (const w of eligible) {
    if (summary.imported >= opts.limit) break;
    if (known.ids.has(`wikisource:${w.page}`) || known.works.has(crossKey(w.title, w.authors.map((a) => a.name), "pt"))) {
      summary.duplicates++;
      continue;
    }
    const file = await downloadFirst(get, [`${WS_EXPORT}?format=epub-3&lang=pt&page=${encodeURIComponent(w.page)}`], DETECT_BYTES);
    if (!file) {
      summary.failed++;
      log(`  ! ${w.page}: export failed`);
      continue;
    }
    try {
      if (file.size < MIN_WIKISOURCE_BYTES || file.size > MAX_BYTES || detectFormat(file.head, "book.epub") !== "epub" || (await isFileBlocked(file.sha256))) {
        summary.skipped++;
        continue;
      }
      const themes = themesFor(w.genres);
      const title = await storePublicBook(
        ownerId,
        file,
        {
          source: "wikisource",
          sourceId: w.page,
          sourceUrl: `https://pt.wikisource.org/wiki/${encodeURIComponent(w.page.replace(/ /g, "_"))}`,
          title: w.title,
          authors: w.authors,
          translators: w.translators,
          language: "pt",
          subjects: w.genres,
          themes: themes.length ? themes : ["literature"],
          tags: w.genres,
          description: w.description,
          popularity: w.links,
        },
        [],
        get,
      );
      known.works.add(crossKey(w.title, w.authors.map((a) => a.name), "pt"));
      summary.imported++;
      log(`  [wikisource ${summary.imported}] ${title}`);
    } catch (err) {
      summary.failed++;
      log(`  ! ${w.page}: ${(err as Error).message}`);
    } finally {
      await fs.rm(file.tmpPath, { force: true });
    }
    await delay(opts.delayMs ?? 1500);
  }
  return summary;
}
