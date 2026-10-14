import type { Book, PublicBook } from "./api";
import { SUPPORTED_EXTENSIONS } from "./books";

// ---------- Matching books by title and author ----------

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * A title reduced to what identifies the work: no series ("(Discworld, #1)"), no subtitle
 * after ":" or ";", no leading article, case, accents or punctuation.
 */
export function titleKey(title: string) {
  const t = title
    .replace(/\s*\([^)]*#\s*\d+[^)]*\)\s*$/, "") // Goodreads series suffix
    .replace(/\s*[:;].*$/, "")
    .trim();
  return norm(t).replace(/^(the|a|an|o|a|os|as|um|uma)\s+/, "");
}

/**
 * Each author's name, normalized, in "First Last" order. Authors are separated by ";", "&",
 * "and" or "e"; a single comma is "Last, First" ("Assis, Machado de"), more are a list.
 */
export function authorKeys(author: string | null | undefined) {
  if (!author) return [];
  return author
    .split(/\s*(?:;|&|\s+and\s+|\s+e\s+)\s*/)
    .flatMap((a) => {
      const parts = a.split(/\s*,\s*/).filter(Boolean);
      if (parts.length === 2) return [`${parts[1]} ${parts[0]}`];
      return parts;
    })
    .map(norm)
    .filter(Boolean);
}

/** Same work: same title key, and a shared author when both sides name one. */
export function sameBook(a: { title: string; author: string | null }, b: { title: string; author: string | null }) {
  if (titleKey(a.title) !== titleKey(b.title)) return false;
  const x = authorKeys(a.author);
  const y = authorKeys(b.author);
  if (!x.length || !y.length) return true;
  // Surnames are enough ("J. R. R. Tolkien" vs "John Ronald Reuel Tolkien").
  const last = (n: string) => n.split(" ").at(-1);
  return x.some((n) => y.some((m) => n === m || last(n) === last(m)));
}

// ---------- Goodreads ----------

/** RFC 4180 CSV: quoted fields may hold commas, doubled quotes and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows.filter((r) => r.some((f) => f.trim()));
}

export type GoodreadsShelf = "read" | "currently-reading" | "to-read" | string;

export type GoodreadsBook = {
  title: string;
  author: string | null;
  isbn: string | null;
  /** 0 (not rated) to 5. */
  rating: number;
  /** Goodreads' exclusive shelf: read, currently-reading, to-read (or a custom one). */
  shelf: GoodreadsShelf;
  /** The other shelves, which become tags. */
  shelves: string[];
  dateRead: Date | null;
};

/** Goodreads dates are "2024/05/17" (or empty). */
function goodreadsDate(s: string | undefined) {
  const m = s && /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s.trim());
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null;
}

