import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Android app: no service worker, a bearer token and an account kept in Preferences.
const prefs = vi.hoisted(() => new Map<string, string>());
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefs.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => void prefs.set(key, value),
    remove: async ({ key }: { key: string }) => void prefs.delete(key),
  },
}));

const { apiAnswer, apiJson, loadToken, offlineUser, rememberUser, sessionUnreachable, setToken } = await import("./api");

/** Cache Storage kept in memory. */
function memoryCaches() {
  const store = new Map<string, Response>();
  const name = (k: string) => new URL(k, "http://localhost").pathname;
  const cache = { put: async (k: string, r: Response) => void store.set(name(k), r), match: async (k: string) => store.get(name(k))?.clone() };
  vi.stubGlobal("caches", { open: async () => cache });
  return store;
}

let online = true;
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  online = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (!online) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ url, method: init.method ?? "GET" }), { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("library data in the Android app", () => {
  it("answers from the last good copy when the server can't be reached, and says so", async () => {
    const store = memoryCaches();
    expect(await apiAnswer("/api/books")).toMatchObject({ offline: false });
    await tick(); // kept in the background
    expect(store.has("/api/books")).toBe(true);

    online = false;
    const answer = await apiAnswer<{ method: string }>("/api/books");
    expect(answer).toMatchObject({ offline: true, body: { method: "GET" } });
  });

  it("keeps only library reads, not changes or other pages", async () => {
    const store = memoryCaches();
    await apiJson("/api/folders", { method: "POST", body: "{}" });
    await apiJson("/api/clubs");
    await apiJson("/api/books/b1/highlights");
    await tick();
    expect([...store.keys()]).toEqual(["/api/books/b1/highlights"]);

    online = false;
    await expect(apiJson("/api/clubs")).rejects.toThrow("Failed to fetch");
    await expect(apiJson("/api/books/b2")).rejects.toThrow("Failed to fetch"); // never kept
  });
});

describe("the session in the Android app", () => {
  const reader = { id: "u1", name: "Reader", email: "reader@example.com" };

  it("opens offline only when the server can't be reached, not when it turns the session down", () => {
    expect(sessionUnreachable(new TypeError("Failed to fetch"))).toBe(true);
    expect(sessionUnreachable({ status: 502 })).toBe(true);
    expect(sessionUnreachable({ status: 401 })).toBe(false);
    expect(sessionUnreachable({ status: 403 })).toBe(false);
    expect(sessionUnreachable(null)).toBe(false);
  });

  it("keeps the account of the saved token, and forgets it with the token", async () => {
    await setToken("t1");
    await rememberUser({ ...reader, extra: "not kept" } as typeof reader);
    expect(offlineUser()).toEqual(reader);

    // A new start of the app reads both back.
    await loadToken();
    expect(offlineUser()).toEqual(reader);

    // Another token (another account signing in, or signing out) drops it.
    await setToken("t2");
    expect(offlineUser()).toBeNull();
    expect(prefs.has("readsync.sessionUser")).toBe(false);

    await rememberUser(reader);
    await setToken(null);
    expect(offlineUser()).toBeNull();
  });
});
