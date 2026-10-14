import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { importPublicDomain } from "../src/lib/gutenbergImport.js";
import {
  catalogEntries,
  cleanTitle,
  deathYearCutoff,
  displayName,
  fragmentOf,
  isPublicDomainEverywhere,
  tagsFrom,
  workKey,
  writtenInEnglish,
  type GutendexBook,
} from "../src/lib/publicDomain.js";
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
    expect(cleanTitle("Peter Pan : $b [Peter and Wendy]")).toBe("Peter Pan: [Peter and Wendy]");
    expect(cleanTitle("The book of wonders : $b gives plain answers")).toBe("The book of wonders: gives plain answers");
    expect(cleanTitle("Plain  title ")).toBe("Plain title");
  });

  it("recognises other editions of the same work", () => {
    const austen = [person("Austen, Jane", 1817)];
    expect(workKey("Pride and Prejudice", austen, "en")).toBe(workKey("PRIDE AND PREJUDICE.", austen, "en"));
    expect(workKey("Moby Dick; Or, The Whale", [person("Melville, Herman", 1891)], "en")).toBe(
      workKey("Moby Dick", [person("Melville, Herman", 1891)], "en"),
    );
    expect(workKey("Os Lusíadas", [person("Camões, Luís de", 1580)], "pt")).toBe(workKey("Os Lusiadas", [person("Camoes, Luis de", 1580)], "pt"));
    // Different subtitle, author or language: different works.
    const emerson = [person("Emerson, Ralph Waldo", 1882)];
    expect(workKey("Essays: First Series", emerson, "en")).not.toBe(workKey("Essays: Second Series", emerson, "en"));
    expect(workKey("Poems", austen, "en")).not.toBe(workKey("Poems", emerson, "en"));
    expect(workKey("Poems", austen, "en")).not.toBe(workKey("Poems", austen, "pt"));
  });

  it("recognises pieces of books", () => {
    expect(fragmentOf("Adventures of Huckleberry Finn, Chapters 06 to 10")).toEqual({ whole: "Adventures of Huckleberry Finn" });
    expect(fragmentOf("The Adventures of Tom Sawyer, Part 3.")).toEqual({ whole: "The Adventures of Tom Sawyer" });
    expect(fragmentOf("Oliver Twist, Vol. 1 (of 3)")).toEqual({ whole: "Oliver Twist" });
    expect(fragmentOf("Rob Roy — Volume 01")).toEqual({ whole: "Rob Roy" });
    expect(fragmentOf("Le Morte d'Arthur: Volume 2")).toEqual({ whole: "Le Morte d'Arthur" });
    expect(fragmentOf("Index of the Project Gutenberg Works of Lord Byron")).toBe("index");
    // Whole works.
    expect(fragmentOf("King Henry IV, Part 1")).toBeNull();
    expect(fragmentOf("Adventures of Huckleberry Finn")).toBeNull();
    expect(fragmentOf("Twenty Thousand Leagues under the Sea")).toBeNull();
  });

  it("tells books written in English from translations", () => {
    const base = { languages: ["en"], translators: [], bookshelves: ["Category: Classics of Literature", "Category: British Literature"] };
    expect(writtenInEnglish(base)).toBe(true);
    expect(writtenInEnglish({ ...base, bookshelves: ["Category: Classics of Literature", "Category: Russian Literature"] })).toBe(false);
    expect(writtenInEnglish({ ...base, translators: [person("Garnett, Constance", 1946)] })).toBe(false);
  });

  it("reads Gutenberg's catalog file", () => {
    const csv = [
      "Text#,Type,Issued,Title,Language,Authors,Subjects,LoCC,Bookshelves",
      '1342,Text,1998-06-01,Pride and Prejudice,en,"Austen, Jane, 1775-1817","Courtship -- Fiction; England -- Fiction",PR,"Best Books Ever Listings; Category: British Literature; Category: Classics of Literature"',
      '2554,Text,2006-03-28,"Crime and Punishment\nA Novel",en,"Dostoyevsky, Fyodor, 1821-1881; Garnett, Constance, 1861-1946 [Translator]; Somebody, 1900- [Editor]",Murder -- Fiction,PG,"Category: Classics of Literature; Category: Russian Literature"',
      "9999,Sound,2006-03-28,An audio book,en,,,,",
      "1,Text,1971-12-01,Homer's Hymns,en,\"Homer, 751? BCE-651? BCE\",,,",
      "",
    ].join("\r\n");
    const entries = catalogEntries(csv);
    expect(entries.map((e) => e.id)).toEqual([1342, 2554, 1]);
    expect(entries[0]).toMatchObject({
      title: "Pride and Prejudice",
      languages: ["en"],
      authors: [{ name: "Austen, Jane", birth_year: 1775, death_year: 1817 }],
      translators: [],
      bookshelves: ["Best Books Ever Listings", "Category: British Literature", "Category: Classics of Literature"],
    });
    // Line breaks in titles, translators, ignored roles, BCE years.
    expect(entries[1]).toMatchObject({
      title: "Crime and Punishment: A Novel",
      authors: [{ name: "Dostoyevsky, Fyodor", death_year: 1881 }],
      translators: [{ name: "Garnett, Constance", death_year: 1946 }],
    });
    expect(entries[2]!.authors).toEqual([{ name: "Homer", birth_year: -751, death_year: -651 }]);
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
      book(105, { title: "Dom Casmurro" }), // another edition of 101
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
    expect(first).toMatchObject({ imported: 3, duplicates: 1, failed: 0 });
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
    expect(dom).toMatchObject({ author: "Machado de Assis", language: "pt", publishedBy: "BookRaven Library", source: { url: "https://www.gutenberg.org/ebooks/101" } });
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

  it("picks themed candidates from Gutenberg's catalog file and looks up only those", async () => {
    const english = { languages: ["en"], bookshelves: ["Category: Classics of Literature", "Category: American Literature"] };
    const catalog = [
      book(201, { ...english, title: "Classic A", authors: [person("Writer, A", 1900)], download_count: 10 }),
      book(202, { ...english, title: "Classic B", authors: [person("Writer, B", 1900)], download_count: 500 }),
      book(203, { ...english, title: "Classic C", authors: [person("Writer, C", 1900)], download_count: 50 }),
    ];
    const row = (b: GutendexBook) =>
      `${b.id},Text,2000-01-01,${b.title},en,"${b.authors[0]!.name}, 1850-1900",Fiction,PS,"${b.bookshelves.join("; ")}"`;
    const csv = [
      "Text#,Type,Issued,Title,Language,Authors,Subjects,LoCC,Bookshelves",
      ...catalog.map(row),
      `204,Text,2000-01-01,Too Recent,en,"Writer, D, 1900-1990",Fiction,PS,"${english.bookshelves.join("; ")}"`,
      `205,Text,2000-01-01,Not a classic,en,"Writer, E, 1850-1900",Fiction,PS,"Category: Novels"`,
    ].join("\n");
    const requested: string[] = [];
    const fakeFetch = (async (input: string | URL | Request) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("pg_catalog.csv.gz")) return new Response(gzipSync(Buffer.from(csv)), { status: 200 });
      const ids = /[?&]ids=([\d,]+)/.exec(url);
      if (ids) {
        const wanted = ids[1]!.split(",").map(Number);
        return new Response(JSON.stringify({ next: null, results: catalog.filter((b) => wanted.includes(b.id)) }), { status: 200 });
      }
      if (url.startsWith("https://gutendex.com/")) return new Response(JSON.stringify({ next: null, results: [] }), { status: 200 });
      const epub = /\/pg(\d+)-images-3\.epub$/.exec(url);
      if (epub) return new Response(fakeEpub(Number(epub[1])), { status: 200 });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    // The step's quota counts English literature already in the library.
    const before = (await api(await signUp(), "GET", "/api/public"))
      .json()
      .filter((b: { language: string; themes: string[] }) => b.language === "en" && b.themes.includes("literature")).length;
    const plan = [{ theme: "literature" as const, topic: "Classics of Literature", quota: { en: before + 2 } }];
    const result = await importPublicDomain({ languages: ["en"], perLanguage: 1, plan, fetch: fakeFetch, delayMs: 0 });
    expect(result).toMatchObject({ imported: 2, failed: 0 });
    // Only the qualifying entries were looked up, in one request; no topic search was paged through.
    expect(requested.filter((u) => u.includes("ids="))).toEqual(["https://gutendex.com/books/?ids=201,202,203"]);
    expect(requested.some((u) => u.includes("topic="))).toBe(false);
    // Most downloaded first: B and C, not A.
    const titles = (await api(await signUp(), "GET", "/api/public")).json().map((b: { title: string }) => b.title);
    expect(titles).toEqual(expect.arrayContaining(["Classic B", "Classic C"]));
    expect(titles).not.toContain("Classic A");
  });
});
