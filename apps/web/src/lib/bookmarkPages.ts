import { collapse, compare } from "foliate-js/epubcfi.js";
import { comicIndexFromLocator } from "./comics";

/** Which page a bookmark belongs to, per format (lib/bookmarks.ts holds and syncs the bookmarks). */

export type BookKind = "pdf" | "comic" | "text";

const isCfi = (s: string) => s.startsWith("epubcfi(");

/** What a bookmark of the page at `current` (the reader's position) is stored as. */
export function bookmarkLocator(current: string, kind: BookKind) {
  // Ebooks report the visible page as a CFI range; the bookmark keeps where the page starts.
  if (kind === "text" && isCfi(current)) {
    try {
      return collapse(current);
    } catch {
      return current;
    }
  }
  return current;
}

/** Whether a bookmark falls on the page the reader shows at `current`. */
export function isOnPage(bookmark: string, current: string, kind: BookKind) {
  if (bookmark === current) return true;
  if (kind === "pdf") {
    const page = (l: string) => /^(?:page|pdf):(\d+)/.exec(l)?.[1];
    return page(bookmark) !== undefined && page(bookmark) === page(current);
  }
  if (kind === "comic") return isCfi(bookmark) && isCfi(current) && comicIndexFromLocator(bookmark) === comicIndexFromLocator(current);
  if (!isCfi(bookmark) || !isCfi(current)) return false;
  // Ebook pages move with the font size: a bookmark is on the page when it lies inside it.
  try {
    const start = collapse(current);
    const end = collapse(current, true);
    return compare(bookmark, start) === 0 || (compare(bookmark, start) > 0 && compare(bookmark, end) < 0);
  } catch {
    return false;
  }
}
