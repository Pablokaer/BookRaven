import sax from "sax";

/**
 * Exact EPUB positions between KOReader and BookRaven: KOReader's XPointers (crengine) to the
 * EPUB CFIs the web reader (foliate-js) uses, and back. Pure logic over parsed documents; loading
 * the EPUB and caching it is epubPositions.ts.
 *
 *   /body/DocFragment[12]/body/div[2]/p[5]/text().123      a KOReader XPointer
 *   epubcfi(/6/24[ch12]!/4/4[part2]/10/1:131)               the same spot as a CFI
 *
 * XPointers, as crengine writes them (ldomXPointer::toStringV2, KOReader since 2020):
 * - The book is one DOM: /body holds one DocFragment per spine item crengine renders, in spine
 *   order (only (X)HTML items; images or SVGs in the spine get none). DocFragment[n] is the n-th.
 * - Each DocFragment holds the XHTML's <body> (its <html> and <head> are dropped), so
 *   /body/DocFragment[n]/body/… continues from the XHTML <body>.
 * - `name[i]` is the i-th child element called `name` (1-based, local name without a namespace
 *   prefix); the [i] is left out when it is the only one. `text()[i]` is the i-th text child.
 * - A final `.N` is a character offset into a text node (an element position ends in `.0`).
 * - crengine's own wrappers (autoBoxing, floatBox…) are skipped by V2 XPointers; old ones that
 *   name them are not converted.
 * - crengine's text differs from the XML DOM's: outside <pre>, runs of spaces, tabs and line
 *   breaks are one space (offsets count that text), and whitespace-only text is dropped when it
 *   is the first child of a block element or sits between blocks only (a parent without inline
 *   content). See `kept` and `rawToCrengine` below; a mismatch only moves the position a few
 *   characters within the same paragraph.
 *
 * CFIs, as foliate-js writes them (epubcfi.js): the spine item's CFI in the package document,
 * "!", then steps from the XHTML's <html> element: elements are even (2, 4, …, the n-th element
 * child is 2n), the text between them odd, `[id]` asserts an element's id, `:N` is a character
 * offset into the (raw, XML DOM) text. A range CFI stands for its start. The XHTML is parsed as
 * XML, as foliate does for valid XHTML.
 */

export type XmlElement = {
  kind: "element";
  /** Local name, lowercase (crengine's name for it). */
  name: string;
  id: string | null;
  /** All attributes, by their qualified name; only when parsed with `attributes` (the package document). */
  attributes?: Record<string, string>;
  children: XmlNode[];
  parent: XmlElement | null;
};
/** Character data: adjacent text and CDATA (split only by comments) is one node, like a CFI chunk. */
export type XmlText = { kind: "text"; text: string; parent: XmlElement };
export type XmlNode = XmlElement | XmlText;

/** One spine item: its CFI in the package document (e.g. "/6/14[ch6]") and whether crengine renders it (XHTML/HTML). */
export type SpineItem = { cfi: string; html: boolean };

/** A book to convert positions in: its spine and its spine documents (the root element), loaded on demand. */
export type EpubDocuments = {
  spine: SpineItem[];
  document(spineIndex: number): Promise<XmlElement | null> | XmlElement | null;
};

/**
 * Parses an XML document (XHTML, OPF) into elements and text, keeping each element's id (and all
 * its attributes with `attributes`); throws when it isn't well-formed.
 */
export function parseXml(source: string, { attributes = false } = {}): XmlElement {
  const parser = sax.parser(true, { position: false });
  let root: XmlElement | null = null;
  let current: XmlElement | null = null;
  const addText = (text: string) => {
    if (!current || !text) return; // whitespace around the root element
    const last = current.children.at(-1);
    if (last?.kind === "text") last.text += text;
    else current.children.push({ kind: "text", text, parent: current });
  };
  parser.onerror = (err) => {
    throw err;
  };
  parser.onopentag = (tag) => {
    const attrs = tag.attributes as Record<string, string>;
    const name = tag.name.slice(tag.name.indexOf(":") + 1).toLowerCase();
    const el: XmlElement = { kind: "element", name, id: attrs.id ?? null, children: [], parent: current };
    if (attributes) el.attributes = attrs;
    if (current) current.children.push(el);
    else root ??= el;
    current = el;
  };
  parser.onclosetag = () => {
    current = current?.parent ?? null;
  };
  parser.ontext = addText;
  parser.oncdata = addText;
  // XML end-of-line handling, which sax leaves out (a browser's parser does it).
  parser.write(source.replace(/^﻿/, "").replace(/\r\n?/g, "\n")).close();
  if (!root) throw new Error("no root element");
  return root;
}

