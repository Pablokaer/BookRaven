/**
 * Public-domain rules and helpers for importing books from Project Gutenberg.
 *
 * Gutenberg marks books that are public domain in the USA. Brazil, Portugal and most
 * of the world use "life + 70 years", so a book is only imported when every author and
 * translator died more than 70 full years ago (works without a known author are skipped).
 */

export type Person = { name: string; birth_year: number | null; death_year: number | null };

export type GutendexBook = {
  id: number;
  title: string;
  authors: Person[];
  translators: Person[];
  subjects: string[];
  bookshelves: string[];
  languages: string[];
  copyright: boolean | null;
  media_type: string;
  formats: Record<string, string>;
  download_count: number;
  /** Short descriptions of the book (Gutendex adds them for many books). */
  summaries?: string[];
};

/** The book's blurb from its catalog summary, if any. */
export function summaryOf(b: Pick<GutendexBook, "summaries">) {
  const s = b.summaries?.find((x) => x.trim())?.trim();
  return s ? s.slice(0, 4000) : null;
}

/** Latest death year that makes a work public domain under "life + 70" in `year`. */
export const deathYearCutoff = (year = new Date().getFullYear()) => year - 71;

export function isPublicDomainEverywhere(b: Pick<GutendexBook, "authors" | "translators" | "copyright" | "media_type">, cutoff = deathYearCutoff()) {
  if (b.copyright !== false || b.media_type !== "Text") return false;
  if (!b.authors.length) return false;
  return [...b.authors, ...b.translators].every((p) => p.death_year !== null && p.death_year <= cutoff);
}

/**
 * Gutenberg titles sometimes keep library-catalog (MARC) subfield markers:
 * "Peter Pan : $b [Peter and Wendy]" → "Peter Pan: [Peter and Wendy]".
 */
