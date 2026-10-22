import { beforeEach, describe, expect, it, vi } from "vitest";

// Better Auth's client, answering as the test says.
const client = vi.hoisted(() => ({
  signOut: vi.fn(async (): Promise<{ error: unknown }> => ({ error: null })),
  getSession: vi.fn(async (): Promise<{ data: { user: { id: string } } | null }> => ({ data: null })),
  $store: { notify: vi.fn() },
}));
vi.mock("better-auth/react", () => ({ createAuthClient: () => client }));

const { signOut } = await import("./auth");
const { loadSnapshot, openAccount, saveSnapshot } = await import("./accountData");

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  openAccount();
});

describe("signing out", () => {
  it("doesn't keep the closing library's list once signed out", async () => {
    await signOut();
    saveSnapshot("books", "u1", []);
    expect(loadSnapshot("books", "u1")).toBeNull();
    expect(client.getSession).not.toHaveBeenCalled();
  });

  it("keeps the library's snapshots when the server didn't sign out and the account is still signed in", async () => {
    client.signOut.mockResolvedValueOnce({ error: { status: 503 } });
    client.getSession.mockResolvedValueOnce({ data: { user: { id: "u1" } } });
    await signOut();
    saveSnapshot("books", "u1", []);
    expect(loadSnapshot("books", "u1")).toEqual([]);
    expect(client.$store.notify).not.toHaveBeenCalled();
  });

  it("offline, forgets the account and has the app check the session again", async () => {
    client.signOut.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    client.getSession.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await signOut();
    saveSnapshot("books", "u1", []);
    expect(loadSnapshot("books", "u1")).toBeNull();
    expect(client.$store.notify).toHaveBeenCalledWith("$sessionSignal");
  });
});
