import type { Book, Me } from "./api";
import { readJson, writeJson } from "./storage";

/**
 * Last-known library snapshot kept in localStorage so a cold start (the Android app
 * especially) can paint real numbers on the first frame instead of empty placeholders.
 * It is only a first guess: the provider's network `refresh` overwrites it a moment later.
 *
 * Everything is keyed by user id so one account never sees another's cached data.
 */

const BOOKS_KEY = "readsync.books";
const ME_KEY = "readsync.me";

/** Namespaces a key by user so signing in as someone else starts from a clean slate. */
const key = (base: string, userId: string) => `${base}.${userId}`;

export function loadCachedBooks(userId: string): Book[] | null {
  const books = readJson<unknown>(key(BOOKS_KEY, userId), null);
  return Array.isArray(books) ? (books as Book[]) : null;
}

export const saveCachedBooks = (userId: string, books: Book[]) => writeJson(key(BOOKS_KEY, userId), books);
export const loadCachedMe = (userId: string) => readJson<Me | null>(key(ME_KEY, userId), null);
export const saveCachedMe = (userId: string, me: Me) => writeJson(key(ME_KEY, userId), me);
