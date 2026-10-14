import type { Book, PublicBook } from "./api";
import { FINISHED_AT } from "./bookStats";

/**
 * Public-library suggestions from the reader's own library, worked out in the app (no data
 * leaves it). A book the reader has, read or liked points to public books with the same
 * author or from the same sections, in the languages they read; popular books first among
 * equals. Books already in the library are never suggested.
 */

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** "Machado de Assis, José de Alencar" → each author on their own. */
const authorsOf = (author: string | null) => (author ? author.split(/\s*(?:,|;|&| and )\s*/).map(norm).filter(Boolean) : []);

/** How much a book of the library says about the reader's taste. */
function weight(b: Book) {
  const p = b.progress?.percentage ?? 0;
  let w = p >= FINISHED_AT ? 3 : p > 0.05 ? 2 : b.progress ? 1 : 0.5;
  if (b.favorite) w += 2;
  return w;
}

type Seed = { book: Book; weight: number; authors: string[]; themes: string[]; language: string | null; lastRead: number };

export type Recommendations = {
  /** Best matches overall, best first. */
  forYou: PublicBook[];
  /** "Because you read …" rows for the books that point to the most. */
  because: { seed: Book; books: PublicBook[] }[];
};

const DEFAULTS = { forYou: 18, rows: 2, rowSize: 18, minRow: 3 };

export function recommend(library: Book[], publicBooks: PublicBook[], options: Partial<typeof DEFAULTS> = {}): Recommendations {
  const opts = { ...DEFAULTS, ...options };
  // A library book's sections come from its public-library entry (same file), when it has one.
  const themesByOwnId = new Map<string, string[]>();
  for (const p of publicBooks) if (p.ownBookId) themesByOwnId.set(p.ownBookId, p.themes);

  const seeds: Seed[] = library.map((b) => ({
    book: b,
    weight: weight(b),
    authors: authorsOf(b.author),
    themes: themesByOwnId.get(b.id) ?? [],
    language: b.language,
    lastRead: new Date(b.progress?.updatedAt ?? b.createdAt).getTime(),
  }));
  const languages = new Set(seeds.map((s) => s.language).filter(Boolean));
  const candidates = publicBooks.filter((p) => !p.ownBookId && !p.isMine);

  /** How strongly `seed` points to `p`: the same author counts more than a shared section. */
  const affinity = (seed: Seed, p: PublicBook) => {
    const sameAuthor = authorsOf(p.author).some((a) => seed.authors.includes(a));
    const shared = p.themes.filter((t) => seed.themes.includes(t)).length;
    return (sameAuthor ? 3 : 0) + shared;
  };
  // Other languages only when the library gives no clue about the reader's.
  const inMyLanguage = (p: PublicBook) => !languages.size || !p.language || languages.has(p.language);
  const byPopularity = (a: PublicBook, b: PublicBook) => (b.popularity ?? -1) - (a.popularity ?? -1);

  const scored = candidates
    .filter(inMyLanguage)
    .map((p) => ({ p, score: seeds.reduce((n, s) => n + s.weight * affinity(s, p), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || byPopularity(a.p, b.p));
  const forYou = scored.slice(0, opts.forYou).map((x) => x.p);

  // "Because you read": the most telling books (read or liked, most recent first), each with
  // what it alone points to and that the "for you" row doesn't already show.
  const shown = new Set(forYou.map((p) => p.id));
  const because: Recommendations["because"] = [];
  for (const seed of seeds.filter((s) => s.weight >= 2).sort((a, b) => b.weight - a.weight || b.lastRead - a.lastRead)) {
    if (because.length >= opts.rows) break;
    const books = candidates
      .filter((p) => inMyLanguage(p) && !shown.has(p.id) && affinity(seed, p) > 0)
      .sort((a, b) => affinity(seed, b) - affinity(seed, a) || byPopularity(a, b))
      .slice(0, opts.rowSize);
    if (books.length < opts.minRow) continue;
    books.forEach((p) => shown.add(p.id));
    because.push({ seed: seed.book, books });
  }
  return { forYou, because };
}