// ---------------------------------------------------------------------------------------------
// crengine's view of a document

const XML_SPACE = /^[ \t\n\r]*$/;

/** Elements displayed as blocks by default (crengine's and browsers' default styles). */
const BLOCKS = new Set(
  (
    "html body div p h1 h2 h3 h4 h5 h6 ul ol li dl dt dd table caption thead tbody tfoot tr td th col colgroup " +
    "blockquote pre section article aside nav header footer main figure figcaption address hr center form fieldset " +
    "legend details summary hgroup dir menu noscript"
  ).split(" "),
);

/** crengine's layout wrappers: positions inside them can't be mapped back to the XHTML. */
const CRENGINE_BOXES = new Set(["autoboxing", "floatbox", "inlinebox", "rubybox", "tabularbox", "pseudoelem"]);

const inPre = (node: XmlNode) => {
  for (let p: XmlElement | null = node.parent; p; p = p.parent) if (p.name === "pre") return true;
  return false;
};

/**
 * Whether crengine keeps a text node. It drops whitespace-only text when it is the first child of
 * a block ("first empty space of block item" in ldomElementWriter::onText) and between block
 * children when the parent has no inline content (such text never renders).
 */
function kept(t: XmlText) {
  if (!XML_SPACE.test(t.text) || inPre(t)) return true;
  const p = t.parent;
  if (BLOCKS.has(p.name) && p.children[0] === t) return false;
  return p.children.some((c) => (c.kind === "text" ? !XML_SPACE.test(c.text) : !BLOCKS.has(c.name)));
}

// crengine's text: outside <pre>, every run of XML whitespace is one space.

/** A raw (DOM) offset into a text node as an offset into crengine's text. */
function rawToCrengine(t: XmlText, raw: number) {
  if (inPre(t)) return raw;
  let out = 0;
  for (let i = 0; i < raw && i < t.text.length; i++) {
    const space = " \t\n\r".includes(t.text[i]!);
    if (!space || i === 0 || !" \t\n\r".includes(t.text[i - 1]!)) out++;
  }
  return out;
}

/** An offset into crengine's text as a raw (DOM) offset into the text node. */
function crengineToRaw(t: XmlText, offset: number) {
  if (inPre(t)) return Math.min(offset, t.text.length);
  let out = 0;
  for (let i = 0; i < t.text.length; i++) {
    const space = " \t\n\r".includes(t.text[i]!);
    if (!space || i === 0 || !" \t\n\r".includes(t.text[i - 1]!)) {
      if (out === offset) return i;
      out++;
    }
  }
  return t.text.length;
}

const childElements = (el: XmlElement) => el.children.filter((c): c is XmlElement => c.kind === "element");
const findChild = (el: XmlElement, name: string) => childElements(el).find((c) => c.name === name) ?? null;
const bodyOf = (root: XmlElement) => (root.name === "body" ? root : findChild(root, "body"));

// ---------------------------------------------------------------------------------------------
// CFIs

type CfiStep = { index: number; id?: string; offset?: number };

/** A CFI's inside split at its unescaped commas outside assertions: [parent, start, end] for a range. */
function cfiPieces(cfi: string) {
  const inner = /^epubcfi\((.*)\)$/s.exec(cfi.trim())?.[1];
  if (inner === undefined) return null;
  const pieces: string[] = [""];
  let inAssertion = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (ch === "^") pieces[pieces.length - 1] += ch + (inner[++i] ?? "");
    else if (ch === "," && !inAssertion) pieces.push("");
    else {
      if (ch === "[" || ch === "]") inAssertion = ch === "[";
      pieces[pieces.length - 1] += ch;
    }
  }
  return pieces;
}

