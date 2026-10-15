import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyChange,
  inkSignature,
  inverseChange,
  liveChangeAction,
  mergeChanges,
  strokeOutline,
  strokePoint,
  touchesStroke,
  withPendingInk,
  type InkChange,
  type Stroke,
} from "./ink";

const stroke = (id: string, points = [0.1, 0.1, 0.5, 0.5, 0.1, 0.5], extra: Partial<Stroke> = {}): Stroke => ({
  id,
  tool: "pen",
  color: "#111827",
  width: 0.004,
  points,
  ...extra,
});
const ids = (strokes: Stroke[]) => strokes.map((s) => s.id);

/** What the server does with a change: erase `remove` and the ids in `add`, then add `add`. */
const serverApply = (strokes: Stroke[], c: InkChange) => {
  const gone = new Set([...c.remove, ...c.add.map((s) => s.id)]);
  return [...strokes.filter((s) => !gone.has(s.id)), ...c.add];
};

describe("ink changes", () => {
  it("adds, replaces and erases strokes, and undoes a change", () => {
    const before = [stroke("a"), stroke("b")];
    const change = { add: [stroke("c"), stroke("a", [0.2, 0.2, 0.5])], remove: ["b"] };
    const after = applyChange(before, change);
    expect(ids(after)).toEqual(["c", "a"]);
    expect(after.find((s) => s.id === "a")!.points).toEqual([0.2, 0.2, 0.5]);

    const undo = inverseChange(before, { add: [stroke("c")], remove: ["b"] });
    expect(undo).toEqual({ add: [stroke("b")], remove: ["c"] });
    expect(ids(applyChange(applyChange(before, { add: [stroke("c")], remove: ["b"] }), undo)).sort()).toEqual(["a", "b"]);
  });

  it("merges several changes into one with the same result on the server", () => {
    const start = [stroke("a"), stroke("b"), stroke("c")];
    const changes: InkChange[] = [
      { add: [stroke("x")], remove: ["a"] },
      { add: [stroke("y")], remove: ["x"] }, // erases a stroke added just before
      { add: [stroke("a", [0.3, 0.3, 0.5])], remove: [] }, // puts back an erased one
      { add: [stroke("b", [0.4, 0.4, 0.5])], remove: ["c"] },
    ];
    const oneByOne = changes.reduce(serverApply, start);
    expect(serverApply(start, mergeChanges(changes))).toEqual(oneByOne);
    expect(ids(oneByOne)).toEqual(["y", "a", "b"]);
  });

  it("applies live changes in order, ignores old ones and asks for the page after a gap", () => {
    expect(liveChangeAction(4, 5)).toBe("apply");
    expect(liveChangeAction(4, 4)).toBe("ignore");
    expect(liveChangeAction(4, 2)).toBe("ignore");
    expect(liveChangeAction(4, 7)).toBe("refetch");
    expect(liveChangeAction(0, 1)).toBe("apply"); // first change to a page
  });

  it("gives pages a signature that changes when any stroke does, even with the same count", () => {
    const page = [stroke("a"), stroke("b")];
    const erasedAndDrawn = applyChange(applyChange(page, { add: [], remove: ["a"] }), { add: [stroke("c")], remove: [] });
    expect(inkSignature(erasedAndDrawn)).not.toBe(inkSignature(page));
    expect(inkSignature([stroke("a"), stroke("b")])).toBe(inkSignature(page));
  });

  it("puts this device's unsent changes of a page on top of the server's copy", () => {
    const pending = [
      { seq: 1, bookId: "bk", page: 2, add: [], remove: ["b"] },
      { seq: 2, bookId: "bk", page: 2, add: [stroke("c")], remove: [] },
      { seq: 3, bookId: "bk", page: 3, add: [stroke("d")], remove: [] },
      { seq: 4, bookId: "other", page: 2, add: [], remove: ["a"] },
    ];
    expect(ids(withPendingInk("bk", 2, [stroke("a"), stroke("b")], pending))).toEqual(["a", "c"]);
  });
});

