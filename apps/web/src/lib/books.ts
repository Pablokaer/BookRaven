import { apiFetch, apiJson, ApiError, apiUrl, authHeaders, type Book, type BookAbout } from "./api";
import { comicFormatOfName, type ComicFormat } from "./comicFormats";
import { blobRangeFile, forgetSaved, openRemoteFile, savedWholeFile, saveWholeFile, type RangeFile } from "./rangeFile";

export const SUPPORTED_EXTENSIONS = [".pdf", ".epub", ".mobi", ".azw3", ".azw", ".fb2", ".cbz", ".cbr", ".cb7", ".cbt"];

export function listBooks() {
  return apiJson<Book[]>("/api/books");
}

export function getBookAbout(id: string) {
  return apiJson<BookAbout>(`/api/books/${id}/about`);
}

export function getBook(id: string) {
  return apiJson<Book>(`/api/books/${id}`);
}

export async function deleteBook(id: string) {
  const res = await apiFetch(`/api/books/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new ApiError(res.status, null);
}

export function bookFileUrl(id: string) {
  return apiUrl(`/api/books/${id}/file`);
}

/** Cache Storage key of a book's file saved on this device (`.cbz`: the CBZ copy of a RAR/7z/TAR comic). */
const savedKey = (id: string, cbz = false) => `/books/${id}${cbz ? ".cbz" : ""}`;

/** RAR, 7z and TAR comics are read from the server's CBZ copy of them (see openComicFile). */
export const readsAsCbz = (format: string) => format === "cbr" || format === "cb7" || format === "cbt";

/**
 * Downloads a whole book file and keeps it in Cache Storage so reopening it (or reading
 * offline) does not download it again. Files never change for a given book id, so the cache
 * never needs invalidation, only deletion. Readers use openBookFile instead, which downloads
 * only the parts being read; this is for "Save for offline reading" and FB2 (one XML file).
 */
export async function downloadBook(book: Book, opts: { cbz?: boolean } = {}): Promise<File> {
  const key = savedKey(book.id, opts.cbz);
  let blob = await savedWholeFile(key).catch(() => null);
  if (!blob) {
    const res = await apiFetch(`/api/books/${book.id}/file${opts.cbz ? "?as=cbz" : ""}`);
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
    blob = await res.blob();
    // Saving it can take a while for big files: the book opens meanwhile.
    void saveWholeFile(key, blob).catch(() => {});
  }
  return new File([blob], book.filename, { type: blob.type });
}

/** Keeps the whole book on this device. Comics in RAR/7z/TAR keep the CBZ copy the reader uses. */
export async function saveForOffline(book: Book) {
  if (readsAsCbz(book.format)) {
    const ok = await downloadBook(book, { cbz: true }).then(
      () => true,
      (err) => (err instanceof ApiError && err.status === 422 ? false : Promise.reject(err)),
    );
    if (ok) return;
  }
  const key = savedKey(book.id);
  if (await savedWholeFile(key).catch(() => null)) return;
  const res = await apiFetch(`/api/books/${book.id}/file`);
  if (!res.ok) throw new ApiError(res.status, null);
  await saveWholeFile(key, await res.blob());
}

/**
 * A book's file for range reads: the copy saved on this device if there is a whole one,
 * otherwise the server's, downloaded piece by piece as the reader asks for them.
 * `cbz` opens the CBZ copy of a RAR/7z/TAR comic.
 */
export async function openBookFile(book: Book, opts: { cbz?: boolean } = {}): Promise<RangeFile> {
  const key = savedKey(book.id, opts.cbz);
  const saved = await savedWholeFile(key).catch(() => null);
  if (saved) return blobRangeFile(saved);
  return openRemoteFile(`/api/books/${book.id}/file${opts.cbz ? "?as=cbz" : ""}`, key);
}

/** The book's whole file (or CBZ copy) if it was saved on this device (kept for offline, or read to the end). */
export function cachedBookFile(id: string, opts: { cbz?: boolean } = {}): Promise<Blob | null> {
  return savedWholeFile(savedKey(id, opts.cbz)).catch(() => null);
}

/** Forgets everything saved on this device for a book (its file, CBZ copy and downloaded pieces). */
export async function forgetCachedBook(id: string) {
  await forgetSaved(savedKey(id));
}

// ---------- Metadata extraction (client-side, before upload) ----------

export type Meta = { title?: string; author?: string; description?: string; cover?: Blob };

/** EPUB descriptions are often HTML: keep the text, one blank line between paragraphs. */
function plainText(html: string | undefined) {
  if (!html) return undefined;
  const doc = new DOMParser().parseFromString(html.replace(/<\/(p|div|br)\s*>|<br\s*\/?>/gi, "\n\n$&"), "text/html");
  const text = (doc.body.textContent ?? "").replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*/g, "\n\n").trim();
  return text || undefined;
}

function langString(v: unknown): string | undefined {
  if (!v) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const values = Object.values(v as Record<string, string>);
    return values.find((x) => typeof x === "string");
  }
  return undefined;
}

function authorString(v: unknown): string | undefined {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  const names = list
    .map((a) => (typeof a === "string" ? a : langString((a as any)?.name)))
    .filter(Boolean) as string[];
  return names.length ? names.join(", ") : undefined;
}

async function pdfMeta(file: File): Promise<Meta> {
  const { pdfjs } = await import("./pdf");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const { info } = (await doc.getMetadata()) as { info: Record<string, any> };
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 400 / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const cover = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.8));
    return {
      title: typeof info?.Title === "string" ? info.Title : undefined,
      author: typeof info?.Author === "string" ? info.Author : undefined,
      description: typeof info?.Subject === "string" && info.Subject.trim().length > 20 ? info.Subject.trim() : undefined,
      cover: cover ?? undefined,
    };
  } finally {
    await doc.loadingTask.destroy();
  }
}

async function ebookMeta(file: File): Promise<Meta> {
  const { makeBook } = await import("foliate-js/view.js");
  const book = await makeBook(file);
  try {
    const cover = await book.getCover?.().catch(() => null);
    return {
      title: langString(book.metadata?.title),
      author: authorString(book.metadata?.author),
      description: plainText(langString(book.metadata?.description)),
      cover: cover ?? undefined,
    };
  } finally {
    book.destroy?.();
  }
}

/** Scales a page image down to a cover-sized JPEG (comic pages are often several MB). */
async function coverFromImage(blob: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 600 / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return (await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85))) ?? blob;
  } catch {
    return blob;
  }
}

async function comicMeta(file: File, format: ComicFormat): Promise<Meta> {
  // The archive reader (and its worker) loads only when a comic is uploaded.
  const { openComicArchive } = await import("./comics");
  const archive = await openComicArchive(file, format);
  return {
    title: archive.info?.title,
    author: archive.info?.author,
    cover: await coverFromImage(await archive.loadPage(archive.pages[0]!.name)),
  };
}

export async function extractMetadata(file: File): Promise<Meta> {
  try {
    const comic = comicFormatOfName(file.name);
    if (comic) return await comicMeta(file, comic);
    return file.name.toLowerCase().endsWith(".pdf") ? await pdfMeta(file) : await ebookMeta(file);
  } catch (err) {
    console.warn("Metadata extraction failed", err);
    return {};
  }
}

export type UploadResult =
  | { ok: true; book: Book }
  | { ok: false; error: "duplicate" | "unsupported_format" | "file_too_large" | "network" | string; bookId?: string };

export type UploadOptions = {
  /** Collection to put the book in. */
  folderId?: string | null;
  /** Reading the file's title, author and cover, before the transfer starts. */
  onPreparing?: () => void;
  /** Fraction of the file sent (0 to 1). */
  onProgress?: (fraction: number) => void;
  /** Known metadata (e.g. from a Calibre library) instead of what the file says; the cover still comes from the file if missing. */
  meta?: Meta;
};

export async function uploadBook(file: File, opts: UploadOptions = {}): Promise<UploadResult> {
  opts.onPreparing?.();
  const meta = opts.meta
    ? { ...opts.meta, cover: opts.meta.cover ?? (await extractMetadata(file)).cover }
    : await extractMetadata(file);
  const form = new FormData();
  if (meta.title) form.append("title", meta.title.trim().slice(0, 500));
  if (meta.author) form.append("author", meta.author.trim().slice(0, 500));
  if (meta.description) form.append("description", meta.description.slice(0, 4000));
  if (opts.folderId) form.append("folderId", opts.folderId);
  if (meta.cover && meta.cover.size < 5 * 1024 * 1024) form.append("cover", meta.cover, "cover");
  form.append("file", file, file.name); // file last: server reads fields first

  // XMLHttpRequest rather than fetch: only it reports upload progress.
  return new Promise<UploadResult>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiUrl("/api/books"));
    xhr.withCredentials = true;
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status === 401) window.dispatchEvent(new Event("readsync:unauthorized"));
      if (xhr.status >= 200 && xhr.status < 300) resolve({ ok: true, book: body });
      else resolve({ ok: false, error: body?.error ?? `HTTP ${xhr.status}`, bookId: body?.bookId });
    };
    xhr.onerror = () => resolve({ ok: false, error: "network" });
    xhr.send(form);
  });
}
