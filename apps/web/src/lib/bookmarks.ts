import { collapse, compare } from "foliate-js/epubcfi.js";
import { apiFetch, apiJson, type Bookmark } from "./api";
import { comicIndexFromLocator } from "./comics";

/**
 * Bookmarked pages ("save this page", like a Kindle bookmark).
 *  - A page is identified by its locator, so the latest change to a page wins and replaying
 *    a change is harmless.
 *  - Changes go to an outbox in localStorage first, so bookmarking works offline; the outbox
 *    is sent when back online. The last list seen for each book is kept for offline reading.
 */

export type BookKind = "pdf" | "comic" | "text";

type Change =
  | { op: "put"; bookId: string; locator: string; percentage: number; label: string | null; title?: string | null; at: number }
  | { op: "delete"; bookId: string; locator: string; at: number };

const OUTBOX_KEY = "readsync.bookmarkOutbox";
const cacheKey = (bookId: string) => `readsync.bookmarks.${bookId}`;
const changeKey = (c: { bookId: string; locator: string }) => `${c.bookId} ${c.locator}`;

function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the server still has the bookmarks */
  }
}

const readOutbox = () => read<Record<string, Change>>(OUTBOX_KEY, {});

/** Page order, then creation order. */
export function sortBookmarks(list: Bookmark[]) {
  return [...list].sort((a, b) => a.percentage - b.percentage || a.createdAt.localeCompare(b.createdAt));
}

/** `list` with this device's not-yet-sent changes applied on top. */
export function withPending(bookId: string, list: Bookmark[], outbox: Record<string, Change> = readOutbox()) {
  const byLocator = new Map(list.map((b) => [b.locator, b]));
  for (const c of Object.values(outbox).sort((a, b) => a.at - b.at)) {
    if (c.bookId !== bookId) continue;
    if (c.op === "delete") {
      byLocator.delete(c.locator);
      continue;
    }
    const prev = byLocator.get(c.locator);
    byLocator.set(c.locator, {
      id: prev?.id ?? `local:${c.locator}`,
      bookId,
      locator: c.locator,
      percentage: c.percentage,
      label: c.label ?? prev?.label ?? null,
      title: c.title !== undefined ? c.title : (prev?.title ?? null),
      createdAt: prev?.createdAt ?? new Date(c.at).toISOString(),
    });
  }
  return sortBookmarks([...byLocator.values()]);
}

/** The book's bookmarks: from the server when reachable, else the last copy seen; plus pending changes. */
export async function loadBookmarks(bookId: string) {
  let list: Bookmark[];
  try {
    list = await apiJson<Bookmark[]>(`/api/books/${bookId}/bookmarks`);
    write(cacheKey(bookId), list);
  } catch {
    list = read<Bookmark[]>(cacheKey(bookId), []);
  }
  return withPending(bookId, list);
}

/** Keeps the offline copy in step with what the reader shows (server events, local changes). */
export function rememberBookmarks(bookId: string, list: Bookmark[]) {
  write(
    cacheKey(bookId),
    list.filter((b) => !b.id.startsWith("local:")),
  );
}

function queue(change: Change) {
  const outbox = readOutbox();
  outbox[changeKey(change)] = change;
  write(OUTBOX_KEY, outbox);
  if (flushing) queuedWhileFlushing = true;
  void flushBookmarks();
}

/** Bookmarks a page, or renames its bookmark (`title`: null clears it, undefined keeps it). */
export function putBookmark(bookId: string, b: { locator: string; percentage: number; label: string | null; title?: string | null }) {
  queue({ op: "put", bookId, ...b, percentage: Math.min(1, Math.max(0, b.percentage || 0)), at: Date.now() });
}

export function deleteBookmark(bookId: string, locator: string) {
  queue({ op: "delete", bookId, locator, at: Date.now() });
}

let flushing: Promise<void> | null = null;
/** A change made while sending: send again afterwards, it may have missed this round. */
let queuedWhileFlushing = false;

async function sendOutbox() {
  for (const c of Object.values(readOutbox()).sort((a, b) => a.at - b.at)) {
    const url = `/api/books/${c.bookId}/bookmarks`;
    let res: Response;
    try {
      res =
        c.op === "put"
          ? await apiFetch(url, {
              method: "PUT",
              body: JSON.stringify({ locator: c.locator, percentage: c.percentage, label: c.label, ...(c.title !== undefined ? { title: c.title } : {}) }),
            })
          : await apiFetch(`${url}?locator=${encodeURIComponent(c.locator)}`, { method: "DELETE" });
    } catch {
      return; // offline
    }
    // Server errors are retried later; anything else (done, book gone, invalid) leaves the outbox.
    if (res.status >= 500 || res.status === 401) return;
    const outbox = readOutbox();
    if (outbox[changeKey(c)]?.at === c.at) {
      delete outbox[changeKey(c)];
      write(OUTBOX_KEY, outbox);
    }
  }
}

/** Sends the outbox in order; stops at the first network failure and tries again later. */
export function flushBookmarks(): Promise<void> {
  // .finally runs after `flushing` is set, even when there is nothing to send.
  flushing ??= sendOutbox().finally(() => {
    flushing = null;
    if (queuedWhileFlushing) {
      queuedWhileFlushing = false;
      void flushBookmarks();
    }
  });
  return flushing;
}

let installed = false;
export function installBookmarkFlushers() {
  if (installed) return;
  installed = true;
  window.addEventListener("online", () => void flushBookmarks());
  void flushBookmarks();
}

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
