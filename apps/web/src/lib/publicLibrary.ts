import { apiDelete, apiJson, type Book, type Me, type PublicBook, type PublicBookDetails } from "./api";
import { saveFile } from "./library";

export function getMe() {
  return apiJson<Me>("/api/me");
}

export function getPublicBook(id: string) {
  return apiJson<PublicBookDetails>(`/api/public/${id}`);
}

/**
 * The catalog (up to 1000 books) is shared by the pages that show it (public library, search,
 * book pages, imports) instead of downloaded on each visit. The library forgets it whenever it
 * may have changed: a `public.changed` event (when it bumps `publicVersion`, so the pages on
 * screen reload), a book added to or removed from the viewer's library (`ownBookId`), and this
 * app's own publish, unpublish, add and remove. The age limit covers changes no event reports.
 */
let catalog: { at: number; books: Promise<PublicBook[]> } | null = null;
const CATALOG_MAX_AGE = 5 * 60_000;

export function listPublicBooks() {
  if (!catalog || Date.now() - catalog.at > CATALOG_MAX_AGE) {
    const books = apiJson<PublicBook[]>("/api/public");
    const entry = { at: Date.now(), books };
    catalog = entry;
    // A failed download is not kept: the next page asks again.
    books.catch(() => {
      if (catalog === entry) catalog = null;
    });
  }
  return catalog.books;
}

/** The next `listPublicBooks()` downloads the catalog again. */
export function forgetPublicBooks() {
  catalog = null;
}

/** Adds a copy to the caller's library; fails with 413 "quota_exceeded" when full. */
export function addPublicBook(id: string) {
  return apiJson<Book>(`/api/public/${id}/add`, { method: "POST" }).finally(forgetPublicBooks);
}

export function downloadPublicBook(book: PublicBook) {
  return saveFile(`/api/public/${book.id}/file`, book.filename);
}

/** Takes a book out of the public library (publisher or administrator). */
export const removePublicBook = (id: string) => apiDelete(`/api/public/${id}`).finally(forgetPublicBooks);
