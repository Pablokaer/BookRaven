import { describe, expect, it } from "vitest";
import {
  comicPageLocator,
  fractionLocator,
  pageLocator,
  pageOf,
  parseLocator,
  pdfRangeLocator,
  pdfSearchLocator,
  type Locator,
} from "./index.js";

describe("parseLocator", () => {
  const cases: [string | null | undefined, Locator | null][] = [
    ["page:12", { kind: "page", page: 12 }],
    ["pdf:12:340-388", { kind: "pdfRange", page: 12, start: 340, end: 388 }],
    ["pdfsearch:12:0:raven", { kind: "pdfSearch", page: 12, nth: 0, query: "raven" }],
    ["pdfsearch:3:2:never: more\nagain", { kind: "pdfSearch", page: 3, nth: 2, query: "never: more\nagain" }],
    ["epubcfi(/6/20)", { kind: "cfi", cfi: "epubcfi(/6/20)", section: 9 }],
    ["epubcfi(/6/2)", { kind: "cfi", cfi: "epubcfi(/6/2)", section: 0 }],
    ["epubcfi(/6/8!/4/2,/1:0,/1:5)", { kind: "cfi", cfi: "epubcfi(/6/8!/4/2,/1:0,/1:5)", section: 3 }],
    ["epubcfi(/6/7)", { kind: "cfi", cfi: "epubcfi(/6/7)", section: null }],
    ["epubcfi(/4/2)", { kind: "cfi", cfi: "epubcfi(/4/2)", section: null }],
    ["fraction:0.42", { kind: "fraction", fraction: 0.42 }],
    ["fraction:1", { kind: "fraction", fraction: 1 }],
    ["fraction:0", { kind: "fraction", fraction: 0 }],
    ["fraction:1e-7", { kind: "fraction", fraction: 1e-7 }], // how JavaScript writes tiny percentages
    ["fraction:1.5", { kind: "fraction", fraction: 1 }],
    ["fraction:", null],
    ["fraction:abc", null],
    ["page:", null],
    ["page:3x", null],
    ["pdf:3", null],
    ["chapter-2.xhtml", null],
    ["", null],
    [null, null],
    [undefined, null],
  ];
  it.each(cases)("%j", (input, expected) => {
    expect(parseLocator(input)).toEqual(expected);
  });
});

describe("builders", () => {
  it("write each form, and parse back to what they wrote", () => {
    const cases: [string, string, Locator][] = [
      [pageLocator(7), "page:7", { kind: "page", page: 7 }],
      [pdfRangeLocator(7, 3, 9), "pdf:7:3-9", { kind: "pdfRange", page: 7, start: 3, end: 9 }],
      [pdfSearchLocator(7, 1, "a:b"), "pdfsearch:7:1:a:b", { kind: "pdfSearch", page: 7, nth: 1, query: "a:b" }],
      [comicPageLocator(0), "epubcfi(/6/2)", { kind: "cfi", cfi: "epubcfi(/6/2)", section: 0 }],
      [comicPageLocator(9), "epubcfi(/6/20)", { kind: "cfi", cfi: "epubcfi(/6/20)", section: 9 }],
      [fractionLocator(0.25), "fraction:0.25", { kind: "fraction", fraction: 0.25 }],
      [fractionLocator(2), "fraction:1", { kind: "fraction", fraction: 1 }],
      [fractionLocator(1e-7), "fraction:1e-7", { kind: "fraction", fraction: 1e-7 }],
    ];
    for (const [built, text, parsed] of cases) {
      expect(built).toBe(text);
      expect(parseLocator(built)).toEqual(parsed);
    }
  });
});

describe("pageOf", () => {
  const cases: [string | null, number | undefined, number | null][] = [
    // PDF forms, with and without the page count (kept within the book)
    ["page:12", undefined, 12],
    ["page:12", 50, 12],
    ["page:80", 50, 50],
    ["page:0", 50, 1],
    ["pdf:12:340-388", 50, 12],
    ["pdfsearch:12:0:raven", 50, 12],
    // comic pages (1-based page = index + 1)
    ["epubcfi(/6/20)", undefined, 10],
    ["epubcfi(/6/20)", 5, 5],
    ["epubcfi(/6/8!/4/2)", 30, 4],
    ["epubcfi(/6/7)", 30, null],
    // fractions need the page count; the inverse of the reported (page - 1) / (pageCount - 1)
    ["fraction:1", 120, 120], // a book imported as read opens on its last page
    ["fraction:1", 1, 1],
    ["fraction:0", 120, 1],
    ["fraction:0.5", 101, 51],
    ["fraction:0.42", 50, 22],
    ["fraction:0.42", undefined, null],
    ["fraction:0.42", 0, null],
    // nothing to go on
    [null, 50, null],
    ["chapter-2.xhtml", 50, null],
  ];
  it.each(cases)("%j of %j pages", (locator, pageCount, expected) => {
    expect(pageOf(locator, pageCount)).toBe(expected);
  });

  it("opens a book imported as read (fraction:1) on its last page, not the first", () => {
    expect(pageOf(fractionLocator(1), 240)).toBe(240); // PDF of 240 pages
    expect(pageOf(fractionLocator(1), 36)! - 1).toBe(35); // comic of 36 pages: the last index
  });

  it("is the inverse of the percentage the readers report", () => {
    for (const pageCount of [2, 3, 17, 240]) {
      for (let page = 1; page <= pageCount; page++) {
        expect(pageOf(fractionLocator((page - 1) / (pageCount - 1)), pageCount)).toBe(page);
      }
    }
  });
});
