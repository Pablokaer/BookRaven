import { apiDelete, apiFetch, apiJson, ApiError, isNative, type Book, type Folder } from "./api";
import { forgetPublicBooks } from "./publicLibrary";

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
export const deleteFolder = (id: string) => apiDelete(`/api/folders/${id}`);

export function updateBook(id: string, patch: { folderId?: string | null; tags?: string[]; favorite?: boolean; isPublic?: boolean }) {
  const res = apiJson<Book>(`/api/books/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  // Publishing or unpublishing changes the public catalog (tags change its sections).
  return patch.isPublic !== undefined || patch.tags ? res.finally(forgetPublicBooks) : res;
}

/** Android app: WebViews ignore download links, so write the file to Documents/BookRaven. */
async function saveFileNative(blob: Blob, filename: string) {
  const { Directory, Filesystem } = await import("@capacitor/filesystem");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const path = `BookRaven/${filename.replace(/[\\/:*?"<>|]+/g, " ").trim() || "book"}`;
  await Filesystem.writeFile({ path, data, directory: Directory.Documents, recursive: true });
  window.alert(`Saved to Documents/${path}`);
}

/** Saves a file to the device: the browser's download, or Documents/BookRaven in the Android app. */
export async function saveBlob(blob: Blob, filename: string) {
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

/** Saves a file from an authenticated URL: fetched whole first, since a plain link cannot carry the bearer token. */
export async function saveFile(path: string, filename: string) {
  const res = await apiFetch(path);
  if (!res.ok) throw new ApiError(res.status, null);
  await saveBlob(await res.blob(), filename);
}

export function downloadOwnBook(book: Book) {
  return saveFile(`/api/books/${book.id}/file?download=1`, book.filename);
}
