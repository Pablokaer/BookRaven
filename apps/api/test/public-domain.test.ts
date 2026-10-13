import { describe, expect, it } from "vitest";
import { importPublicDomain } from "../src/lib/gutenbergImport.js";
import { deathYearCutoff, displayName, isPublicDomainEverywhere, tagsFrom, type GutendexBook } from "../src/lib/publicDomain.js";
import { themesFor } from "../src/lib/themes.js";
import { api, signUp } from "./helpers.js";

const person = (name: string, death: number | null) => ({ name, birth_year: null, death_year: death });

function book(id: number, over: Partial<GutendexBook> = {}): GutendexBook {
  return {
    id,
    title: `Book ${id}`,
    authors: [person("Assis, Machado de", 1908)],
    translators: [],
    subjects: ["Fiction"],
    bookshelves: ["Category: Novels", "Best Books Ever Listings"],
    languages: ["pt"],
    copyright: false,
    media_type: "Text",
    formats: { "application/epub+zip": `https://example.test/${id}.epub`, "image/jpeg": `https://example.test/${id}.jpg` },
    download_count: 1000 - id,
    ...over,
  };
}

/** A tiny file the server accepts as EPUB: a ZIP whose first entry is the "mimetype" file. */
function fakeEpub(id: number) {
  const name = Buffer.from("mimetype");
  const body = Buffer.from("application/epub+zip");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(name.length, 26);
  return Buffer.concat([header, name, body, Buffer.from(`unique content ${id} ${Math.random()}`)]);
}

describe("public-domain rules", () => {
  it("requires every author and translator to have died more than 70 years ago", () => {
    const cutoff = deathYearCutoff(2026); // 1955
    expect(isPublicDomainEverywhere(book(1), cutoff)).toBe(true);
    expect(isPublicDomainEverywhere(book(2, { authors: [person("Recent", 1960)] }), cutoff)).toBe(false);
    expect(isPublicDomainEverywhere(book(3, { translators: [person("Translator", 1980)] }), cutoff)).toBe(false);
    expect(isPublicDomainEverywhere(book(4, { authors: [] }), cutoff)).toBe(false); // unknown author
    expect(isPublicDomainEverywhere(book(5, { authors: [person("No dates", null)] }), cutoff)).toBe(false);
    expect(isPublicDomainEverywhere(book(6, { copyright: true }), cutoff)).toBe(false);
    expect(isPublicDomainEverywhere(book(7, { media_type: "Sound" }), cutoff)).toBe(false);
  });

  it("formats names and tags", () => {
    expect(displayName("Assis, Machado de")).toBe("Machado de Assis");
    expect(displayName("Camões, Luís de")).toBe("Luís de Camões");
    expect(displayName("Homer")).toBe("Homer");
    expect(displayName("Twain, Mark (Samuel Clemens)")).toBe("Mark Twain");
    expect(tagsFrom(book(1))).toEqual(["Novels"]);
  });

  it("classifies books into library sections", () => {
    expect(themesFor(["Philosophy, Ancient", "Ethics"], [])).toEqual(["philosophy"]);
    expect(themesFor(["Political science"], ["Category: Politics"])).toContain("politics");
    expect(themesFor(["Economics"], [])).toEqual(["economics"]);
    expect(themesFor(["Electronic digital computers -- History"], [])).toEqual(expect.arrayContaining(["computing", "history"]));
    expect(themesFor(["Engineering -- Juvenile literature"], [])).toEqual(expect.arrayContaining(["technology", "children"]));
    expect(themesFor(["Love stories", "Domestic fiction"], [])).toEqual(["literature"]);
  });
});

describe("Gutenberg import", () => {
  it("imports eligible books into the public library, once", async () => {
    const catalog = [
      book(101, { title: "Dom Casmurro" }),
      book(102, { authors: [person("Too recent", 1990)] }),
      book(103, { title: "Memórias Póstumas" }),
      book(104, { title: "O Capital", subjects: ["Economics", "Capital"], bookshelves: ["Category: Economics"] }),
    ];
    const files = new Map(catalog.map((b) => [b.id, fakeEpub(b.id)]));
    const requested: string[] = [];
    const fakeFetch = (async (input: string | URL | Request) => {
      const url = String(input);
      requested.push(url);
      if (url.startsWith("https://gutendex.com/")) return new Response(JSON.stringify({ next: null, results: catalog }), { status: 200 });
      const epub = /\/pg(\d+)-images-3\.epub$/.exec(url);
      if (epub) return new Response(files.get(Number(epub[1]))!, { status: 200 });
      return new Response("not found", { status: 404 }); // no covers
    }) as typeof fetch;

    const plan = [{ theme: "economics" as const, topic: "econom", quota: { pt: 1 } }];
    const first = await importPublicDomain({ languages: ["pt"], perLanguage: 5, plan, fetch: fakeFetch, delayMs: 0 });
    expect(first).toMatchObject({ imported: 3, failed: 0 });
    expect(requested.some((u) => u.includes("topic=econom"))).toBe(true);
    expect(requested.some((u) => u.includes("languages=pt") && u.includes("copyright=false"))).toBe(true);

    const reader = await signUp();
    const list = (await api(reader, "GET", "/api/public")).json() as {
      title: string;
      author: string;
      language: string;
      source: { url: string } | null;
      publishedBy: string;
      themes: string[];
      popularity: number | null;
    }[];
    const dom = list.find((b) => b.title === "Dom Casmurro")!;
    expect(dom).toMatchObject({ author: "Machado de Assis", language: "pt", publishedBy: "Mico-livrão Library", source: { url: "https://www.gutenberg.org/ebooks/101" } });
    expect(list.some((b) => b.title === "Book 102")).toBe(false);
    expect(dom.themes).toContain("literature"); // from "Category: Novels"
    expect(dom.popularity).toBe(899);
    // Found by the themed search first, and classified by its subjects too.
    expect(list.find((b) => b.title === "O Capital")!.themes).toContain("economics");

    // Running it again adds nothing.
    const again = await importPublicDomain({ languages: ["pt"], perLanguage: 5, plan, fetch: fakeFetch, delayMs: 0 });
    expect(again.imported).toBe(0);

    // The system account cannot sign in.
    expect((await api(null, "POST", "/api/auth/sign-in/email", { email: "library@readsync.local", password: "anything123" })).statusCode).toBe(401);
  });
});
