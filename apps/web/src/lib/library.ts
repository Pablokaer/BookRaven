import { apiFetch, apiJson, ApiError, type Book, type Folder } from "./api";

export function listFolders() {
  return apiJson<Folder[]>("/api/folders");
}

export function createFolder(name: string) {
  return apiJson<Folder>("/api/folders", { method: "POST", body: JSON.stringify({ name }) });
}

export function renameFolder(id: string, name: string) {
  return apiJson<Folder>(`/api/folders/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

/** Deletes the folder; its books are kept and move back to "no folder". */
export async function deleteFolder(id: string) {
  const res = await apiFetch(`/api/folders/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new ApiError(res.status, null);
}

export function updateBook(id: string, patch: { folderId?: string | null; tags?: string[]; favorite?: boolean; isPublic?: boolean }) {
  return apiJson<Book>(`/api/books/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

/**
 * Saves a file from an authenticated URL to the device (the browser's download).
 * The whole file is fetched first, since a plain link cannot carry the bearer token.
 */
export async function saveFile(path: string, filename: string) {
  const res = await apiFetch(path);
  if (!res.ok) throw new ApiError(res.status, null);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function downloadOwnBook(book: Book) {
  return saveFile(`/api/books/${book.id}/file?download=1`, book.filename);
}
