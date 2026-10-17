import type { Book, Folder, Me } from "./api";
import { readJson, removeKey, writeJson } from "./storage";

/**
 * Last-known library snapshot kept in localStorage so a cold start (the Android app
 * especially) can paint real numbers on the first frame instead of empty placeholders.
 * It is only a first guess: the provider's network `refresh` overwrites it a moment later.
 *
 * Everything is keyed by user id so one account never sees another's cached data.
 */

const BOOKS_KEY = "readsync.books";
const ME_KEY = "readsync.me";
const FOLDERS_KEY = "readsync.folders";

/** Namespaces a key by user so signing in as someone else starts from a clean slate. */
const key = (base: string, userId: string) => `${base}.${userId}`;

export function loadCachedBooks(userId: string): Book[] | null {
  const books = readJson<unknown>(key(BOOKS_KEY, userId), null);
  return Array.isArray(books) ? (books as Book[]) : null;
}

export const saveCachedBooks = (userId: string, books: Book[]) => writeJson(key(BOOKS_KEY, userId), books);
export const loadCachedMe = (userId: string) => readJson<Me | null>(key(ME_KEY, userId), null);
export const saveCachedMe = (userId: string, me: Me) => writeJson(key(ME_KEY, userId), me);

/** The collections, so they show offline (and on the first frame) too. */
export function loadCachedFolders(userId: string): Folder[] | null {
  const folders = readJson<unknown>(key(FOLDERS_KEY, userId), null);
  return Array.isArray(folders) ? (folders as Folder[]) : null;
}

export const saveCachedFolders = (userId: string, folders: Folder[]) => writeJson(key(FOLDERS_KEY, userId), folders);

/** Forgets every account's collections (signing out). */
export function forgetCachedFolders() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(`${FOLDERS_KEY}.`)) removeKey(k);
    }
  } catch {
    /* unavailable: nothing stored */
  }
}
