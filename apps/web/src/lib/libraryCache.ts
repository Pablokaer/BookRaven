import type { Book, Me } from "./api";

/**
 * Last-known library snapshot kept in localStorage so a cold start (the Android app
 * especially) can paint real numbers on the first frame instead of empty placeholders.
 * It is only a first guess: the provider's network `refresh` overwrites it a moment later.
 *
 * Everything is keyed by user id so one account never sees another's cached data, and every
 * access is wrapped in try/catch — localStorage can be absent, full or blocked (private mode).
 */

const BOOKS_KEY = "readsync.books";
const ME_KEY = "readsync.me";

/** Namespaces a key by user so signing in as someone else starts from a clean slate. */
const key = (base: string, userId: string) => `${base}.${userId}`;

export function loadCachedBooks(userId: string): Book[] | null {
  try {
    const raw = localStorage.getItem(key(BOOKS_KEY, userId));
    if (!raw) return null;
    const books = JSON.parse(raw);
    return Array.isArray(books) ? (books as Book[]) : null;
  } catch {
    return null;
  }
}

export function saveCachedBooks(userId: string, books: Book[]): void {
  try {
    localStorage.setItem(key(BOOKS_KEY, userId), JSON.stringify(books));
  } catch {
    /* quota or unavailable: the cache is optional */
  }
}

export function loadCachedMe(userId: string): Me | null {
  try {
    const raw = localStorage.getItem(key(ME_KEY, userId));
    return raw ? (JSON.parse(raw) as Me) : null;
  } catch {
    return null;
  }
}

export function saveCachedMe(userId: string, me: Me): void {
  try {
    localStorage.setItem(key(ME_KEY, userId), JSON.stringify(me));
  } catch {
    /* ignore */
  }
}
