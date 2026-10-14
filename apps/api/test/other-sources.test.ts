import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { epubPackage, opfPeople, readZipEntry } from "../src/lib/epubInfo.js";
import {
  crossKey,
  importStandardEbooks,
  importWikisource,
  parseStandardEbooksFeed,
  wikisourceEligible,
  wikisourceWorks,
} from "../src/lib/otherSources.js";
import { api, signUp } from "./helpers.js";

/** A real ZIP (stored or deflated entries, with a central directory). */
function zip(entries: [string, string | Buffer, boolean?][]) {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content, deflate] of entries) {
    const raw = Buffer.from(content);
    const data = deflate ? deflateRawSync(raw) : raw;
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(deflate ? 8 : 0, 10);
    dir.writeUInt32LE(crc32(raw), 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(n.length, 28);
    dir.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    central.push(dir, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** An EPUB with this package document, padded to `size` bytes of text. */
function epub(opf: string, size = 1000) {
  return zip([
    ["mimetype", "application/epub+zip"],
    ["META-INF/container.xml", `<container><rootfiles><rootfile full-path="epub/content.opf"/></rootfiles></container>`, true],
    ["epub/content.opf", opf, true],
    ["epub/text.xhtml", `<p>${"x".repeat(size)}${Math.random()}</p>`], // stored: the file really is that big
  ]);
}

const OPF3 = (author: string, translator?: string) => `<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:language>en-GB</dc:language>
<dc:creator id="author">${author}</dc:creator>
<meta property="role" refines="#author" scheme="marc:relators">aut</meta>
<meta property="role" refines="#author" scheme="marc:relators">dto</meta>
${translator ? `<dc:contributor id="translator">${translator}</dc:contributor><meta property="role" refines="#translator" scheme="marc:relators">trl</meta>` : ""}
<dc:contributor id="designer">The League of Moveable Type</dc:contributor><meta property="role" refines="#designer" scheme="marc:relators">tyd</meta>
</metadata></package>`;

describe("EPUB package reading", () => {
  it("reads entries out of a ZIP and finds authors and translators", () => {
    const file = epub(OPF3("Henry Seton Merriman", "Aylmer Maude"));
    expect(readZipEntry(file, (n) => n === "mimetype")?.toString()).toBe("application/epub+zip");
    expect(opfPeople(epubPackage(file)!)).toEqual({ authors: ["Henry Seton Merriman"], translators: ["Aylmer Maude"], language: "en" });
    // EPUB 2 roles, and a creator without a role is the author.
    expect(
      opfPeople(`<dc:creator opf:role="aut">A &amp; B</dc:creator><dc:contributor opf:role="trl">T</dc:contributor><dc:creator>C</dc:creator>`),
    ).toEqual({ authors: ["A & B", "C"], translators: ["T"], language: null });
  });

  it("treats editions of a work as the same across sources", () => {
    expect(crossKey("Moby Dick; Or, The Whale", ["Melville, Herman"], "en")).toBe(crossKey("Moby Dick", ["Herman Melville"], "en"));
  });
});

const feedEntry = (slug: string, title: string, author: string) => `<entry>
  <id>https://standardebooks.org/ebooks/${slug}</id><title>${title}</title>
  <author><name>${author}</name><uri>https://standardebooks.org/ebooks/x</uri></author>
  <summary type="text">A story about ${title}.</summary>
  <category scheme="http://purl.org/dc/terms/LCSH" term="Russia--Fiction"/><category scheme="https://standardebooks.org/vocab/subjects" term="Fiction"/>
  <media:thumbnail url="https://standardebooks.org/ebooks/${slug}/downloads/cover-thumbnail.jpg"/>
  <link href="https://standardebooks.org/ebooks/${slug}/downloads/book.epub?source=feed" rel="enclosure" title="Recommended compatible epub" type="application/epub+zip"/>
  <link href="https://standardebooks.org/ebooks/${slug}/downloads/book_advanced.epub?source=feed" rel="enclosure" title="Advanced epub" type="application/epub+zip"/>
</entry>`;

describe("Standard Ebooks", () => {
  it("parses the feed", () => {
    const { entries, next } = parseStandardEbooksFeed(`<feed>${feedEntry("a/the-sowers", "The Sowers", "Henry Seton Merriman")}<link rel="next" href="https://x/2"/></feed>`);
    expect(next).toBe("https://x/2");
    expect(entries[0]).toMatchObject({
      id: "a/the-sowers",
      title: "The Sowers",
      authors: ["Henry Seton Merriman"],
      summary: "A story about The Sowers.",
      subjects: ["Russia--Fiction", "Fiction"],
      epub: "https://standardebooks.org/ebooks/a/the-sowers/downloads/book.epub?source=feed",
      cover: "https://standardebooks.org/ebooks/a/the-sowers/downloads/cover-thumbnail.jpg",
    });
  });

  it("imports editions whose authors and translators died long enough ago, once", async () => {
    const files: Record<string, Buffer> = {
      "se/old-one": epub(OPF3("Old Novelist")),
      "se/recent-translation": epub(OPF3("Old Novelist", "Recent Translator")),
      "se/unknown-person": epub(OPF3("Nobody Knows")),
    };
    const feed = `<feed>${feedEntry("se/old-one", "The Old One", "Old Novelist")}${feedEntry("se/recent-translation", "A Translation", "Old Novelist")}${feedEntry("se/unknown-person", "Mystery", "Nobody Knows")}</feed>`;
    const seen: { url: string; auth: string | null }[] = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
      if (url.includes("/feeds/")) return new Response(feed, { status: 200 });
      if (url.startsWith("https://query.wikidata.org/")) {
        // Only the translator is asked about: the author's death year is known beforehand.
        return Response.json({ results: { bindings: [{ name: { value: "Recent Translator" }, died: { value: "1980" } }] } });
      }
      const slug = /ebooks\/(.+)\/downloads\/book\.epub/.exec(url)?.[1];
      if (slug && files[slug]) return new Response(files[slug], { status: 200 });
      return new Response("no", { status: 404 });
    }) as typeof fetch;

    const deaths = new Map([["old novelist", 1903]]);
    const first = await importStandardEbooks({ limit: 10, fetch: fakeFetch, delayMs: 0, deaths, patronEmail: "patron@example.com" });
    expect(first).toMatchObject({ imported: 1, skipped: 2, failed: 0 });
    // The Patrons Circle email goes as the user name of the whole-catalog feed.
    expect(seen[0]!.url).toBe("https://standardebooks.org/feeds/opds/all");
    expect(seen[0]!.auth).toBe(`Basic ${Buffer.from("patron@example.com:").toString("base64")}`);

    const reader = await signUp();
    const book = (await api(reader, "GET", "/api/public")).json().find((b: { title: string }) => b.title === "The Old One");
    expect(book).toMatchObject({
      author: "Old Novelist",
      language: "en",
      description: "A story about The Old One.",
      source: { name: "Standard Ebooks", url: "https://standardebooks.org/ebooks/se/old-one" },
    });
    expect(book.themes).toContain("literature");

    const again = await importStandardEbooks({ limit: 10, fetch: fakeFetch, delayMs: 0, deaths });
    expect(again.imported).toBe(0);
    expect(again.duplicates).toBe(1);
  });
});

/** A SPARQL result row. */
const row = (v: Record<string, string>) => Object.fromEntries(Object.entries(v).map(([k, value]) => [k, { value }]));

describe("Wikisource", () => {
  it("reads Wikidata's answers and keeps public-domain works only", () => {
    const pages = new Map([
      ["Q1", "Dom Bonifácio"],
      ["Q2", "O Corvo (tradução de Exemplo)"],
      ["Q3", "Alice (tradução anônima)"],
      ["Q4", "Poemas Recentes"],
      ["Q5", "Tradução Recente"],
      ["Q6", "Crônicas"],
      ["Q7", "Écrits"],
    ]);
    const works = wikisourceWorks(
      [
        row({ item: "http://www.wikidata.org/entity/Q1", authors: "Autor Antigo|1908", languages: "pt", genres: "romance", links: "16" }),
        row({ item: "http://www.wikidata.org/entity/Q2", authors: "Edgar Allan Poe|1849", translators: "Tradutor Antigo|1908", languages: "en", links: "73" }),
        row({ item: "http://www.wikidata.org/entity/Q3", authors: "Lewis Carroll|1898", links: "124" }), // translator unknown
        row({ item: "http://www.wikidata.org/entity/Q4", authors: "Poeta|1990", languages: "pt", links: "5" }),
        row({ item: "http://www.wikidata.org/entity/Q5", authors: "Old|1800", translators: "Vivo|", languages: "fr", links: "9" }),
        // No language on the work: a Portuguese-writing author is enough, anyone else isn't.
        row({ item: "http://www.wikidata.org/entity/Q6", authors: "Cronista|1890", authorLanguages: "pt", links: "2" }),
        row({ item: "http://www.wikidata.org/entity/Q7", authors: "Writer|1890", authorLanguages: "pt;fr", links: "1" }),
      ],
      pages,
    );
    expect(works.map((w) => w.page)).toEqual(["Alice (tradução anônima)", "O Corvo (tradução de Exemplo)", "Dom Bonifácio", "Tradução Recente", "Poemas Recentes", "Crônicas", "Écrits"]);
    expect(works.find((w) => w.page.startsWith("O Corvo"))!.title).toBe("O Corvo");
    expect(works.filter((w) => wikisourceEligible(w, 1955)).map((w) => w.page)).toEqual(["O Corvo (tradução de Exemplo)", "Dom Bonifácio", "Crônicas"]);
  });

  it("imports eligible works as EPUBs, skipping texts too short to be books", async () => {
    const fakeFetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://query.wikidata.org/")) {
        const q = decodeURIComponent(url);
        if (q.includes("wd:Q7725634 .")) {
          return Response.json({
            results: {
              bindings: [
                row({ item: "http://www.wikidata.org/entity/Q10", page: "Lendas do Mar Antigo" }),
                row({ item: "http://www.wikidata.org/entity/Q11", page: "Hino Curto" }),
                row({ item: "http://www.wikidata.org/entity/Q12", page: "Lendas do Mar Antigo/Capítulo I" }), // a chapter
              ],
            },
          });
        }
        if (q.includes("VALUES ?item")) {
          return Response.json({
            results: {
              bindings: [
                row({ item: "http://www.wikidata.org/entity/Q10", authors: "Autora Antiga|1900", languages: "pt", genres: "contos", links: "9" }),
                row({ item: "http://www.wikidata.org/entity/Q11", authors: "Autora Antiga|1900", languages: "pt", genres: "poesia", links: "3" }),
              ],
            },
          });
        }
        return Response.json({ results: { bindings: [] } });
      }
      const page = new URL(url).searchParams.get("page");
      if (page === "Lendas do Mar Antigo") return new Response(epub(OPF3("Autora Antiga"), 50_000), { status: 200 });
      if (page === "Hino Curto") return new Response(epub(OPF3("Autora Antiga"), 500), { status: 200 });
      return new Response("no", { status: 404 });
    }) as typeof fetch;

    const summary = await importWikisource({ limit: 10, fetch: fakeFetch, delayMs: 0 });
    expect(summary).toMatchObject({ imported: 1, skipped: 1, failed: 0 });
    const reader = await signUp();
    const book = (await api(reader, "GET", "/api/public")).json().find((b: { title: string }) => b.title === "Lendas do Mar Antigo");
    expect(book).toMatchObject({
      author: "Autora Antiga",
      language: "pt",
      source: { name: "Wikisource", url: "https://pt.wikisource.org/wiki/Lendas_do_Mar_Antigo" },
      popularity: 9,
    });
    expect(book.themes).toContain("literature"); // "contos"
  });
});
