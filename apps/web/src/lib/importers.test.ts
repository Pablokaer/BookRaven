import { describe, expect, it } from "vitest";
import type { Book, PublicBook } from "./api";
import { authorKeys, matchGoodreads, parseGoodreads, parseOpf, readCalibreFolder, sameBook, titleKey } from "./importers";

describe("matching", () => {
  it("reduces titles to the work", () => {
    expect(titleKey("The Hobbit, or There and Back Again")).toBe("hobbit or there and back again");
    expect(titleKey("Mort (Discworld, #4)")).toBe("mort");
    expect(titleKey("Dom Casmurro: romance")).toBe("dom casmurro");
    expect(titleKey("Moby Dick; Or, The Whale")).toBe("moby dick");
  });

  it("reads author lists in either name order", () => {
    expect(authorKeys("Assis, Machado de")).toEqual(["machado de assis"]);
    expect(authorKeys("Karl Marx & Friedrich Engels")).toEqual(["karl marx", "friedrich engels"]);
    expect(authorKeys("Eça de Queirós")).toEqual(["eca de queiros"]);
  });

  it("matches the same book across sources", () => {
    expect(sameBook({ title: "Dom Casmurro", author: "Machado de Assis" }, { title: "Dom Casmurro", author: "Assis, Machado de" })).toBe(true);
    expect(sameBook({ title: "The Hobbit", author: "J.R.R. Tolkien" }, { title: "The Hobbit", author: "John Ronald Reuel Tolkien" })).toBe(true);
    expect(sameBook({ title: "Emma", author: "Jane Austen" }, { title: "Emma", author: "Someone Else" })).toBe(false);
    expect(sameBook({ title: "Emma", author: null }, { title: "Emma", author: "Jane Austen" })).toBe(true);
  });
});

const CSV = `﻿Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies
1,Dom Casmurro,Machado de Assis,"Assis, Machado de",,"=""8535908005""","=""9788535908008""",5,4.1,X,Paperback,256,1998,1899,2024/05/17,2024/01/02,"classics, favorites","classics (#1), favorites (#2)",read,"Great, really ""great"".",,,1,0
2,"Moby-Dick; or, The Whale",Herman Melville,"Melville, Herman",,,,0,3.5,Y,Paperback,600,2001,1851,,2024/02/01,,,to-read,,,,0,0
3,Unknown Book,Nobody,"Nobody",,,,3,3.0,Z,Ebook,100,2020,2020,,2024/03/01,,,currently-reading,,,,0,0
`;

describe("Goodreads", () => {
  it("parses the export", () => {
    const books = parseGoodreads(CSV);
    expect(books).toHaveLength(3);
    expect(books[0]).toEqual({
      title: "Dom Casmurro",
      author: "Machado de Assis",
      isbn: "9788535908008",
      rating: 5,
      shelf: "read",
      shelves: ["classics", "favorites"],
      dateRead: new Date(2024, 4, 17, 12),
    });
    expect(books[1]).toMatchObject({ title: "Moby-Dick; or, The Whale", shelf: "to-read", rating: 0, dateRead: null, isbn: null });
    expect(() => parseGoodreads("a,b\n1,2")).toThrow("not_goodreads");
  });

  it("finds each book in the library or the public library", () => {
    const library = [{ id: "b1", title: "Dom Casmurro", author: "Machado de Assis" }] as Book[];
    const pub = [
      { id: "p1", title: "Moby Dick", author: "Herman Melville", popularity: 10 },
      { id: "p2", title: "Moby Dick; Or, The Whale", author: "Herman Melville", popularity: 900 },
      { id: "p3", title: "Dom Casmurro", author: "Machado de Assis", popularity: 5 },
    ] as PublicBook[];
    const m = matchGoodreads(parseGoodreads(CSV), library, pub);
    expect(m.map((x) => [x.own?.id ?? null, x.pub?.id ?? null])).toEqual([
      ["b1", null], // already in the library: not offered from the public one
      [null, "p2"], // most popular edition
      [null, null],
    ]);
  });
});

const OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
<dc:title>Guards! Guards!</dc:title><dc:creator opf:role="aut">Terry Pratchett</dc:creator>
<dc:description>&lt;p&gt;Dragons.&lt;/p&gt;&lt;p&gt;And a watch.&lt;/p&gt;</dc:description>
<dc:subject>Fantasy</dc:subject><dc:subject>Humor</dc:subject>
<meta name="calibre:series" content="Discworld"/><meta name="calibre:series_index" content="8.0"/>
</metadata></package>`;

describe("Calibre", () => {
  it("reads metadata.opf", () => {
    expect(parseOpf(OPF)).toEqual({
      title: "Guards! Guards!",
      author: "Terry Pratchett",
      description: "Dragons.\n\nAnd a watch.",
      tags: ["Fantasy", "Humor"],
      series: "Discworld #8",
    });
  });

  it("makes one book per folder, preferring EPUB, with its cover", async () => {
    const file = (path: string, body = "x") => {
      const f = new File([body], path.split("/").pop()!);
      Object.defineProperty(f, "webkitRelativePath", { value: path });
      return f;
    };
    const books = await readCalibreFolder([
      file("Lib/Terry Pratchett/Guards! Guards! (8)/metadata.opf", OPF),
      file("Lib/Terry Pratchett/Guards! Guards! (8)/Guards! Guards! - Terry Pratchett.pdf"),
      file("Lib/Terry Pratchett/Guards! Guards! (8)/Guards! Guards! - Terry Pratchett.epub"),
      file("Lib/Terry Pratchett/Guards! Guards! (8)/cover.jpg"),
      file("Lib/Someone/Loose (9)/Loose.mobi"),
      file("Lib/metadata.db"),
    ]);
    expect(books.map((b) => [b.title, b.file.name, b.cover?.name ?? null, b.otherFormats])).toEqual([
      ["Guards! Guards!", "Guards! Guards! - Terry Pratchett.epub", "cover.jpg", ["PDF"]],
      ["Loose", "Loose.mobi", null, []],
    ]);
    expect(books[0]).toMatchObject({ tags: ["Fantasy", "Humor"], series: "Discworld #8" });
  });
});
