import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOutbox, memoryStore, retryDelay, settle, type OutboxStore, type Queued } from "./outbox";

type Item = { name: string; key?: string; note?: string };

/** An outbox whose server answers with `statuses` in turn (then 200); "offline" throws. */
function setup(statuses: (number | "offline" | [number, string])[] = [], extra: Partial<Parameters<typeof createOutbox<Item>>[0]> = {}, store: OutboxStore<Item> = memoryStore()) {
  const sent: string[][] = [];
  const rejected: [string[], number][] = [];
  const box = createOutbox<Item>({
    store,
    send: async (items) => {
      const next = statuses.shift() ?? 200;
      if (next === "offline") throw new TypeError("offline");
      sent.push(items.map((i) => i.name));
      const [status, retryAfter] = Array.isArray(next) ? next : [next, null];
      return new Response(null, { status, headers: retryAfter ? { "Retry-After": retryAfter } : {} });
    },
    onRejected: (items, status) => rejected.push([items.map((i) => i.name), status]),
    ...extra,
  });
  return { box, sent, rejected };
}

describe("response rules", () => {
  it("retries what can still succeed and drops what can't", () => {
    expect([200, 204, 404].map(settle)).toEqual(["done", "done", "done"]);
    expect([401, 408, 429, 500, 503].map(settle)).toEqual(["retry", "retry", "retry", "retry", "retry"]);
    expect([400, 403, 409, 413].map(settle)).toEqual(["rejected", "rejected", "rejected", "rejected"]);
  });
  it("waits longer each time, or as long as the server asks", () => {
    expect([1, 2, 3].map((n) => retryDelay(n))).toEqual([2000, 4000, 8000]);
    expect(retryDelay(20)).toBe(300_000);
    expect(retryDelay(1, "30")).toBe(30_000);
  });
});

describe("outbox", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends in order, including changes queued while sending, and after an empty round", async () => {
    const { box, sent } = setup();
    await box.flush(); // nothing to send
    box.push({ name: "a" });
    box.push({ name: "b" });
    await box.flush();
    box.push({ name: "c" });
    await box.flush();
    expect(sent).toEqual([["a"], ["b"], ["c"]]);
    expect(box.pending()).toEqual([]);
  });

  it("keeps changes on 429 and tries again when the server says", async () => {
    const { box, sent } = setup([[429, "30"]]);
    box.push({ name: "a" });
    box.push({ name: "b" });
    await box.flush();
    expect(box.pending().map((i) => i.name)).toEqual(["a", "b"]);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(sent).toEqual([["a"]]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sent).toEqual([["a"], ["a"], ["b"]]);
    expect(box.pending()).toEqual([]);
  });

  it("keeps changes while offline or on server errors, retrying with a growing delay", async () => {
    const { box, sent } = setup(["offline", 502]);
    box.push({ name: "a" });
    await box.flush();
    expect(box.pending()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000); // 2nd try: 502
    expect(box.pending()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4_000); // 3rd try: ok
    expect(sent).toEqual([["a"], ["a"]]);
    expect(box.pending()).toEqual([]);
  });

  it("drops a refused change, says so, and goes on with the next", async () => {
    const { box, sent, rejected } = setup([413]);
    box.push({ name: "big" });
    box.push({ name: "next" });
    await box.flush();
    expect(rejected).toEqual([[["big"], 413]]);
    expect(sent).toEqual([["big"], ["next"]]);
    expect(box.pending()).toEqual([]);
  });

  it("sends several changes in one request when asked to", async () => {
    const { box, sent } = setup(["offline"], { batch: (q) => Math.min(2, q.length) });
    for (const name of ["a", "b", "c"]) box.push({ name });
    await box.flush();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sent).toEqual([["a", "b"], ["c"]]);
  });

  it("lets a newer change replace a waiting one with the same key, keeping what `combine` says", async () => {
    const { box, sent } = setup(["offline"], {
      key: (i) => i.key ?? i.name,
      combine: (older, newer) => ({ ...newer, note: newer.note ?? older.note }),
    });
    box.push({ name: "first", key: "k", note: "kept" });
    box.push({ name: "other" });
    box.push({ name: "second", key: "k" });
    expect(box.pending().map((i) => [i.name, i.note])).toEqual([
      ["other", undefined],
      ["second", "kept"],
    ]);
    await box.flush();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sent).toEqual([["other"], ["second"]]);
  });

  it("sends changes stored by an earlier session first; a newer change on the same key wins", async () => {
    const store = memoryStore<Item>();
    await store.add({ name: "stored-1", seq: 1 } as Queued<Item>);
    await store.add({ name: "stored-2", key: "k", seq: 2 } as Queued<Item>);
    const { box, sent } = setup([], { key: (i) => i.key ?? i.name }, store);
    box.push({ name: "new", key: "k" });
    await box.ready;
    await box.flush();
    expect(sent).toEqual([["stored-1"], ["new"]]);
    expect(await store.load()).toEqual([]);
  });
});
