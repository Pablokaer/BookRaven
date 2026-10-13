import { apiFetch, apiJson, ApiError, type Book, type Me, type PublicBook } from "./api";
import { saveFile } from "./library";

export function getMe() {
  return apiJson<Me>("/api/me");
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
export async function removePublicBook(id: string) {
  const res = await apiFetch(`/api/public/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new ApiError(res.status, null);
}