export function cleanTitle(title: string) {
  return title
    .replace(/\s*:\s*\$[a-z]\s*/g, ": ")
    .replace(/\s*\$[a-z]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Identifies a work regardless of the edition: Gutenberg often has several editions of the
 * same book under different ids (e.g. two "Pride and Prejudice"). Same language, same
 * authors and the same title, ignoring case, accents, punctuation and alternative titles
 * ("Moby Dick; Or, The Whale" = "Moby Dick"). Subtitles after ":" are kept, so "Essays:
 * First Series" and "Essays: Second Series" stay different works.
 */
export function workKey(title: string, authors: Pick<Person, "name">[], language: string) {
  // "Moby Dick; Or, The Whale" and "Tom Sawyer, Complete" are the same works as "Moby Dick" and "Tom Sawyer".
  const t = normalize(
    cleanTitle(title)
      .replace(/\s*;\s*or\b.*$/i, "")
      .replace(/(?:,|\s+—)\s+complete\.?$/i, ""),
  );
  const a = authors.map((p) => normalize(p.name)).sort().join(" + ");
  return `${language}|${t}|${a}`;
}

/**
 * Gutenberg also carries pieces of books: a novel split into chapter ranges or parts (the
 * complete book is always there too), single volumes of a set, and index pages. For a volume
 * the result names the whole work.
 */
export function fragmentOf(title: string): "index" | "piece" | { whole: string } | null {
  if (/index of the project gutenberg works|index to the project gutenberg editions|table of contents and index/i.test(title)) return "index";
  if (/,?\s+chapters?\s+\d+\s+(?:to|-)\s+(?:\d+|the last)\.?$/i.test(title)) return "piece"; // "Huckleberry Finn, Chapters 36 to the Last"
  if (/,\s+part\s+\d+\.$/i.test(title)) return "piece"; // "Tom Sawyer, Part 3." (plays like "King Henry IV, Part 1" have no period)
  const m = /^(.+?)(?:,|:|\.|\s+—)\s+(?:vol(?:ume)?\.?|v\.)\s*\d+(?:\s*\(?of \d+\)?)?(?:[:.].*)?$/i.exec(title); // "Oliver Twist, Vol. 1 (of 3)"
  return m ? { whole: m[1]!.trim() } : null;
}

/** Written in English, not translated: an English-language literature category and no translator. */
export function writtenInEnglish(b: Pick<GutendexBook, "languages" | "translators" | "bookshelves">) {
  return (
    b.languages.includes("en") &&
    b.translators.length === 0 &&
    b.bookshelves.some((s) => /^Category: (British|American|Irish|Scottish|Canadian|Australian) Literature$/.test(s))
  );
}

/** "Assis, Machado de" → "Machado de Assis"; keeps names without a comma as they are. */
export function displayName(name: string) {
  const clean = name.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  const [last, first] = clean.split(/,\s*/, 2);
  return first ? `${first} ${last}`.trim() : clean;
}

/** Useful tags from Gutenberg's bookshelves ("Category: Novels" → "Novels"). */
export function tagsFrom(b: Pick<GutendexBook, "bookshelves">) {
  const tags = b.bookshelves.filter((s) => s.startsWith("Category: ")).map((s) => s.slice("Category: ".length).trim());
  return [...new Set(tags)].slice(0, 5);
}

export const LANGUAGE_NAMES: Record<string, string> = { en: "English", pt: "Português" };

// ---- Gutenberg's own catalog (pg_catalog.csv) ----

/** A row of Gutenberg's catalog file: enough to choose candidates without asking Gutendex. */
export type CatalogEntry = Pick<GutendexBook, "id" | "title" | "languages" | "subjects" | "bookshelves" | "authors" | "translators">;

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
  return rows;
}

/** A year in a catalog date ("1817", "1775?", "651? BCE"); BCE years are negative. */
function year(part: string | undefined) {
  const m = part && /\d{1,4}/.exec(part);
  if (!m) return null;
  return /BCE/i.test(part) ? -Number(m[0]) : Number(m[0]);
}

/**
 * The catalog's Authors column: "Austen, Jane, 1775-1817; Garnett, Constance, 1861-1946 [Translator]".
 * People without a role are authors; other roles than translator (editor, illustrator…) are ignored,
 * as Gutendex does.
 */
export function catalogPeople(field: string) {
  const authors: Person[] = [];
  const translators: Person[] = [];
  for (const raw of field.split(";").map((s) => s.trim()).filter(Boolean)) {
    const role = /\[([^\]]+)\]\s*$/.exec(raw)?.[1];
    const entry = raw.replace(/\s*\[[^\]]+\]\s*$/, "");
    const dates = /,\s*([^,]*\d[^,]*)$/.exec(entry);
    const name = dates ? entry.slice(0, dates.index).trim() : entry;
    const [born, died] = dates ? dates[1]!.split("-") : [];
    const person = { name, birth_year: year(born), death_year: year(died) };
    if (!role) authors.push(person);
    else if (role === "Translator") translators.push(person);
  }
  return { authors, translators };
}

/** Text entries of Gutenberg's catalog file. */
export function catalogEntries(csv: string): CatalogEntry[] {
  const [header, ...rows] = parseCsv(csv);
  const col = (name: string) => header!.indexOf(name);
  const [id, type, title, language, people, subjects, shelves] = ["Text#", "Type", "Title", "Language", "Authors", "Subjects", "Bookshelves"].map(col);
  const list = (s: string | undefined) => (s ?? "").split(";").map((x) => x.trim()).filter(Boolean);
  return rows
    .filter((r) => r[type!] === "Text" && Number(r[id!]))
    .map((r) => ({
      id: Number(r[id!]),
      title: (r[title!] ?? "").replace(/\s*\n\s*/g, ": "),
      languages: list(r[language!]),
      subjects: list(r[subjects!]),
      bookshelves: list(r[shelves!]),
      ...catalogPeople(r[people!] ?? ""),
    }));
}
