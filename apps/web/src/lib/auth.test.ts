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
});
