import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyChange, flushInk, inverseChange, loadInk, recordInk, resetInkStore, strokeOutline, strokePoint, touchesStroke, withPendingInk, type Stroke } from "./ink";

const stroke = (id: string, points = [0.1, 0.1, 0.5, 0.5, 0.1, 0.5], extra: Partial<Stroke> = {}): Stroke => ({
  id,
  tool: "pen",
  color: "#111827",
  width: 0.004,
  points,
  ...extra,
});

describe("ink changes", () => {
  it("adds, replaces and erases strokes, and undoes a change", () => {
    const before = [stroke("a"), stroke("b")];
    const change = { add: [stroke("c"), stroke("a", [0.2, 0.2, 0.5])], remove: ["b"] };
    const after = applyChange(before, change);
    expect(after.map((s) => s.id)).toEqual(["c", "a"]);
    expect(after.find((s) => s.id === "a")!.points).toEqual([0.2, 0.2, 0.5]);

    const undo = inverseChange(before, { add: [stroke("c")], remove: ["b"] });
    expect(undo).toEqual({ add: [stroke("b")], remove: ["c"] });
    expect(applyChange(applyChange(before, { add: [stroke("c")], remove: ["b"] }), undo).map((s) => s.id).sort()).toEqual(["a", "b"]);
  });

  it("overlays this device's pending changes, per book and page, dropping emptied pages", () => {
    const pages = { 1: [stroke("a")], 2: [stroke("b")] };
    const outbox = [
      { id: "1", bookId: "bk", page: 2, at: 1, add: [], remove: ["b"] },
      { id: "2", bookId: "bk", page: 3, at: 2, add: [stroke("c")], remove: [] },
      { id: "3", bookId: "other", page: 1, at: 3, add: [], remove: ["a"] },
    ];
    expect(withPendingInk("bk", pages, outbox)).toEqual({ 1: [stroke("a")], 3: [stroke("c")] });
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
  beforeEach(() => resetInkStore());
  afterEach(() => vi.unstubAllGlobals());

  it("keeps changes while offline, shows them, and sends them in order when back", async () => {
    let online = false;
    const sent: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (!online) throw new TypeError("offline");
        if ((init.method ?? "GET") === "GET") return new Response(JSON.stringify([{ page: 1, strokes: [stroke("server")] }]), { status: 200 });
        sent.push([url, JSON.parse(init.body as string)]);
        return new Response("{}", { status: 200 });
      }),
    );
    await recordInk("bk", 1, { add: [stroke("x")], remove: [] });
    await recordInk("bk", 1, { add: [], remove: ["server"] });
    await flushInk();
    expect(sent).toEqual([]);

    online = true;
    // The server's copy, with the unsent changes on top.
    expect((await loadInk("bk"))[1]!.map((s) => s.id)).toEqual(["x"]);
    await flushInk();
    expect(sent.map((s) => (s as [string, { add: Stroke[]; remove: string[] }])[1])).toMatchObject([
      { add: [{ id: "x" }], remove: [] },
      { add: [], remove: ["server"] },
    ]);
    expect((sent[0] as [string])[0]).toBe("/api/books/bk/ink/1");
  });
});
