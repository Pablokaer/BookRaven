import { comicPageLocator, pageLocator, pageOf, parseLocator, pdfSearchLocator } from "@bookraven/locator";
import { query } from "../db.js";
import { storedCfiToXpointer, storedCfiToXpointers, storedXpointerRangeToCfi, storedXpointerToCfi } from "./epubPositions.js";

/**
 * Highlights and bookmarks between KOReader (the BookRaven plugin, koreader/bookraven.koplugin)
 * and BookRaven: positions and colors one way and the other. The sync itself (what changed since
 * when, deletions) is routes/koreader.ts.
 *
 * Positions:
 * - EPUB: KOReader's pos0/pos1 XPointers ⇄ a range CFI (xpointer.ts); a bookmark's XPointer ⇄
 *   the page's CFI.
 * - PDF: KOReader keeps a highlight's page and coordinates, BookRaven character offsets into
 *   pdf.js's text layer, which the server can't compute. A KOReader highlight is saved as
 *   `pdfsearch:<page>:0:<its first words>` and drawn by the web reader where it finds the text
 *   on the page (lib/pdfPassage.ts); a BookRaven highlight goes to KOReader as its page and text,
 *   and the plugin finds the words on the page. Bookmarks are pages.
 * - Comics (CBZ…): bookmarks are pages (KOReader has no highlights in images).
 * - Other formats (MOBI, AZW3, FB2): no conversion. KOReader's annotations are kept for its other
 *   devices but not shown in BookRaven.
 */

/** KOReader's annotation fields the server keeps and hands back (see the plugin's main.lua). */
export type KoAnnotation = {
  id: string;
  kind: "highlight" | "bookmark";
  text?: string | null;
  note?: string | null;
  color?: string | null;
  drawer?: string | null;
  chapter?: string | null;
  datetime?: string | null;
  /** XPointers (EPUB and other crengine books) or {page, x, y…} (PDF). */
  pos0?: unknown;
  pos1?: unknown;
  /** XPointer or page number. */
  page?: string | number | null;
  pboxes?: unknown[];
  /** Where it is in the book, 0 to 1 (bookmarks). */
  percent?: number | null;
};

export type WebColor = "yellow" | "green" | "blue" | "pink";

/** KOReader's highlight colors (2024.11+: red, orange, yellow, green, olive, cyan, blue, purple, gray) as BookRaven's four. */
export function webColor(koColor: string | null | undefined): WebColor {
  switch ((koColor ?? "").toLowerCase()) {
    case "green":
    case "olive":
      return "green";
    case "blue":
    case "cyan":
    case "purple":
      return "blue";
    case "red":
    case "pink":
      return "pink";
    default:
      return "yellow"; // yellow, orange, gray, none (KOReader's default is gray on e-ink)
  }
}

/** BookRaven's color for KOReader; KOReader's own when it maps to the same one. */
export function koColor(web: string, current?: string | null): string {
  if (current && webColor(current) === web) return current;
  return web === "pink" ? "red" : web;
}

/** KOReader's "YYYY-MM-DD HH:MM:SS" (the device's time), or null when it isn't one. */
export function parseKoDate(s: string | null | undefined): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(s?.trim() ?? "");
  const d = m ? new Date(`${m[1]}T${m[2]}Z`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/** A date the way KOReader writes them (UTC here: the server doesn't know the device's time zone). */
export const koDate = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

const COMIC = new Set(["cbz", "cbr", "cb7", "cbt"]);

/** The 1-based page of a KOReader position in a paged document (PDF, comic): `page`, or pos0's page. */
function koPage(a: KoAnnotation): number | null {
  const fromPos = a.pos0 && typeof a.pos0 === "object" ? (a.pos0 as { page?: unknown }).page : undefined;
  const n = Number(typeof a.page === "number" || /^\d+$/.test(String(a.page ?? "")) ? a.page : fromPos);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** The first words of a passage, one line, for a `pdfsearch:` locator (the full text is the highlight's). */
const passageStart = (text: string) => Array.from(text.replace(/\s+/g, " ").trim()).slice(0, 120).join("");

type StoredBook = { format: string; sha256: string; size_bytes: string };

/** Where a KOReader highlight goes in BookRaven (its `cfi` locator), or null when it can't be shown there. */
export async function highlightLocatorFor(book: StoredBook, a: KoAnnotation): Promise<string | null> {
  if (book.format === "epub" && typeof a.pos0 === "string" && typeof a.pos1 === "string") {
    return storedXpointerRangeToCfi(book.sha256, Number(book.size_bytes), a.pos0, a.pos1);
  }
  if (book.format === "pdf") {
    const page = koPage(a);
    const text = passageStart(a.text ?? "");
    return page && text ? pdfSearchLocator(page, 0, text) : null;
  }
  return null;
}

/** Where a KOReader bookmark goes in BookRaven (its locator), or null when it can't be shown there. */
export async function bookmarkLocatorFor(book: StoredBook, a: KoAnnotation): Promise<string | null> {
  if (book.format === "epub" && typeof a.page === "string" && a.page.startsWith("/")) {
    return storedXpointerToCfi(book.sha256, Number(book.size_bytes), a.page);
  }
  const page = koPage(a);
  if (!page) return null;
  if (book.format === "pdf") return pageLocator(page);
  if (COMIC.has(book.format)) return comicPageLocator(page - 1);
  return null;
}

/**
 * A BookRaven highlight's position for KOReader: pos0/pos1 XPointers (EPUB), or the page for the
 * plugin to find the text on (PDF). Null when KOReader can't use it.
 */
export async function koHighlightPosition(book: StoredBook, cfi: string): Promise<Pick<KoAnnotation, "pos0" | "pos1" | "page"> | null> {
  const l = parseLocator(cfi);
  if (book.format === "epub" && l?.kind === "cfi") {
    const xps = await storedCfiToXpointers(book.sha256, Number(book.size_bytes), cfi);
    return xps ? { pos0: xps.pos0, pos1: xps.pos1, page: xps.pos0 } : null;
  }
  if (book.format === "pdf" && (l?.kind === "pdfRange" || l?.kind === "pdfSearch")) return { page: l.page };
  return null;
}

/** A BookRaven bookmark's page for KOReader: an XPointer (EPUB) or a page number. Null when KOReader can't use it. */
export async function koBookmarkPage(book: StoredBook, locator: string): Promise<string | number | null> {
  const l = parseLocator(locator);
  if (book.format === "epub" && l?.kind === "cfi") return storedCfiToXpointer(book.sha256, Number(book.size_bytes), locator);
  if (book.format === "pdf" || COMIC.has(book.format)) return pageOf(locator);
  return null;
}

/**
 * A highlight or bookmark deleted in BookRaven: KOReader devices that have it delete it on their
 * next sync. Called by the web's delete routes.
 */
export async function forgetOnKoreader(kind: "highlight" | "bookmark", id: string) {
  await query(
    `UPDATE koreader_annotation SET deleted_at = now(), updated_at = now(), highlight_id = NULL, bookmark_id = NULL
     WHERE ${kind === "highlight" ? "highlight_id" : "bookmark_id"} = $1`,
    [id],
  );
}
