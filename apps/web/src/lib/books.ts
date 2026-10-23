import { apiAnswer, apiDelete, apiFetch, apiJson, ApiError, apiUrl, authHeaders, type Book, type BookAbout } from "./api";
import { comicFormatOfName, type ComicFormat } from "./comicFormats";
import { keepOnDevice, noteOpened, savedKey } from "./deviceStorage";
import { afterIdle } from "./idle";
import { onUnmeteredNetwork } from "./network";
import { blobRangeFile, isOpenFile, openRemoteFile, savedWholeFile, saveWholeFile, type RangeFile } from "./rangeFile";

export const SUPPORTED_EXTENSIONS = [".pdf", ".epub", ".mobi", ".azw3", ".azw", ".fb2", ".cbz", ".cbr", ".cb7", ".cbt"];

/** Books up to this size finish downloading in the background once opened (on Wi-Fi), so they open whole offline. */
const FINISH_IN_BACKGROUND = 30 * 1024 * 1024;

/** The library's books; `offline` when they are the copy kept for offline use (the server couldn't be reached). */
export async function listBooks() {
  const { body, offline } = await apiAnswer<Book[]>("/api/books");
  return { books: body, offline };
}

export function getBookAbout(id: string) {
  return apiJson<BookAbout>(`/api/books/${id}/about`);
}

export function getBook(id: string) {
  return apiJson<Book>(`/api/books/${id}`);
}

export const deleteBook = (id: string) => apiDelete(`/api/books/${id}`);

/** RAR, 7z and TAR comics are read from the server's CBZ copy of them (see openComicFile). */
export const readsAsCbz = (format: string) => format === "cbr" || format === "cb7" || format === "cbt";

/**
 * Downloads a whole book file and keeps it in Cache Storage so reopening it (or reading
 * offline) does not download it again. Files never change for a given book id, so the cache
 * never needs invalidation, only deletion. Readers use openBookFile instead, which downloads
 * only the parts being read; this is for FB2 (one XML file) and comics the server can't convert.
 */
export async function downloadBook(book: Book, opts: { cbz?: boolean } = {}): Promise<File> {
  const key = savedKey(book.id, opts.cbz);
  noteOpened(book.id);
  let blob = await savedWholeFile(key).catch(() => null);
  if (!blob) {
    // Kept in Cache Storage: the browser's HTTP cache needn't keep it too.
    const res = await apiFetch(`/api/books/${book.id}/file${opts.cbz ? "?as=cbz" : ""}`, { cache: "no-store" });
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
    blob = await res.blob();
    // Saving it can take a while for big files: the book opens meanwhile.
    void saveWholeFile(key, blob).catch(() => {});
  }
  return new File([blob], book.filename, { type: blob.type });
}

/**
 * Keeps the whole book on this device, downloading only the pieces it doesn't have yet. Comics in
 * RAR/7z/TAR keep the CBZ copy the reader uses (the original when the server can't make one).
 * Rejects with a QuotaExceededError when the device has no room for it.
 */
export async function saveForOffline(book: Book) {
  keepOnDevice(book.id);
  const cbz = readsAsCbz(book.format)
    ? await bookFile(book, true).catch((err) => (err instanceof ApiError && err.status === 422 ? null : Promise.reject(err)))
    : null;
  await (cbz ?? (await bookFile(book, false))).fill?.();
}

/** The copy saved on this device if there is a whole one, otherwise the server's, read by ranges. */
async function bookFile(book: Book, cbz: boolean): Promise<RangeFile> {
  const key = savedKey(book.id, cbz);
  const saved = await savedWholeFile(key).catch(() => null);
  if (saved) return blobRangeFile(saved);
  return openRemoteFile(`/api/books/${book.id}/file${cbz ? "?as=cbz" : ""}`, key);
}

/**
 * A book's file for the reader: the copy saved on this device if there is a whole one,
 * otherwise the server's, downloaded piece by piece as the reader asks for them.
 * `cbz` opens the CBZ copy of a RAR/7z/TAR comic.
 */
