import type { FoliateView, RelocateDetail } from "foliate-js/view.js";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Overlayer } from "foliate-js/overlayer.js";
import type { Highlight } from "../lib/api";
import { cachedWidePages, getComicArchive, isComicFormat, makeComicBook, scanWidePages, type ComicArchive } from "../lib/comics";
import { openEbook } from "../lib/ebooks";
import { fontFaceCss, fontFamily } from "../lib/fonts";
import { HIGHLIGHT_COLORS } from "../lib/highlights";
import { attachLens } from "../lib/lens";
import { pinchController, transformSurface, type PinchController } from "../lib/pinchZoom";
import { THEMES, type ReaderSettings } from "../lib/settings";
import { useLatest } from "../lib/useLatest";
import { freeZone, selectionReporter, USER_NAV_WINDOW_MS, type ReaderHandle, type ReaderProps } from "./types";

/** Percentage positions ("fraction:0.42") reported by other apps such as KOReader. */
function fractionOf(locator: string | null) {
  const m = locator ? /^fraction:([\d.]+)$/.exec(locator) : null;
  return m ? Math.min(1, Math.max(0, Number(m[1]))) : null;
}

/** A range's box in the app's viewport (ranges live inside the book's iframes). */
function viewportRect(range: Range) {
  const r = range.getBoundingClientRect();
  const frame = range.startContainer.ownerDocument?.defaultView?.frameElement;
  const f = frame?.getBoundingClientRect() ?? { left: 0, top: 0 };
  return DOMRect.fromRect({ x: f.left + r.left, y: f.top + r.top, width: r.width, height: r.height });
}

/** CSS injected into every book section (iframe). */
function bookCss(s: ReaderSettings): string {
  const t = THEMES[s.theme];
  const family = fontFamily(s.font);
  const dark = s.theme === "dark" || s.theme === "black";
  return `
    ${fontFaceCss(s.font)}
    html { color-scheme: ${dark ? "dark" : "light"}; font-size: ${s.fontSize}% !important; }
    ${
      s.overrideColors
        ? `html { --theme-bg-color: ${t.bg}; }
           html, body { background: ${t.bg} !important; color: ${t.fg} !important; }
           body *:not(img):not(svg):not(svg *) { color: inherit !important; background-color: transparent !important; }
           a:link, a:visited, a:link *, a:visited * { color: ${t.link} !important; }`
        : ""
    }
    ${
      family
        ? `body, body *:not(code):not(pre):not(kbd):not(samp) { font-family: ${family} !important; }`
        : ""
    }
    p, li, blockquote, dd, div {
      line-height: ${s.lineHeight} !important;
    }
    ${s.letterSpacing ? `body, body * { letter-spacing: ${s.letterSpacing}em !important; }` : ""}
    p, li, blockquote, dd {
      text-align: ${s.justify ? "justify" : "start"};
      hyphens: ${s.justify ? "auto" : "manual"};
      -webkit-hyphens: ${s.justify ? "auto" : "manual"};
      widows: 2; orphans: 2;
    }
    [align="left"] { text-align: left; }
    [align="right"] { text-align: right; }
    [align="center"] { text-align: center; }
    pre { white-space: pre-wrap !important; }
    ${dark ? "img { filter: brightness(0.9); }" : ""}
  `;
}

/** The book CSS last given to each renderer (a new renderer starts without one). */
const appliedCss = new WeakMap<Element, string>();

function applySettings(view: FoliateView, s: ReaderSettings, comic: boolean) {
  const r = view.renderer;
  if (!r) return;
  // foliate lays the whole section out again on every attribute set, even to the same value:
  // only touch what changed, so unrelated settings changes don't re-render the page.
  const set = (name: string, value: string) => {
    if (r.getAttribute(name) !== value) r.setAttribute(name, value);
  };
  const t = THEMES[s.theme];
  const host = view.parentElement;
  if (comic) {
    // Fixed-layout pages: only the fit and the surrounding color apply; the view fills the screen.
    set("zoom", s.comicFit === "width" ? "fit-width" : "fit-page");
    view.style.background = "transparent";
    view.style.boxShadow = "none";
    if (host) {
      host.style.background = t.surround;
      host.style.setProperty("--page-width", "100vw");
      host.style.setProperty("--page-count", "1");
    }
    return;
  }
  set("flow", "paginated");
  set("animated", "");
  set("gap", `${s.margin}%`);
  set("margin", `${s.marginY}px`);
  set("max-inline-size", `${s.pageWidth}px`);
  set("max-column-count", String(s.columns));
  const css = bookCss(s);
  if (r.setStyles && appliedCss.get(r) !== css) {
    r.setStyles(css);
    appliedCss.set(r, css);
  }
  view.style.background = t.bg;
  view.style.boxShadow = t.bg === t.surround ? "0 0 0 1px rgb(255 255 255 / 0.12)" : "0 0 24px rgb(0 0 0 / 0.08)";
  // The host centers the view (one page, or a spread) and paints the area around it.
  if (host) {
    host.style.background = t.surround;
    host.style.setProperty("--page-width", `${s.pageWidth}px`);
    host.style.setProperty("--page-count", String(s.columns));
  }
}

