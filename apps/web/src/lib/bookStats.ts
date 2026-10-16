import type { Book, Folder, PublicBook } from "./api";
import { percent } from "./format";

/** Progress at or past this point counts as finished (last pages are often notes/indexes). */
export const FINISHED_AT = 0.98;

export const isFinished = (b: Book) => (b.progress?.percentage ?? 0) >= FINISHED_AT;
export const isInProgress = (b: Book) => !!b.progress && !isFinished(b);

/** Short status line for a book card: "Not started", "Just started", "42% read", "Finished". */
export function readingStatus(book: Book) {
  if (!book.progress) return "Not started";
  if (isFinished(book)) return "Finished";
  if (book.progress.percentage < 0.01) return "Just started";
  return `${percent(book.progress.percentage)} read`;
}

/**
 * Books finished this calendar year. There is no "finished at" timestamp, so the
 * time the final position was saved stands in for it.
 */
export function finishedThisYear(books: Book[]) {
  const year = new Date().getFullYear();
  return books.filter((b) => isFinished(b) && new Date(b.progress!.updatedAt).getFullYear() === year).length;
}

/** Most recently read first. */
export function byLastRead(a: Book, b: Book) {
  return new Date(b.progress?.updatedAt ?? 0).getTime() - new Date(a.progress?.updatedAt ?? 0).getTime();
}

export function byAdded(a: Book, b: Book) {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

const COLLECTION_COLORS = ["#16c9b2", "#f59e0b", "#a78bfa", "#f472b6", "#60a5fa", "#4ade80", "#fb7185", "#facc15"];

/** Stable color per collection, derived from its id. */
export function collectionColor(folder: Pick<Folder, "id">) {
  let h = 0;
  for (const ch of folder.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLLECTION_COLORS[h % COLLECTION_COLORS.length]!;
}

export function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Text order ignoring case and accents, numbers by value ("2" before "10"); missing values last. */
export const byText = (a: string | null, b: string | null) => (a ?? "\uffff").localeCompare(b ?? "\uffff", undefined, { sensitivity: "base", numeric: true });

/** Most downloaded at the source first; books people published (no count) after them. */
export const byPopularity = (a: PublicBook, b: PublicBook) => (b.popularity ?? -1) - (a.popularity ?? -1);
