import { describe, expect, it, vi } from "vitest";
import { applyChange, type InkChange, type Stroke } from "./ink";
import { createInkSession, type InkPageCopy, type InkServer } from "./inkSession";

const stroke = (id: string): Stroke => ({ id, tool: "pen", color: "#111827", width: 0.004, points: [0.1, 0.1, 0.5] });
const ids = (strokes: Stroke[] = []) => strokes.map((s) => s.id);
const add = (...strokeIds: string[]): InkChange => ({ add: strokeIds.map(stroke), remove: [] });
const erase = (...strokeIds: string[]): InkChange => ({ add: [], remove: strokeIds });
/** Lets answered requests reach the session. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The server, the outbox and the device's copy, in memory. `hold()` keeps summary and page
 * requests waiting (they answer with the pages as they were when asked) until `release()`.
 */
function fakeServer(pages: Record<number, string[]> = {}) {
  const copies: Record<number, InkPageCopy> = Object.fromEntries(Object.entries(pages).map(([p, s]) => [p, { strokes: s.map(stroke), version: s.length }]));
  const unsent: (InkChange & { page: number })[] = [];
  const remembered: [number, string[], number][] = [];
  const changeListeners = new Set<(page: number, change: InkChange, version: number) => void>();
  const rejectListeners = new Set<(page: number, status: number) => void>();
  const pageRequests: number[][] = [];
  let held: (() => void)[] | null = null;
  const answer = <T>(value: () => T) => {
    const v = value(); // as the server has it now
    return new Promise<T>((resolve) => (held ? held.push(() => resolve(v)) : resolve(v)));
  };
  const copy = (page: number): InkPageCopy => copies[page] ?? { strokes: [], version: 0 };

  const server: InkServer = {
    summary: () => answer(() => Object.fromEntries(Object.entries(copies).map(([p, c]) => [p, { count: c.strokes.length, version: c.version }]))),
    pages: (_bookId, wanted) => {
      pageRequests.push(wanted);
      return answer(() => Object.fromEntries(wanted.map((p) => [p, copy(p)])));
    },
    page: async (_bookId, page) => copy(page),
    send: (_bookId, page, change) => void unsent.push({ ...change, page }),
    unsent: () => [...unsent],
    remember: (_bookId, page, strokes, version) => void remembered.push([page, ids(strokes), version]),
    onChange: (_bookId, listener) => {
      changeListeners.add(listener);
      return () => void changeListeners.delete(listener);
    },
    onRejected: (_bookId, listener) => {
      rejectListeners.add(listener);
      return () => void rejectListeners.delete(listener);
    },
  };
  /** A change saved on the server by another device: a new version, heard of live unless `quiet`. */
  const remote = (page: number, change: InkChange, { quiet = false } = {}) => {
    const c = copy(page);
    copies[page] = { strokes: applyChange(c.strokes, change), version: c.version + 1 };
    if (!quiet) for (const l of changeListeners) l(page, change, copies[page]!.version);
  };
  /** The server accepts this device's oldest unsent change (and tells every device, this one too). */
  const deliver = () => {
    const c = unsent.shift()!;
    const change = { add: c.add, remove: c.remove };
    copies[c.page] = { strokes: applyChange(copy(c.page).strokes, change), version: copy(c.page).version + 1 };
    for (const l of changeListeners) l(c.page, change, copies[c.page]!.version);
  };
  /** The server refuses this device's unsent changes to `page` for good. */
  const reject = (page: number, status: number) => {
    for (let i = unsent.length - 1; i >= 0; i--) if (unsent[i]!.page === page) unsent.splice(i, 1);
    for (const l of rejectListeners) l(page, status);
  };
  const hold = () => void (held = []);
  const release = async () => {
    const waiting = held ?? [];
    held = null;
    waiting.forEach((r) => r());
    await settle();
  };
  return { server, copies, unsent, remembered, pageRequests, changeListeners, rejectListeners, remote, deliver, reject, hold, release };
}

async function open(fake: ReturnType<typeof fakeServer>, onRejected?: (page: number, status: number) => void) {
  const session = createInkSession("bk", { server: fake.server, onRejected });
  await settle();
  return session;
}

