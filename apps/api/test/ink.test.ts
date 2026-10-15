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

describe("handwritten PDF annotations", () => {
  it("adds and erases strokes per page, merges changes from several devices and lists annotated pages", async () => {
    const u = await signUp();
    const book = (await upload(u, "i.pdf", fakePdf())).json();
    const url = (page: number) => `/api/books/${book.id}/ink/${page}`;

    let res = await api(u, "POST", url(3), { add: [stroke("a"), stroke("b", { tool: "highlighter", color: "#facc15", width: 0.02 })] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ page: 3, strokes: [{ id: "a", color: "#1d4ed8" }, { id: "b", tool: "highlighter" }] });

    // Another device, unaware of "b", adds "c" and erases "a": both changes survive.
    res = await api(u, "POST", url(3), { add: [stroke("c")], remove: ["a"] });
    expect(res.json().strokes.map((s: { id: string }) => s.id)).toEqual(["b", "c"]);
    // Replaying the same change is harmless.
    res = await api(u, "POST", url(3), { add: [stroke("c")], remove: ["a"] });
    expect(res.json().strokes.map((s: { id: string }) => s.id)).toEqual(["b", "c"]);

    await api(u, "POST", url(1), { add: [stroke("d")] });
    const pages = (await api(u, "GET", `/api/books/${book.id}/ink`)).json();
    expect(pages.map((p: { page: number; strokes: unknown[] }) => [p.page, p.strokes.length])).toEqual([
      [1, 1],
      [3, 2],
    ]);

    // Erasing everything on a page removes the page.
    res = await api(u, "POST", url(1), { remove: ["d"] });
    expect(res.json().strokes).toEqual([]);
    expect((await api(u, "GET", `/api/books/${book.id}/ink`)).json().map((p: { page: number }) => p.page)).toEqual([3]);
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
    expect((await api(other, "GET", `/api/books/${book.id}/ink`)).statusCode).toBe(404);
    expect((await api(null, "GET", `/api/books/${book.id}/ink`)).statusCode).toBe(401);
  });
});
