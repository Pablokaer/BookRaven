import { describe, expect, it } from "vitest";
import { parseWiktionary } from "../src/lib/lookup.js";
import { api, fakePdf, signUp, upload } from "./helpers.js";

describe("highlights with notes", () => {
  it("creates, edits and clears notes", async () => {
    const u = await signUp();
    const book = (await upload(u, "n.pdf", fakePdf())).json();
    const h = (await api(u, "POST", `/api/books/${book.id}/highlights`, { cfi: "pdf:3:10-42", text: "a passage", color: "yellow", note: "  my thought " })).json();
    expect(h).toMatchObject({ cfi: "pdf:3:10-42", note: "my thought", color: "yellow" });

    expect((await api(u, "PATCH", `/api/highlights/${h.id}`, { note: "changed" })).json()).toMatchObject({ note: "changed", color: "yellow" });
    expect((await api(u, "PATCH", `/api/highlights/${h.id}`, { color: "blue" })).json()).toMatchObject({ note: "changed", color: "blue" });
    expect((await api(u, "PATCH", `/api/highlights/${h.id}`, { note: "" })).json().note).toBeNull();
    expect((await api(u, "PATCH", `/api/highlights/${h.id}`, {})).statusCode).toBe(400);

    const other = await signUp();
    expect((await api(other, "PATCH", `/api/highlights/${h.id}`, { note: "x" })).statusCode).toBe(404);
  });
});

describe("dictionary parsing", () => {
  const sample = {
    en: [{ partOfSpeech: "Noun", language: "English", definitions: [{ definition: 'A feeling of <a href="/wiki/x">melancholy</a> &amp; longing.' }] }],
    pt: [
      { partOfSpeech: "Noun", language: "Portuguese", definitions: [{ definition: "<i>longing</i>, yearning" }, { definition: "" }] },
    ],
  };
  it("uses the book's language and strips markup", () => {
    expect(parseWiktionary("saudade", sample, "pt-BR")).toMatchObject({
      language: "Portuguese",
      entries: [{ partOfSpeech: "Noun", definitions: ["longing, yearning"] }],
    });
    expect(parseWiktionary("saudade", sample, "de")?.entries[0]!.definitions[0]).toBe("A feeling of melancholy & longing.");
    expect(parseWiktionary("x", {}, "en")).toBeNull();
  });

  it("validates lookup input", async () => {
    const u = await signUp();
    expect((await api(u, "GET", "/api/dictionary?word=%20%21%21")).statusCode).toBe(400);
    expect((await api(u, "POST", "/api/translate", { text: "hi", to: "not a language" })).statusCode).toBe(400);
    expect((await api(null, "GET", "/api/dictionary?word=book")).statusCode).toBe(401);
  });
});

describe("reading stats", () => {
  it("records time between page turns, breaks, finished books, and keeps history of deleted books", async () => {
    const u = await signUp();
    const book = (await upload(u, "s.pdf", fakePdf())).json();
    const t0 = Date.parse("2026-03-10T20:05:00Z");
    const save = (locator: string, percentage: number, at: number) =>
      api(u, "PUT", `/api/books/${book.id}/progress`, { locator, percentage, deviceId: "d1", clientUpdatedAt: at });

    await save("page:1", 0.1, t0); // first position: a reading day, no time yet
    await save("page:2", 0.2, t0 + 90_000); // 90 s on page 1
    await save("page:2", 0.2, t0 + 100_000); // same page again: nothing
    await save("page:3", 0.3, t0 + 100_000 + 20 * 60_000); // after a 20-minute break: no time
    await save("page:9", 0.99, t0 + 100_000 + 21 * 60_000); // 60 s more, and finished
    await save("page:0", 0.5, t0 - 60_000); // older than what is stored: ignored

    const stats = (await api(u, "GET", "/api/stats")).json();
    const mine = stats.activity.filter((a: { bookId: string }) => a.bookId === book.id);
    // 20:05 and 20:06:30 fall in the 20:00 hour; the rest after 20:25 too.
    expect(mine).toEqual([{ hour: "2026-03-10T20:00:00.000Z", bookId: book.id, seconds: 150, finished: true }]);

    await api(u, "DELETE", `/api/books/${book.id}`);
    const after = (await api(u, "GET", "/api/stats")).json().activity;
    expect(after).toEqual([{ hour: "2026-03-10T20:00:00.000Z", bookId: null, seconds: 150, finished: true }]);

    const other = await signUp();
    expect((await api(other, "GET", "/api/stats")).json().activity).toEqual([]);
  });
});
