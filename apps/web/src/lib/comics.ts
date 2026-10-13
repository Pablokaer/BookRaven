import type { Book } from "./api";

/** Comic book archives: ZIP, RAR, 7-Zip and TAR containers of page images. */
export const COMIC_FORMATS = ["cbz", "cbr", "cb7", "cbt"] as const;
export type ComicFormat = (typeof COMIC_FORMATS)[number];

export const isComicFormat = (format: string): format is ComicFormat => (COMIC_FORMATS as readonly string[]).includes(format);

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

export type ComicInfo = { title?: string; author?: string; rtl: boolean };

export type ComicArchive = {
  pages: { name: string; size: number }[];
  loadPage: (name: string) => Promise<Blob>;
  info: ComicInfo | null;
};

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

async function openZip(file: Blob): Promise<ComicArchive> {
  const { configure, ZipReader, BlobReader, BlobWriter, TextWriter } = await import("foliate-js/vendor/zip.js");
  configure({ useWebWorkers: false });
  const entries = await new ZipReader(new BlobReader(file)).getEntries();
  const byName = new Map(entries.map((e) => [e.filename, e]));
  const infoEntry = entries.find((e) => /(^|\/)comicinfo\.xml$/i.test(e.filename));
  return {
    pages: sortPages(entries.filter((e) => !e.directory).map((e) => ({ name: e.filename, size: e.uncompressedSize }))),
    loadPage: (name) => byName.get(name)!.getData(new BlobWriter(mimeOf(name))),
    info: infoEntry ? parseComicInfo(await infoEntry.getData(new TextWriter())) : null,
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
    const infoName = [...blobs.keys()].find((n) => /(^|\/)comicinfo\.xml$/i.test(n));
    return {
      pages: sortPages([...blobs].map(([name, blob]) => ({ name, size: blob.size }))),
      loadPage: async (name) => blobs.get(name)!,
      info: infoName ? parseComicInfo(await blobs.get(infoName)!.text()) : null,
    };
  } finally {
    worker.terminate();
  }
}

export async function openComicArchive(file: Blob, format: ComicFormat): Promise<ComicArchive> {
  const archive = format === "cbz" ? await openZip(file) : await openWith7z(file);
  if (!archive.pages.length) throw new Error("No pages found: this archive has no images.");
  return archive;
}

/** Guesses the format of a local file by extension (uploads, before the server checks it). */
export function comicFormatOfName(name: string): ComicFormat | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, ComicFormat> = { cbz: "cbz", cbr: "cbr", rar: "cbr", cb7: "cb7", "7z": "cb7", cbt: "cbt", tar: "cbt" };
  return map[ext] ?? null;
}

/**
 * A foliate-js book object for a comic: one fixed-layout section per page image,
 * shown alone or as two-page spreads, left-to-right or right-to-left (manga).
 */
export function makeComicBook(archive: ComicArchive, opts: { book: Book; spreads: boolean; rtl: boolean }) {
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

  const sections = archive.pages.map((p) => ({ id: p.name, load: () => load(p.name), unload: () => unload(p.name), size: p.size }));
  return {
    metadata: { title: opts.book.title, author: opts.book.author ?? undefined },
    dir: opts.rtl ? "rtl" : "ltr",
    rendition: { layout: "pre-paginated", spread: opts.spreads ? "auto" : "none" },
    sections,
    toc: archive.pages.map((p, i) => ({ label: `Page ${i + 1}`, href: p.name })),
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
