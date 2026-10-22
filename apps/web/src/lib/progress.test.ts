import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Live events from the server, sent by the test.
const live = vi.hoisted(() => new Set<(event: string, data: any) => void>());
vi.mock("./events", () => ({
  onServerEvent: (handler: (event: string, data: any) => void) => {
    live.add(handler);
    return () => live.delete(handler);
  },
}));
const serverEvent = (event: string, data: unknown) => live.forEach((h) => h(event, data));

/** This device (each fresh copy of the modules reads it from storage). */
const deviceId = "this-device";

type Sent = { bookId: string; locator: string; clientUpdatedAt: number; deviceId: string; keepalive: boolean };

/** The server, answering each position PUT with `respond` (throwing: offline). */
let respond: () => Response | Promise<Response>;
const sent: Sent[] = [];
const offline = () => Promise.reject(new TypeError("offline"));
const ok = () => new Response("{}", { status: 200 });

/** A fresh copy of the module (as when the app starts again), with what was stored on the device. */
async function open() {
  vi.resetModules();
  const lib = await import("./progress");
  const account = await import("./accountData");
  await vi.advanceTimersByTimeAsync(0); // positions stored by an earlier session are loaded
  return { ...lib, forgetAccount: account.forgetAccount };
}
let current: Awaited<ReturnType<typeof open>> | null = null;
async function start() {
  current = await open();
  return current;
}

const pos = (locator: string) => ({ locator, percentage: 0.5, label: null });
/** A position the server has, reached at `at` (ms) on another device unless said. */
const remote = (locator: string, at: number, from = "other-device") => ({ locator, updatedAt: new Date(at).toISOString(), deviceId: from });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("readsync.deviceId", deviceId);
  sent.length = 0;
  respond = ok;
  vi.useFakeTimers({ now: 1_000_000 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const res = await respond();
      const body = JSON.parse(String(init.body));
      sent.push({ bookId: url.split("/")[3]!, locator: body.locator, clientUpdatedAt: body.clientUpdatedAt, deviceId: body.deviceId, keepalive: !!init.keepalive });
      return res;
    }),
  );
});
afterEach(async () => {
  // Nothing of this test is left to send in the next one (their page-hide listeners stay).
  await current?.forgetAccount();
  current = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("saving positions", () => {
  it("sends one request for pages turned in quick succession, with the last position", async () => {
    const lib = await start();
    lib.savePosition("b1", pos("page:1"));
    await vi.advanceTimersByTimeAsync(1_000);
    lib.savePosition("b1", pos("page:2"));
    await vi.advanceTimersByTimeAsync(1_000);
    lib.savePosition("b1", pos("page:3"));
    await vi.advanceTimersByTimeAsync(1_400);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(sent.map((s) => [s.bookId, s.locator, s.deviceId])).toEqual([["b1", "page:3", deviceId]]);
    expect(sent[0]!.clientUpdatedAt).toBe(1_000_000 + 2_000); // when it was reached
  });

  it("keeps a position while the server fails, and tries again", async () => {
    const lib = await start();
    respond = () => new Response(null, { status: 503 });
    lib.savePosition("b1", pos("page:4"));
    await vi.advanceTimersByTimeAsync(1_500);
    respond = ok;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sent.map((s) => s.locator)).toEqual(["page:4", "page:4"]);
    expect(lib.openingLocator("b1", null)).toBeNull(); // sent: nothing waits any more
  });

  it("drops a position the server refuses for good", async () => {
    const lib = await start();
    respond = () => new Response(null, { status: 400 });
    lib.savePosition("b1", pos("page:4"));
    await lib.flushPositions();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toHaveLength(1);
    expect(lib.openingLocator("b1", null)).toBeNull();
  });

  it("sends without waiting when the page is hidden, and the request outlives it", async () => {
    const lib = await start();
    lib.savePosition("b1", pos("page:7"));
    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map((s) => [s.locator, s.keepalive])).toEqual([["page:7", true]]);
    lib.savePosition("b1", pos("page:8"));
    await lib.flushPositions(); // closing the book
    expect(sent.map((s) => [s.locator, s.keepalive])).toEqual([
      ["page:7", true],
      ["page:8", false],
    ]);
  });

  it("brings over positions waiting in the previous version's outbox", async () => {
    const old = { bookId: "b1", locator: "page:9", percentage: 0.9, label: null, clientUpdatedAt: 5 };
    localStorage.setItem("readsync.progressOutbox", JSON.stringify({ b1: old }));
    const lib = await start();
    expect(lib.openingLocator("b1", remote("page:1", 1))).toBe("page:9");
    await lib.flushPositions();
    expect(sent.map((s) => [s.locator, s.clientUpdatedAt])).toEqual([["page:9", 5]]);
    expect(localStorage.getItem("readsync.progressOutbox")).toBeNull();
  });
});

