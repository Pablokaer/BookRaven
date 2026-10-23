import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { packageSpine } from "../src/lib/epubPositions.js";
import { partialMd5 } from "../src/lib/koreader.js";
import { cfiToXpointer, parseXml, xpointerToCfi, type EpubDocuments, type XmlElement, type XmlNode, type XmlText } from "../src/lib/xpointer.js";
import { CH1, CH2, CH3, fixtureEpub, OPF } from "./epubFixture.js";
import { api, getApp, signUp, upload } from "./helpers.js";

const spine = packageSpine(OPF, "OEBPS/content.opf");
const docs: (XmlElement | null)[] = [parseXml(CH1), null, parseXml(CH2), parseXml(CH3)];
const book: EpubDocuments = { spine, document: (i) => docs[i] ?? null };

// --- Reference helpers, written independently of the module: the DOM text a CFI points at. ---

/** All text after a node (and an offset into it), in document order. */
function textFrom(node: XmlNode, offset: number) {
  let out = node.kind === "text" ? node.text.slice(offset) : "";
  const walk = (n: XmlNode): void => (n.kind === "text" ? void (out += n.text) : n.children.forEach(walk));
  if (node.kind === "element") node.children.forEach(walk);
  for (let n: XmlNode = node; n.parent; n = n.parent) {
    const sibs = n.parent.children;
    sibs.slice(sibs.indexOf(n) + 1).forEach(walk);
  }
  return out;
}

/** The first characters of the text at a CFI (a single, non-range CFI), whitespace collapsed. */
function textAtCfi(cfi: string, length = 16) {
  const m = /^epubcfi\(\/6\/(\d+)(?:\[[^\]]*\])?!(.*)\)$/.exec(cfi);
  if (!m) throw new Error(`unexpected CFI ${cfi}`);
  let node: XmlNode = docs[Number(m[1]) / 2 - 1]!;
  let offset = 0;
  for (const step of m[2]!.split("/").slice(1)) {
    const [, idx, off] = /^(\d+)(?:\[[^\]]*\])?(?::(\d+))?$/.exec(step)!;
    const index = Number(idx);
    const el = node as XmlElement;
    const elements = el.children.filter((c) => c.kind === "element");
    if (index % 2 === 0) node = elements[index / 2 - 1]!;
    else {
      // Text after element (index-1)/2.
      const prev = elements[(index - 1) / 2 - 1];
      node = el.children[prev ? el.children.indexOf(prev) + 1 : 0]!;
      expect(node.kind).toBe("text");
      offset = Number(off ?? 0);
    }
  }
  return textFrom(node, offset).replace(/[ \t\n\r]+/g, " ").trim().slice(0, length);
}

/** A CFI the way foliate-js builds one for a DOM position. */
function refCfi(spineCfi: string, node: XmlNode, offset?: number) {
  const steps: string[] = [];
  for (let n: XmlNode = node; n.parent; n = n.parent) {
    const before = n.parent.children.slice(0, n.parent.children.indexOf(n)).filter((c) => c.kind === "element").length;
    if (n.kind === "element") steps.unshift(`/${(before + 1) * 2}${n.id ? `[${n.id}]` : ""}`);
    else steps.unshift(`/${before * 2 + 1}${n === node ? `:${offset ?? 0}` : ""}`);
  }
  return `epubcfi(${spineCfi}!${steps.join("")})`;
}

function* nodesOf(el: XmlElement): Generator<XmlNode> {
  for (const c of el.children) {
    yield c;
    if (c.kind === "element") yield* nodesOf(c);
  }
}

