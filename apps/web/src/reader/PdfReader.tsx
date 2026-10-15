import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { authHeaders, type Highlight } from "../lib/api";
import { bookFileUrl, cachedBookFile } from "../lib/books";
import { HIGHLIGHT_COLORS } from "../lib/highlights";
import { pdfjs, type PDFDocumentProxy, type PDFPageProxy } from "../lib/pdf";
import { canvasPixelRatio, contentBox, fitScale, FULL_PAGE, type PageBox } from "../lib/pdfLayout";
import { MAX_ZOOM, pinchController, type PinchController } from "../lib/pinchZoom";
import { THEMES, type ReaderSettings } from "../lib/settings";
import { zoneFromX, type ReaderHandle, type ReaderProps, type SearchResult } from "./types";

/** PDFs can't reflow, so "themes" are applied as color filters on the rendered page. */
function pageFilter(s: ReaderSettings) {
  switch (s.theme) {
    case "black":
      return "invert(1) hue-rotate(180deg)";
    case "dark":
      return "invert(0.88) hue-rotate(180deg)";
    case "sepia":
      return "sepia(0.35) brightness(0.97)";
    default:
      return "none";
  }
}

function parsePage(locator: string | null) {
  const m = locator ? /^(?:page|pdf|pdfsearch):(\d+)/.exec(locator) : null;
  return m ? Number(m[1]) : 1;
}

/**
 * Text positions on a page are character offsets into the page's text layer, so a
 * highlight is "pdf:<page>:<start>-<end>" and does not depend on zoom or screen size.
 */
function parseRange(locator: string) {
  const m = /^pdf:(\d+):(\d+)-(\d+)$/.exec(locator);
  return m ? { page: Number(m[1]), start: Number(m[2]), end: Number(m[3]) } : null;
}

/** Text nodes of a text layer, in reading order, with their starting offsets. */
function textNodes(layer: HTMLElement) {
  const nodes: { node: Text; start: number }[] = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  let offset = 0;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    nodes.push({ node: n, start: offset });
    offset += n.data.length;
  }
  return { nodes, text: nodes.map((n) => n.node.data).join("") };
}

/** A DOM range for [start, end) in the text layer. */
function rangeFor(layer: HTMLElement, start: number, end: number) {
  const { nodes } = textNodes(layer);
  const at = (offset: number) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i]!.start <= offset) return { node: nodes[i]!.node, offset: Math.min(offset - nodes[i]!.start, nodes[i]!.node.data.length) };
    }
    return null;
  };
  const a = at(start);
  const b = at(end);
  if (!a || !b) return null;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

