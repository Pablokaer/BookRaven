import { describe, expect, it, vi } from "vitest";
import { forgetAccountData } from "./auth";
import { putBookmark, withPending } from "./bookmarks";
import { getLocalPending, lastLocalUpdate, saveProgress } from "./progress";

describe("signing out", () => {
  it("forgets the account's unsent changes and offline copies, not the device's preferences", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")));
    saveProgress("b1", { locator: "page:3", percentage: 0.1, label: null });
    putBookmark("b1", { locator: "page:3", percentage: 0.1, label: null });
    expect(withPending("b1", [])).toHaveLength(1);
    localStorage.setItem("readsync.bookmarks.b1", "[]");
    localStorage.setItem("readsync.settings", "{}");

    await forgetAccountData();

    expect(getLocalPending("b1")).toBeNull();
    expect(lastLocalUpdate("b1")).toBe(0);
    expect(withPending("b1", [])).toEqual([]);
    expect(localStorage.getItem("readsync.bookmarkQueue")).toBeNull();
    expect(localStorage.getItem("readsync.bookmarks.b1")).toBeNull();
    expect(localStorage.getItem("readsync.settings")).toBe("{}");
    vi.unstubAllGlobals();
  });

  it("forgets the downloaded books, the library data kept for offline use and the collections", async () => {
    const deleted: string[] = [];
    vi.stubGlobal("caches", { delete: async (name: string) => (deleted.push(name), true) });
    localStorage.setItem("readsync.folders.u1", "[]");
    localStorage.setItem("readsync.deviceBooks", JSON.stringify({ b1: { openedAt: 1, kept: true } }));

    await forgetAccountData();

    expect(deleted).toEqual(expect.arrayContaining(["readsync-books-v1", "readsync-api-v1"]));
    expect(localStorage.getItem("readsync.folders.u1")).toBeNull();
    expect(localStorage.getItem("readsync.deviceBooks")).toBeNull();
    vi.unstubAllGlobals();
  });
});