/** Reads Goodreads' "Export Library" CSV (My Books → Import and export). */
export function parseGoodreads(csv: string): GoodreadsBook[] {
  const [header, ...rows] = parseCsv(csv.replace(/^﻿/, ""));
  if (!header) return [];
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const title = col("title");
  if (title < 0) throw new Error("not_goodreads");
  const [author, isbn13, isbn, rating, shelf, shelves, dateRead] = ["author", "isbn13", "isbn", "my rating", "exclusive shelf", "bookshelves", "date read"].map(col);
  const get = (r: string[], i: number) => (i! >= 0 ? (r[i!] ?? "").trim() : "");
  // ISBNs come wrapped as ="9780141439518".
  const cleanIsbn = (s: string) => s.replace(/[="\s]/g, "") || null;
  return rows
    .map((r) => {
      const exclusive = get(r, shelf!) || "read";
      return {
        title: get(r, title),
        author: get(r, author!) || null,
        isbn: cleanIsbn(get(r, isbn13!)) ?? cleanIsbn(get(r, isbn!)),
        rating: Number(get(r, rating!)) || 0,
        shelf: exclusive,
        shelves: get(r, shelves!)
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s && s !== exclusive),
        dateRead: goodreadsDate(get(r, dateRead!)),
      };
    })
    .filter((b) => b.title);
}

export type GoodreadsMatch = {
  item: GoodreadsBook;
  /** The same book in the reader's library, if any. */
  own: Book | null;
  /** The same book in the public library, when it isn't in the library yet. */
  pub: PublicBook | null;
};

export function matchGoodreads(items: GoodreadsBook[], library: Book[], publicBooks: PublicBook[]): GoodreadsMatch[] {
  return items.map((item) => {
    const own = library.find((b) => sameBook(item, b)) ?? null;
    // Most popular edition first, when the public library has several.
    const pub = own
      ? null
      : ([...publicBooks].sort((a, b) => (b.popularity ?? -1) - (a.popularity ?? -1)).find((b) => sameBook(item, b)) ?? null);
    return { item, own, pub };
  });
}

// ---------- Calibre ----------

export type CalibreBook = {
  title: string;
  author: string | null;
  description: string | null;
  tags: string[];
  series: string | null;
  /** The file to upload: the library's best format for reading here. */
  file: File;
  cover: File | null;
  /** Other formats in the folder, not uploaded. */
  otherFormats: string[];
};

/** Formats in order of preference when a Calibre book has several. */
const PREFERRED = [".epub", ".azw3", ".mobi", ".fb2", ".cbz", ".cbr", ".cb7", ".cbt", ".pdf", ".azw"];
const ext = (name: string) => name.toLowerCase().slice(name.lastIndexOf("."));

/** HTML from Calibre's comments field as plain text. */
function plain(html: string | null | undefined) {
  if (!html) return null;
  const doc = new DOMParser().parseFromString(html.replace(/<\/(p|div)\s*>|<br\s*\/?>/gi, "\n\n$&"), "text/html");
  const text = (doc.body.textContent ?? "").replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*/g, "\n\n").trim();
  return text || null;
}

/** Reads one book's metadata.opf (Dublin Core plus Calibre's own <meta> entries). */
export function parseOpf(xml: string) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const all = Array.from(doc.getElementsByTagName("*"));
  // By prefix or local name: parsers differ in how they expose XML namespaces.
  const dc = (name: string) =>
    all
      .filter((e) => e.tagName.toLowerCase() === `dc:${name}` || (e.localName === name && e.namespaceURI === "http://purl.org/dc/elements/1.1/"))
      .map((e) => e.textContent?.trim() ?? "")
      .filter(Boolean);
  const meta = (name: string) => all.find((e) => e.localName === "meta" && e.getAttribute("name") === name)?.getAttribute("content") ?? null;
  const series = meta("calibre:series");
  const index = meta("calibre:series_index");
  return {
    title: dc("title")[0] ?? null,
    author: dc("creator").join(", ") || null,
    description: plain(dc("description")[0]),
    tags: dc("subject"),
    series: series ? `${series}${index && Number(index) ? ` #${Number(index)}` : ""}` : null,
  };
}

/**
 * Turns the files of a picked Calibre library folder into books: one per folder with a
 * readable file, with its metadata.opf and cover.jpg when present.
 */
export async function readCalibreFolder(files: File[]): Promise<CalibreBook[]> {
  const byDir = new Map<string, File[]>();
  for (const f of files) {
    const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    byDir.set(dir, [...(byDir.get(dir) ?? []), f]);
  }
  const books: CalibreBook[] = [];
  for (const [, dirFiles] of byDir) {
    const readable = dirFiles.filter((f) => SUPPORTED_EXTENSIONS.includes(ext(f.name))).sort((a, b) => PREFERRED.indexOf(ext(a.name)) - PREFERRED.indexOf(ext(b.name)));
    const file = readable[0];
    if (!file) continue;
    const opfFile = dirFiles.find((f) => f.name === "metadata.opf");
    const opf = opfFile ? parseOpf(await opfFile.text()) : null;
    books.push({
      title: opf?.title ?? file.name.replace(/\.[^.]+$/, ""),
      author: opf?.author ?? null,
      description: opf?.description ?? null,
      tags: opf?.tags ?? [],
      series: opf?.series ?? null,
      file,
      cover: dirFiles.find((f) => /^cover\.(jpe?g|png)$/i.test(f.name)) ?? null,
      otherFormats: readable.slice(1).map((f) => ext(f.name).slice(1).toUpperCase()),
    });
  }
  return books.sort((a, b) => a.title.localeCompare(b.title));
}
