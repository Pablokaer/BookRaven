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
  return pageMatcher(current, kind)(bookmark);
}

/** isOnPage for many bookmarks: the page at `current` is worked out once, not for each bookmark. */
export function pageMatcher(current: string, kind: BookKind): (bookmark: string) => boolean {
  if (kind === "pdf") {
    const page = (l: string) => /^(?:page|pdf):(\d+)/.exec(l)?.[1];
    const here = page(current);
    return (b) => b === current || (here !== undefined && page(b) === here);
  }
  if (kind === "comic") {
    const here = isCfi(current) ? comicIndexFromLocator(current) : null;
    return (b) => b === current || (here !== null && isCfi(b) && comicIndexFromLocator(b) === here);
  }
  if (!isCfi(current)) return (b) => b === current;
  // Ebook pages move with the font size: a bookmark is on the page when it lies inside it.
  let start: string;
  let end: string;
  try {
    start = collapse(current);
    end = collapse(current, true);
  } catch {
    return (b) => b === current;
  }
  return (b) => {
    if (b === current) return true;
    if (!isCfi(b)) return false;
    try {
      return compare(b, start) === 0 || (compare(b, start) > 0 && compare(b, end) < 0);
    } catch {
      return false;
    }
  };
}
