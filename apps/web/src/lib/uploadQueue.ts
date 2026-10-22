import type { Book } from "./api";
import { SUPPORTED_EXTENSIONS, type Meta, type UploadOptions, type UploadResult } from "./books";
import { fileSize } from "./format";

export type UploadStatus = "queued" | "preparing" | "uploading" | "processing" | "done" | "duplicate" | "error";

export type UploadItem = {
  key: string;
  name: string;
  size: number;
  status: UploadStatus;
  /** Fraction of the file sent (0 to 1). */
  progress: number;
  message?: string;
  bookId?: string;
  /** Collection the file goes into. */
  folderId: string | null;
};

/** A file to upload with what is already known about it (an import from another app). */
export type UploadEntry = { file: File; meta?: Meta; tags?: string[] };

/** Still to finish: the page should not be closed. */
export const isActiveUpload = (u: UploadItem) => u.status === "queued" || u.status === "preparing" || u.status === "uploading" || u.status === "processing";

/** How files reach the server (lib/books `uploadBook` and lib/library `updateBook` in the app; a fake in tests). */
export type Uploader = {
  /** Reads the file's metadata (`onPreparing`), then sends it (`onProgress`, 0 to 1). */
  upload: (file: File, opts: UploadOptions) => Promise<UploadResult>;
  /** Tags a book, or moves it into a collection; resolves to the updated book. */
  update: (bookId: string, patch: { tags: string[] } | { folderId: string }) => Promise<Book>;
};

/** What the queue tells the library, and asks of it. */
export type UploadHooks = {
  /** A book was uploaded (and tagged). */
  uploaded: (book: Book) => void;
  /** A file already in the library was moved into the collection it was dropped on. */
  moved: (book: Book) => void;
  /** The queue ran dry (storage use changed). */
  settled: () => void;
  /** The account's storage limit, for the "limit reached" message. */
  quotaBytes: () => number | null | undefined;
};

const UPLOAD_ERRORS: Record<string, string> = {
  duplicate: "Already in your library",
  unsupported_format: "Unsupported or DRM-protected file",
  file_too_large: "File is too large",
  network: "Network error, try again",
  quota_exceeded: "Storage limit reached",
};

/** Upload progress is shown at most this often (the browser reports it many times a second). */
export const PROGRESS_INTERVAL = 100;

/**
 * Files to upload, sent one at a time; files added meanwhile join the same queue. `items()` is
 * the list the upload panel shows (subscribers hear each change). Progress updates wait and are
 * applied together, once every `progressInterval`; any other change (a new state: processing,
 * done, failed…) applies at once, after the waiting ones.
 */
export function createUploadQueue({ uploader, hooks, progressInterval = PROGRESS_INTERVAL }: { uploader: Uploader; hooks: UploadHooks; progressInterval?: number }) {
  let items: UploadItem[] = [];
  const listeners = new Set<() => void>();
  const jobs: { key: string; file: File; folderId: string | null; meta?: Meta; tags?: string[] }[] = [];
  let running = false;
  const pending = new Map<string, Partial<UploadItem>>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const set = (next: UploadItem[]) => {
    items = next;
    listeners.forEach((l) => l());
  };

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (!pending.size) return;
    const patches = new Map(pending);
    pending.clear();
    set(items.map((x) => (patches.has(x.key) ? { ...x, ...patches.get(x.key) } : x)));
  }
  const patch = (key: string, change: Partial<UploadItem>) => {
    pending.set(key, { ...pending.get(key), ...change });
    flush();
  };
  const patchProgress = (key: string, change: Partial<UploadItem>) => {
    pending.set(key, { ...pending.get(key), ...change });
    timer ??= setTimeout(flush, progressInterval);
  };

  async function run() {
    if (running) return;
    running = true;
    try {
      for (let job = jobs.shift(); job; job = jobs.shift()) {
        const { key, file, folderId, meta, tags } = job;
        const result = await uploader.upload(file, {
          folderId,
          meta,
          onPreparing: () => patch(key, { status: "preparing" }),
          // At 100% the server still stores the file and reads its metadata.
          onProgress: (progress) => (progress >= 1 ? patch(key, { status: "processing", progress }) : patchProgress(key, { status: "uploading", progress })),
        });
        if (result.ok) {
          let book = result.book;
          if (tags?.length) book = await uploader.update(book.id, { tags }).catch(() => book);
          patch(key, { status: "done", progress: 1, bookId: book.id });
          hooks.uploaded(book);
        } else if (result.error === "duplicate" && result.bookId) {
          // Dropped on a collection: the copy already in the library moves there.
          let message = "Already in your library";
          if (folderId) {
            try {
              hooks.moved(await uploader.update(result.bookId, { folderId }));
              message = "Already in your library, moved to this collection";
            } catch {
              /* keep the plain message */
            }
          }
          patch(key, { status: "duplicate", progress: 1, bookId: result.bookId, message });
        } else {
          const quota = hooks.quotaBytes();
          patch(key, {
            status: "error",
            message: result.error === "quota_exceeded" && quota ? `Storage limit reached (${fileSize(quota)})` : (UPLOAD_ERRORS[result.error] ?? result.error),
          });
        }
      }
    } finally {
      running = false;
      hooks.settled();
    }
  }

  return {
    items: () => items,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Queues files (into a collection when `folderId` is given); unsupported ones are listed as failed at once. */
    add(files: FileList | (File | UploadEntry)[], folderId: string | null = null) {
      const added: UploadItem[] = Array.from(files as ArrayLike<File | UploadEntry>).map((entry, i) => {
        const { file, meta, tags } = entry instanceof File ? { file: entry, meta: undefined, tags: undefined } : entry;
        const key = `${file.name}-${file.size}-${Date.now()}-${i}`;
        const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
        if (!SUPPORTED_EXTENSIONS.includes(ext)) {
          return { key, name: file.name, size: file.size, status: "error", progress: 0, message: "Unsupported file type", folderId };
        }
        jobs.push({ key, file, folderId, meta, tags });
        return { key, name: file.name, size: file.size, status: "queued", progress: 0, folderId };
      });
      set([...items, ...added]);
      void run();
    },
    /** Removes finished uploads from the list. */
    clear: () => set(items.filter(isActiveUpload)),
    /** Stops waiting to show progress (the library closed). */
    dispose() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

export type UploadQueue = ReturnType<typeof createUploadQueue>;