describe("ink session", () => {
  it("opens with the summary and loads the pages around the one being read, with unsent changes on top", async () => {
    const fake = fakeServer({ 2: ["a", "b"], 20: ["c"], 40: ["d"] });
    fake.server.send("bk", 2, erase("b")); // from an earlier session, not sent yet
    fake.server.send("bk", 30, add("u"));
    const session = await open(fake);
    expect(session.snapshot().annotated).toEqual([
      { page: 2, strokes: 2, signature: "v2" },
      { page: 20, strokes: 1, signature: "v1" },
      { page: 40, strokes: 1, signature: "v1" },
    ]);

    session.showAround(2);
    await settle();
    // Only pages with strokes are asked for (unsent ones too: they must show before the server has them).
    expect(fake.pageRequests).toEqual([[2]]);
    expect(ids(session.snapshot().pages[2])).toEqual(["a"]);
    expect(ids(session.snapshot().pages[30])).toEqual(["u"]);
    expect(Object.keys(session.snapshot().pages)).toEqual(["2", "30"]);

    // A notebook picture: the page loads once the summary is in.
    await session.load([40]);
    expect(ids(session.snapshot().pages[40])).toEqual(["d"]);
    expect(session.snapshot().annotated.map((p) => p.page)).toEqual([2, 20, 30, 40]);
  });

  it("loads a page again when a live change arrives while it loads", async () => {
    const fake = fakeServer({ 5: ["a"] });
    const session = await open(fake);
    fake.hold();
    session.showAround(5);
    fake.remote(5, add("r")); // version 2, while the request for version 1 is on its way
    await fake.release();
    await settle();
    expect(ids(session.snapshot().pages[5])).toEqual(["a", "r"]);
    // The summary counted it meanwhile, then the loaded strokes took over.
    expect(session.snapshot().annotated).toEqual([{ page: 5, strokes: 2, signature: expect.any(String) }]);
  });

  it("applies live changes in order, ignores ones already seen and loads the page after a gap", async () => {
    const fake = fakeServer({ 1: ["a"] });
    const session = await open(fake);
    session.showAround(1);
    await settle();

    fake.remote(1, add("b")); // v2
    expect(ids(session.snapshot().pages[1])).toEqual(["a", "b"]);
    for (const l of fake.changeListeners) l(1, erase("a"), 2); // the same version again
    expect(ids(session.snapshot().pages[1])).toEqual(["a", "b"]);

    fake.remote(1, add("missed"), { quiet: true }); // v3, never heard of
    fake.remote(1, add("c")); // v4: a gap
    await settle();
    expect(ids(session.snapshot().pages[1])).toEqual(["a", "b", "missed", "c"]);
  });

  it("keeps this device's unsent strokes on top of a newer copy from the server", async () => {
    const fake = fakeServer({ 1: ["a", "b"] });
    const session = await open(fake);
    session.showAround(1);
    await settle();
    session.draw(1, add("mine"));
    session.draw(1, erase("a"));

    fake.remote(1, add("r")); // applies in order, under the unsent strokes
    expect(ids(session.snapshot().pages[1])).toEqual(["b", "r", "mine"]);
    fake.remote(1, add("missed"), { quiet: true });
    fake.remote(1, erase("b")); // a gap: the server's copy (a, r, missed) is loaded again
    await settle();
    expect(ids(session.snapshot().pages[1])).toEqual(["r", "missed", "mine"]);
    expect(fake.unsent).toHaveLength(2);
  });

  it("shows the server's page again and says so when a change is refused for good", async () => {
    const fake = fakeServer({ 4: ["a"] });
    const rejected: [number, number][] = [];
    const session = await open(fake, (page, status) => rejected.push([page, status]));
    session.showAround(4);
    await settle();
    session.draw(4, add("big"));
    expect(ids(session.snapshot().pages[4])).toEqual(["a", "big"]);

    fake.reject(4, 413);
    await settle();
    expect(rejected).toEqual([[4, 413]]);
    expect(ids(session.snapshot().pages[4])).toEqual(["a"]);
  });

  it("undoes and redoes this session's changes, keeping changes from other devices", async () => {
    const fake = fakeServer({ 1: ["a"] });
    const session = await open(fake);
    session.showAround(1);
    await settle();
    expect(session.undo()).toBeNull();

    session.draw(1, erase("a"));
    session.draw(1, add("x"));
    fake.deliver();
    fake.deliver();
    fake.remote(1, add("r")); // v4, after ours (v2, v3)
    expect(session.snapshot()).toMatchObject({ canUndo: true, canRedo: false });

    expect(session.undo()).toBe(1);
    expect(ids(session.snapshot().pages[1])).toEqual(["r"]);
    expect(session.undo()).toBe(1);
    expect(ids(session.snapshot().pages[1])).toEqual(["r", "a"]);
    expect(session.snapshot()).toMatchObject({ canUndo: false, canRedo: true });
    expect(session.redo()).toBe(1);
    expect(ids(session.snapshot().pages[1])).toEqual(["r"]);
    // Each step is sent like any change.
    expect(fake.unsent.map((c) => [ids(c.add), c.remove])).toEqual([
      [[], ["x"]],
      [["a"], []],
      [[], ["a"]],
    ]);
    // A new change clears what could be redone.
    session.draw(1, add("y"));
    expect(session.snapshot().canRedo).toBe(false);
  });

  it("keeps the offline copy in step, but writes nothing before the summary has loaded", async () => {
    const fake = fakeServer({ 1: ["a"] });
    fake.hold();
    const session = await open(fake);
    session.draw(3, add("early"));
    expect(fake.remembered).toEqual([]);

    await fake.release();
    expect(fake.remembered).toEqual([[3, ["early"], 0]]);

    session.showAround(1);
    await settle();
    expect(fake.remembered).toHaveLength(1); // a loaded page is already in the copy (the server's side keeps it)
    session.draw(1, erase("a"));
    expect(fake.remembered.at(-1)).toEqual([1, [], 1]);
  });

  it("stops listening when closed", async () => {
    const fake = fakeServer({ 1: ["a"] });
    const session = await open(fake);
    fake.hold();
    session.showAround(1);
    const listener = vi.fn();
    session.subscribe(listener);
    session.close();
    expect(fake.changeListeners.size).toBe(0);
    expect(fake.rejectListeners.size).toBe(0);

    await fake.release(); // a load on its way when the book closed
    session.draw(1, add("x"));
    expect(listener).not.toHaveBeenCalled();
    expect(session.snapshot().pages).toEqual({});
    expect(fake.unsent).toEqual([]);
  });
});
