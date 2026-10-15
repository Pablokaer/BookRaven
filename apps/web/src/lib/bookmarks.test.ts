import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bookmark } from "./api";
import { bookmarkLocator, isOnPage } from "./bookmarks";
import { comicLocator } from "./comics";

const mark = (locator: string, percentage: number, extra: Partial<Bookmark> = {}): Bookmark => ({
  id: `id-${locator}`,
  bookId: "b1",
  locator,
  percentage,
  label: null,
  title: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

describe("which page a bookmark is on", () => {
  it("PDFs: by page number", () => {
    expect(isOnPage("page:3", "page:3", "pdf")).toBe(true);
    expect(isOnPage("page:3", "page:4", "pdf")).toBe(false);
  });

  it("comics: by page index, whatever the CFI says inside the page", () => {
    expect(isOnPage(comicLocator(2), "epubcfi(/6/6!/4/2,/1:0,/1:0)", "comic")).toBe(true);
    expect(isOnPage(comicLocator(2), comicLocator(3), "comic")).toBe(false);
  });

  it("ebooks: the bookmark lies inside the visible range, so it survives font changes", () => {
    const page = "epubcfi(/6/4!/4/2,/2/1:0,/10/1:20)";
    expect(bookmarkLocator(page, "text")).toBe("epubcfi(/6/4!/4/2/2/1:0)");
    expect(isOnPage("epubcfi(/6/4!/4/2/2/1:0)", page, "text")).toBe(true);
    expect(isOnPage("epubcfi(/6/4!/4/2/6/1:5)", page, "text")).toBe(true);
    expect(isOnPage("epubcfi(/6/4!/4/2/12/1:0)", page, "text")).toBe(false);
    expect(isOnPage("epubcfi(/6/6!/4/2/2/1:0)", page, "text")).toBe(false);
  });
});

describe("offline changes", () => {
  /** A fresh copy of the module (its outbox lives in memory), with the server answering `respond`. */
  async function fresh(respond: (method: string, url: string) => Response | Promise<Response>) {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const method = init.method ?? "GET";
        const res = await respond(method, url);
        calls.push(`${method} ${url} ${res.status}`);
        return res;
      }),
    );
    vi.resetModules();
    return { lib: await import("./bookmarks"), calls };
  }
  const offline = () => Promise.reject(new TypeError("offline"));

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows pending changes over the last list seen; a newer change to a page replaces the waiting one", async () => {
    const { lib } = await fresh(offline);
    lib.putBookmark("b1", { locator: "page:5", percentage: 0.3, label: "Page 5 of 20", title: "Mine" });
    lib.putBookmark("b1", { locator: "page:5", percentage: 0.3, label: "Page 5 of 20" }); // no title: keeps "Mine"
    lib.putBookmark("b1", { locator: "page:2", percentage: 0.1, label: null, title: "Renamed" });
    lib.deleteBookmark("b1", "page:9");
    lib.putBookmark("other", { locator: "page:1", percentage: 0, label: null });
    const list = lib.withPending("b1", [mark("page:2", 0.1, { title: "Intro" }), mark("page:9", 0.5)]);
    expect(list.map((b) => [b.locator, b.title, b.id])).toEqual([
      ["page:2", "Renamed", "id-page:2"],
      ["page:5", "Mine", "local:page:5"],
    ]);
  });

  it("opening a book offline shows the copy kept on the device", async () => {
    localStorage.setItem("readsync.bookmarks.b1", JSON.stringify([mark("page:4", 0.2)]));
    const { lib } = await fresh(offline);
    expect((await lib.loadBookmarks("b1")).map((b) => b.locator)).toEqual(["page:4"]);
  });

  it("keeps changes on 429 or offline and sends them in order later; drops refused ones and says so", async () => {
    let mode: "offline" | "429" | "ok" | "409" = "offline";
    const { lib, calls } = await fresh((method) => {
      if (mode === "offline") throw new TypeError("offline");
      if (mode === "429") return new Response(null, { status: 429, headers: { "Retry-After": "5" } });
      if (mode === "409" && method === "PUT") return new Response(null, { status: 409 });
      return new Response(null, { status: method === "DELETE" ? 204 : 200 });
    });
    const rejected: unknown[] = [];
    window.addEventListener("readsync:bookmarks-rejected", (e) => rejected.push((e as CustomEvent).detail));

    lib.putBookmark("b1", { locator: "page:5", percentage: 0.3, label: null });
    lib.deleteBookmark("b1", "epubcfi(/6/4)");
    await lib.flushBookmarks();
    mode = "429";
    await vi.advanceTimersByTimeAsync(2_000); // first retry: 429, wait 5 s
    expect(lib.withPending("b1", []).map((b) => b.locator)).toEqual(["page:5"]);
    mode = "ok";
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls.filter((c) => c.endsWith(" 200") || c.endsWith(" 204"))).toEqual([
      "PUT /api/books/b1/bookmarks 200",
      `DELETE /api/books/b1/bookmarks?locator=${encodeURIComponent("epubcfi(/6/4)")} 204`,
    ]);
    expect(lib.withPending("b1", [])).toEqual([]);

    mode = "409";
    lib.putBookmark("b1", { locator: "page:6", percentage: 0.4, label: null });
    await lib.flushBookmarks();
    expect(rejected).toEqual([{ bookId: "b1", status: 409 }]);
    expect(lib.withPending("b1", [])).toEqual([]);
  });

  it("brings over changes queued by the previous version", async () => {
    localStorage.setItem(
      "readsync.bookmarkOutbox",
      JSON.stringify({ "b1 page:3": { op: "put", bookId: "b1", locator: "page:3", percentage: 0.2, label: null, at: 1 } }),
    );
    const { lib, calls } = await fresh(() => new Response(null, { status: 200 }));
    await lib.flushBookmarks();
    expect(calls).toEqual(["PUT /api/books/b1/bookmarks 200"]);
    expect(localStorage.getItem("readsync.bookmarkOutbox")).toBeNull();
  });
});
