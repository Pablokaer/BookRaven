import { describe, expect, it } from "vitest";
import { api, fakePdf, signUp, upload } from "./helpers.js";

describe("bookmarks", () => {
  it("saves a page once, keeps or clears its title, lists in book order and removes by page", async () => {
    const u = await signUp();
    const book = (await upload(u, "b.pdf", fakePdf())).json();
    const url = `/api/books/${book.id}/bookmarks`;

    const late = (await api(u, "PUT", url, { locator: "page:40", percentage: 0.8, label: "Page 40 of 50", title: "  Formula  " })).json();
    expect(late).toMatchObject({ bookId: book.id, locator: "page:40", label: "Page 40 of 50", title: "Formula" });
    await api(u, "PUT", url, { locator: "page:3", percentage: 0.04, label: "Page 3 of 50" });

    // Same page again (another device, or an offline queue replayed): updated, not duplicated.
    const again = (await api(u, "PUT", url, { locator: "page:40", percentage: 0.8 })).json();
    expect(again).toMatchObject({ id: late.id, title: "Formula", label: "Page 40 of 50" });
    expect((await api(u, "PUT", url, { locator: "page:40", percentage: 0.8, title: null })).json().title).toBeNull();

    const list = (await api(u, "GET", url)).json();
    expect(list.map((b: { locator: string }) => b.locator)).toEqual(["page:3", "page:40"]);

    const cfi = "epubcfi(/6/4!/4/2/1:0)";
    await api(u, "PUT", url, { locator: cfi, percentage: 0.5 });
    expect((await api(u, "DELETE", `${url}?locator=${encodeURIComponent(cfi)}`)).statusCode).toBe(204);
    expect((await api(u, "DELETE", `${url}?locator=page:3`)).statusCode).toBe(204);
    // Already gone: still fine (offline queues may repeat it).
    expect((await api(u, "DELETE", `${url}?locator=page:3`)).statusCode).toBe(204);
    expect((await api(u, "GET", url)).json().map((b: { locator: string }) => b.locator)).toEqual(["page:40"]);
  });

  it("validates input and keeps other people out", async () => {
    const u = await signUp();
    const book = (await upload(u, "c.pdf", fakePdf())).json();
    const url = `/api/books/${book.id}/bookmarks`;
    expect((await api(u, "PUT", url, { locator: "", percentage: 0 })).statusCode).toBe(400);
    expect((await api(u, "PUT", url, { locator: "page:1", percentage: 2 })).statusCode).toBe(400);
    expect((await api(u, "DELETE", url)).statusCode).toBe(400);

    const other = await signUp();
    expect((await api(other, "GET", url)).statusCode).toBe(404);
    expect((await api(other, "PUT", url, { locator: "page:1", percentage: 0 })).statusCode).toBe(404);
    expect((await api(null, "GET", url)).statusCode).toBe(401);
  });
});