describe("EPUB positions: KOReader XPointers and CFIs", () => {
  it("reads the spine like foliate-js and KOReader", () => {
    expect(spine).toEqual([
      { cfi: "/6/2", html: true, href: "OEBPS/text/ch1.xhtml" },
      { cfi: "/6/4", html: false, href: "OEBPS/images/pic.svg" },
      { cfi: "/6/6[ch2ref]", html: true, href: "OEBPS/text/ch 2.xhtml" },
      { cfi: "/6/8", html: true, href: "OEBPS/text/ch3.xhtml" },
    ]);
  });

  // [XPointer, its CFI, the text there (whitespace collapsed)]
  const cases: [string, string, string][] = [
    ["/body/DocFragment[1]/body/h1/text().8", "epubcfi(/6/2!/4/2[c1]/1:8)", "One It was a \"da"],
    ["/body/DocFragment[1]/body/p[1]/text().9", "epubcfi(/6/2!/4/4/1:9)", '"dark" & stormy '],
    ["/body/DocFragment[1]/body/p[1]/text().18", "epubcfi(/6/2!/4/4/1:18)", "stormy night; th"],
    ["/body/DocFragment[1]/body/p[2]/text()[2].1", "epubcfi(/6/2!/4/6/3:1)", "intervals, when "],
    ["/body/DocFragment[1]/body/p[2]/i/text().3", "epubcfi(/6/2!/4/6/2/1:3)", "asional interval"],
    ["/body/DocFragment[1]/body/p[2]/b/em/text().0", "epubcfi(/6/2!/4/6/4/2/1:0)", "violent gust of "],
    ["/body/DocFragment[1]/body/p[2]/b/text()[2].1", "epubcfi(/6/2!/4/6/4/3:1)", "gust of wind. Ca"],
    ["/body/DocFragment[1]/body/p[3]/text().7", "epubcfi(/6/2!/4/8/1:7)", "naïve text, spre"],
    // Source line breaks: crengine counts one space, the DOM all of them.
    ["/body/DocFragment[1]/body/p[3]/text().19", "epubcfi(/6/2!/4/8/1:24)", "spread over thre"],
    ["/body/DocFragment[1]/body/p[3]/text().31", "epubcfi(/6/2!/4/8/1:41)", "three lines."],
    ["/body/DocFragment[1]/body/p[2]", "epubcfi(/6/2!/4/6)", "Except at occasi"],
    ["/body/DocFragment[2]/body/section/div[1]/p[1]/text()[1].6", "epubcfi(/6/6[ch2ref]!/4[b2]/2/2/2/1:6)", "nested deeper te"],
    ["/body/DocFragment[2]/body/section/div[1]/p[1]/span/span/text().2", "epubcfi(/6/6[ch2ref]!/4[b2]/2/2/2/2/2/1:2)", "eper text after."],
    ["/body/DocFragment[2]/body/section/div[1]/p[1]/span/text()[2].1", "epubcfi(/6/6[ch2ref]!/4[b2]/2/2/2/2/3:1)", "text after. Seco"],
    ["/body/DocFragment[2]/body/section/div[1]/p[2]/text().7", "epubcfi(/6/6[ch2ref]!/4[b2]/2/2/4/1:7)", "paragraph contin"],
    ["/body/DocFragment[2]/body/section/div[2]/blockquote/p/text().7", "epubcfi(/6/6[ch2ref]!/4[b2]/2/4/2/2/1:7)", "words. line one "],
    ["/body/DocFragment[2]/body/section/div[2]/blockquote.0", "epubcfi(/6/6[ch2ref]!/4[b2]/2/4/2)", "Quoted words. li"],
    // <pre> keeps its spaces in crengine too.
    ["/body/DocFragment[2]/body/section/div[2]/pre/text().15", "epubcfi(/6/6[ch2ref]!/4[b2]/2/4/4/1:15)", "line two Bold it"],
    ["/body/DocFragment[2]/body/section/div[2]/p[1]/b/text().2", "epubcfi(/6/6[ch2ref]!/4[b2]/2/4/6/2/1:2)", "ld italic plain."],
    // The space between <b> and <i> is a text node in crengine as well: " plain." is text()[2].
    ["/body/DocFragment[2]/body/section/div[2]/p[1]/text()[2].1", "epubcfi(/6/6[ch2ref]!/4[b2]/2/4/6/5:1)", "plain. Raw <cdat"],
    ["/body/DocFragment[2]/body/section/div[2]/p[2]/text().4", "epubcfi(/6/6[ch2ref]!/4[b2]/2/4/8/1:4)", "<cdata> text and"],
    ["/body/DocFragment[2]/body/section/div[2]/svg/title/text().1", "epubcfi(/6/6[ch2ref]!/4[b2]/2/4/10/2/1:1)", "ic Last one."],
    ["/body/DocFragment[2]/body/section/div[2]/p[3]/text().5", "epubcfi(/6/6[ch2ref]!/4[b2]/2/4/12[last]/1:5)", "one."],
    ["/body/DocFragment[3]/body/p/text().10", "epubcfi(/6/8!/4/2/1:13)", "start of the end"],
    ["/body/DocFragment[3]/body/table/tr/td[2]/text().5", "epubcfi(/6/8!/4/4/2/4/1:5)", "B"],
  ];

  it.each(cases)("%s ⇄ %s", async (xp, cfi, text) => {
    expect(await xpointerToCfi(book, xp)).toBe(cfi);
    expect(await cfiToXpointer(book, cfi)).toBe(/\.\d+$/.test(xp) ? xp : `${xp}.0`);
    expect(textAtCfi(cfi)).toBe(text);
  });

  it("round-trips every word and element of the book, both ways", async () => {
    let checked = 0;
    for (const [i, root] of docs.entries()) {
      if (!root) continue;
      const body = root.children.find((c): c is XmlElement => c.kind === "element" && c.name === "body")!;
      for (const node of nodesOf(body)) {
        const cfis: string[] = [];
        if (node.kind === "element") cfis.push(refCfi(spine[i]!.cfi, node));
        else if (/[^ \t\n\r]/.test(node.text)) {
          // Each word start, and the end of the text.
          for (let o = 0; o <= node.text.length; o++) {
            if (o === node.text.length || (/[^ \t\n\r]/.test(node.text[o]!) && (o === 0 || /[ \t\n\r]/.test(node.text[o - 1]!)))) cfis.push(refCfi(spine[i]!.cfi, node, o));
          }
        }
        for (const cfi of cfis) {
          const xp = await cfiToXpointer(book, cfi);
          expect(xp, cfi).toMatch(/^\/body\/DocFragment\[\d\]\/body\/.+\.\d+$/);
          expect(await xpointerToCfi(book, xp!), xp!).toBe(cfi);
          expect(await cfiToXpointer(book, (await xpointerToCfi(book, xp!))!)).toBe(xp);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(60);
  });

  it("parses XHTML like a browser: byte order mark and line ends", () => {
    const root = parseXml("﻿<html><body><p>a\r\nb\rc</p></body></html>");
    const p = (root.children[0] as XmlElement).children[0] as XmlElement;
    expect((p.children[0] as XmlText).text).toBe("a\nb\nc");
    expect(() => parseXml("<html><body><p>unclosed</body></html>")).toThrow();
  });

  it("handles range CFIs, positions crengine has no node for, and what it can't convert", async () => {
    // A range (what the web reader saves) stands for its start.
    expect(await cfiToXpointer(book, "epubcfi(/6/2!/4,/4/1:9,/6/1:5)")).toBe("/body/DocFragment[1]/body/p[1]/text().9");
    expect(await cfiToXpointer(book, "epubcfi(/6/2!/4,/4/1:9[a ,\"dark],/6/1:5)")).toBe("/body/DocFragment[1]/body/p[1]/text().9");
    // Whitespace crengine drops: the element after it.
    expect(await cfiToXpointer(book, "epubcfi(/6/2!/4/1:0)")).toBe("/body/DocFragment[1]/body/h1.0");
    // The <head>, or only a spine item: the start of the chapter.
    expect(await cfiToXpointer(book, "epubcfi(/6/2!/2)")).toBe("/body/DocFragment[1]/body.0");
    expect(await cfiToXpointer(book, "epubcfi(/6/6[ch2ref])")).toBe("/body/DocFragment[2]/body.0");
    expect(await xpointerToCfi(book, "/body/DocFragment[2].0")).toBe("epubcfi(/6/6[ch2ref]!/4[b2])");
    expect(await xpointerToCfi(book, "/body/DocFragment[3]/body.0")).toBe("epubcfi(/6/8!/4)");
    // The image in the spine has no DocFragment.
    expect(await cfiToXpointer(book, "epubcfi(/6/4!/4)")).toBeNull();
    // Not convertible.
    expect(await cfiToXpointer(book, "fraction:0.4")).toBeNull();
    expect(await cfiToXpointer(book, "epubcfi(/6/20!/4/2/1:0)")).toBeNull();
    expect(await xpointerToCfi(book, "/body/DocFragment[9]/body/p/text().0")).toBeNull();
    expect(await xpointerToCfi(book, "/body/DocFragment[1]/body/p[7]/text().0")).toBeNull();
    expect(await xpointerToCfi(book, "/body/DocFragment[1]/body/autoBoxing/p/text().0")).toBeNull();
    expect(await xpointerToCfi(book, "12")).toBeNull();
    expect(await xpointerToCfi(book, "#_doc_fragment_3")).toBeNull();
    // Offsets past the end stay in the text.
    expect(await xpointerToCfi(book, "/body/DocFragment[3]/body/table/tr/td[2]/text().99")).toBe("epubcfi(/6/8!/4/4/2/4/1:6)");
  });
});

describe("KOReader sync of EPUB positions", () => {
  const md5 = (s: string) => createHash("md5").update(s).digest("hex");

  it("turns KOReader positions into CFIs and BookRaven's into XPointers", async () => {
    const u = await signUp();
    const file = fixtureEpub();
    const bookRow = (await upload(u, "positions.epub", file)).json();
    expect(bookRow.format).toBe("epub");
    const { password } = (await api(u, "POST", "/api/app-passwords", { name: "Kindle" })).json();
    const doc = await partialMd5(async (o, l) => file.subarray(o, o + l), file.length);
    const a = await getApp();
    const ko = (method: string, url: string, payload?: object) =>
      a.inject({
        method: method as "GET",
        url,
        headers: { "x-auth-user": u.email, "x-auth-key": md5(password), accept: "application/vnd.koreader.v1+json", "content-type": "application/vnd.koreader.v1+json" },
        payload: payload ? JSON.stringify(payload) : undefined,
      });
    const progress = async () => (await api(u, "GET", `/api/books/${bookRow.id}/progress`)).json();

    // KOReader → BookRaven: the exact spot, as a CFI, with KOReader's percentage.
    const xp = "/body/DocFragment[2]/body/section/div[1]/p[1]/span/span/text().2";
    await ko("PUT", "/kosync/syncs/progress", { document: doc, progress: xp, percentage: 0.52, device: "Kindle", device_id: "k1" });
    expect(await progress()).toMatchObject({ locator: "epubcfi(/6/6[ch2ref]!/4[b2]/2/2/2/2/2/1:2)", percentage: 0.52, deviceName: "KOReader (Kindle)" });
    expect((await ko("GET", `/kosync/syncs/progress/${doc}`)).json()).toMatchObject({ progress: xp, device: "Kindle" });

    // A position that can't be converted keeps the percentage, as before.
    await new Promise((r) => setTimeout(r, 1100));
    await ko("PUT", "/kosync/syncs/progress", { document: doc, progress: "/body/DocFragment[7]/body/p/text().0", percentage: 0.6, device: "Kindle", device_id: "k1" });
    expect(await progress()).toMatchObject({ locator: "fraction:0.6", percentage: 0.6 });

    // BookRaven → KOReader: the web reader's CFI (a range) comes back as an XPointer.
    await new Promise((r) => setTimeout(r, 1100));
    await api(u, "PUT", `/api/books/${bookRow.id}/progress`, {
      locator: "epubcfi(/6/2!/4/6,/4/3:1,/6/1:5)",
      percentage: 0.2,
      deviceId: "web",
      deviceName: "Firefox",
      clientUpdatedAt: Date.now(),
    });
    expect((await ko("GET", `/kosync/syncs/progress/${doc}`)).json()).toMatchObject({
      progress: "/body/DocFragment[1]/body/p[2]/b/text()[2].1",
      percentage: 0.2,
      device: "Firefox",
    });

    // A CFI KOReader can't use (the image in the spine): KOReader keeps its own position.
    await new Promise((r) => setTimeout(r, 1100));
    await api(u, "PUT", `/api/books/${bookRow.id}/progress`, { locator: "epubcfi(/6/4)", percentage: 0.3, deviceId: "web", deviceName: "Firefox", clientUpdatedAt: Date.now() });
    expect((await ko("GET", `/kosync/syncs/progress/${doc}`)).json()).toMatchObject({ progress: "/body/DocFragment[7]/body/p/text().0", device: "Kindle" });
  });
});
