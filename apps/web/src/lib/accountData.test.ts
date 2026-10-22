import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Cache Storage kept in memory (the stores pick it up when they load), and which platform runs.
const env = vi.hoisted(() => {
  const named = new Map<string, Map<string, Response>>();
  const path = (k: string | { url: string }) => new URL(typeof k === "string" ? k : k.url, "http://localhost").pathname;
  const open = (name: string) => {
    const entries = named.get(name) ?? new Map<string, Response>();
    named.set(name, entries);
    return {
      put: async (k: string, r: Response) => void entries.set(path(k), r),
      match: async (k: string) => entries.get(path(k))?.clone(),
      delete: async (k: string) => entries.delete(path(k)),
      keys: async () => [...entries.keys()].map((p) => ({ url: `http://localhost${p}` })),
    };
  };
  vi.stubGlobal("caches", {
    open: async (name: string) => open(name),
    delete: async (name: string) => named.delete(name),
    keys: async () => [...named.keys()],
    match: async () => undefined,
  });
  return { named, open, native: false, online: true };
});
vi.mock("./platform", () => ({
  get isNative() {
    return env.native;
  },
}));

const { forgetAccount, keptForAccount, loadSnapshot, saveSnapshot, sendAccountChanges, STORE_MODULES, isOfflineCopy, withOfflineCopy } = await import(
  "./accountData"
);
const { OFFLINE_CACHE } = await import("./offlineCopies");

const tick = () => new Promise((r) => setTimeout(r, 0));
/** The server: echoes the request, or can't be reached. */
const server = vi.fn(async (body = "{}") => {
  if (!env.online) throw new TypeError("Failed to fetch");
  return new Response(body, { status: 200 });
});

beforeEach(() => {
  env.online = true;
  env.native = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (!env.online) throw new TypeError("Failed to fetch");
      return new Response("{}", { status: 200 });
    }),
  );
});
afterEach(() => {
  server.mockClear();
  localStorage.clear();
  env.named.clear();
});

describe("library snapshots", () => {
  it("are kept per account, and a list that isn't one counts as missing", () => {
    saveSnapshot("folders", "u1", [{ id: "f1", name: "Poetry", createdAt: "2026-01-01" }]);
    expect(loadSnapshot("folders", "u1")).toHaveLength(1);
    expect(loadSnapshot("folders", "u2")).toBeNull();
    localStorage.setItem("readsync.books.u1", "{}");
    expect(loadSnapshot("books", "u1")).toBeNull();
  });
});

