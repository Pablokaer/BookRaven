import { fractionLocator, pageLocator, pageOf, parseLocator, pdfRangeLocator, pdfSearchLocator } from "@bookraven/locator";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Highlight } from "../lib/api";
import { openBookFile } from "../lib/books";
import { HIGHLIGHT_COLORS } from "../lib/highlights";
import { afterIdle } from "../lib/idle";
import { MAX_STROKE_POINTS, type InkTool, type Stroke } from "../lib/ink";
import { drawStrokes, strokePoint, touchesStroke } from "../lib/inkDraw";
import { pdfjs, type PDFDocumentProxy, type PDFPageProxy } from "../lib/pdf";
import { findPassage } from "../lib/pdfPassage";
import { canvasPixelRatio, contentBox, fitScale, FULL_PAGE, type PageBox } from "../lib/pdfLayout";
import { MAX_ZOOM, pinchController, type PinchController } from "../lib/pinchZoom";
import { CHUNK, type RangeFile } from "../lib/rangeFile";
import { THEMES, type ReaderSettings, type ThemeId } from "../lib/settings";
import { useDocumentEvent, useLatest } from "../lib/useLatest";
import { freeZone, selectionReporter, type ReaderHandle, type ReaderProps, type SearchResult } from "./types";

/** PDFs can't reflow, so "themes" are applied as color filters on the rendered page. */
const PAGE_FILTERS: Partial<Record<ThemeId, string>> = {
  black: "invert(1) hue-rotate(180deg)",
  dark: "invert(0.88) hue-rotate(180deg)",
  sepia: "sepia(0.35) brightness(0.97)",
};

/**
 * Bytes pdf.js asked for. pdf.js waits for every range it requests, so once the PDF is open
 * a failed download is retried (when the device is back online, if it went offline) instead
 * of leaving a page blank for good. Null once the PDF is closed.
 */
async function readRange(file: RangeFile, begin: number, end: number, closed: () => boolean, keepTrying: () => boolean): Promise<Uint8Array | null> {
  for (let attempt = 0; !closed(); attempt++) {
    try {
      return await file.read(begin, end);
    } catch (err) {
      if (!keepTrying()) throw err;
      if (!navigator.onLine) await new Promise((r) => window.addEventListener("online", r, { once: true }));
      else await new Promise((r) => setTimeout(r, Math.min(30_000, 2000 * 2 ** attempt)));
    }
  }
  return null;
}

/**
 * The page to show for a locator (a page, a highlight or search match on it, or a percentage), in
 * a PDF of `numPages` pages; the first page when it names none. Before the PDF is open
 * (`numPages` 0) a percentage has no page yet.
 */
const pageFor = (locator: string | null | undefined, numPages: number) => pageOf(locator, numPages || undefined) ?? 1;

type TextNodes = { node: Text; start: number }[];

/** Text nodes of a text layer, in reading order, with their starting offsets (read once, used for every lookup). */
function textNodes(layer: HTMLElement) {
  const nodes: TextNodes = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  let offset = 0;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    nodes.push({ node: n, start: offset });
    offset += n.data.length;
  }
  let text: string | null = null;
  return {
    nodes,
    /** The layer's whole text (joined when first asked for). */
    get text() {
      return (text ??= nodes.map((n) => n.node.data).join(""));
    },
  };
}