function offsetOf(layer: HTMLElement, container: Node, offset: number) {
  const { nodes } = textNodes(layer);
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

/** Where a page's content is: rendered small and scanned for non-white pixels. */
async function detectContent(pdfPage: PDFPageProxy): Promise<PageBox> {
  const viewport = pdfPage.getViewport({ scale: 240 / pdfPage.getViewport({ scale: 1 }).width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await pdfPage.render({ canvas, viewport }).promise;
  const ctx = canvas.getContext("2d");
  if (!ctx) return FULL_PAGE;
  return contentBox(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
}

/** Zoom factor of one step of the + and − buttons and keys. */
const ZOOM_STEP = 1.25;

export const PdfReader = forwardRef<ReaderHandle, ReaderProps>(function PdfReader(props, ref) {
  const stageRef = useRef<HTMLDivElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  /**
   * The current page's wrapper: the visible (possibly cropped) part of the page, sized by
   * --total-scale-factor, holding the whole page sheet (canvas + highlight layer + text layer).
   */
  const pageEl = useRef<HTMLDivElement | null>(null);
  const sheetEl = useRef<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(() => parsePage(props.initialLocator));
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
  const pageRef = useRef(page);
  pageRef.current = page;
  const propsRef = useRef(props);
  propsRef.current = props;
  /** Highlight rectangles on the current page (fractions of the page), for click hit-testing. */
  const hlRects = useRef<{ h: Highlight; rects: DOMRect[] }[]>([]);
  const selectionShown = useRef(false);

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const action = e.key === "+" || e.key === "=" ? "in" : e.key === "-" ? "out" : e.key === "0" ? "reset" : null;
      if (!action) return;
      e.preventDefault();
      zoomStep(action);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zoomStep]);

  useImperativeHandle(ref, () => ({
    next: () => go(page + 1, true),
    prev: () => go(page - 1, true),
    goToFraction: (f) => go(Math.round(f * (numPages - 1)) + 1, true),
    goToHref: (href) => {
      const m = /^pdfsearch:(\d+):(\d+):(.*)$/s.exec(href);
      setSearchHit(m ? { page: Number(m[1]), nth: Number(m[2]), query: m[3]! } : null);
      go(parsePage(href), true);
    },
    restore: (locator) => go(parsePage(locator), false),
    clearSelection: () => {
      window.getSelection()?.removeAllRanges();
      selectionShown.current = false;
      propsRef.current.onSelection?.(null);
    },
    clearSearch: () => setSearchHit(null),
    zoom: zoomStep,
    search: async (query, onResult, signal) => {
      if (!doc) return;
      const q = fold(query.trim());
      if (!q) return;
      for (let p = 1; p <= doc.numPages && !signal.aborted; p++) {
        const content = await (await doc.getPage(p)).getTextContent();
        // Same text the text layer shows: one text node per item, in order.
        const text = content.items.map((it) => ("str" in it ? it.str : "")).join("");
        const folded = fold(text);
        let nth = 0;
        for (let at = folded.indexOf(q); at !== -1; at = folded.indexOf(q, at + q.length)) {
          const r: SearchResult = { locator: `pdfsearch:${p}:${nth++}:${query.trim()}`, label: `Page ${p}`, excerpt: excerpt(text, at, q.length) };
          onResult(r);
        }
      }
    },
  }));

  // Open the copy saved on this device if there is one (works offline), otherwise
  // stream it with HTTP range requests (large PDFs start fast).
  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof pdfjs.getDocument> | null = null;
    const open = async () => {
      const saved = await cachedBookFile(props.book.id).catch(() => null);
      if (cancelled) throw new Error("cancelled");
      task = saved
        ? pdfjs.getDocument({ data: new Uint8Array(await saved.arrayBuffer()) })
        : pdfjs.getDocument({
            url: bookFileUrl(props.book.id),
            httpHeaders: authHeaders(),
            withCredentials: true,
            disableAutoFetch: true,
            rangeChunkSize: 256 * 1024,
          });
      return task.promise;
    };
    open()
      .then(async (d) => {
        if (cancelled) return void d.loadingTask.destroy();
        crops.current.clear();
        setDoc(d);
        setPage((p) => Math.min(Math.max(1, p), d.numPages));
        const meta = await d.getMetadata().catch(() => null);
        const lang = (meta?.info as { Language?: string } | undefined)?.Language ?? null;
        propsRef.current.onReady({ totalPages: d.numPages, language: lang });
      })
      .catch((err) => {
        if (!cancelled) propsRef.current.onError(navigator.onLine ? (err?.message ?? "Could not open this PDF") : "This PDF is not saved on this device. Connect to the internet to open it.");
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
        locator: `page:${page}`,
        percentage: numPages > 1 ? (page - 1) / (numPages - 1) : 1,
        label: `Page ${page} of ${numPages}`,
      },
      byUser,
    );
  }, [page, numPages]);

  // Render the current page (canvas + selectable text layer) off-screen, then swap (no flicker).
  // Runs again once a zoom settles, to draw the page sharp at its new size.
  useEffect(() => {
    if (!doc || !size.w || !size.h) return;
    let cancelled = false;
    let renderTask: ReturnType<PDFPageProxy["render"]> | null = null;
    (async () => {
      const pdfPage = await doc.getPage(page);
      if (cancelled) return;
      const settings = propsRef.current.settings;
      const base = pdfPage.getViewport({ scale: 1 });
      let box = FULL_PAGE;
      if (settings.pdfCrop) {
        box = crops.current.get(page) ?? (await detectContent(pdfPage));
        crops.current.set(page, box);
        if (cancelled) return;
      }
      // The visible part of the page, in PDF units.
      const cropW = base.width * (box.x1 - box.x0);
      const cropH = base.height * (box.y1 - box.y0);
      const fit = fitScale({ w: cropW, h: cropH }, size, settings.pdfMargin, settings.pdfFit);
      const scale = fit * zoom;
      const dpr = canvasPixelRatio(base.width * scale, base.height * scale, window.devicePixelRatio);
      const viewport = pdfPage.getViewport({ scale: scale * dpr });
      const cssViewport = pdfPage.getViewport({ scale });

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
      sheet.append(canvas, hl, text);
      wrap.append(sheet);

      renderTask = pdfPage.render({ canvas, viewport });
      const textLayer = new pdfjs.TextLayer({ textContentSource: pdfPage.streamTextContent(), container: text, viewport: cssViewport });
      await Promise.all([renderTask.promise, textLayer.render()]);
      if (cancelled || !holderRef.current) return;
      // The fingers may have kept zooming while this was drawn: show it at the live zoom.
      fitRef.current = fit;
      wrap.style.setProperty("--total-scale-factor", String(fit * zoomRef.current));
      holderRef.current.replaceChildren(wrap);
      pageEl.current = wrap;
      sheetEl.current = sheet;
      // A new page starts at its top-left corner; a sharper redraw of the same one stays put.
      if (shownPage.current !== page) stageRef.current?.scrollTo({ top: 0, left: 0 });
      shownPage.current = page;
      setRendered((n) => n + 1);
      // Warm up the next page in the background.
      if (page < doc.numPages) void doc.getPage(page + 1);
    })().catch((err) => {
      if (err?.name !== "RenderingCancelledException") console.error(err);
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, page, size, zoom, props.settings.pdfFit, props.settings.pdfMargin, props.settings.pdfCrop]);

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
        Object.assign(el.style, {
          left: `${r.left * 100}%`,
          top: `${r.top * 100}%`,
          width: `${r.width * 100}%`,
          height: `${r.height * 100}%`,
          ...(color ? { background: color } : {}),
        });
        hlLayer.append(el);
      }
      return rects;
    };

    for (const h of props.highlights ?? []) {
      const pos = parseRange(h.cfi);
      if (!pos || pos.page !== page) continue;
      const range = rangeFor(layer, pos.start, pos.end);
      if (range) hlRects.current.push({ h, rects: draw(range, "pdf-hl", HIGHLIGHT_COLORS[h.color].fill) });
    }

    if (searchHit && searchHit.page === page) {
      const { text } = textNodes(layer);
      const folded = fold(text);
      const q = fold(searchHit.query);
      let at = -1;
      for (let i = 0; i <= searchHit.nth; i++) at = folded.indexOf(q, at + (i ? q.length : 0));
      const range = at >= 0 ? rangeFor(layer, at, at + q.length) : null;
      if (range) {
        draw(range, "pdf-search-hit");
        range.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
  }, [props.highlights, rendered, page, searchHit]);

  // Report text selections (debounced, like the ebook reader).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const layer = sheetEl.current?.querySelector<HTMLElement>(".textLayer");
        const sel = window.getSelection();
        const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
        const text = sel?.toString().trim() ?? "";
        if (!layer || !range || sel!.isCollapsed || !text || !layer.contains(range.commonAncestorContainer)) {
          if (selectionShown.current) {
            selectionShown.current = false;
            propsRef.current.onSelection?.(null);
          }
          return;
        }
        const start = offsetOf(layer, range.startContainer, range.startOffset);
        const end = offsetOf(layer, range.endContainer, range.endOffset);
        if (end <= start) return;
        selectionShown.current = true;
        propsRef.current.onSelection?.({ cfi: `pdf:${pageRef.current}:${start}-${end}`, text, rect: range.getBoundingClientRect() });
      }, 350);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", onChange);
    };
  }, []);

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
    const zone = zoneFromX(clientX - rect.left, rect.width);
    // Zoomed in: side taps would turn the page away; the middle still shows the bars.
    if (zone !== "center" && pinch.current?.busy()) return;
    propsRef.current.onTap(zone);
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
      <div ref={holderRef} className="flex min-h-full w-max min-w-full" style={{ padding: props.settings.pdfMargin, filter: pageFilter(props.settings) }} />
    </div>
  );
});