export async function openBookFile(book: Book, opts: { cbz?: boolean } = {}): Promise<RangeFile> {
  noteOpened(book.id);
  const file = await bookFile(book, !!opts.cbz);
  // Small books finish downloading in the background on Wi-Fi, behind the reader's own requests,
  // so they open whole offline later. It stops when another book is opened.
  if (file.fill && file.size <= FINISH_IN_BACKGROUND && onUnmeteredNetwork()) {
    const key = savedKey(book.id, opts.cbz);
    afterIdle(() => void file.fill!(() => isOpenFile(key) && onUnmeteredNetwork()).catch(() => {}), { delay: 3000 });
  }
  return file;
}

/** The book's whole file (or CBZ copy) if it was saved on this device (kept for offline, or read to the end). */
export function cachedBookFile(id: string, opts: { cbz?: boolean } = {}): Promise<Blob | null> {
  return savedWholeFile(savedKey(id, opts.cbz)).catch(() => null);
}

// ---------- Metadata extraction (client-side, before upload) ----------

export type Meta = {
  title?: string;
  author?: string;
  description?: string;
  series?: string;
  seriesIndex?: number;
  publisher?: string;
  /** Publication date as the file gives it ("1965", "1965-08-01"). */
  issued?: string;
  cover?: Blob;
};

/** Book descriptions are often HTML: keep the text, one blank line between paragraphs. */
export function htmlToText(html: string | null | undefined) {
  if (!html) return null;
  const doc = new DOMParser().parseFromString(html.replace(/<\/(p|div|br)\s*>|<br\s*\/?>/gi, "\n\n$&"), "text/html");
  const text = (doc.body.textContent ?? "").replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*/g, "\n\n").trim();
  return text || null;
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

/**
 * The series an EPUB belongs to and its position: EPUB 3 collections come as a list, Calibre's
 * calibre:series as one object (whose name foliate leaves out when the file has both kinds).
 */
export function seriesOf(belongsTo: unknown): { series?: string; seriesIndex?: number } {
  const raw = (belongsTo as { series?: unknown } | undefined)?.series;
  const first = (Array.isArray(raw) ? raw[0] : raw) as { name?: unknown; position?: unknown } | undefined;
  const series = langString(first?.name)?.trim();
  if (!series) return {};
  const index = parseFloat(String(first?.position ?? ""));
  return { series, seriesIndex: Number.isFinite(index) ? index : undefined };
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
      description: htmlToText(langString(book.metadata?.description)) ?? undefined,
      ...seriesOf(book.metadata?.belongsTo),
      publisher: authorString(book.metadata?.publisher),
      issued: typeof book.metadata?.published === "string" ? book.metadata.published.trim() : undefined,
      cover: cover ?? undefined,
    };
  } finally {
    book.destroy?.();
  }
}

/**
 * Scales a cover down to a cover-sized JPEG: comic pages and EPUB or Calibre covers are often
 * several MB. A cover that is already smaller than that stays as it is.
 */
async function coverFromImage(blob: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 600 / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; // transparent parts on white, as on paper (JPEG has no transparency)
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const small = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return small && small.size < blob.size ? small : blob;
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
    cover: await archive.loadPage(archive.pages[0]!.name),
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
  if (meta.series) form.append("series", meta.series.trim().slice(0, 500));
  if (meta.seriesIndex !== undefined) form.append("seriesIndex", String(meta.seriesIndex));
  if (meta.publisher) form.append("publisher", meta.publisher.trim().slice(0, 500));
  if (meta.issued) form.append("issued", meta.issued.slice(0, 40));
  if (opts.folderId) form.append("folderId", opts.folderId);
  const cover = meta.cover && (await coverFromImage(meta.cover));
  if (cover && cover.size < 5 * 1024 * 1024) form.append("cover", cover, "cover");
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
