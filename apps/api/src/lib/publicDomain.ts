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
};

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
  const t = normalize(cleanTitle(title).replace(/\s*;\s*or\b.*$/i, ""));
  const a = authors.map((p) => normalize(p.name)).sort().join(" + ");
  return `${language}|${t}|${a}`;
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
