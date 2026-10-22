/**
 * Locators: reading positions as strings, the same on every device, in the database and over
 * the API. One codec for both apps; index.js implements this file (it is type-checked against it).
 *
 *   page:12                     a PDF page (1-based)
 *   pdf:12:340-388              a text range on a PDF page (character offsets into its text layer), for highlights
 *   pdfsearch:12:0:raven        the nth (0-based) match of a search on a PDF page
 *   epubcfi(/6/14!/4/2/1:0)     an EPUB CFI; comic pages are epubcfi(/6/<2·(index+1)>), as foliate-js numbers them
 *   fraction:0.42               a percentage through the book (KOReader's ebook positions, books imported as read)
 */

export type Locator =
  | { kind: "page"; page: number }
  | { kind: "pdfRange"; page: number; start: number; end: number }
  | { kind: "pdfSearch"; page: number; nth: number; query: string }
  /** `section`: the 0-based spine item the CFI starts in (a comic's page index), or null. */
  | { kind: "cfi"; cfi: string; section: number | null }
  /** `fraction`: 0 to 1. */
  | { kind: "fraction"; fraction: number };

/** What a locator string says, or null when it is none of the forms above (or empty). */
export function parseLocator(locator: string | null | undefined): Locator | null;

export function pageLocator(page: number): string;
export function pdfRangeLocator(page: number, start: number, end: number): string;
export function pdfSearchLocator(page: number, nth: number, query: string): string;
/** A comic page by its 0-based index. */
export function comicPageLocator(index: number): string;
/** A percentage position (clamped to 0–1). */
export function fractionLocator(fraction: number): string;

/**
 * The 1-based page a locator points at in a paged book (a PDF, or a comic by its pages) of
 * `pageCount` pages, kept within 1…pageCount. A fraction becomes the page at that percentage,
 * the same one the readers report it for (fraction 1 is the last page); without `pageCount` it
 * names no page. Null when the locator names no page.
 */
export function pageOf(locator: string | null | undefined, pageCount?: number): number | null;