describe("which position wins", () => {
  it("a book read offline opens where it was left on this device, after the app starts again", async () => {
    respond = offline;
    const before = await open();
    before.savePosition("b1", pos("page:12"));
    await before.flushPositions();

    const lib = await start();
    expect(lib.openingLocator("b1", remote("page:3", 1_000_000 - 60_000))).toBe("page:12"); // the server's is older
    expect(lib.openingLocator("b1", remote("page:30", 1_000_000 + 60_000))).toBe("page:30"); // read further elsewhere since
    expect(lib.openingLocator("b2", remote("page:5", 1))).toBe("page:5");
    expect(lib.openingLocator("b2", null)).toBeNull();
  });

  it("offers a position from another device only when it is newer than what was read here", async () => {
    const lib = await start();
    lib.savePosition("b1", pos("page:10")); // at 1_000_000
    const here = pos("page:10");
    expect(lib.worthOffering("b1", remote("page:20", 1_000_000 - 1), here)).toBe(false);
    expect(lib.worthOffering("b1", remote("page:20", 1_000_000 + 1), here)).toBe(true);
    // Still true once this device's position is sent: it is what was read here that counts.
    await lib.flushPositions();
    expect(lib.worthOffering("b1", remote("page:20", 1_000_000 - 1), here)).toBe(false);
    // Not this device's own, not where the reader already is, not the one the book opened at.
    expect(lib.worthOffering("b1", remote("page:20", 2_000_000, deviceId), here)).toBe(false);
    expect(lib.worthOffering("b1", remote("page:10", 2_000_000), here)).toBe(false);
    lib.openingLocator("b2", remote("page:5", 2_000_000));
    expect(lib.worthOffering("b2", remote("page:5", 2_000_000), pos("page:5a"))).toBe(false);
    expect(lib.worthOffering("b2", remote("page:6", 2_000_001), pos("page:5a"))).toBe(true);
  });

  it("two devices racing: each position carries when it was reached, so the newest wins", async () => {
    const lib = await start();
    respond = offline;
    lib.savePosition("b1", pos("page:40")); // here, at 1_000_000, offline
    await vi.advanceTimersByTimeAsync(1_500);
    await vi.advanceTimersByTimeAsync(60_000);
    // Another device reached page 50 later, and the server has it: worth offering, and where the book opens.
    const other = remote("page:50", 1_000_000 + 30_000);
    expect(lib.worthOffering("b1", other, pos("page:40"))).toBe(true);
    expect(lib.openingLocator("b1", other)).toBe("page:50");
    // Back online, this device's position goes with the time it was reached: the server keeps page 50.
    respond = ok;
    await lib.flushPositions();
    expect(sent.at(-1)).toMatchObject({ locator: "page:40", clientUpdatedAt: 1_000_000 });
  });

  it("tells live position changes, and whether they came from another device", async () => {
    const lib = await start();
    const heard: [string, boolean][] = [];
    const off = lib.onPositionChange((p, elsewhere) => heard.push([p.locator, elsewhere]));
    serverEvent("progress.updated", { bookId: "b1", ...remote("page:2", 1), percentage: 0.1 });
    serverEvent("progress.updated", { bookId: "b1", ...remote("page:3", 2, deviceId), percentage: 0.2 });
    serverEvent("book.updated", { id: "b1" });
    off();
    serverEvent("progress.updated", { bookId: "b1", ...remote("page:4", 3), percentage: 0.3 });
    expect(heard).toEqual([
      ["page:2", true],
      ["page:3", false],
    ]);
  });
});

describe("signing out", () => {
  it("forgets positions not yet sent: never sent, and the book no longer opens there", async () => {
    respond = offline;
    const lib = await start();
    lib.savePosition("b1", pos("page:3"));
    await vi.advanceTimersByTimeAsync(1_500);
    await lib.forgetAccount();
    respond = ok;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await lib.flushPositions();
    expect(sent).toEqual([]);
    expect(lib.openingLocator("b1", null)).toBeNull();
    expect(lib.worthOffering("b1", remote("page:9", 1), null)).toBe(true);
  });
});