const escapeCfi = (s: string) => s.replace(/[\^[\](),;=]/g, "^$&");

/**
 * The steps of a CFI, one list per indirection ("!"); a range CFI gives its start. Temporal,
 * spatial and text assertions are ignored. Null when it isn't a CFI.
 */
export function parseCfi(cfi: string): CfiStep[][] | null {
  // A range is split at its unescaped commas outside assertions: parent, start, end.
  const pieces = cfiPieces(cfi);
  if (!pieces) return null;
  const parts: CfiStep[][] = [[]];
  for (const piece of pieces.slice(0, 2)) {
    let i = 0;
    const number = () => {
      const m = /^\d+(\.\d+)?/.exec(piece.slice(i));
      i += m ? m[0].length : 0;
      return m ? Number(m[0]) : NaN;
    };
    while (i < piece.length) {
      const ch = piece[i++]!;
      const last = parts.at(-1)!.at(-1);
      if (ch === "/") {
        const index = number();
        if (!Number.isInteger(index)) return null;
        parts.at(-1)!.push({ index });
      } else if (ch === "!") parts.push([]);
      else if (ch === ":" && last) last.offset = number();
      else if (ch === "~" || ch === "@") while (i < piece.length && /[\d.:]/.test(piece[i]!)) i++;
      else if (ch === "[") {
        let value = "";
        for (; i < piece.length && piece[i] !== "]"; i++) {
          if (piece[i] === "^") i++;
          value += piece[i] ?? "";
        }
        i++;
        // An assertion right after an element step is its id; after an offset, the text around it.
        if (last && last.offset === undefined && last.index % 2 === 0) last.id = value.split(";")[0] || undefined;
      } else return null;
    }
  }
  if (parts.some((p) => !p.length || p.some((s) => Number.isNaN(s.offset ?? 0)))) return null;
  return parts;
}

/** The CFI steps from the document's root element to `node`, as foliate writes them. */
function cfiSteps(node: XmlNode, offset?: number): string {
  let path = "";
  for (let n: XmlNode = node; n.parent; n = n.parent) {
    const siblings = n.parent.children;
    const before = siblings.slice(0, siblings.indexOf(n)).filter((c) => c.kind === "element").length;
    path =
      (n.kind === "element"
        ? `/${2 * (before + 1)}${n.id ? `[${escapeCfi(n.id)}]` : ""}`
        : `/${2 * before + 1}${n === node && offset !== undefined ? `:${offset}` : ""}`) + path;
  }
  return path;
}

/** Where a CFI's steps lead in a document: an element, or a text node and a raw offset. */
function resolveCfiSteps(root: XmlElement, steps: CfiStep[]): { node: XmlNode; offset: number } {
  let node: XmlElement = root;
  for (const [i, step] of steps.entries()) {
    const elements = childElements(node);
    if (step.index % 2 === 0) {
      const el = elements[step.index / 2 - 1];
      if (!el) return { node, offset: 0 }; // 0 and n+2: before or after the children
      node = el;
      continue;
    }
    // The character data between element k-1 and element k (k = (index-1)/2).
    const k = (step.index - 1) / 2;
    const prev = k > 0 ? elements[k - 1] : null;
    const from = prev ? node.children.indexOf(prev) + 1 : 0;
    const text = node.children[from];
    if (text?.kind === "text") return { node: text, offset: i === steps.length - 1 ? Math.min(step.offset ?? 0, text.text.length) : 0 };
    return { node: elements[k] ?? node, offset: 0 };
  }
  return { node, offset: 0 };
}

// ---------------------------------------------------------------------------------------------
// XPointers

type XpStep = { name: string; index: number };

/** The steps of an XPointer and its final offset; null when it isn't one. */
function parseXPointer(xp: string): { steps: XpStep[]; offset: number | null } | null {
  const s = xp.trim();
  const offset = /\.(\d+)$/.exec(s);
  const path = offset ? s.slice(0, offset.index) : s;
  if (!path.startsWith("/")) return null;
  const steps: XpStep[] = [];
  for (const part of path.split("/").slice(1)) {
    const step = /^(?:[\w.-]+:)?([A-Za-z_][\w.-]*|text\(\))(?:\[(\d+)\])?$/.exec(part);
    if (!step) return null;
    steps.push({ name: step[1]!.toLowerCase(), index: step[2] ? Number(step[2]) : 1 });
  }
  return { steps, offset: offset ? Number(offset[1]) : null };
}

