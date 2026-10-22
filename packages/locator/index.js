// Plain JavaScript, so the API runs it from node_modules and the web app bundles it without a
// build step. The interface and its documentation are in index.d.ts; each export is typed
// against it (`tsc -p tsconfig.json` checks this file).

/** @typedef {import("./index.js").Locator} Locator */

const PAGE = /^page:(\d+)$/;
const PDF_RANGE = /^pdf:(\d+):(\d+)-(\d+)$/;
const PDF_SEARCH = /^pdfsearch:(\d+):(\d+):(.*)$/s;
const SECTION = /^epubcfi\(\/6\/(\d+)/;

/** @param {number} n @param {number} lo @param {number} hi */
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** @type {typeof import("./index.js").parseLocator} */
export function parseLocator(locator) {
  if (!locator) return null;
  let m;
  if ((m = PAGE.exec(locator))) return { kind: "page", page: Number(m[1]) };
  if ((m = PDF_RANGE.exec(locator))) return { kind: "pdfRange", page: Number(m[1]), start: Number(m[2]), end: Number(m[3]) };
  if ((m = PDF_SEARCH.exec(locator))) return { kind: "pdfSearch", page: Number(m[1]), nth: Number(m[2]), query: m[3] ?? "" };
  if (locator.startsWith("epubcfi(")) {
    // Spine items are the even steps of the package's spine (/6): /6/2 is the first.
    const step = Number(SECTION.exec(locator)?.[1] ?? NaN);
    return { kind: "cfi", cfi: locator, section: step >= 2 && step % 2 === 0 ? step / 2 - 1 : null };
  }
  if (locator.startsWith("fraction:")) {
    const text = locator.slice("fraction:".length);
    const f = text.trim() === "" ? NaN : Number(text);
    return Number.isFinite(f) ? { kind: "fraction", fraction: clamp(f, 0, 1) } : null;
  }
  return null;
}

/** @type {typeof import("./index.js").pageLocator} */
export const pageLocator = (page) => `page:${page}`;

/** @type {typeof import("./index.js").pdfRangeLocator} */
export const pdfRangeLocator = (page, start, end) => `pdf:${page}:${start}-${end}`;

/** @type {typeof import("./index.js").pdfSearchLocator} */
export const pdfSearchLocator = (page, nth, query) => `pdfsearch:${page}:${nth}:${query}`;

/** @type {typeof import("./index.js").comicPageLocator} */
export const comicPageLocator = (index) => `epubcfi(/6/${(index + 1) * 2})`;

/** @type {typeof import("./index.js").fractionLocator} */
export const fractionLocator = (fraction) => `fraction:${clamp(fraction, 0, 1)}`;

/** @type {typeof import("./index.js").pageOf} */
export function pageOf(locator, pageCount) {
  const l = parseLocator(locator);
  const known = pageCount !== undefined && pageCount > 0;
  /** @type {number | null} */
  let page = null;
  if (l?.kind === "page" || l?.kind === "pdfRange" || l?.kind === "pdfSearch") page = l.page;
  else if (l?.kind === "cfi" && l.section !== null) page = l.section + 1;
  // The inverse of the percentage the readers report: (page - 1) / (pageCount - 1).
  else if (l?.kind === "fraction" && known) page = Math.round(l.fraction * (pageCount - 1)) + 1;
  if (page === null) return null;
  return known ? clamp(page, 1, pageCount) : Math.max(1, page);
}
