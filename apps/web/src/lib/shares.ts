import { API_BASE, apiFetch, apiJson, ApiError, isNative, type Book } from "./api";

export type SharedBook = {
  title: string;
  author: string | null;
  format: Book["format"];
  sizeBytes: number;
  hasCover: boolean;
  sharedBy: string | null;
  /** Set when the caller already has this file in their library. */
  ownBookId: string | null;
};

export async function getShareToken(bookId: string) {
  return (await apiJson<{ token: string | null }>(`/api/books/${bookId}/share`)).token;
}

export async function createShareToken(bookId: string) {
  return (await apiJson<{ token: string }>(`/api/books/${bookId}/share`, { method: "POST" })).token;
}

export async function revokeShare(bookId: string) {
  const res = await apiFetch(`/api/books/${bookId}/share`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new ApiError(res.status, null);
}

/** Public link to the share page. In the native app the web app lives at the API's origin. */
export function shareUrl(token: string) {
  return `${isNative ? API_BASE : window.location.origin}/share/${token}`;
}

export function getSharedBook(token: string) {
  return apiJson<SharedBook>(`/api/shares/${token}`);
}

export function acceptShare(token: string) {
  return apiJson<Book>(`/api/shares/${token}/accept`, { method: "POST" });
}
