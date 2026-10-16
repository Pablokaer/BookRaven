import { apiFetch, ApiError } from "./api";

/**
 * A book file read in pieces, the way a video player streams an MP4: readers ask for the
 * bytes they need (a PDF page, a chapter or comic page inside a ZIP) and only those are
 * downloaded, with HTTP range requests. Pieces already downloaded stay on the device, so
 * reopening the book (or reading it again offline) doesn't fetch them again; once every
 * piece is there, they become one saved file.
 */
export interface RangeFile {
  readonly size: number;
  /** Bytes [start, end). */
  read(start: number, end: number): Promise<Uint8Array>;
  /** Starts downloading bytes [start, end) in the background (pages the reader will need next). */
  prefetch?(start: number, end: number): void;
  /** Bytes [start, end), downloaded exactly and not kept (a few bytes out of a big piece, like an image header). */
  peek?(start: number, end: number): Promise<Uint8Array>;
}

/** A file already on the device. */
export function blobRangeFile(blob: Blob): RangeFile {
  return { size: blob.size, read: async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer()) };
}

/** Size of the pieces that are downloaded and saved. */
export const CHUNK = 64 * 1024;
/** Reads that follow each other (a whole chapter, a MOBI's text) fetch up to this much ahead. */
const MAX_READAHEAD = 2 * 1024 * 1024;
/** Pieces kept in memory; older ones are read back from Cache Storage. */
const MEMORY_LIMIT = 24 * 1024 * 1024;
const PARALLEL_REQUESTS = 4;
export const BOOK_CACHE = "readsync-books-v1";

/** Cache Storage keys: `<key>` is a whole saved file, `<key>/part/<n>` its pieces. */
const partKey = (key: string, n: number) => `${key}/part/${n}`;
const manifestKey = (key: string) => `${key}/parts`;

type Manifest = { size: number; parts: number[] };

async function openCache() {
  return "caches" in window ? caches.open(BOOK_CACHE).catch(() => null) : null;
}

/**
 * Saves a whole file under `key`, replacing the pieces saved so far: those its manifest lists,
 * those the open file saved since, and `parts` (deleted by key, without listing the whole cache).
 */
export async function saveWholeFile(key: string, blob: Blob, parts: Iterable<number> = []) {
  const cache = await openCache();
  if (!cache) return;
  await cache.put(key, new Response(blob, { headers: { "Content-Type": blob.type } }));
  const pieces = new Set(parts);
  const manifest = await cache
    .match(manifestKey(key))
    .then((r) => (r ? (r.json() as Promise<Manifest>) : null))
    .catch(() => null);
  for (const n of manifest?.parts ?? []) pieces.add(n);
  const open = lastOpened?.key === key ? await lastOpened.file.catch(() => null) : null;
  if (open instanceof RemoteFile) for (const n of open.savedParts()) pieces.add(n);
  await Promise.all([manifestKey(key), ...[...pieces].map((n) => partKey(key, n))].map((k) => cache.delete(k)));
}

/** Deletes a saved file and its pieces (every key starting with `prefix`: the pieces may be unknown here). */
export async function forgetSaved(prefix: string) {
  if (lastOpened?.key.startsWith(prefix)) lastOpened = null;
  const cache = await openCache();
  if (!cache) return;
  const keys = (await cache.keys()).filter((req) => new URL(req.url).pathname.startsWith(prefix));
  await Promise.all(keys.map((req) => cache.delete(req)));
}

/** The whole file saved under `key`, if any. */
export async function savedWholeFile(key: string): Promise<Blob | null> {
  const hit = await (await openCache())?.match(key);
  return hit ? hit.blob() : null;
}