/** crengine's step for a node in its parent: `name[i]` / `text()[i]`, without [i] when it is the only one. */
function xpStep(node: XmlNode) {
  const same = node.parent!.children.filter((c) =>
    node.kind === "element" ? c.kind === "element" && c.name === node.name : c.kind === "text" && kept(c),
  );
  const name = node.kind === "element" ? node.name : "text()";
  return same.length > 1 ? `${name}[${same.indexOf(node) + 1}]` : name;
}

/** The spine index of the n-th (1-based) DocFragment: the n-th item crengine renders. */
function spineIndexOfFragment(spine: SpineItem[], n: number) {
  let seen = 0;
  for (const [i, item] of spine.entries()) if (item.html && ++seen === n) return i;
  return -1;
}

/**
 * The CFI of the spot a KOReader XPointer points at, or null when it can't be converted (another
 * format of XPointer, a spine item that isn't there, a path the document doesn't have).
 */
export async function xpointerToCfi(book: EpubDocuments, xpointer: string): Promise<string | null> {
  const xp = parseXPointer(xpointer);
  if (!xp) return null;
  const [top, fragment, body, ...rest] = xp.steps;
  if (top?.name !== "body" || top.index !== 1 || fragment?.name !== "docfragment") return null;
  const spineIndex = spineIndexOfFragment(book.spine, fragment.index);
  if (spineIndex < 0) return null;
  const root = await book.document(spineIndex);
  const xBody = root && bodyOf(root);
  if (!xBody) return null;
  const spineCfi = book.spine[spineIndex]!.cfi;
  if (!body) return `epubcfi(${spineCfi}!${cfiSteps(xBody)})`; // the start of the spine item
  if (body.name !== "body" || body.index !== 1) return null;

  let node: XmlNode = xBody;
  for (const step of rest) {
    if (node.kind !== "element" || CRENGINE_BOXES.has(step.name)) return null;
    const candidates: XmlNode[] =
      step.name === "text()"
        ? node.children.filter((c) => c.kind === "text" && kept(c))
        : node.children.filter((c) => c.kind === "element" && c.name === step.name);
    const next = candidates[step.index - 1];
    if (!next) return null;
    node = next;
  }
  if (node.kind === "element") return `epubcfi(${spineCfi}!${cfiSteps(node)})`;
  return `epubcfi(${spineCfi}!${cfiSteps(node, crengineToRaw(node, xp.offset ?? 0))})`;
}

/**
 * The KOReader XPointer of the spot a CFI points at (the start of a range), or null when it
 * can't be converted (not a CFI, a spine item crengine doesn't render, a path the document
 * doesn't have).
 */
export async function cfiToXpointer(book: EpubDocuments, cfi: string): Promise<string | null> {
  const parts = parseCfi(cfi);
  if (!parts) return null;
  const itemStep = parts[0]!.at(-1)!;
  const spineIndex = book.spine.findIndex((s) => parseCfi(`epubcfi(${s.cfi})`)?.[0]?.at(-1)?.index === itemStep.index);
  if (spineIndex < 0 || !book.spine[spineIndex]!.html) return null;
  const fragments = book.spine.filter((s) => s.html).length;
  const n = book.spine.slice(0, spineIndex + 1).filter((s) => s.html).length;
  const fragment = `/body/DocFragment${fragments > 1 ? `[${n}]` : ""}`;
  const root = await book.document(spineIndex);
  const xBody = root && bodyOf(root);
  if (!root || !xBody) return null;

  let { node, offset } = parts[1] ? resolveCfiSteps(root, parts[1]) : { node: xBody as XmlNode, offset: 0 };
  // Whitespace crengine drops: the element after it, or its parent.
  if (node.kind === "text" && !kept(node)) {
    const siblings = node.parent.children;
    node = siblings.slice(siblings.indexOf(node) + 1).find((c) => c.kind === "element") ?? node.parent;
    offset = 0;
  }
  // Outside the body (its <head>, the <html> itself): the start of the spine item.
  let inBody = false;
  for (let p: XmlNode | null = node; p; p = p.parent) if (p === xBody) inBody = true;
  if (!inBody) return `${fragment}/body.0`;

  let path = "";
  for (let p: XmlNode = node; p !== xBody; p = p.parent!) {
    if (p.kind === "element" && CRENGINE_BOXES.has(p.name)) return null;
    path = `/${xpStep(p)}${path}`;
  }
  return `${fragment}/body${path}.${node.kind === "text" ? rawToCrengine(node, offset) : 0}`;
}

