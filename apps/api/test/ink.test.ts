import { describe, expect, it } from "vitest";
import { api, fakePdf, signUp, upload } from "./helpers.js";

const stroke = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  tool: "pen",
  color: "#1D4ED8",
  width: 0.004,
  points: [0.1, 0.2, 0.5, 0.15, 0.25, 0.6, 0.2, 0.3, 0.7],
  ...extra,
});

const ids = (strokes: { id: string }[]) => strokes.map((s) => s.id);

describe("handwritten PDF annotations", () => {
  it("adds and erases strokes per page, merges changes from several devices and versions every change", async () => {
    const u = await signUp();
    const book = (await upload(u, "i.pdf", fakePdf())).json();
    const url = (page: number) => `/api/books/${book.id}/ink/${page}`;

    let res = await api(u, "POST", url(3), { add: [stroke("a"), stroke("b", { tool: "highlighter", color: "#facc15", width: 0.02 })] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ page: 3, version: 1 });
    expect((await api(u, "GET", url(3))).json()).toMatchObject({ version: 1, strokes: [{ id: "a", color: "#1d4ed8" }, { id: "b", tool: "highlighter" }] });

    // Another device, unaware of "b", adds "c" and erases "a": both changes survive.
    expect((await api(u, "POST", url(3), { add: [stroke("c")], remove: ["a"] })).json().version).toBe(2);
    expect(ids((await api(u, "GET", url(3))).json().strokes)).toEqual(["b", "c"]);
    // Replaying the same change is harmless (it still counts as a change).
    expect((await api(u, "POST", url(3), { add: [stroke("c")], remove: ["a"] })).json().version).toBe(3);
    expect(ids((await api(u, "GET", url(3))).json().strokes)).toEqual(["b", "c"]);

    // Re-adding a stroke puts it on top; a batch erasing and adding the same id ends with the stroke.
    await api(u, "POST", url(3), { add: [stroke("b", { color: "#dc2626" })] });
    await api(u, "POST", url(3), { add: [stroke("d")], remove: ["d", "c"] });
    expect((await api(u, "GET", url(3))).json().strokes.map((s: { id: string; color: string }) => [s.id, s.color])).toEqual([
      ["b", "#dc2626"],
      ["d", "#1d4ed8"],
    ]);

    // Erasing everything keeps the page's version, so devices still see the change in order.
    await api(u, "POST", url(1), { add: [stroke("e")] });
    expect((await api(u, "POST", url(1), { remove: ["e"] })).json().version).toBe(2);
    const pages = (await api(u, "GET", `/api/books/${book.id}/ink`)).json();
    expect(pages.map((p: { page: number; version: number; strokes: unknown[] }) => [p.page, p.version, p.strokes.length])).toEqual([
      [1, 2, 0],
      [3, 5, 2],
    ]);
    // A page never written on.
    expect((await api(u, "GET", url(9))).json()).toMatchObject({ page: 9, version: 0, strokes: [] });
  });

  it("lists a summary of the pages (no strokes) and only the pages asked for", async () => {
    const u = await signUp();
    const book = (await upload(u, "s.pdf", fakePdf())).json();
    const ink = `/api/books/${book.id}/ink`;
    await api(u, "POST", `${ink}/2`, { add: [stroke("a"), stroke("b")] });
    await api(u, "POST", `${ink}/7`, { add: [stroke("c")] });
    await api(u, "POST", `${ink}/7`, { remove: ["c"] });
    await api(u, "POST", `${ink}/9`, { add: [stroke("d")] });

    const summary = (await api(u, "GET", `${ink}?summary=1`)).json();
    expect(summary.map((p: { page: number; version: number; count: number; strokes?: unknown }) => [p.page, p.version, p.count, p.strokes])).toEqual([
      [2, 1, 2, undefined],
      [7, 2, 0, undefined],
      [9, 1, 1, undefined],
    ]);
    const some = (await api(u, "GET", `${ink}?pages=9,2,4`)).json();
    expect(some.map((p: { page: number; strokes: { id: string }[] }) => [p.page, ids(p.strokes)])).toEqual([
      [2, ["a", "b"]],
      [9, ["d"]],
    ]);
    expect((await api(u, "GET", `${ink}?pages=0`)).statusCode).toBe(400);
    expect((await api(u, "GET", `${ink}?pages=1,x`)).statusCode).toBe(400);
  });

  it("refuses a change that would overfill the page, leaving it as it was", async () => {
    const u = await signUp();
    const book = (await upload(u, "k.pdf", fakePdf())).json();
    const url = `/api/books/${book.id}/ink/1`;
    // About 63 kB stored per stroke, 630 kB per request: the page passes 2 MB on the 4th request.
    const long = (id: string) => stroke(id, { points: Array.from({ length: 9000 }, (_, i) => (i % 3 === 2 ? 0.5 : 0.1234)) });
    const statuses: number[] = [];
    for (let r = 0; r < 4; r++) {
      statuses.push((await api(u, "POST", url, { add: Array.from({ length: 10 }, (_, i) => long(`s${r * 10 + i}`)) })).statusCode);
    }
    expect(statuses).toEqual([200, 200, 200, 413]);
    const page = (await api(u, "GET", url)).json();
    expect(page.strokes.length).toBe(30);
    expect(page.version).toBe(3);
  });

  it("validates strokes and keeps other people out", async () => {
    const u = await signUp();
    const book = (await upload(u, "j.pdf", fakePdf())).json();
    const url = `/api/books/${book.id}/ink/2`;
    expect((await api(u, "POST", url, { add: [stroke("x", { color: "blue" })] })).statusCode).toBe(400);
    expect((await api(u, "POST", url, { add: [stroke("x", { points: [0.1, 0.2, 0.5, 0.3] })] })).statusCode).toBe(400);
    expect((await api(u, "POST", url, { add: [stroke("x", { tool: "laser" })] })).statusCode).toBe(400);
    expect((await api(u, "POST", `/api/books/${book.id}/ink/0`, { add: [stroke("x")] })).statusCode).toBe(400);

    const other = await signUp();
    expect((await api(other, "POST", url, { add: [stroke("x")] })).statusCode).toBe(404);
    expect((await api(other, "GET", url)).statusCode).toBe(404);
    expect((await api(other, "GET", `/api/books/${book.id}/ink`)).statusCode).toBe(404);
    expect((await api(null, "GET", `/api/books/${book.id}/ink`)).statusCode).toBe(401);
  });
});