/** Runs network requests a few at a time; what the reader is waiting for goes first. */
class RequestQueue {
  private active = 0;
  private waiting: (() => void)[] = [];
  async run<T>(task: () => Promise<T>, urgent: boolean): Promise<T> {
    if (this.active >= PARALLEL_REQUESTS) {
      await new Promise<void>((resolve) => (urgent ? this.waiting.unshift(resolve) : this.waiting.push(resolve)));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

class RemoteFile implements RangeFile {
  private memory = new Map<number, Uint8Array>();
  private memoryBytes = 0;
  private pending = new Map<number, Promise<Uint8Array>>();
  private queue = new RequestQueue();
  private lastEnd = -1;
  private readahead = 0;
  private manifestTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set once every piece is saved and they were joined into one file. */
  private whole: Blob | null = null;
  private readonly chunks: number;

  constructor(
    readonly size: number,
    private path: string,
    private key: string,
    private cache: Cache | null,
    private saved: Set<number>,
  ) {
    this.chunks = Math.ceil(size / CHUNK);
  }

  /** The pieces saved on the device so far. */
  savedParts(): Iterable<number> {
    return this.saved;
  }

  static async open(path: string, key: string): Promise<RangeFile> {
    const cache = await openCache();
    const manifest = await cache
      ?.match(manifestKey(key))
      .then((r) => (r ? (r.json() as Promise<Manifest>) : null))
      .catch(() => null);
    if (manifest) return new RemoteFile(manifest.size, path, key, cache, new Set(manifest.parts));

    const res = await apiFetch(path, { headers: { Range: `bytes=0-${CHUNK - 1}` } });
    if (res.status === 206) {
      const size = Number(/\/(\d+)\s*$/.exec(res.headers.get("Content-Range") ?? "")?.[1]);
      if (!Number.isFinite(size) || size <= 0) throw new Error("The server did not say how big this book is.");
      const file = new RemoteFile(size, path, key, cache, new Set());
      file.store(0, new Uint8Array(await res.arrayBuffer()));
      return file;
    }
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
    // No range support on the way (a proxy): this was the whole file.
    const blob = await res.blob();
    void saveWholeFile(key, blob).catch(() => {});
    return blobRangeFile(blob);
  }

  async read(start: number, end: number) {
    // Reads that pick up where the last one ended are streaming through the file: fetch further ahead.
    const sequential = Math.abs(start - this.lastEnd) <= CHUNK;
    this.readahead = sequential ? Math.min(MAX_READAHEAD, Math.max(4 * CHUNK, this.readahead * 2)) : 0;
    this.lastEnd = end;
    return this.load(start, end, this.readahead, true);
  }

  prefetch(start: number, end: number) {
    void this.load(start, end, 0, false).catch(() => {});
  }

  async peek(start: number, end: number) {
    end = Math.min(end, this.size);
    if (start >= end) return new Uint8Array(0);
    const first = Math.floor(start / CHUNK);
    const last = Math.floor((end - 1) / CHUNK);
    for (let i = first; i <= last; i++) {
      if (this.isMissing(i)) return this.queue.run(() => this.fetchBytes(start, end), false);
    }
    return this.load(start, end, 0, false);
  }

  private async load(start: number, end: number, ahead: number, urgent: boolean) {
    end = Math.min(end, this.size);
    if (start >= end) return new Uint8Array(0);
    const first = Math.floor(start / CHUNK);
    const last = Math.floor((end - 1) / CHUNK);
    const aheadLast = Math.min(this.chunks - 1, Math.floor((end - 1 + ahead) / CHUNK));

    const parts: Promise<Uint8Array>[] = [];
    let run: number | null = null;
    const flush = (upTo: number) => {
      if (run !== null) this.fetchRun(run, upTo, urgent);
      run = null;
    };
    for (let i = first; i <= aheadLast; i++) {
      if (this.isMissing(i)) {
        run ??= i;
      } else {
        flush(i - 1);
        if (i > last) break; // read ahead only up to the next piece we already have
      }
    }
    flush(aheadLast);
    for (let i = first; i <= last; i++) parts.push(this.chunk(i, urgent));

    const chunks = await Promise.all(parts);
    const out = new Uint8Array(end - start);
    for (let i = first; i <= last; i++) {
      const c = chunks[i - first]!;
      const from = Math.max(start - i * CHUNK, 0);
      const to = Math.min(end - i * CHUNK, c.length);
      out.set(c.subarray(from, to), i * CHUNK + from - start);
    }
    return out;
  }

  /** A piece neither in memory, nor downloading, nor saved on the device. */
  private isMissing(i: number) {
    return !this.memory.has(i) && !this.pending.has(i) && !this.saved.has(i);
  }

  /** Bytes [from, to) in one request (a server without range support sends the whole file). */
  private async fetchBytes(from: number, to: number) {
    const res = await apiFetch(this.path, { headers: { Range: `bytes=${from}-${to - 1}` } });
    if (!res.ok) throw new ApiError(res.status, null);
    const data = new Uint8Array(await res.arrayBuffer());
    return res.status === 200 ? data.subarray(from, to) : data;
  }

  private chunk(i: number, urgent: boolean): Promise<Uint8Array> {
    const inMemory = this.memory.get(i);
    if (inMemory) {
      this.memory.delete(i); // most recently used last
      this.memory.set(i, inMemory);
      return Promise.resolve(inMemory);
    }
    const pending = this.pending.get(i);
    if (pending) return pending;
    if (this.saved.has(i)) {
      const p = this.readSaved(i).then((c) => c ?? this.fetchRun(i, i, urgent).get(i)!);
      return p;
    }
    return this.fetchRun(i, i, urgent).get(i)!;
  }

  private async readSaved(i: number): Promise<Uint8Array | null> {
    const res = this.whole
      ? new Response(this.whole.slice(i * CHUNK, (i + 1) * CHUNK))
      : await this.cache?.match(partKey(this.key, i)).catch(() => undefined);
    if (!res) {
      this.saved.delete(i); // the browser cleared it
      return null;
    }
    const c = new Uint8Array(await res.arrayBuffer());
    this.remember(i, c);
    return c;
  }

  /** Downloads pieces a..b in one request (retrying a couple of times on a flaky network). */
  private fetchRun(a: number, b: number, urgent: boolean) {
    const from = a * CHUNK;
    const to = Math.min((b + 1) * CHUNK, this.size);
    const request = this.queue.run(async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const data = await this.fetchBytes(from, to);
          if (data.length !== to - from) throw new Error("Incomplete download");
          return data;
        } catch (err) {
          if (attempt >= 2 || (err instanceof ApiError && err.status < 500) || !navigator.onLine) throw err;
          await wait(1000 * 3 ** attempt);
        }
      }
    }, urgent);
    const out = new Map<number, Promise<Uint8Array>>();
    for (let i = a; i <= b; i++) {
      const p = request.then((data) => {
        const c = data.slice((i - a) * CHUNK, (i - a + 1) * CHUNK);
        this.store(i, c);
        return c;
      });
      p.catch(() => {}).finally(() => this.pending.get(i) === p && this.pending.delete(i));
      this.pending.set(i, p);
      out.set(i, p);
    }
    return out;
  }

