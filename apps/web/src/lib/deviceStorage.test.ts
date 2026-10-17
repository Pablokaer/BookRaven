import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDeviceBooks, evictionOrder, keepOnDevice, makeRoom, noteOpened, pruneDeviceBooks } from "./deviceStorage";

/** Cache Storage kept in memory: the keys of the books cache. */
function memoryCaches(keys: string[]) {
  const store = new Set(keys);
  const name = (k: string | Request) => (typeof k === "string" ? k : new URL(k.url).pathname);
  const cache = {
    keys: async () => [...store].map((k) => new Request(new URL(k, "http://localhost"))),
    delete: async (k: string | Request) => store.delete(name(k)),
  };
  vi.stubGlobal("caches", { open: async () => cache, delete: async () => (store.clear(), true) });
  return store;
}

/** navigator.storage, reporting `usage(books)` for the books still cached. */
function storage(estimate: () => { usage: number; quota: number }) {
  const persist = vi.fn(async () => true);
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: { estimate: async () => estimate(), persisted: async () => false, persist },
  });
  return persist;
}

const registry = () => JSON.parse(localStorage.getItem("readsync.deviceBooks") ?? "{}");

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  delete (navigator as { storage?: unknown }).storage;
});

describe("books kept on the device", () => {
  it("make room least recently opened first, never one saved for offline nor the one being read", () => {
    const books = { a: { openedAt: 3 }, b: { openedAt: 1, kept: true }, c: { openedAt: 2 }, d: { openedAt: 5 } };
    // "old" was saved before opening times were kept: it goes first.
    expect(evictionOrder(["a", "b", "c", "d", "old"], books)).toEqual(["old", "c", "a"]);
  });

  it("drops the books read least recently while the quota is tight", async () => {
    const keys = memoryCaches(["/books/a/part/0", "/books/b", "/books/c/parts", "/books/c/part/1"]);
    const books = () => new Set([...keys].map((k) => k.split("/")[2])).size;
    storage(() => ({ usage: books() * 100, quota: 250 })); // tight above 200
    localStorage.setItem("readsync.deviceBooks", JSON.stringify({ a: { openedAt: 1 }, b: { openedAt: 2, kept: true }, c: { openedAt: 3 } }));

    await makeRoom();
    expect([...keys]).toEqual(["/books/b", "/books/c/parts", "/books/c/part/1"]);
    expect(Object.keys(registry())).toEqual(["b", "c"]);
  });

  it("forgets books the library no longer has, CBZ copies included", async () => {
    const keys = memoryCaches(["/books/a", "/books/b/part/0", "/books/b/parts", "/books/c.cbz/part/3"]);
    localStorage.setItem("readsync.deviceBooks", JSON.stringify({ a: { openedAt: 1 }, b: { openedAt: 2 } }));
    await pruneDeviceBooks(new Set(["a"]));
    expect([...keys]).toEqual(["/books/a"]);
    expect(Object.keys(registry())).toEqual(["a"]);
  });

  it("asks once for persistent storage, with the first book opened or saved, and clears everything", async () => {
    const keys = memoryCaches(["/books/a/part/0"]);
    const persist = storage(() => ({ usage: 0, quota: 100 }));
    noteOpened("a");
    keepOnDevice("b");
    noteOpened("c");
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
    expect(registry()).toMatchObject({ a: {}, b: { kept: true }, c: {} });

    await clearDeviceBooks();
    expect(keys.size).toBe(0);
    expect(localStorage.getItem("readsync.deviceBooks")).toBeNull();
  });
});
