import { describe, expect, it, vi } from "vitest";

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

const { loadToken, offlineUser, rememberUser, sessionUnreachable, setToken } = await import("./api");

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
