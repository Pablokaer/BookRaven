import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { authHeaders, type Highlight } from "../lib/api";
import { bookFileUrl } from "../lib/books";
import { HIGHLIGHT_COLORS } from "../lib/highlights";
import { pdfjs, type PDFDocumentProxy } from "../lib/pdf";
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

export const PdfReader = forwardRef<ReaderHandle, ReaderProps>(function PdfReader(props, ref) {
  const stageRef = useRef<HTMLDivElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  /** The current page's wrapper (canvas + highlight layer + text layer). */
  const pageEl = useRef<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(() => parsePage(props.initialLocator));
  const [size, setSize] = useState({ w: 0, h: 0 });
  /** Bumped after each page render, so overlays are redrawn. */
  const [rendered, setRendered] = useState(0);
  /** Search match to outline on its page: nth occurrence of the query there. */
  const [searchHit, setSearchHit] = useState<{ page: number; query: string; nth: number } | null>(null);
  const userNav = useRef(false);
  const pageRef = useRef(page);
  pageRef.current = page;
  const propsRef = useRef(props);
  propsRef.current = props;
  /** Highlight rectangles on the current page (page coordinates), for click hit-testing. */
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

  // Open the document with HTTP range requests (large PDFs start fast).
  useEffect(() => {
    let cancelled = false;
    const task = pdfjs.getDocument({
      url: bookFileUrl(props.book.id),
      httpHeaders: authHeaders(),
      withCredentials: true,
      disableAutoFetch: true,
      rangeChunkSize: 256 * 1024,
    });
    task.promise
      .then(async (d) => {
        if (cancelled) return void d.loadingTask.destroy();
        setDoc(d);
        setPage((p) => Math.min(Math.max(1, p), d.numPages));
        const meta = await d.getMetadata().catch(() => null);
        const lang = (meta?.info as { Language?: string } | undefined)?.Language ?? null;
        propsRef.current.onReady({ totalPages: d.numPages, language: lang });
      })
      .catch((err) => {
        if (!cancelled) propsRef.current.onError(err?.message ?? "Could not open this PDF");
      });
    return () => {
      cancelled = true;
      void task.destroy();
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
  useEffect(() => {
    if (!doc || !size.w || !size.h) return;
    let cancelled = false;
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | null = null;
    (async () => {
      const pdfPage = await doc.getPage(page);
      if (cancelled) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const pad = 16;
      const fitWidth = (size.w - pad * 2) / base.width;
      const fitPage = Math.min(fitWidth, (size.h - pad * 2) / base.height);
      const scale = propsRef.current.settings.pdfFit === "width" ? fitWidth : fitPage;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const viewport = pdfPage.getViewport({ scale: scale * dpr });
      const cssViewport = pdfPage.getViewport({ scale });

      const wrap = document.createElement("div");
      wrap.className = "pdf-page relative mx-auto";
      wrap.style.width = `${Math.floor(cssViewport.width)}px`;
      wrap.style.height = `${Math.floor(cssViewport.height)}px`;
      wrap.style.setProperty("--total-scale-factor", String(scale));
      wrap.style.setProperty("--scale-round-x", "1px");
      wrap.style.setProperty("--scale-round-y", "1px");

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      const light = ["light", "sepia"].includes(propsRef.current.settings.theme);
      canvas.className = `block bg-white ${light ? "shadow-lg" : ""}`;

      const hl = document.createElement("div");
      hl.className = "pdf-highlights";
      const text = document.createElement("div");
      text.className = "textLayer";
      wrap.append(canvas, hl, text);

      renderTask = pdfPage.render({ canvas, viewport });
      const textLayer = new pdfjs.TextLayer({ textContentSource: pdfPage.streamTextContent(), container: text, viewport: cssViewport });
      await Promise.all([renderTask.promise, textLayer.render()]);
      if (cancelled || !holderRef.current) return;
      holderRef.current.replaceChildren(wrap);
      pageEl.current = wrap;
      stageRef.current?.scrollTo({ top: 0 });
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
  }, [doc, page, size, props.settings.pdfFit]);

  // Draw highlights (and the current search match) on the page.
  useEffect(() => {
    const wrap = pageEl.current;
    const layer = wrap?.querySelector<HTMLElement>(".textLayer");
    const hlLayer = wrap?.querySelector<HTMLElement>(".pdf-highlights");
    if (!wrap || !layer || !hlLayer) return;
    hlLayer.replaceChildren();
    hlRects.current = [];
    const origin = wrap.getBoundingClientRect();

    const draw = (range: Range, cls: string, color?: string) => {
      const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      for (const r of rects) {
        const el = document.createElement("div");
        el.className = cls;
        Object.assign(el.style, {
          left: `${r.left - origin.left}px`,
          top: `${r.top - origin.top}px`,
          width: `${r.width}px`,
          height: `${r.height}px`,
          ...(color ? { background: color } : {}),
        });
        hlLayer.append(el);
      }
      return rects.map((r) => new DOMRect(r.left - origin.left, r.top - origin.top, r.width, r.height));
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
        const layer = pageEl.current?.querySelector<HTMLElement>(".textLayer");
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

  // Swipe, tap and highlight-click handling.
  const pointer = useRef<{ x: number; y: number; t: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    pointer.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = pointer.current;
    pointer.current = null;
    if (!start || !stageRef.current) return;
    // Dragging over text selects it; that must not turn the page.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      go(dx < 0 ? page + 1 : page - 1, true);
    } else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const origin = pageEl.current?.getBoundingClientRect();
      if (origin) {
        const x = e.clientX - origin.left;
        const y = e.clientY - origin.top;
        const hit = hlRects.current.find(({ rects }) => rects.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom));
        if (hit) {
          const r = hit.rects[0]!;
          propsRef.current.onHighlightClick?.(hit.h, new DOMRect(r.left + origin.left, r.top + origin.top, r.width, r.height));
          return;
        }
      }
      const rect = stageRef.current.getBoundingClientRect();
      props.onTap(zoneFromX(e.clientX - rect.left, rect.width));
    }
  };

  return (
    <div
      ref={stageRef}
      className="h-full w-full overflow-auto"
      style={{ background: THEMES[props.settings.theme].surround, touchAction: "pan-y pinch-zoom" }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <div ref={holderRef} className="flex min-h-full items-center justify-center p-4" style={{ filter: pageFilter(props.settings) }} />
    </div>
  );
});
