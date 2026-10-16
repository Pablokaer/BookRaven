import { apiDelete, apiJson, type Book, type Me, type PublicBook, type PublicBookDetails } from "./api";
import { saveFile } from "./library";

export function getMe() {
  return apiJson<Me>("/api/me");
}

export function getPublicBook(id: string) {
  return apiJson<PublicBookDetails>(`/api/public/${id}`);
}

export function listPublicBooks() {
  return apiJson<PublicBook[]>("/api/public");
}

/** Adds a copy to the caller's library; fails with 413 "quota_exceeded" when full. */
export function addPublicBook(id: string) {
  return apiJson<Book>(`/api/public/${id}/add`, { method: "POST" });
}

export function downloadPublicBook(book: PublicBook) {
  return saveFile(`/api/public/${book.id}/file`, book.filename);
}

/** Takes a book out of the public library (publisher or administrator). */
export const removePublicBook = (id: string) => apiDelete(`/api/public/${id}`);