/** A DOM range for [start, end) in the text layer. */
function rangeFor(nodes: TextNodes, start: number, end: number) {
  // The last node starting at or before `offset` (binary search: the starts only grow).
  const at = (offset: number) => {
    let lo = 0;
    let hi = nodes.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (nodes[mid]!.start <= offset) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (found < 0) return null;
    const n = nodes[found]!;
    return { node: n.node, offset: Math.min(offset - n.start, n.node.data.length) };
  };
  const a = at(start);
  const b = at(end);
  if (!a || !b) return null;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

function offsetOf(nodes: TextNodes, container: Node, offset: number) {
  const hit = nodes.find((n) => n.node === container);
  if (hit) return hit.start + offset;
  // Selection boundaries can land on elements: use the next text node inside/after them.
  const el = container.childNodes[offset] ?? container;
  const next = nodes.find((n) => el.contains(n.node) || el.compareDocumentPosition(n.node) & Node.DOCUMENT_POSITION_FOLLOWING);
  return next ? next.start : (nodes.at(-1)?.start ?? 0) + (nodes.at(-1)?.node.data.length ?? 0);
}

/** Excerpt around a match, for the search results list. */
function excerpt(text: string, at: number, len: number) {
  return {
    pre: text.slice(Math.max(0, at - 40), at).replace(/\s+/g, " "),
    match: text.slice(at, at + len),
    post: text.slice(at + len, at + len + 60).replace(/\s+/g, " "),
  };
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Gives a canvas's pixels back now, rather than whenever it is garbage collected. */
function freeCanvas(c: HTMLCanvasElement) {
  c.width = 0;
  c.height = 0;
}

/** Takes a canvas off the page and frees it. */
function discardCanvas(c: HTMLCanvasElement | null) {
  c?.remove();
  if (c) freeCanvas(c);
}

/** A page drawn on a new canvas `width` pixels wide. */
async function renderAtWidth(pdfPage: PDFPageProxy, width: number) {
  const viewport = pdfPage.getViewport({ scale: width / pdfPage.getViewport({ scale: 1 }).width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await pdfPage.render({ canvas, viewport }).promise;
  return canvas;
}

/** Places `el` over a part of the page given in fractions of it, so it follows a pinch without being redrawn. */
const placeFraction = (el: HTMLElement, x: number, y: number, w: number, h: number) =>
  Object.assign(el.style, { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` });

/** Where a page's content is: rendered small and scanned for non-white pixels. */
async function detectContent(pdfPage: PDFPageProxy): Promise<PageBox> {
  const canvas = await renderAtWidth(pdfPage, 240);
  const ctx = canvas.getContext("2d");
  const box = ctx ? contentBox(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height) : FULL_PAGE;
  freeCanvas(canvas);
  return box;
}

/** A page ready to show: built off-screen (canvas at the fitted size, text layer, handwriting canvases). */
type BuiltPage = {
  page: number;
  wrap: HTMLDivElement;
  sheet: HTMLDivElement;
  canvas: HTMLCanvasElement;
  ink: HTMLCanvasElement;
  wet: HTMLCanvasElement;
  /** Scale that fits the page (or its cropped part) on screen. */
  fit: number;
  /** Page size in PDF units. */
  width: number;
  height: number;
  pdfPage: PDFPageProxy;
};

type Build = {
  page: number;
  promise: Promise<BuiltPage | null>;
  /** Set once built. */
  built: BuiltPage | null;
  /** pdf.js's page, once loaded: it keeps the page's drawing instructions and images until cleaned up. */
  pdfPage: PDFPageProxy | null;
  /** Stops building it (a page not built yet gives its canvases back). */
  cancel: () => void;
};

/** A built page's canvases (the page, its handwriting, the sharp part drawn while zoomed) give their pixels back. */
function freeBuiltPage(b: BuiltPage) {
  discardCanvas(b.sheet.querySelector<HTMLCanvasElement>(".pdf-detail"));
  for (const c of b.sheet.querySelectorAll("canvas")) freeCanvas(c);
}

/**
 * Builds a page off-screen. The canvas is drawn at the fitted size only: zooming in draws the
 * visible part sharp on top of it (see the detail effect), so a zoomed page never needs a giant
 * canvas, and zooming doesn't rebuild the page or its text layer.
 */
function buildPage(doc: PDFDocumentProxy, pageNo: number, area: { w: number; h: number }, settings: ReaderSettings, crops: Map<number, PageBox>): Build {
  let cancelled = false;
  let task: ReturnType<PDFPageProxy["render"]> | null = null;
  let textLayer: InstanceType<typeof pdfjs.TextLayer> | null = null;
  let sheetEl: HTMLDivElement | null = null;
  const build: Build = { page: pageNo, promise: Promise.resolve(null), built: null, pdfPage: null, cancel: () => {} };
  /** Cancelled before it was built: nobody will show it. */
  const discard = () => sheetEl?.querySelectorAll("canvas").forEach(freeCanvas);
  build.promise = (async () => {
    const pdfPage = await doc.getPage(pageNo);
    build.pdfPage = pdfPage;
    if (cancelled) return null;
    const base = pdfPage.getViewport({ scale: 1 });
    let box = FULL_PAGE;
    if (settings.pdfCrop) {
      box = crops.get(pageNo) ?? (await detectContent(pdfPage));
      crops.set(pageNo, box);
    }
    if (cancelled) return null;
    // The visible part of the page, in PDF units.
    const cropW = base.width * (box.x1 - box.x0);
    const cropH = base.height * (box.y1 - box.y0);
    const fit = fitScale({ w: cropW, h: cropH }, area, settings.pdfMargin, settings.pdfFit);
    const dpr = canvasPixelRatio(base.width * fit, base.height * fit, window.devicePixelRatio);
    const viewport = pdfPage.getViewport({ scale: fit * dpr });
    const cssViewport = pdfPage.getViewport({ scale: fit });

    // Everything is sized from --total-scale-factor (like pdf.js's text layer), so a pinch
    // only has to change that one variable.
    const px = (v: number) => `calc(var(--total-scale-factor) * ${v}px)`;
    const wrap = document.createElement("div");
    const light = ["light", "sepia"].includes(settings.theme);
    wrap.className = `pdf-page relative m-auto shrink-0 overflow-hidden bg-white ${light ? "shadow-lg" : ""}`;
    wrap.style.width = px(cropW);
    wrap.style.height = px(cropH);
    wrap.style.setProperty("--scale-round-x", "1px");
    wrap.style.setProperty("--scale-round-y", "1px");
    wrap.style.setProperty("--total-scale-factor", String(fit));

    const sheet = document.createElement("div");
    sheet.className = "absolute";
    Object.assign(sheet.style, {
      left: px(-box.x0 * base.width),
      top: px(-box.y0 * base.height),
      width: px(base.width),
      height: px(base.height),
    });

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.className = "block bg-white";

    const hl = document.createElement("div");
    hl.className = "pdf-highlights";
    const text = document.createElement("div");
    text.className = "textLayer";
    // Handwriting (lib/ink.ts): the page's strokes, and on top the one being drawn. Sized for the zoom when shown.
    const [ink, wet] = ["pdf-ink", "pdf-ink pdf-ink-wet"].map((cls) => {
      const c = document.createElement("canvas");
      c.className = cls;
      return c;
    });
    sheet.append(canvas, hl, text, ink!, wet!);
    wrap.append(sheet);
    sheetEl = sheet;

    task = pdfPage.render({ canvas, viewport });
    textLayer = new pdfjs.TextLayer({ textContentSource: pdfPage.streamTextContent(), container: text, viewport: cssViewport });
    await Promise.all([task.promise, textLayer.render()]);
    if (cancelled) return null;
    build.built = { page: pageNo, wrap, sheet, canvas, ink: ink!, wet: wet!, fit, width: base.width, height: base.height, pdfPage };
    return build.built;
  })().catch((err) => {
    if (!cancelled && err?.name !== "RenderingCancelledException") console.error(err);
    return null;
  });
  build.cancel = () => {
    if (cancelled) return;
    cancelled = true;
    task?.cancel();
    textLayer?.cancel();
    if (!build.built) discard();
  };
  return build;
}

/** Pages whose text a search reads at the same time. */
const SEARCH_PARALLEL = 3;
/** Zoom factor of one step of the + and − buttons and keys. */
const ZOOM_STEP = 1.25;
/** How far the eraser reaches, as a fraction of the page width. */
const ERASER_RADIUS = 0.012;
/** Handwriting canvases stay under this many pixels each (they are redrawn at every zoom). */
const MAX_INK_PIXELS = 6_000_000;
/** The sharp part drawn over the visible area while zoomed in stays under this many pixels. */
const MAX_DETAIL_PIXELS = 8_000_000;

export const PdfReader = forwardRef<ReaderHandle, ReaderProps>(function PdfReader(props, ref) {
  const stageRef = useRef<HTMLDivElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  /**
   * The current page's wrapper: the visible (possibly cropped) part of the page, sized by
   * --total-scale-factor, holding the whole page sheet (canvas + highlight layer + text layer).
   */
  const pageEl = useRef<HTMLDivElement | null>(null);
  const sheetEl = useRef<HTMLDivElement | null>(null);
  /** Handwriting: the page's strokes, and on top the stroke being drawn. */
  const inkEl = useRef<HTMLCanvasElement | null>(null);
  const wetEl = useRef<HTMLCanvasElement | null>(null);
  /** The page on screen, and the sharp part drawn over its visible area while zoomed in. */
  const builtRef = useRef<BuiltPage | null>(null);
  const detailEl = useRef<HTMLCanvasElement | null>(null);
  /** Pages being built or ready (the current one and its neighbours), by page and layout. */
  const prepared = useRef(new Map<string, Build>());
  /** Each page's text (and its folded form) for search: reading it from the PDF is the slow part. */
  const pageTexts = useRef(new Map<number, { text: string; folded: string }>());
  /** Bumped when a zoomed page stops scrolling, to draw the newly visible part sharp. */
  const [scrolled, setScrolled] = useState(0);
  /** The pen stroke (or eraser pass) in progress. */
  const drawing = useRef<{ id: number; rect: DOMRect; stroke: Stroke | null; removed: Set<string> } | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(() => pageFor(props.initialLocator, 0));
  const [size, setSize] = useState({ w: 0, h: 0 });
  /** Bumped after each page render, so overlays are redrawn. */
  const [rendered, setRendered] = useState(0);
  /** Search match to outline on its page: nth occurrence of the query there. */
  const [searchHit, setSearchHit] = useState<{ page: number; query: string; nth: number } | null>(null);
  /** Scale that fits the current page on screen (CSS px per PDF unit, at zoom 1). */
  const fitRef = useRef(0);
  /** Live zoom (follows the fingers); `zoom` is the settled one the canvas is drawn at. */
  const zoomRef = useRef(1);
  const [zoom, setZoom] = useState(1);
  const zoomTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pinch = useRef<PinchController | null>(null);
  /** Content boxes of the pages seen so far (for "Crop white margins"). */
  const crops = useRef(new Map<number, PageBox>());
  const shownPage = useRef(0);
  const userNav = useRef(false);
  const pageRef = useLatest(page);
  const propsRef = useLatest(props);
  /** Highlight rectangles on the current page (fractions of the page), for click hit-testing. */
  const hlRects = useRef<{ h: Highlight; rects: DOMRect[] }[]>([]);
  const [selections] = useState(() => selectionReporter(propsRef));

  const numPages = doc?.numPages ?? 0;

  const go = useCallback(
    (target: number, byUser: boolean) => {
      if (!numPages) return;
      const p = Math.min(numPages, Math.max(1, target));
      if (p === pageRef.current) return;
      userNav.current = byUser;
      setPage(p);
    },
    [numPages],
  );

  /** Zooms to `next`, keeping the point under `anchor` (viewport coordinates) where it is. */
  const zoomAt = useCallback((next: number, anchor: { x: number; y: number }) => {
    const stage = stageRef.current;
    const wrap = pageEl.current;
    if (!stage || !wrap || !fitRef.current) return;
    const prev = zoomRef.current;
    const before = wrap.getBoundingClientRect();
    const px = (anchor.x - before.left) / prev;
    const py = (anchor.y - before.top) / prev;
    zoomRef.current = next;
    wrap.style.setProperty("--total-scale-factor", String(fitRef.current * next));
    const after = wrap.getBoundingClientRect();
    stage.scrollLeft += after.left + px * next - anchor.x;
    stage.scrollTop += after.top + py * next - anchor.y;
    // Redraw sharp once the fingers rest.
    clearTimeout(zoomTimer.current);
    zoomTimer.current = setTimeout(() => {
      setZoom(zoomRef.current);
      propsRef.current.onZoom?.(zoomRef.current);
    }, 200);
  }, []);

  const stageCenter = () => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  // Pinch, double-tap and Ctrl + wheel. Double-click stays text selection.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const controller = pinchController({ scale: () => zoomRef.current, zoomAt, reset: () => zoomAt(1, stageCenter()) }, { dblClick: false });
    pinch.current = controller;
    const detach = controller.attach(stage);
    return () => {
      detach();
      pinch.current = null;
      clearTimeout(zoomTimer.current);
    };
  }, [zoomAt]);

  const zoomStep = useCallback(
    (action: "in" | "out" | "reset") => {
      if (!stageRef.current) return;
      const z = zoomRef.current;
      const next = action === "reset" ? 1 : Math.min(MAX_ZOOM, action === "in" ? z * ZOOM_STEP : z / ZOOM_STEP);
      zoomAt(next < 1.05 ? 1 : next, stageCenter());
    },
    [zoomAt],
  );

  // Ctrl/⌘ + plus, minus and 0 zoom the page instead of the whole app.
  useDocumentEvent("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const action = e.key === "+" || e.key === "=" ? "in" : e.key === "-" ? "out" : e.key === "0" ? "reset" : null;
    if (!action) return;
    e.preventDefault();
    zoomStep(action);
  });

  useImperativeHandle(ref, () => ({
    next: () => go(page + 1, true),
    prev: () => go(page - 1, true),
    goToFraction: (f) => go(pageFor(fractionLocator(f), numPages), true),
    goToHref: (href) => {
      const l = parseLocator(href);
      setSearchHit(l?.kind === "pdfSearch" ? { page: l.page, nth: l.nth, query: l.query } : null);
      go(pageFor(href, numPages), true);
    },
    restore: (locator) => go(pageFor(locator, numPages), false),
    clearSelection: () => {
      window.getSelection()?.removeAllRanges();
      selections.cleared();
    },
    clearSearch: () => setSearchHit(null),
    zoom: zoomStep,
    thumbnail: async (p, width, strokes) => {
      if (!doc) return null;
      const pdfPage = await doc.getPage(p);
      const canvas = await renderAtWidth(pdfPage, width);
      const ctx = canvas.getContext("2d");
      let url: string | null = null;
      if (ctx) {
        drawStrokes(ctx, strokes ?? propsRef.current.ink?.[p] ?? [], canvas.width, canvas.height);
        url = canvas.toDataURL("image/jpeg", 0.75);
      }
      freeCanvas(canvas);
      if (!pageInUse(p)) pdfPage.cleanup(); // the notebook can draw many pages
      return url;
    },
    search: async (query, onResult, signal) => {
      if (!doc) return;
      const q = fold(query.trim());
      if (!q) return;
      const textOf = async (p: number) => {
        let page = pageTexts.current.get(p);
        if (!page) {
          const content = await (await doc.getPage(p)).getTextContent();
          // Same text the text layer shows: one text node per item, in order.
          const text = content.items.map((it) => ("str" in it ? it.str : "")).join("");
          page = { text, folded: fold(text) };
          pageTexts.current.set(p, page);
        }
        return page;
      };
      // A few pages are read at a time; their matches are still reported in page order.
      const reading: Promise<{ text: string; folded: string }>[] = [];
      let next = 1;
      for (let p = 1; p <= doc.numPages && !signal.aborted; p++) {
        for (; next <= doc.numPages && next < p + SEARCH_PARALLEL; next++) {
          const text = textOf(next);
          text.catch(() => {}); // read ahead, maybe never awaited (the search stopped)
          reading.push(text);
        }
        const { text, folded } = await reading.shift()!;
        if (signal.aborted) break;
        let nth = 0;
        for (let at = folded.indexOf(q); at !== -1; at = folded.indexOf(q, at + q.length)) {
          const r: SearchResult = { locator: pdfSearchLocator(p, nth++, query.trim()), label: `Page ${p}`, excerpt: excerpt(text, at, q.length) };
          onResult(r);
        }
      }
    },
  }));

  // pdf.js asks for the byte ranges it needs (the cross-reference table, then each page's
  // objects) and gets them from the copy saved on this device or, piece by piece, from the
  // server: opening a big PDF downloads little more than the pages on screen.
  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof pdfjs.getDocument> | null = null;
    let loaded = false;
    const fail = (err: { message?: string } | undefined) =>
      propsRef.current.onError(navigator.onLine ? (err?.message ?? "Could not open this PDF") : "This PDF is not saved on this device. Connect to the internet to open it.");
    const open = async () => {
      const file = await openBookFile(props.book);
      if (cancelled) throw new Error("cancelled");
      const transport = new pdfjs.PDFDataRangeTransport(file.size, await file.read(0, Math.min(file.size, CHUNK)));
      transport.requestDataRange = (begin: number, end: number) =>
        void readRange(file, begin, end, () => cancelled, () => loaded)
          .then((data) => data && !cancelled && transport.onDataRange(begin, data))
          .catch((err) => {
            if (cancelled) return;
            fail(err);
            void task?.destroy();
          });
      task = pdfjs.getDocument({ range: transport, disableAutoFetch: true, disableStream: true, rangeChunkSize: CHUNK });
      return task.promise;
    };
    open()
      .then(async (d) => {
        if (cancelled) return void d.loadingTask.destroy();
        loaded = true;
        crops.current.clear();
        pageTexts.current.clear();
        for (const key of [...prepared.current.keys()]) drop(key);
        setDoc(d);
        // Now a percentage (KOReader, a book imported as read) has a page too.
        setPage(pageFor(propsRef.current.initialLocator, d.numPages));
        const meta = await d.getMetadata().catch(() => null);
        const lang = (meta?.info as { Language?: string } | undefined)?.Language ?? null;
        propsRef.current.onReady({ language: lang });
      })
      .catch((err) => {
        if (!cancelled) fail(err);
      });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [props.book.id]);

  // Track the available space.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Report position whenever the page changes.
  useEffect(() => {
    if (!numPages) return;
    const byUser = userNav.current;
    userNav.current = false;
    propsRef.current.onRelocate(
      {
        locator: pageLocator(page),
        percentage: numPages > 1 ? (page - 1) / (numPages - 1) : 1,
        label: `Page ${page} of ${numPages}`,
      },
      byUser,
    );
  }, [page, numPages]);

  /**
   * Sizes a page's handwriting canvases for the zoom (they hold vector strokes, so they are
   * redrawn sharp). The canvas for the stroke being drawn takes memory only while annotating.
   */
  const sizeInk = (b: BuiltPage, z: number) => {
    const w = b.width * b.fit * z;
    const h = b.height * b.fit * z;
    const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_INK_PIXELS / (w * h)));
    const annotating = !!propsRef.current.inkMode;
    for (const c of [b.ink, b.wet]) {
      const used = c === b.ink || annotating;
      const cw = used ? Math.floor(w * ratio) : 0;
      const ch = used ? Math.floor(h * ratio) : 0;
      if (c.width !== cw || c.height !== ch) {
        c.width = cw;
        c.height = ch;
      }
    }
  };

  /** Whether page `p` is on screen or prepared (pdf.js's copy of it is still needed). */
  const pageInUse = (p: number) => builtRef.current?.page === p || [...prepared.current.values()].some((b) => b.page === p);

  /**
   * Frees a page that is neither prepared nor on screen: its canvases, and pdf.js's drawing
   * instructions and images for it, unless that page is still used. pdf.js waits for renders
   * in flight (a thumbnail) before cleaning up, and a new render of the page calls it off.
   */
  const release = (b: BuiltPage | null, pdfPage: PDFPageProxy | null, p: number) => {
    if (b) freeBuiltPage(b);
    if (pdfPage && !pageInUse(p)) pdfPage.cleanup();
  };

  /** Stops preparing a page, or drops it built. The page on screen stays until another replaces it. */
  const drop = (key: string) => {
    const b = prepared.current.get(key);
    if (!b) return;
    prepared.current.delete(key);
    b.cancel();
    if (!b.built || b.built !== builtRef.current) release(b.built, b.pdfPage, b.page);
  };

  // Show the current page: built off-screen (or prepared ahead, then it is instant), then
  // swapped in without flicker. The neighbours are prepared while this one is read.
  const layout = `${size.w}x${size.h}|${props.settings.pdfFit}|${props.settings.pdfMargin}|${props.settings.pdfCrop ? 1 : 0}`;
  useEffect(() => {
    if (!doc || !size.w || !size.h) return;
    let cancelled = false;
    let cancelPrefetch: (() => void) | undefined;
    const builds = prepared.current;
    // Pages built for another size or setting are no use now, nor those far from this one.
    for (const [key, b] of builds) {
      if (key.slice(key.indexOf("|") + 1) !== layout || Math.abs(b.page - page) > 1) drop(key);
    }
    const take = (p: number) => {
      const key = `${p}|${layout}`;
      let b = builds.get(key);
      if (!b) {
        b = buildPage(doc, p, size, propsRef.current.settings, crops.current);
        builds.set(key, b);
      }
      return b;
    };
    take(page)
      .promise.then((b) => {
        if (cancelled || !b || !holderRef.current) return;
        fitRef.current = b.fit;
        // The fingers may have kept zooming while this was built: show it at the live zoom.
        b.wrap.style.setProperty("--total-scale-factor", String(b.fit * zoomRef.current));
        // The sharp part drawn while zoomed is drawn again for the page shown.
        discardCanvas(detailEl.current);
        discardCanvas(b.sheet.querySelector<HTMLCanvasElement>(".pdf-detail"));
        detailEl.current = null;
        // The handwriting is drawn before the page shows, so it never blinks.
        sizeInk(b, zoomRef.current);
        const ctx = b.ink.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, b.ink.width, b.ink.height);
          drawStrokes(ctx, propsRef.current.ink?.[page] ?? [], b.ink.width, b.ink.height);
        }
        b.wet.getContext("2d")?.clearRect(0, 0, b.wet.width, b.wet.height);
        const prev = builtRef.current;
        holderRef.current.replaceChildren(b.wrap);
        builtRef.current = b;
        // The page this replaces goes unless it is still prepared (a neighbour).
        if (prev && prev !== b && ![...builds.values()].some((o) => o.built === prev)) release(prev, prev.pdfPage, prev.page);
        pageEl.current = b.wrap;
        sheetEl.current = b.sheet;
        inkEl.current = b.ink;
        wetEl.current = b.wet;
        // A new page starts at its top-left corner.
        if (shownPage.current !== page) stageRef.current?.scrollTo({ top: 0, left: 0 });
        shownPage.current = page;
        setRendered((n) => n + 1);
        cancelPrefetch = afterIdle(
          () => {
            for (const p of [page + 1, page - 1]) if (p >= 1 && p <= doc.numPages) take(p);
            for (const [key, other] of builds) if (Math.abs(other.page - page) > 1) drop(key);
          },
          { delay: 300, timeout: 1000 },
        );
      })
      .catch((err) => console.error(err));
    return () => {
      cancelled = true;
      cancelPrefetch?.();
    };
    // `layout` stands for the size and the page-layout settings.
  }, [doc, page, layout]);

  // A zoomed page that stops scrolling gets its newly visible part drawn sharp.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (zoomRef.current <= 1.01) return;
      clearTimeout(timer);
      timer = setTimeout(() => setScrolled((n) => n + 1), 120);
    };
    stage.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      stage.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Zoomed in: the page canvas keeps its fitted resolution, and the visible part (plus a margin)
  // is drawn sharp on a canvas of its own, placed over it in page fractions so a pinch stretches
  // it along until it is drawn again.
  useEffect(() => {
    const b = builtRef.current;
    const stage = stageRef.current;
    if (!doc || !b || !stage) return;
    if (zoom <= 1.01) {
      discardCanvas(detailEl.current);
      detailEl.current = null;
      return;
    }
    let cancelled = false;
    let task: ReturnType<PDFPageProxy["render"]> | null = null;
    let canvas: HTMLCanvasElement | null = null;
    (async () => {
      const pdfPage = await doc.getPage(b.page);
      if (cancelled) return;
      const s = b.sheet.getBoundingClientRect();
      const v = stage.getBoundingClientRect();
      // A small margin, so a short scroll shows sharp text before the next drawing.
      const mx = v.width / 10;
      const my = v.height / 10;
      const x0 = Math.max(0, v.left - s.left - mx);
      const y0 = Math.max(0, v.top - s.top - my);
      const x1 = Math.min(s.width, v.right - s.left + mx);
      const y1 = Math.min(s.height, v.bottom - s.top + my);
      if (x1 - x0 < 1 || y1 - y0 < 1) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3, Math.sqrt(MAX_DETAIL_PIXELS / ((x1 - x0) * (y1 - y0))));
      const scale = s.width / b.width; // CSS px per PDF unit, right now
      canvas = document.createElement("canvas");
      canvas.width = Math.ceil((x1 - x0) * dpr);
      canvas.height = Math.ceil((y1 - y0) * dpr);
      canvas.className = "pdf-detail";
      placeFraction(canvas, x0 / s.width, y0 / s.height, (x1 - x0) / s.width, (y1 - y0) / s.height);
      task = pdfPage.render({ canvas, viewport: pdfPage.getViewport({ scale: scale * dpr, offsetX: -x0 * dpr, offsetY: -y0 * dpr }) });
      await task.promise;
      if (cancelled || builtRef.current !== b) return void freeCanvas(canvas);
      discardCanvas(detailEl.current);
      b.canvas.after(canvas);
      detailEl.current = canvas;
    })().catch((err) => {
      if (err?.name !== "RenderingCancelledException") console.error(err);
    });
    return () => {
      cancelled = true;
      task?.cancel();
      if (canvas && canvas !== detailEl.current) freeCanvas(canvas); // never shown
    };
  }, [doc, zoom, rendered, scrolled]);

  // Draw highlights (and the current search match) on the page.
  useEffect(() => {
    const sheet = sheetEl.current;
    const layer = sheet?.querySelector<HTMLElement>(".textLayer");
    const hlLayer = sheet?.querySelector<HTMLElement>(".pdf-highlights");
    if (!sheet || !layer || !hlLayer) return;
    hlLayer.replaceChildren();
    hlRects.current = [];
    const origin = sheet.getBoundingClientRect();

    // In fractions of the page, so the marks follow a pinch without being redrawn.
    const draw = (range: Range, cls: string, color?: string) => {
      const rects = [...range.getClientRects()]
        .filter((r) => r.width > 0.5 && r.height > 0.5)
        .map((r) => new DOMRect((r.left - origin.left) / origin.width, (r.top - origin.top) / origin.height, r.width / origin.width, r.height / origin.height));
      for (const r of rects) {
        const el = document.createElement("div");
        el.className = cls;
        placeFraction(el, r.left, r.top, r.width, r.height);
        if (color) el.style.background = color;
        hlLayer.append(el);
      }
      return rects;
    };

    const texts = textNodes(layer);
    for (const h of props.highlights ?? []) {
      // Character offsets into the page's text layer: they don't depend on zoom or screen size.
      const pos = parseLocator(h.cfi);
      if ((pos?.kind !== "pdfRange" && pos?.kind !== "pdfSearch") || pos.page !== page) continue;
      // KOReader's highlights have their page and text: they go where the text is (lib/pdfPassage.ts).
      const span = pos.kind === "pdfRange" ? [pos.start, pos.end] : findPassage(texts.text, h.text);
      const range = span && rangeFor(texts.nodes, span[0]!, span[1]!);
      if (range) hlRects.current.push({ h, rects: draw(range, "pdf-hl", HIGHLIGHT_COLORS[h.color].fill) });
    }

    if (searchHit && searchHit.page === page) {
      const folded = fold(texts.text);
      const q = fold(searchHit.query);
      let at = -1;
      for (let i = 0; i <= searchHit.nth; i++) at = folded.indexOf(q, at + (i ? q.length : 0));
      const range = at >= 0 ? rangeFor(texts.nodes, at, at + q.length) : null;
      if (range) {
        draw(range, "pdf-search-hit");
        range.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
  }, [props.highlights, rendered, page, searchHit]);

  /** Draws the page's strokes, minus those the eraser is going over. */
  const drawInk = useCallback(() => {
    const c = inkEl.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    const hidden = drawing.current?.removed;
    drawStrokes(ctx, (propsRef.current.ink?.[pageRef.current] ?? []).filter((s) => !hidden?.has(s.id)), c.width, c.height);
  }, []);

  const clearWet = () => {
    const c = wetEl.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
  };

  // Redraw the handwriting when the page is shown, its strokes change or a zoom settles (at
  // the new resolution). A stroke just finished stays on the top canvas until then, so it never blinks.
  const pageInk = props.ink?.[page];
  useEffect(() => {
    const b = builtRef.current;
    if (b && !drawing.current) sizeInk(b, zoomRef.current);
    drawInk();
    if (!drawing.current) clearWet();
  }, [rendered, pageInk, zoom, drawInk]);

  // Annotating: a pen or a mouse (or a finger, when allowed) draws; other fingers still scroll,
  // pinch and turn pages. While the pen is down, touches (a resting palm) are ignored.
  const inking = !!props.inkMode;
  useEffect(() => {
    const wet = wetEl.current;
    const stage = stageRef.current;
    if (!inking || !wet || !stage) return;
    if (builtRef.current) sizeInk(builtRef.current, zoomRef.current); // give the stroke canvas its size
    let frame = 0;
    /** The eraser redraws the page's strokes once per frame too. */
    let inkFrame = 0;
    /** Fingers on the page that don't draw; one of them scrolls it. */
    const fingers = new Set<number>();
    let pan: { id: number; x: number; y: number } | null = null;

    const paintWet = () => {
      frame = 0;
      const ctx = wet.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, wet.width, wet.height);
      const stroke = drawing.current?.stroke;
      if (stroke) drawStrokes(ctx, [stroke], wet.width, wet.height);
    };

    const add = (ev: PointerEvent) => {
      const d = drawing.current;
      if (!d) return;
      const coalesced = ev.getCoalescedEvents?.() ?? [];
      let erased = false;
      for (const e of coalesced.length ? coalesced : [ev]) {
        const x = (e.clientX - d.rect.left) / d.rect.width;
        const y = (e.clientY - d.rect.top) / d.rect.height;
        if (d.stroke) {
          d.stroke.points.push(...strokePoint(x, y, e.pointerType === "pen" ? e.pressure : 0.5));
          if (d.stroke.points.length >= MAX_STROKE_POINTS * 3) {
            // A very long stroke is saved in pieces (the server takes up to 10,000 points per stroke).
            const piece = d.stroke;
            propsRef.current.onInkChange?.(pageRef.current, { add: [piece], remove: [] });
            d.stroke = { ...piece, id: crypto.randomUUID(), points: piece.points.slice(-3) };
          }
          continue;
        }
        const aspect = d.rect.height / d.rect.width;
        for (const s of propsRef.current.ink?.[pageRef.current] ?? []) {
          if (!d.removed.has(s.id) && touchesStroke(s, x, y, ERASER_RADIUS, aspect)) {
            d.removed.add(s.id);
            erased = true;
          }
        }
      }
      if (d.stroke) frame ||= requestAnimationFrame(paintWet);
      else if (erased)
        inkFrame ||= requestAnimationFrame(() => {
          inkFrame = 0;
          drawInk();
        });
    };

    const onDown = (ev: PointerEvent) => {
      const mode = propsRef.current.inkMode;
      const sheet = sheetEl.current;
      if (!mode || !sheet) return;
      if (drawing.current) return void ev.stopPropagation();
      const draws = ev.pointerType === "pen" || (ev.pointerType === "mouse" ? ev.button === 0 : mode.fingerDraws);
      if (!draws) {
        fingers.add(ev.pointerId);
        pan = fingers.size === 1 ? { id: ev.pointerId, x: ev.clientX, y: ev.clientY } : null; // two fingers: a pinch
        return;
      }
      ev.stopPropagation();
      ev.preventDefault();
      pan = null;
      wet.setPointerCapture(ev.pointerId);
      const eraser = mode.tool === "eraser" || (ev.buttons & 32) !== 0; // 32: the pen's eraser end
      drawing.current = {
        id: ev.pointerId,
        rect: sheet.getBoundingClientRect(),
        removed: new Set(),
        stroke: eraser ? null : { id: crypto.randomUUID(), tool: mode.tool as InkTool, color: mode.color, width: mode.width, points: [] },
      };
      add(ev);
    };

    const onMove = (ev: PointerEvent) => {
      if (pan?.id === ev.pointerId) {
        // Annotating turns the browser's own panning off (a pen must not scroll), so fingers scroll here.
        stage.scrollBy(pan.x - ev.clientX, pan.y - ev.clientY);
        pan = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
        return;
      }
      if (drawing.current?.id !== ev.pointerId) return;
      ev.stopPropagation();
      add(ev);
    };

    const onEnd = (ev: PointerEvent) => {
      fingers.delete(ev.pointerId);
      if (pan?.id === ev.pointerId) pan = null;
      const d = drawing.current;
      if (d?.id !== ev.pointerId) return;
      ev.stopPropagation();
      cancelAnimationFrame(frame);
      paintWet();
      if (inkFrame) {
        // The last strokes erased show gone before the change is applied.
        cancelAnimationFrame(inkFrame);
        inkFrame = 0;
        drawInk();
      }
      drawing.current = null;
      const change = d.stroke ? (d.stroke.points.length >= 3 ? { add: [d.stroke], remove: [] } : null) : d.removed.size ? { add: [], remove: [...d.removed] } : null;
      if (change) propsRef.current.onInkChange?.(pageRef.current, change);
      else {
        clearWet();
        drawInk();
      }
    };

    // A pen's touches, and any touch while it draws, stay away from the pinch-zoom.
    const onTouch = (ev: TouchEvent) => {
      const stylus = Array.from(ev.changedTouches).some((t) => (t as Touch & { touchType?: string }).touchType === "stylus");
      if (drawing.current || stylus) ev.stopPropagation();
    };

    const listening = new AbortController();
    const { signal } = listening;
    wet.addEventListener("pointerdown", onDown, { signal });
    wet.addEventListener("pointermove", onMove, { signal });
    wet.addEventListener("pointerup", onEnd, { signal });
    wet.addEventListener("pointercancel", onEnd, { signal });
    for (const t of ["touchstart", "touchmove", "touchend"] as const) wet.addEventListener(t, onTouch, { passive: true, signal });
    return () => {
      listening.abort();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(inkFrame);
      drawing.current = null;
      clearWet();
      if (builtRef.current) sizeInk(builtRef.current, zoomRef.current); // done annotating: free the stroke canvas
      drawInk();
    };
  }, [inking, rendered, drawInk]);

  // Report text selections (debounced, like the ebook reader).
  useEffect(() => {
    const onChange = selections.listener(() => {
      const layer = sheetEl.current?.querySelector<HTMLElement>(".textLayer");
      const sel = window.getSelection();
      const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
      const text = sel?.toString().trim() ?? "";
      if (!layer || !range || sel!.isCollapsed || !text || !layer.contains(range.commonAncestorContainer)) return null;
      const { nodes } = textNodes(layer);
      const start = offsetOf(nodes, range.startContainer, range.startOffset);
      const end = offsetOf(nodes, range.endContainer, range.endOffset);
      if (end <= start) return undefined; // leave the menu as it is
      return { cfi: pdfRangeLocator(pageRef.current, start, end), text, rect: range.getBoundingClientRect() };
    });
    document.addEventListener("selectionchange", onChange);
    return () => {
      onChange.cancel();
      document.removeEventListener("selectionchange", onChange);
    };
  }, [selections, pageRef]);

  // Swipe, tap and highlight-click handling. Two-finger gestures are pinches (pinchZoom.ts).
  const pointer = useRef<{ x: number; y: number; t: number } | null>(null);
  const fingers = useRef(new Set<number>());
  const multiTouch = useRef(false);
  /** A touch tap waits a moment: a second tap makes it a double-tap (zoom) instead. */
  const pendingTap = useRef<{ t: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  useEffect(() => () => clearTimeout(pendingTap.current?.timer), []);

  const tapAt = (clientX: number) => {
    if (!stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const zone = freeZone(clientX - rect.left, rect.width, pinch.current);
    if (zone) propsRef.current.onTap(zone);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    fingers.current.add(e.pointerId);
    if (fingers.current.size > 1) multiTouch.current = true;
    pointer.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  };
  const onPointerEnd = (e: React.PointerEvent) => {
    fingers.current.delete(e.pointerId);
    const pinched = multiTouch.current;
    if (!fingers.current.size) multiTouch.current = false;
    const start = pointer.current;
    pointer.current = null;
    if (!start || pinched || e.type === "pointercancel" || !stageRef.current) return;
    // Dragging over text selects it; that must not turn the page.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      // Zoomed in, a swipe moves around the page instead.
      if (!pinch.current?.busy()) go(dx < 0 ? page + 1 : page - 1, true);
    } else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const origin = sheetEl.current?.getBoundingClientRect();
      if (origin) {
        const x = (e.clientX - origin.left) / origin.width;
        const y = (e.clientY - origin.top) / origin.height;
        const hit = hlRects.current.find(({ rects }) => rects.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom));
        if (hit) {
          const r = hit.rects[0]!;
          const rect = new DOMRect(origin.left + r.left * origin.width, origin.top + r.top * origin.height, r.width * origin.width, r.height * origin.height);
          propsRef.current.onHighlightClick?.(hit.h, rect);
          return;
        }
      }
      if (e.pointerType !== "touch") return tapAt(e.clientX);
      const prev = pendingTap.current;
      if (prev && e.timeStamp - prev.t < 300 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 30) {
        clearTimeout(prev.timer);
        pendingTap.current = null;
        return;
      }
      const clientX = e.clientX;
      pendingTap.current = {
        t: e.timeStamp,
        x: e.clientX,
        y: e.clientY,
        timer: setTimeout(() => {
          pendingTap.current = null;
          tapAt(clientX);
        }, 280),
      };
    }
  };

  return (
    <div
      ref={stageRef}
      className="h-full w-full overflow-auto"
      // The app zooms the page itself (pinchZoom.ts), so the browser's own pinch stays off.
      // Sideways drags pan a zoomed page; at page size they are swipes that turn it.
      style={{ background: THEMES[props.settings.theme].surround, touchAction: zoom > 1 ? "pan-x pan-y" : "pan-y" }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      {/* The page centers with m-auto (not justify-center), so a zoomed page still scrolls to its left edge. */}
      <div
        ref={holderRef}
        className={`flex min-h-full w-max min-w-full ${inking ? "pdf-inking" : ""}`}
        style={{ padding: props.settings.pdfMargin, filter: PAGE_FILTERS[props.settings.theme] ?? "none" }}
      />
    </div>
  );
});
