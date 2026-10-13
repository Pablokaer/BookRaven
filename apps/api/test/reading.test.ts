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
