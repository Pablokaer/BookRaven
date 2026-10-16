import { ApiError, type Book } from "./api";
import { cachedBookFile, downloadBook, openBookFile, readsAsCbz } from "./books";
import { blobRangeFile, type RangeFile } from "./rangeFile";
import { localDataStart, openRangeZip } from "./rangeZip";
import { readJson, writeJson } from "./storage";
import type { ComicFormat } from "./comicFormats";

export { comicFormatOfName, isComicFormat } from "./comicFormats";

const IMAGE_RE = /\.(jpe?g|png|gif|webp|avif|bmp|jxl|svg)$/i;
const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  jxl: "image/jxl",
  svg: "image/svg+xml",
};
const mimeOf = (name: string) => MIME[name.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";

/** "page2" before "page10"; ignores case. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Skip macOS resource forks and hidden files that archivers often add. */
const isJunk = (name: string) => /(^|\/)(__MACOSX|\.)/.test(name);
const isComicInfo = (name: string) => /(^|\/)comicinfo\.xml$/i.test(name);
/** Room for a ZIP entry's local header: 30 bytes plus the name and an "extra" field (rarely over a few hundred bytes). */
const headerRoom = (entry: { filename: string }) => 30 + 4 * entry.filename.length + 1024;

export type ComicInfo = { title?: string; author?: string; rtl: boolean };

export type ComicArchive = {
  pages: { name: string; size: number }[];
  loadPage: (name: string) => Promise<Blob>;
  /** The first `bytes` of a page image, for its size (when cheaper than the whole page). */
  loadHead?: (name: string, bytes: number) => Promise<Blob>;
  info: ComicInfo | null;
};

/** Pages downloaded ahead of the one being read (and one behind, for going back). */
const PREFETCH_AHEAD = 3;

/** Reads ComicInfo.xml (the de facto standard metadata file in comic archives). */
function parseComicInfo(xml: string): ComicInfo | null {
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const get = (tag: string) => doc.getElementsByTagName(tag)[0]?.textContent?.trim() || undefined;
    const series = get("Series");
    const number = get("Number");
    const title = get("Title") ?? (series ? `${series}${number ? ` #${number}` : ""}` : undefined);
    return { title, author: get("Writer") ?? get("Penciller"), rtl: get("Manga") === "YesAndRightToLeft" };
  } catch {
    return null;
  }
}

function sortPages<T extends { name: string }>(list: T[]) {
  return list.filter((p) => IMAGE_RE.test(p.name) && !isJunk(p.name)).sort((a, b) => collator.compare(a.name, b.name));
}

/**
 * A CBZ read by ranges: its directory first, then each page image when it is shown. The next
 * pages are downloaded in the background, like a video player buffers what comes next.
 */
async function openZip(file: RangeFile): Promise<ComicArchive> {
  const { zip, entries } = await openRangeZip(file);
  const byName = new Map(entries.map((e) => [e.filename, e]));
  const infoEntry = entries.find((e) => isComicInfo(e.filename));
  const pages = sortPages(entries.filter((e) => !e.directory).map((e) => ({ name: e.filename, size: e.uncompressedSize })));
  const indexOf = new Map(pages.map((p, i) => [p.name, i]));
  const prefetchAround = (name: string) => {
    if (!file.prefetch) return;
    const at = indexOf.get(name) ?? -1;
    for (let i = at + 1; i <= at + PREFETCH_AHEAD; i++) prefetchPage(i);
    prefetchPage(at - 1);
  };
  const prefetchPage = (i: number) => {
    const entry = pages[i] && byName.get(pages[i].name);
    if (entry) file.prefetch!(entry.offset, entry.offset + entry.compressedSize + headerRoom(entry));
  };
  return {
    pages,
    loadPage: (name) => {
      prefetchAround(name);
      return byName.get(name)!.getData(new zip.BlobWriter(mimeOf(name)));
    },
    loadHead: async (name, bytes) => {
      const entry = byName.get(name)!;
      if (entry.compressionMethod !== 0 || entry.encrypted) return entry.getData(new zip.BlobWriter(mimeOf(name)));
      // One small request: the local header and the image's first bytes.
      const peek = (file.peek ?? file.read).bind(file);
      const head = await peek(entry.offset, entry.offset + headerRoom(entry) + bytes);
      const start = localDataStart(head);
      return new Blob([head.subarray(start, start + Math.min(bytes, entry.compressedSize)) as BlobPart]);
    },
    info: infoEntry ? parseComicInfo(await infoEntry.getData(new zip.TextWriter())) : null,
  };
}

/** RAR, 7z and TAR: extracted in a worker with 7-Zip (WebAssembly). */
async function openWith7z(file: Blob): Promise<ComicArchive> {
  const data = await file.arrayBuffer();
  const worker = new Worker(new URL("./comicArchive.worker.ts", import.meta.url), { type: "module" });
  try {
    const result = await new Promise<{ files?: { name: string; data: Uint8Array }[]; error?: string }>((resolve, reject) => {
      worker.onmessage = (e) => resolve(e.data);
      worker.onerror = (e) => reject(new Error(e.message || "Could not read this archive"));
      worker.postMessage({ data }, [data]);
    });
    if (result.error || !result.files) throw new Error(result.error ?? "Could not read this archive");
    const blobs = new Map(result.files.map((f) => [f.name, new Blob([f.data as BlobPart], { type: mimeOf(f.name) })]));
    const infoName = [...blobs.keys()].find(isComicInfo);
    return {
      pages: sortPages([...blobs].map(([name, blob]) => ({ name, size: blob.size }))),
      loadPage: async (name) => blobs.get(name)!,
      info: infoName ? parseComicInfo(await blobs.get(infoName)!.text()) : null,
    };
  } finally {
    worker.terminate();
  }
}

export async function openComicArchive(file: Blob | RangeFile, format: ComicFormat): Promise<ComicArchive> {
  const archive =
    format === "cbz"
      ? await openZip(file instanceof Blob ? blobRangeFile(file) : file)
      : await openWith7z(file instanceof Blob ? file : new Blob([(await file.read(0, file.size)) as BlobPart]));
  if (!archive.pages.length) throw new Error("No pages found: this archive has no images.");
  return archive;
}

/**
 * Opens a book's comic, reading it by ranges. RAR, 7z and TAR archives can't be read a page at
 * a time, so they are read from the server's CBZ copy; a whole original saved on this device
 * (from before the copies existed), or an archive the server couldn't convert, is unpacked here.
 */
async function loadComic(book: Book): Promise<ComicArchive> {
  const format = book.format as ComicFormat;
  if (!readsAsCbz(format)) return openComicArchive(await openBookFile(book), format);
  const savedCbz = await cachedBookFile(book.id, { cbz: true });
  if (savedCbz) return openComicArchive(savedCbz, "cbz");
  const original = await cachedBookFile(book.id);
  if (original) return openComicArchive(original, format);
  const cbz = await openBookFile(book, { cbz: true }).catch((err) =>
    err instanceof ApiError && err.status === 422 ? null : Promise.reject(err),
  );
  return cbz ? openComicArchive(cbz, "cbz") : openComicArchive(await downloadBook(book), format);
}

/**
 * The last opened comic stays open, so switching between paged and scrolling modes (or
 * reopening after a layout change) does not read its directory (or unpack a RAR/7z) again.
 */
let current: { bookId: string; archive: Promise<ComicArchive> } | null = null;

export function getComicArchive(book: Book): Promise<ComicArchive> {
  if (current?.bookId !== book.id) {
    const archive = loadComic(book);
    archive.catch(() => current?.archive === archive && (current = null));
    current = { bookId: book.id, archive };
  }
  return current.archive;
}

/**
 * Position of page `index` in the same format foliate-js uses for comic pages
 * ("epubcfi(/6/<2·(index+1)>)"), so paged and scrolling modes share progress.
 */
export const comicLocator = (index: number) => `epubcfi(/6/${(index + 1) * 2})`;

export function comicIndexFromLocator(locator: string | null) {
  const m = locator ? /^epubcfi\(\/6\/(\d+)/.exec(locator) : null;
  return m ? Math.max(0, Number(m[1]) / 2 - 1) : 0;
}

/** Width and height from an image file's header (PNG, JPEG, GIF, WebP), without decoding it. */
export async function imageSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  const buf = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer());
  const view = new DataView(buf.buffer);
  const ascii = (at: number, len: number) => String.fromCharCode(...buf.subarray(at, at + len));
  if (buf.length > 24 && ascii(1, 3) === "PNG") return { width: view.getUint32(16), height: view.getUint32(20) };
  if (ascii(0, 3) === "GIF") return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const kind = ascii(12, 4);
    if (kind === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (kind === "VP8L") {
      const b = view.getUint32(21, true);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8X") return { width: 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16)), height: 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16)) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    // Walk the JPEG segments up to a start-of-frame marker.
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1]!;
      const len = view.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: view.getUint16(i + 7), height: view.getUint16(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

const WIDE_KEY = (bookId: string) => `readsync.comicWide.${bookId}`;

/** Pages already known to be double-page scans (landscape), or null if not scanned yet. */
export const cachedWidePages = (bookId: string) => readJson<number[] | null>(WIDE_KEY(bookId), null);

/**
 * Finds double-page scans (images wider than tall). They are shown on their own in
 * two-page mode instead of squeezed next to another page. Reads only image headers
 * (the first bytes of each page) where the archive allows it.
 */
export async function scanWidePages(bookId: string, archive: ComicArchive, signal: AbortSignal) {
  const wide: number[] = [];
  // Most headers are in the first 4 KB; JPEGs with a big EXIF block need more.
  const sizeOf = async (name: string) => {
    for (const bytes of archive.loadHead ? [4096, 64 * 1024] : []) {
      const size = await imageSize(await archive.loadHead!(name, bytes)).catch(() => null);
      if (size) return size;
    }
    return imageSize(await archive.loadPage(name)).catch(() => null);
  };
  let next = 0;
  // A few pages at a time: each header is a small download of its own.
  const worker = async () => {
    while (next < archive.pages.length && !signal.aborted) {
      const i = next++;
      const size = await sizeOf(archive.pages[i]!.name).catch(() => null);
      if (size && size.width > size.height * 1.15) wide.push(i);
      await new Promise((r) => setTimeout(r)); // stay responsive
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (signal.aborted) return null;
  wide.sort((a, b) => a - b);
  writeJson(WIDE_KEY(bookId), wide);
  return wide;
}

/** A comic's table of contents: every page. */
export const comicToc = (archive: ComicArchive) => archive.pages.map((p, i) => ({ label: `Page ${i + 1}`, href: p.name }));

/**
 * A foliate-js book object for a comic: one fixed-layout section per page image,
 * shown alone or as two-page spreads, left-to-right or right-to-left (manga).
 * `wide` pages (double-page scans) always get a spread of their own.
 */
export function makeComicBook(archive: ComicArchive, opts: { book: Book; spreads: boolean; rtl: boolean; wide?: number[] }) {
  const urls = new Map<string, string[]>();
  const load = async (name: string) => {
    const existing = urls.get(name);
    if (existing) return existing[1]!;
    const img = URL.createObjectURL(await archive.loadPage(name));
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><img src="${img}" style="display:block" alt=""></body></html>`;
    const page = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    urls.set(name, [img, page]);
    return page;
  };
  const unload = (name: string) => {
    urls.get(name)?.forEach((u) => URL.revokeObjectURL(u));
    urls.delete(name);
  };

  const wide = new Set(opts.wide ?? []);
  const sections = archive.pages.map((p, i) => ({
    id: p.name,
    load: () => load(p.name),
    unload: () => unload(p.name),
    size: p.size,
    ...(wide.has(i) ? { pageSpread: "center" as const } : {}),
  }));
  return {
    metadata: { title: opts.book.title, author: opts.book.author ?? undefined },
    dir: opts.rtl ? "rtl" : "ltr",
    rendition: { layout: "pre-paginated", spread: opts.spreads ? "auto" : "none" },
    sections,
    toc: comicToc(archive),
    getCover: () => archive.loadPage(archive.pages[0]!.name),
    resolveHref: (href: string) => ({ index: sections.findIndex((s) => s.id === href) }),
    splitTOCHref: (href: string) => [href, null],
    getTOCFragment: (doc: Document) => doc.documentElement,
    destroy: () => {
      for (const list of urls.values()) list.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    },
  };
}
