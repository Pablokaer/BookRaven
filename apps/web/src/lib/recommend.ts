import type { Book, PublicBook } from "./api";
import { byPopularity, FINISHED_AT } from "./bookStats";
import { foldWords } from "./search";

/**
 * Public-library suggestions from the reader's own library, worked out in the app (no data
 * leaves it). A book the reader has, read or liked points to public books with the same
 * author or from the same sections, in the languages they read; popular books first among
 * equals. Books already in the library are never suggested.
 */

/** "Machado de Assis, José de Alencar" → each author on their own. */
const authorsOf = (author: string | null) => (author ? author.split(/\s*(?:,|;|&| and )\s*/).map(foldWords).filter(Boolean) : []);

/** How much a book of the library says about the reader's taste. */
function weight(b: Book) {
  const p = b.progress?.percentage ?? 0;
  let w = p >= FINISHED_AT ? 3 : p > 0.05 ? 2 : b.progress ? 1 : 0.5;
  if (b.favorite) w += 2;
  return w;
}

type Seed = { book: Book; weight: number; authors: Set<string>; themes: Set<string>; language: string | null; lastRead: number };
/** A public book with its authors worked out once. */
type Candidate = { p: PublicBook; authors: string[] };

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
    authors: new Set(authorsOf(b.author)),
    themes: new Set(themesByOwnId.get(b.id) ?? []),
    language: b.language,
    lastRead: new Date(b.progress?.updatedAt ?? b.createdAt).getTime(),
  }));
  const languages = new Set(seeds.map((s) => s.language).filter(Boolean));
  // Other languages only when the library gives no clue about the reader's.
  const inMyLanguage = (p: PublicBook) => !languages.size || !p.language || languages.has(p.language);
  const candidates: Candidate[] = publicBooks
    .filter((p) => !p.ownBookId && !p.isMine && inMyLanguage(p))
    .map((p) => ({ p, authors: authorsOf(p.author) }));

  /** How strongly `seed` points to `c`: the same author counts more than a shared section. */
  const affinity = (seed: Seed, c: Candidate) => {
    const sameAuthor = c.authors.some((a) => seed.authors.has(a));
    let shared = 0;
    for (const t of c.p.themes) if (seed.themes.has(t)) shared++;
    return (sameAuthor ? 3 : 0) + shared;
  };

  const scored = candidates
    .map((c) => ({ p: c.p, score: seeds.reduce((n, s) => n + s.weight * affinity(s, c), 0) }))
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
      .filter((c) => !shown.has(c.p.id))
      .map((c) => ({ p: c.p, affinity: affinity(seed, c) }))
      .filter((x) => x.affinity > 0)
      .sort((a, b) => b.affinity - a.affinity || byPopularity(a.p, b.p))
      .slice(0, opts.rowSize)
      .map((x) => x.p);
    if (books.length < opts.minRow) continue;
    books.forEach((p) => shown.add(p.id));
    because.push({ seed: seed.book, books });
  }
  return { forYou, because };
}