// ---------------------------------------------------------------------------------------------
// Ranges: KOReader highlights (pos0, pos1) and the web reader's range CFIs

/**
 * The start and the end of a range CFI as two CFIs (`epubcfi(/6/4!/4/2,/1:3,/1:9)` →
 * `epubcfi(/6/4!/4/2/1:3)` and `epubcfi(/6/4!/4/2/1:9)`); a CFI that isn't a range is both.
 * Null when it isn't a CFI.
 */
export function cfiRangeEnds(cfi: string): { start: string; end: string } | null {
  const pieces = cfiPieces(cfi);
  if (!pieces || !parseCfi(cfi)) return null;
  if (pieces.length !== 3) return { start: cfi.trim(), end: cfi.trim() };
  const [parent, start, end] = pieces as [string, string, string];
  return { start: `epubcfi(${parent}${start})`, end: `epubcfi(${parent}${end})` };
}

/** The steps of a CFI path as written: "/4", "/2[id]", "/1:3", "/1:3[text]". */
const CFI_STEP = /\/\d+(?:\[(?:\^.|[^\]^])*\])?(?::\d+(?:\.\d+)?(?:\[(?:\^.|[^\]^])*\])?)?/gs;

/**
 * A range CFI from two CFIs in the same spine item, as foliate-js writes one: the steps they
 * share, then the rest of each (`epubcfi(/6/4!/4/2,/1:3,/1:9)`). Null when they are in different
 * spine items or aren't plain CFIs.
 */
export function cfiRange(start: string, end: string): string | null {
  const a = cfiPieces(start);
  const b = cfiPieces(end);
  if (a?.length !== 1 || b?.length !== 1) return null;
  const [aItem, aPath, ...aMore] = a[0]!.split("!");
  const [bItem, bPath, ...bMore] = b[0]!.split("!");
  if (aItem !== bItem || aPath === undefined || bPath === undefined || aMore.length || bMore.length) return null;
  const aSteps = aPath.match(CFI_STEP) ?? [];
  const bSteps = bPath.match(CFI_STEP) ?? [];
  if (aSteps.join("") !== aPath || bSteps.join("") !== bPath || !aSteps.length || !bSteps.length) return null;
  // Each end keeps at least its last step (the one with the offset).
  let common = 0;
  while (common < aSteps.length - 1 && common < bSteps.length - 1 && aSteps[common] === bSteps[common]) common++;
  return `epubcfi(${aItem}!${aSteps.slice(0, common).join("")},${aSteps.slice(common).join("")},${bSteps.slice(common).join("")})`;
}

/**
 * The range CFI of a KOReader highlight (its pos0 and pos1 XPointers), or null when either end
 * can't be converted or they are in different spine items.
 */
export async function xpointerRangeToCfi(book: EpubDocuments, pos0: string, pos1: string): Promise<string | null> {
  const start = await xpointerToCfi(book, pos0);
  const end = start && (await xpointerToCfi(book, pos1));
  return start && end ? cfiRange(start, end) : null;
}

/** A range CFI (a web highlight) as KOReader's pos0 and pos1 XPointers, or null when it can't be converted. */
export async function cfiRangeToXpointers(book: EpubDocuments, cfi: string): Promise<{ pos0: string; pos1: string } | null> {
  const ends = cfiRangeEnds(cfi);
  if (!ends) return null;
  const pos0 = await cfiToXpointer(book, ends.start);
  const pos1 = pos0 && (await cfiToXpointer(book, ends.end));
  return pos0 && pos1 ? { pos0, pos1 } : null;
}
