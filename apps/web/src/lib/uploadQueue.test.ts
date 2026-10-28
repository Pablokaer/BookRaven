import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Book } from "./api";
import type { UploadOptions, UploadResult } from "./books";
import { createUploadQueue, PROGRESS_INTERVAL, type Uploader, type UploadHooks } from "./uploadQueue";

const book = (id: string, extra: Partial<Book> = {}) => ({ id, title: `Book ${id}`, tags: [], folderId: null, ...extra }) as unknown as Book;
const file = (name: string) => new File(["x"], name);

/** An uploader whose uploads wait for the test: `finish(result)` answers the oldest one still going. */
function fakeUploader() {
  const going: { opts: UploadOptions; resolve: (r: UploadResult) => void }[] = [];
  const updates: [string, object][] = [];
  let updateFails = false;
  const uploader: Uploader = {
    upload: (_file, opts) => new Promise((resolve) => going.push({ opts, resolve })),
    update: async (id, patch) => {
      updates.push([id, patch]);
      if (updateFails) throw new Error("offline");
      return book(id, patch);
    },
  };
  return {
    uploader,
    updates,
    failUpdates: () => (updateFails = true),
    current: () => going[0]!.opts,
    finish: async (result: UploadResult) => {
      await vi.waitFor(() => expect(going.length).toBeGreaterThan(0));
      going.shift()!.resolve(result);
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

function setup(quota: number | null = null, maxUpload: number | null = null) {
  const fake = fakeUploader();
  const uploaded: Book[] = [];
  const moved: Book[] = [];
  const hooks: UploadHooks = { uploaded: (b) => uploaded.push(b), moved: (b) => moved.push(b), settled: vi.fn(), quotaBytes: () => quota, maxUploadBytes: () => maxUpload };
  const queue = createUploadQueue({ uploader: fake.uploader, hooks });
  const item = (i = 0) => queue.items()[i]!;
  return { ...fake, queue, hooks, uploaded, moved, item };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("upload queue", () => {
  it("sends files one at a time, tags them and hands the books to the library", async () => {
    const q = setup();
    q.queue.add([{ file: file("a.epub"), tags: ["sf"] }, file("b.pdf")]);
    expect(q.queue.items().map((u) => u.status)).toEqual(["queued", "queued"]);
    await q.finish({ ok: true, book: book("a") });
    expect(q.updates).toEqual([["a", { tags: ["sf"] }]]);
    expect(q.item(0)).toMatchObject({ status: "done", progress: 1, bookId: "a" });
    expect(q.item(1).status).toBe("queued");
    expect(q.hooks.settled).not.toHaveBeenCalled();
    await q.finish({ ok: true, book: book("b") });
    expect(q.uploaded.map((b) => [b.id, b.tags])).toEqual([
      ["a", ["sf"]],
      ["b", []],
    ]);
    expect(q.hooks.settled).toHaveBeenCalledTimes(1);
  });

  it("lists unsupported files as failed without sending them", () => {
    const q = setup();
    q.queue.add([file("notes.txt")]);
    expect(q.item()).toMatchObject({ status: "error", message: "Unsupported file type" });
  });

  it("refuses files of the server's size limit or bigger without sending them", async () => {
    const MB = 1024 * 1024;
    const q = setup(null, 100 * MB);
    const sized = (name: string, size: number) => Object.defineProperty(file(name), "size", { value: size });
    q.queue.add([sized("limit.pdf", 100 * MB), sized("huge.epub", 300 * MB), sized("ok.pdf", 100 * MB - 1)]);
    expect(q.item(0)).toMatchObject({ status: "error", message: "Too large: files must be smaller than 100 MB" });
    expect(q.item(1)).toMatchObject({ status: "error", message: "Too large: files must be smaller than 100 MB" });
    expect(q.item(2).status).toBe("queued");
    await q.finish({ ok: false, error: "file_too_large" });
    expect(q.item(2)).toMatchObject({ status: "error", message: "Too large: files must be smaller than 100 MB" });
  });

  it("moves a duplicate dropped on a collection into it", async () => {
    const q = setup();
    q.queue.add([file("a.epub")], "folder-1");
    await q.finish({ ok: false, error: "duplicate", bookId: "old" });
    expect(q.moved.map((b) => [b.id, b.folderId])).toEqual([["old", "folder-1"]]);
    expect(q.item()).toMatchObject({ status: "duplicate", bookId: "old", message: "Already in your library, moved to this collection" });

    q.failUpdates();
    q.queue.add([file("a.epub")], "folder-2");
    await q.finish({ ok: false, error: "duplicate", bookId: "old" });
    expect(q.item(1).message).toBe("Already in your library");
  });

  it("says why an upload failed, with the storage limit when known", async () => {
    const q = setup(1024 * 1024 * 1024);
    q.queue.add([file("a.epub"), file("b.epub"), file("c.epub")]);
    await q.finish({ ok: false, error: "quota_exceeded" });
    await q.finish({ ok: false, error: "file_too_large" });
    await q.finish({ ok: false, error: "something_new" });
    expect(q.queue.items().map((u) => u.message)).toEqual(["Storage limit reached (1 GB)", "File is too large", "something_new"]);
    const noQuota = setup(null);
    noQuota.queue.add([file("a.epub")]);
    await noQuota.finish({ ok: false, error: "quota_exceeded" });
    expect(noQuota.item().message).toBe("Storage limit reached");
  });

  it("shows progress at most once per interval, and new states at once", async () => {
    const q = setup();
    const heard = vi.fn();
    q.queue.subscribe(heard);
    q.queue.add([file("a.epub")]);
    q.current().onPreparing?.(); // the upload started at once
    expect(q.item().status).toBe("preparing");
    heard.mockClear();
    for (const p of [0.1, 0.2, 0.3]) q.current().onProgress?.(p);
    expect(heard).not.toHaveBeenCalled();
    expect(q.item().status).toBe("preparing");
    vi.advanceTimersByTime(PROGRESS_INTERVAL);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(q.item()).toMatchObject({ status: "uploading", progress: 0.3 });
    q.current().onProgress?.(0.5);
    q.current().onProgress?.(1); // sent: the waiting progress and the new state apply together, at once
    expect(heard).toHaveBeenCalledTimes(2);
    expect(q.item()).toMatchObject({ status: "processing", progress: 1 });
  });

  it("clears finished uploads only", async () => {
    const q = setup();
    q.queue.add([file("a.epub"), file("b.epub")]);
    await q.finish({ ok: true, book: book("a") });
    q.queue.clear();
    expect(q.queue.items().map((u) => u.name)).toEqual(["b.epub"]);
  });
});