describe("ink geometry", () => {
  it("rounds points and keeps them near the page", () => {
    expect(strokePoint(0.123456, 2, 1.3)).toEqual([0.1235, 1.25, 1]);
  });

  it("finds strokes under the eraser, in page-width units", () => {
    const line = stroke("a", [0.1, 0.5, 0.5, 0.9, 0.5, 0.5]); // horizontal, across the middle
    expect(touchesStroke(line, 0.5, 0.5, 0.01, 1.3)).toBe(true);
    expect(touchesStroke(line, 0.5, 0.52, 0.01, 1.3)).toBe(false); // 0.02 × 1.3 away
    expect(touchesStroke(line, 0.5, 0.505, 0.01, 1.3)).toBe(true);
    expect(touchesStroke(stroke("dot", [0.3, 0.3, 0.5]), 0.305, 0.3, 0.01, 1)).toBe(true);
  });

  it("outlines pen strokes thicker where pressed harder", () => {
    const light = strokeOutline(stroke("l", [0.1, 0.5, 0.1, 0.5, 0.5, 0.1, 0.9, 0.5, 0.1]), 1000, 1300);
    const hard = strokeOutline(stroke("h", [0.1, 0.5, 0.9, 0.5, 0.5, 0.9, 0.9, 0.5, 0.9]), 1000, 1300);
    const height = (o: number[][]) => Math.max(...o.map((p) => p[1]!)) - Math.min(...o.map((p) => p[1]!));
    expect(height(hard)).toBeGreaterThan(height(light));
  });
});

describe("ink sync", () => {
  /** A fresh copy of the module (its outbox lives in memory), with the server answering `respond`. */
  async function fresh(respond: (method: string, url: string, body: unknown) => Response | Promise<Response>) {
    const posts: [string, InkChange][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const method = init.method ?? "GET";
        const body = init.body ? JSON.parse(init.body as string) : null;
        const res = await respond(method, url, body);
        if (method === "POST" && res.ok) posts.push([url, { add: body.add, remove: body.remove }]);
        return res;
      }),
    );
    vi.resetModules();
    return { lib: await import("./ink"), posts };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps strokes while offline, shows them over the server's copy, then sends a page's strokes together", async () => {
    let online = false;
    const { lib, posts } = await fresh((method) => {
      if (!online) throw new TypeError("offline");
      if (method === "GET") return new Response(JSON.stringify([{ page: 1, version: 3, strokes: [stroke("server")] }]), { status: 200 });
      return new Response("{}", { status: 200 });
    });
    lib.recordInk("bk", 1, { add: [stroke("x")], remove: [] });
    lib.recordInk("bk", 1, { add: [], remove: ["server"] });
    lib.recordInk("bk", 1, { add: [stroke("y")], remove: [] });
    lib.recordInk("bk", 2, { add: [stroke("z")], remove: [] });
    await lib.flushInk();
    expect(posts).toEqual([]);

    online = true;
    const loaded = await lib.loadInk("bk");
    expect(loaded.versions).toEqual({ 1: 3, 2: 0 });
    expect(Object.fromEntries(Object.entries(loaded.pages).map(([p, s]) => [p, ids(s)]))).toEqual({ 1: ["x", "y"], 2: ["z"] });

    await lib.flushInk();
    expect(posts).toEqual([
      ["/api/books/bk/ink/1", { add: [stroke("x"), stroke("y")], remove: ["server"] }],
      ["/api/books/bk/ink/2", { add: [stroke("z")], remove: [] }],
    ]);
  });

  it("tells the reader when the server refuses a page's change for good", async () => {
    const { lib } = await fresh(() => new Response(null, { status: 413 }));
    const rejected: unknown[] = [];
    window.addEventListener("readsync:ink-rejected", (e) => rejected.push((e as CustomEvent).detail));
    lib.recordInk("bk", 4, { add: [stroke("big")], remove: [] });
    await lib.flushInk();
    expect(rejected).toEqual([{ bookId: "bk", page: 4, status: 413 }]);
    expect(lib.withPendingInk("bk", 4, [])).toEqual([]);
  });
});