describe("signing out", () => {
  it("leaves nothing the account kept on the device, only the device's own preferences", async () => {
    const { savePosition, openingLocator, worthOffering } = await import("./progress");
    const { putBookmark, rememberBookmarks, withPending } = await import("./bookmarks");
    const { inkServer } = await import("./ink");
    const { keepOnDevice } = await import("./deviceStorage");
    const { BOOK_CACHE } = await import("./rangeFile");
    const stroke = { id: "s1", tool: "pen" as const, color: "#111827", width: 0.002, points: [0, 0, 0.5] };

    localStorage.setItem("readsync.settings", "{}");
    localStorage.setItem("readsync.whatsNewSeen", "x");
    const devicePreferences = new Set(Object.keys(localStorage)); // the device id too

    env.online = false; // nothing reaches the server: every change still waits
    savePosition("b1", { locator: "page:3", percentage: 0.1, label: null });
    putBookmark("b1", { locator: "page:3", percentage: 0.1, label: null });
    rememberBookmarks("b1", []);
    inkServer.send("b1", 1, { add: [stroke], remove: [] });
    inkServer.remember("b1", 1, [stroke], 1);
    keepOnDevice("b1");
    await env.open(BOOK_CACHE).put("/books/b1", new Response("book"));
    await env.open(OFFLINE_CACHE).put("/api/books", new Response("[]"));
    // Snapshots of two accounts that signed in on this device.
    for (const user of ["u1", "u2"]) {
      saveSnapshot("books", user, []);
      saveSnapshot("me", user, { isAdmin: false, usedBytes: 0, quotaBytes: null });
      saveSnapshot("folders", user, []);
    }
    await tick();

    await forgetAccount();
    await tick();

    expect(Object.keys(localStorage).filter((k) => !devicePreferences.has(k))).toEqual([]);
    expect(localStorage.getItem("readsync.settings")).toBe("{}");
    const kept = [...env.named].filter(([, entries]) => entries.size).map(([name]) => name);
    expect(kept).toEqual([]);
    expect(openingLocator("b1", null)).toBeNull();
    expect(worthOffering("b1", { locator: "page:1", updatedAt: new Date(1).toISOString() }, null)).toBe(true);
    expect(withPending("b1", [])).toEqual([]);
    expect(inkServer.unsent("b1")).toEqual([]);
  });

  it("doesn't keep the library list the closing library saves after signing out, until the next one opens", async () => {
    await forgetAccount();
    saveSnapshot("books", "u1", []);
    expect(localStorage.getItem("readsync.books.u1")).toBeNull();

    expect(loadSnapshot("books", "u2")).toBeNull(); // the next account's library opens
    saveSnapshot("books", "u2", []);
    expect(loadSnapshot("books", "u2")).toEqual([]);
  });

  it("loads every module that keeps the account's data, even those not opened yet", async () => {
    const sources = import.meta.glob<string>("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });
    const registering = Object.entries(sources)
      .filter(([file, text]) => !/\.test\.tsx?$|\/accountData\.ts$/.test(file) && /\bkeptForAccount\(/.test(text))
      .map(([file]) => file.replace("/src/lib/", "./"));
    expect(Object.keys(STORE_MODULES).sort()).toEqual(registering.sort());
  });

  it("sends and forgets every store, even when one fails", async () => {
    const calls: string[] = [];
    keptForAccount({
      flush: () => Promise.reject(new Error("offline")),
      forget: () => {
        throw new Error("blocked");
      },
    });
    keptForAccount({ flush: () => void calls.push("flush"), forget: () => void calls.push("forget") });

    const sent = await sendAccountChanges();
    expect(sent.some((r) => r.status === "rejected")).toBe(true);
    await forgetAccount();
    expect(calls).toEqual(["flush", "forget"]);
  });
});

describe("offline copies in the Android app", () => {
  beforeEach(() => void (env.native = true));

  it("answers from the last good copy when the server can't be reached, and says so", async () => {
    const res = await withOfflineCopy("/api/books", () => server('[{"id":"b1"}]'));
    expect(isOfflineCopy(res)).toBe(false);
    await tick(); // kept in the background

    env.online = false;
    const copy = await withOfflineCopy("/api/books", () => server());
    expect(isOfflineCopy(copy)).toBe(true);
    expect(await copy.json()).toEqual([{ id: "b1" }]);
  });

  it("keeps only the library reads on its list, not changes or other pages", async () => {
    await withOfflineCopy("/api/folders", () => server(), "POST");
    await withOfflineCopy("/api/clubs", () => server());
    await withOfflineCopy("/api/settings", () => server()); // the reader settings live in localStorage
    await withOfflineCopy("/api/books/b1/highlights", () => server());
    await tick();
    expect([...env.named.get(OFFLINE_CACHE)!.keys()]).toEqual(["/api/books/b1/highlights"]);

    env.online = false;
    await expect(withOfflineCopy("/api/clubs", () => server())).rejects.toThrow("Failed to fetch");
    await expect(withOfflineCopy("/api/books/b2", () => server())).rejects.toThrow("Failed to fetch"); // never kept
  });

  it("uses a kept cover without asking the server", async () => {
    await withOfflineCopy("/api/books/b1/cover", () => server("jpeg"));
    await tick();
    const kept = await withOfflineCopy("/api/books/b1/cover", () => server("new"));
    expect(await kept.text()).toBe("jpeg");
    expect(server).toHaveBeenCalledTimes(1);
  });

  it("is left to the service worker on the web", async () => {
    env.native = false;
    await withOfflineCopy("/api/books", () => server());
    await tick();
    expect(env.named.has(OFFLINE_CACHE)).toBe(false);
  });
});
