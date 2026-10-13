import { apiFetch, apiJson, ApiError, isNative, type Book, type Folder } from "./api";

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

/** Android app: WebViews ignore download links, so write the file to Documents/Mico-livrão. */
async function saveFileNative(blob: Blob, filename: string) {
  const { Directory, Filesystem } = await import("@capacitor/filesystem");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const path = `Mico-livrão/${filename.replace(/[\\/:*?"<>|]+/g, " ").trim() || "book"}`;
  await Filesystem.writeFile({ path, data, directory: Directory.Documents, recursive: true });
  window.alert(`Saved to Documents/${path}`);
}

/**
 * Saves a file from an authenticated URL to the device (the browser's download).
 * The whole file is fetched first, since a plain link cannot carry the bearer token.
 */
export async function saveFile(path: string, filename: string) {
  const res = await apiFetch(path);
  if (!res.ok) throw new ApiError(res.status, null);
  const blob = await res.blob();
  if (isNative) return saveFileNative(blob, filename);
  const url = URL.createObjectURL(blob);
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