/**
 * Reader for everything foliate-js renders: reflowable ebooks (EPUB, MOBI, AZW3, FB2)
 * and comics (CBZ, CBR, CB7, CBT) as fixed-layout pages.
 */
export const EpubReader = forwardRef<ReaderHandle, ReaderProps>(function EpubReader(props, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const lastInteraction = useRef(0);
  const ready = useRef(false);
  /** cfi -> color of the highlights currently drawn. */
  const drawn = useRef(new Map<string, string>());
  const annotationClickAt = useRef(0);
  /** Last position, so the book can be reopened in place when the comic layout changes. */
  const lastLocator = useRef<{ bookId: string; cfi: string } | null>(null);
  const comic = isComicFormat(props.book.format);
  /** Comic pages that are double-page scans (null until known); they get a spread of their own. */
  const [wide, setWide] = useState<number[] | null>(() => (comic ? cachedWidePages(props.book.id) : null));
  const wideRef = useLatest(wide);
  // Spreads, reading direction and wide pages are fixed when foliate opens a book, so changing them reopens it.
  const comicLayout = comic ? `${props.settings.comicSpreads}-${props.settings.comicDirection}-${wide?.join(",") ?? ""}` : "";
  // Keep latest props without re-running the open effect.
  const propsRef = useLatest(props);
  const [selections] = useState(() => selectionReporter(propsRef));
  /** The highlights by position (the first one, if two share it), for foliate's per-annotation events. */
  const byCfi = useLatest(
    useMemo(() => {
      const map = new Map<string, Highlight>();
      for (const h of props.highlights ?? []) if (!map.has(h.cfi)) map.set(h.cfi, h);
      return map;
    }, [props.highlights]),
  );

  const mark = () => (lastInteraction.current = Date.now());
  /** User navigation: it counts as an interaction, so the new position is saved. */
  const nav =
    <A extends unknown[]>(go: (view: FoliateView, ...args: A) => Promise<unknown>) =>
    (...args: A) => {
      mark();
      if (viewRef.current) void go(viewRef.current, ...args);
    };
  /** Comics: pinch-to-zoom on the page (null for text books). */
  const zoomRef = useRef<PinchController | null>(null);

  useImperativeHandle(ref, () => ({
    next: nav((view) => view.goRight()),
    prev: nav((view) => view.goLeft()),
    goToFraction: nav((view, f: number) => view.goToFraction(f)),
    goToHref: nav((view, href: string) => view.goTo(href)),
    restore: (locator) => {
      lastInteraction.current = 0;
      const fraction = fractionOf(locator);
      void (fraction !== null ? viewRef.current?.goToFraction(fraction) : viewRef.current?.goTo(locator));
    },
    search: async (query, onResult, signal) => {
      const view = viewRef.current;
      if (!view) return;
      view.clearSearch();
      for await (const item of view.search({ query, matchCase: false, matchDiacritics: false })) {
        if (signal.aborted) break;
        if (item === "done") break;
        if ("subitems" in item) {
          for (const s of item.subitems) onResult({ locator: s.cfi, label: item.label, excerpt: s.excerpt });
        } else if ("cfi" in item) {
          onResult({ locator: item.cfi, label: "", excerpt: item.excerpt });
        }
      }
    },
    clearSearch: () => viewRef.current?.clearSearch(),
    clearSelection: () => {
      for (const { doc } of viewRef.current?.renderer.getContents?.() ?? []) doc.getSelection()?.removeAllRanges();
      selections.cleared();
    },
  }));

  /** Draws added/recolored highlights and erases removed ones. */
  const syncHighlights = (view: FoliateView) => {
    const want = new Map((propsRef.current.highlights ?? []).map((h) => [h.cfi, h.color]));
    for (const cfi of [...drawn.current.keys()]) {
      if (want.has(cfi)) continue;
      drawn.current.delete(cfi);
      view.deleteAnnotation({ value: cfi }).catch(() => {});
    }
    for (const [cfi, color] of want) {
      if (drawn.current.get(cfi) === color) continue;
      drawn.current.set(cfi, color);
      view.addAnnotation({ value: cfi }).catch(() => {});
    }
  };

  useEffect(() => {
    let cancelled = false;
    let view: FoliateView | null = null;
    let detachHostZoom: (() => void) | null = null;
    const scanAbort = new AbortController();

    (async () => {
      const { book, settings } = propsRef.current;
      // The reader's code and the book's first bytes download at the same time.
      const [, opened] = await Promise.all([
        import("foliate-js/view.js"),
        isComicFormat(book.format) ? getComicArchive(book) : openEbook(book),
      ]);
      let source: File | object;
      let scan: (() => void) | null = null;
      if (isComicFormat(book.format)) {
        const archive = opened as ComicArchive;
        const rtl = settings.comicDirection === "auto" ? !!archive.info?.rtl : settings.comicDirection === "rtl";
        source = makeComicBook(archive, { book, spreads: settings.comicSpreads, rtl, wide: wideRef.current ?? [] });
        // First time in two-page mode: look for double-page scans in the background.
        if (settings.comicSpreads && wideRef.current === null) {
          scan = () =>
            void scanWidePages(book.id, archive, scanAbort.signal).then((found) => {
              if (found && !cancelled) setWide(found);
            });
        }
      } else {
        source = opened;
      }
      if (cancelled || !hostRef.current) return;

      view = document.createElement("foliate-view") as FoliateView;
      view.style.cssText = "display:block;height:100%;";
      hostRef.current.append(view);
      await view.open(source);
      if (cancelled) return;
      viewRef.current = view;
      zoomRef.current = isComicFormat(book.format) ? pinchController(transformSurface(view)) : null;
      // The margins around the page too (touches inside the page iframes never reach the host).
      detachHostZoom = zoomRef.current?.attach(hostRef.current) ?? null;

      view.addEventListener("relocate", (e) => {
        const d = (e as CustomEvent<RelocateDetail>).detail;
        lastLocator.current = { bookId: propsRef.current.book.id, cfi: d.cfi };
        zoomRef.current?.reset(); // a new page starts whole
        const byUser = ready.current && Date.now() - lastInteraction.current < USER_NAV_WINDOW_MS;
        propsRef.current.onRelocate(
          { locator: d.cfi, percentage: d.fraction ?? 0, label: d.tocItem?.label?.trim() || null },
          byUser,
        );
      });

      const findHighlight = (cfi: string) => byCfi.current.get(cfi);

      view.addEventListener("draw-annotation", (e) => {
        const { draw, annotation } = (e as CustomEvent).detail;
        const h = findHighlight(annotation.value);
        draw(Overlayer.highlight, { color: HIGHLIGHT_COLORS[h?.color ?? "yellow"].fill });
      });
      // A section was (re)rendered: foliate forgets annotations, so draw them again.
      view.addEventListener("create-overlay", () => {
        for (const cfi of byCfi.current.keys()) view!.addAnnotation({ value: cfi }).catch(() => {});
      });
      view.addEventListener("show-annotation", (e) => {
        const { value, range } = (e as CustomEvent<{ value: string; range: Range }>).detail;
        const h = findHighlight(value);
        if (!h) return;
        annotationClickAt.current = Date.now();
        propsRef.current.onHighlightClick?.(h, viewportRect(range));
      });

      view.addEventListener("load", (e) => {
        const { doc, index } = (e as CustomEvent<{ doc: Document; index: number }>).detail;

        // Report text selections.
        doc.addEventListener(
          "selectionchange",
          selections.listener(() => {
            const sel = doc.getSelection();
            const text = sel?.toString().trim() ?? "";
            if (!sel || sel.isCollapsed || !sel.rangeCount || !text) return null;
            const range = sel.getRangeAt(0);
            let cfi: string;
            try {
              cfi = view!.getCFI(index, range);
            } catch {
              return undefined; // no position for it: leave the menu as it is
            }
            return { cfi, text, rect: viewportRect(range) };
          }),
        );

        doc.addEventListener("keydown", (ev) => propsRef.current.onKeyDown(ev));
        if (isComicFormat(propsRef.current.book.format)) {
          attachLens(doc, { isActive: () => !!propsRef.current.magnifier });
          zoomRef.current?.attach(doc);
          doc.body.style.cursor = propsRef.current.magnifier ? "zoom-in" : "";
          // The app zooms the page itself (pinchZoom.ts); the browser's own pinch would enlarge everything.
          doc.body.style.touchAction = propsRef.current.magnifier ? "none" : "pan-x pan-y";
          // The fixed-layout renderer has no swipe support: swipe left/right turns the page
          // (the direction follows the finger, so it also feels right for manga).
          let start: { x: number; y: number } | null = null;
          doc.addEventListener("touchstart", (ev) => (start = { x: ev.touches[0]!.clientX, y: ev.touches[0]!.clientY }), { passive: true });
          doc.addEventListener("touchend", (ev) => {
            const t = ev.changedTouches[0];
            if (!start || !t || propsRef.current.magnifier || zoomRef.current?.busy()) return;
            const dx = t.clientX - start.x;
            const dy = t.clientY - start.y;
            start = null;
            if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
            mark();
            void (dx < 0 ? view!.goRight() : view!.goLeft());
          });
        }
        doc.addEventListener("touchstart", mark, { passive: true });
        doc.addEventListener("wheel", mark, { passive: true });
        doc.addEventListener("click", (ev) => {
          if ((ev.target as Element | null)?.closest?.("a")) return;
          if (propsRef.current.magnifier) return; // taps move the lens
          const sel = doc.getSelection();
          if (sel && !sel.isCollapsed) return;
          const frame = doc.defaultView?.frameElement as HTMLElement | null;
          const host = hostRef.current;
          if (!frame || !host) return;
          const x = frame.getBoundingClientRect().left + ev.clientX - host.getBoundingClientRect().left;
          const zone = freeZone(x, host.clientWidth, zoomRef.current);
          if (!zone) return;
          // foliate reports clicks on a highlight from its own listener; let that win over page turning.
          setTimeout(() => {
            if (Date.now() - annotationClickAt.current < 300) return;
            propsRef.current.onTap(zone);
          }, 0);
        });
      });
      // Swipes on the area around the iframe also count as interaction.
      view.addEventListener("touchstart", mark, { passive: true });

      applySettings(view, propsRef.current.settings, isComicFormat(book.format));
      const resumeAt = lastLocator.current?.bookId === book.id ? lastLocator.current.cfi : propsRef.current.initialLocator;
      // "fraction:0.42" comes from KOReader, whose positions can't be turned into a CFI.
      const fraction = fractionOf(resumeAt);
      await view.init({ lastLocation: fraction === null ? resumeAt : null });
      if (fraction !== null) await view.goToFraction(fraction);
      ready.current = true;
      syncHighlights(view);
      scan?.();
      const lang = view.book.metadata?.language;
      propsRef.current.onReady({
        toc: view.book.toc,
        language: typeof lang === "string" ? lang : Array.isArray(lang) && typeof lang[0] === "string" ? lang[0] : null,
      });
    })().catch((err) => {
      console.error(err);
      if (cancelled) return;
      propsRef.current.onError(
        navigator.onLine ? (err?.message ?? "Could not open this book") : "This book is not saved on this device. Connect to the internet to open it.",
      );
    });

    return () => {
      cancelled = true;
      scanAbort.abort();
      ready.current = false;
      viewRef.current = null;
      zoomRef.current = null;
      detachHostZoom?.();
      drawn.current.clear();
      try {
        view?.close();
      } catch {
        /* ignore */
      }
      view?.remove();
    };
  }, [props.book.id, comicLayout]);

  useEffect(() => {
    if (viewRef.current) applySettings(viewRef.current, props.settings, comic);
  }, [props.settings, comic]);

  useEffect(() => {
    if (viewRef.current && ready.current) syncHighlights(viewRef.current);
  }, [props.highlights]);

  // Magnifier on/off: zoom cursor and no scrolling gestures on the pages while it is on.
  useEffect(() => {
    for (const { doc } of viewRef.current?.renderer.getContents?.() ?? []) {
      doc.body.style.cursor = props.magnifier ? "zoom-in" : "";
      doc.body.style.touchAction = props.magnifier ? "none" : comic ? "pan-x pan-y" : "";
    }
  }, [props.magnifier, comic]);

  const onHostClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Clicks inside the book's iframe never reach here; these are on the page margins or around the page.
    if (e.target !== e.currentTarget && e.target !== viewRef.current) return;
    mark();
    const rect = e.currentTarget.getBoundingClientRect();
    const zone = freeZone(e.clientX - rect.left, rect.width, zoomRef.current);
    if (zone) props.onTap(zone);
  };

  // overflow-hidden: a zoomed comic page stays inside the reading area.
  return <div ref={hostRef} className={`epub-host h-full w-full ${comic ? "overflow-hidden" : ""}`} onClick={onHostClick} />;
});
