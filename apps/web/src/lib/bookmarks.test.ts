import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bookmark } from "./api";
import { bookmarkLocator, deleteBookmark, flushBookmarks, isOnPage, putBookmark, withPending } from "./bookmarks";
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
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("shows pending changes over the last list seen", () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
    const server = [mark("page:2", 0.1, { title: "Intro" }), mark("page:9", 0.5)];
    putBookmark("b1", { locator: "page:5", percentage: 0.3, label: "Page 5 of 20" });
    putBookmark("b1", { locator: "page:2", percentage: 0.1, label: null, title: "Renamed" });
    deleteBookmark("b1", "page:9");
    putBookmark("other", { locator: "page:1", percentage: 0, label: null });
    const list = withPending("b1", server);
    expect(list.map((b) => [b.locator, b.title])).toEqual([
      ["page:2", "Renamed"],
      ["page:5", null],
    ]);
    expect(list[0]!.id).toBe("id-page:2");
    expect(list[1]!.id).toBe("local:page:5");
  });

  it("sends a change made after a round with nothing to send (app start)", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(`${init.method} ${url}`);
        return new Response(null, { status: 200 });
      }),
    );
    await flushBookmarks(); // empty outbox
    putBookmark("b1", { locator: "page:7", percentage: 0.5, label: null });
    await flushBookmarks();
    expect(calls).toEqual(["PUT /api/books/b1/bookmarks"]);
    expect(withPending("b1", [])).toEqual([]);
  });

  it("keeps changes while offline or on server errors, and sends them in order when it can", async () => {
    const calls: string[] = [];
    let mode: "offline" | "error" | "ok" = "offline";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (mode === "offline") throw new TypeError("offline");
        calls.push(`${init.method} ${url}`);
        return new Response(null, { status: mode === "error" ? 502 : init.method === "DELETE" ? 204 : 200 });
      }),
    );
    putBookmark("b1", { locator: "page:5", percentage: 0.3, label: null });
    deleteBookmark("b1", "epubcfi(/6/4)");
    await flushBookmarks();
    expect(withPending("b1", []).map((b) => b.locator)).toEqual(["page:5"]);

    mode = "error";
    await flushBookmarks();
    expect(withPending("b1", []).map((b) => b.locator)).toEqual(["page:5"]);

    mode = "ok";
    calls.length = 0;
    await flushBookmarks();
    expect(calls).toEqual(["PUT /api/books/b1/bookmarks", `DELETE /api/books/b1/bookmarks?locator=${encodeURIComponent("epubcfi(/6/4)")}`]);
    expect(withPending("b1", [])).toEqual([]);
  });
});