  private remember(i: number, c: Uint8Array) {
    if (this.memory.has(i)) return;
    this.memory.set(i, c);
    this.memoryBytes += c.length;
    for (const [n, old] of this.memory) {
      if (this.memoryBytes <= MEMORY_LIMIT) break;
      this.memory.delete(n);
      this.memoryBytes -= old.length;
    }
  }

  /** Keeps a downloaded piece in memory and on the device. */
  private store(i: number, c: Uint8Array) {
    this.remember(i, c);
    if (!this.cache || this.saved.has(i) || this.whole) return;
    void this.cache
      .put(partKey(this.key, i), new Response(c as BlobPart))
      .then(() => {
        this.saved.add(i);
        this.saveManifest();
      })
      .catch(() => {});
  }

  private saveManifest() {
    if (this.manifestTimer) return;
    this.manifestTimer = setTimeout(() => {
      this.manifestTimer = null;
      if (this.saved.size >= this.chunks) return void this.join();
      const manifest: Manifest = { size: this.size, parts: [...this.saved] };
      void this.cache?.put(manifestKey(this.key), new Response(JSON.stringify(manifest))).catch(() => {});
    }, 500);
  }

  /** Every piece is on the device: keep them as one saved file. */
  private async join() {
    const cache = this.cache;
    if (!cache || this.whole) return;
    try {
      const parts: Blob[] = [];
      for (let i = 0; i < this.chunks; i++) {
        const res = await cache.match(partKey(this.key, i));
        if (!res) return;
        parts.push(await res.blob());
      }
      const whole = new Blob(parts);
      if (whole.size !== this.size) return;
      this.whole = whole;
      await saveWholeFile(this.key, whole, this.saved);
    } catch {
      /* the pieces stay; joining is tried again on the next open */
    }
  }
}

/** The last file opened stays open: reopening the reader (or switching comic modes) reuses what it downloaded. */
let lastOpened: { key: string; file: Promise<RangeFile> } | null = null;

/** Forgets the open file kept in memory (sign-out; the saved copies go with BOOK_CACHE). */
export function forgetOpenedFile() {
  lastOpened = null;
}

/** Opens the file at API `path` for range reads, saved on the device under `key`. */
export function openRemoteFile(path: string, key: string): Promise<RangeFile> {
  if (lastOpened?.key !== key) {
    const file = RemoteFile.open(path, key);
    file.catch(() => lastOpened?.file === file && (lastOpened = null));
    lastOpened = { key, file };
  }
  return lastOpened.file;
}

/** A Blob-like view of part of a range file (for libraries that slice a File, like foliate's MOBI reader). */
export function lazyBlob(file: RangeFile, name: string, start = 0, end = file.size) {
  const size = Math.max(0, end - start);
  const view = {
    name,
    size,
    type: "",
    slice: (s = 0, e = size) => {
      const clamp = (n: number) => Math.min(size, Math.max(0, n < 0 ? size + n : n));
      return lazyBlob(file, name, start + clamp(s), start + Math.max(clamp(s), clamp(e)));
    },
    arrayBuffer: async () => {
      const bytes = await file.read(start, end);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    },
    text: async () => new TextDecoder().decode(await file.read(start, end)),
  };
  return view;
}
