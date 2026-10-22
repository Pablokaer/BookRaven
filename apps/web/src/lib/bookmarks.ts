import { keptForAccount } from "./accountData";
import { apiFetch, apiJson, type Bookmark } from "./api";
import { createOutbox, localStorageStore, type Queued } from "./outbox";
import { readJson, writeJson } from "./storage";

/**
 * Bookmarked pages ("save this page", like a Kindle bookmark).
 *  - A page is identified by its locator, so the latest change to a page wins and replaying
 *    a change is harmless.
 *  - Changes wait in an outbox (lib/outbox) so bookmarking works offline, and are sent in order
 *    when possible. The last list seen for each book is kept for offline reading.
 *  - Which page a bookmark is on lives in lib/bookmarkPages.ts (it loads with the reader only).
 */

type Change =
  | { op: "put"; bookId: string; locator: string; percentage: number; label: string | null; title?: string | null; at: number }
  | { op: "delete"; bookId: string; locator: string; at: number };

const cacheKey = (bookId: string) => `readsync.bookmarks.${bookId}`;

const outbox = createOutbox<Change>({
  // The first version kept one change per page in an object; it is brought over once.
  store: localStorageStore<Change>("readsync.bookmarkQueue", {
    key: "readsync.bookmarkOutbox",
    convert: (old) => Object.values(old as Record<string, Change>).sort((a, b) => a.at - b.at),
  }),
  key: (c) => `${c.bookId} ${c.locator}`,
  // Renaming keeps a waiting bookmark's other details, and a later save without a name keeps the name.
  combine: (older, newer) => (older.op === "put" && newer.op === "put" && newer.title === undefined ? { ...newer, title: older.title } : newer),
  send: ([c]) => {
    const url = `/api/books/${c!.bookId}/bookmarks`;
    return c!.op === "put"
      ? apiFetch(url, {
          method: "PUT",
          body: JSON.stringify({ locator: c!.locator, percentage: c!.percentage, label: c!.label, ...(c!.title !== undefined ? { title: c!.title } : {}) }),
        })
      : apiFetch(`${url}?locator=${encodeURIComponent(c!.locator)}`, { method: "DELETE" });
  },
  // Refused for good (e.g. too many bookmarks): the reader shows the server's list again.
  onRejected: (items, status) => {
    for (const bookId of new Set(items.map((c) => c.bookId))) {
      window.dispatchEvent(new CustomEvent("readsync:bookmarks-rejected", { detail: { bookId, status } }));
    }
  },
});

/** Page order, then creation order. */
export function sortBookmarks(list: Bookmark[]) {
  return [...list].sort((a, b) => a.percentage - b.percentage || a.createdAt.localeCompare(b.createdAt));
}

/** `list` with this device's not-yet-sent changes applied on top. */
export function withPending(bookId: string, list: Bookmark[], pending: Queued<Change>[] = outbox.pending()) {
  const byLocator = new Map(list.map((b) => [b.locator, b]));
  for (const c of pending) {
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
    writeJson(cacheKey(bookId), list);
  } catch {
    list = readJson<Bookmark[]>(cacheKey(bookId), []);
  }
  await outbox.ready;
  return withPending(bookId, list);
}

/**
 * Keeps the offline copy in step with what the reader shows (server events, local changes).
 * Call it only once the book's list is loaded: before that, the reader's list is just empty.
 */
export function rememberBookmarks(bookId: string, list: Bookmark[]) {
  writeJson(
    cacheKey(bookId),
    list.filter((b) => !b.id.startsWith("local:")),
  );
}

/** Bookmarks a page, or renames its bookmark (`title`: null clears it, undefined keeps it). */
export function putBookmark(bookId: string, b: { locator: string; percentage: number; label: string | null; title?: string | null }) {
  outbox.push({ op: "put", bookId, ...b, percentage: Math.min(1, Math.max(0, b.percentage || 0)), at: Date.now() });
}

export function deleteBookmark(bookId: string, locator: string) {
  outbox.push({ op: "delete", bookId, locator, at: Date.now() });
}

export const flushBookmarks = () => outbox.flush();

/** Forgets unsent changes and the offline copies (sign-out). */
export async function clearBookmarks() {
  await outbox.clear();
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(cacheKey(""))) localStorage.removeItem(k);
  } catch {
    /* unavailable: nothing stored */
  }
}

keptForAccount({ flush: flushBookmarks, forget: clearBookmarks });
