import type { FoliateView, RelocateDetail } from "foliate-js/view.js";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Overlayer } from "foliate-js/overlayer.js";
import { downloadBook } from "../lib/books";
import { isComicFormat, makeComicBook, openComicArchive, type ComicArchive } from "../lib/comics";
import { fontFaceCss, fontFamily } from "../lib/fonts";
import { HIGHLIGHT_COLORS } from "../lib/highlights";
import { THEMES, type ReaderSettings } from "../lib/settings";
import { USER_NAV_WINDOW_MS, zoneFromX, type ReaderHandle, type ReaderProps } from "./types";

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

function applySettings(view: FoliateView, s: ReaderSettings, comic: boolean) {
  const r = view.renderer;
  if (!r) return;
  const t = THEMES[s.theme];
  const host = view.parentElement;
  if (comic) {
    // Fixed-layout pages: only the fit and the surrounding color apply; the view fills the screen.
    r.setAttribute("zoom", s.comicFit === "width" ? "fit-width" : "fit-page");
    view.style.background = "transparent";
    view.style.boxShadow = "none";
    if (host) {
      host.style.background = t.surround;
      host.style.setProperty("--page-width", "100vw");
      host.style.setProperty("--page-count", "1");
    }
    return;
  }
  r.setAttribute("flow", "paginated");
  r.setAttribute("animated", "");
  r.setAttribute("gap", `${s.margin}%`);
  r.setAttribute("margin", `${s.marginY}px`);
  r.setAttribute("max-inline-size", `${s.pageWidth}px`);
  r.setAttribute("max-column-count", String(s.columns));
  r.setStyles?.(bookCss(s));
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
  const selectionShown = useRef(false);
  /** Last position, so the book can be reopened in place when the comic layout changes. */
  const lastLocator = useRef<{ bookId: string; cfi: string } | null>(null);
  /** Extracted comic archive, kept across reopenings (RAR/7z extraction is not free). */
  const comicArchive = useRef<{ bookId: string; archive: ComicArchive } | null>(null);
  const comic = isComicFormat(props.book.format);
  // Spreads and reading direction are fixed when foliate opens a book, so changing them reopens it.
  const comicLayout = comic ? `${props.settings.comicSpreads}-${props.settings.comicDirection}` : "";
  // Keep latest props without re-running the open effect.
  const propsRef = useRef(props);
  propsRef.current = props;

  const mark = () => (lastInteraction.current = Date.now());

  useImperativeHandle(ref, () => ({
    next: () => {
      mark();
      void viewRef.current?.goRight();
    },
    prev: () => {
      mark();
      void viewRef.current?.goLeft();
    },
    goToFraction: (f) => {
      mark();
      void viewRef.current?.goToFraction(f);
    },
    goToHref: (href) => {
      mark();
      void viewRef.current?.goTo(href);
    },
    restore: (locator) => {
      lastInteraction.current = 0;
      void viewRef.current?.goTo(locator);
    },
    clearSelection: () => {
      for (const { doc } of viewRef.current?.renderer.getContents?.() ?? []) doc.getSelection()?.removeAllRanges();
      selectionShown.current = false;
      propsRef.current.onSelection?.(null);
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

    (async () => {
      await import("foliate-js/view.js");
      const { book, settings } = propsRef.current;
      let source: File | object;
      if (isComicFormat(book.format)) {
        if (comicArchive.current?.bookId !== book.id) {
          const archive = await openComicArchive(await downloadBook(book), book.format);
          comicArchive.current = { bookId: book.id, archive };
        }
        const { archive } = comicArchive.current!;
        const rtl = settings.comicDirection === "auto" ? !!archive.info?.rtl : settings.comicDirection === "rtl";
        source = makeComicBook(archive, { book, spreads: settings.comicSpreads, rtl });
      } else {
        source = await downloadBook(book);
      }
      if (cancelled || !hostRef.current) return;

      view = document.createElement("foliate-view") as FoliateView;
      view.style.cssText = "display:block;height:100%;";
      hostRef.current.append(view);
      await view.open(source);
      if (cancelled) return;
      viewRef.current = view;

      view.addEventListener("relocate", (e) => {
        const d = (e as CustomEvent<RelocateDetail>).detail;
        lastLocator.current = { bookId: propsRef.current.book.id, cfi: d.cfi };
        const byUser = ready.current && Date.now() - lastInteraction.current < USER_NAV_WINDOW_MS;
        propsRef.current.onRelocate(
          { locator: d.cfi, percentage: d.fraction ?? 0, label: d.tocItem?.label?.trim() || null },
          byUser,
        );
      });

      const findHighlight = (cfi: string) => propsRef.current.highlights?.find((h) => h.cfi === cfi);

      view.addEventListener("draw-annotation", (e) => {
        const { draw, annotation } = (e as CustomEvent).detail;
        const h = findHighlight(annotation.value);
        draw(Overlayer.highlight, { color: HIGHLIGHT_COLORS[h?.color ?? "yellow"].fill });
      });
      // A section was (re)rendered: foliate forgets annotations, so draw them again.
      view.addEventListener("create-overlay", () => {
        for (const h of propsRef.current.highlights ?? []) view!.addAnnotation({ value: h.cfi }).catch(() => {});
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

        // Report text selections (debounced, so dragging the handles does not flicker).
        let selTimer: ReturnType<typeof setTimeout> | undefined;
        doc.addEventListener("selectionchange", () => {
          clearTimeout(selTimer);
          selTimer = setTimeout(() => {
            const sel = doc.getSelection();
            const text = sel?.toString().trim() ?? "";
            if (!sel || sel.isCollapsed || !sel.rangeCount || !text) {
              if (selectionShown.current) {
                selectionShown.current = false;
                propsRef.current.onSelection?.(null);
              }
              return;
            }
            const range = sel.getRangeAt(0);
            let cfi: string;
            try {
              cfi = view!.getCFI(index, range);
            } catch {
              return;
            }
            selectionShown.current = true;
            propsRef.current.onSelection?.({ cfi, text, rect: viewportRect(range) });
          }, 350);
        });

        doc.addEventListener("keydown", (ev) => propsRef.current.onKeyDown(ev));
        if (isComicFormat(propsRef.current.book.format)) {
          // The fixed-layout renderer has no swipe support: swipe left/right turns the page
          // (the direction follows the finger, so it also feels right for manga).
          let start: { x: number; y: number } | null = null;
          doc.addEventListener("touchstart", (ev) => (start = { x: ev.touches[0]!.clientX, y: ev.touches[0]!.clientY }), { passive: true });
          doc.addEventListener("touchend", (ev) => {
            const t = ev.changedTouches[0];
            if (!start || !t) return;
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
          const sel = doc.getSelection();
          if (sel && !sel.isCollapsed) return;
          const frame = doc.defaultView?.frameElement as HTMLElement | null;
          const host = hostRef.current;
          if (!frame || !host) return;
          const x = frame.getBoundingClientRect().left + ev.clientX - host.getBoundingClientRect().left;
          // foliate reports clicks on a highlight from its own listener; let that win over page turning.
          setTimeout(() => {
            if (Date.now() - annotationClickAt.current < 300) return;
            propsRef.current.onTap(zoneFromX(x, host.clientWidth));
          }, 0);
        });
      });
      // Swipes on the area around the iframe also count as interaction.
      view.addEventListener("touchstart", mark, { passive: true });

      applySettings(view, propsRef.current.settings, isComicFormat(book.format));
      const resumeAt = lastLocator.current?.bookId === book.id ? lastLocator.current.cfi : propsRef.current.initialLocator;
      await view.init({ lastLocation: resumeAt });
      ready.current = true;
      syncHighlights(view);
      propsRef.current.onReady({ toc: view.book.toc });
    })().catch((err) => {
      console.error(err);
      if (!cancelled) propsRef.current.onError(err?.message ?? "Could not open this book");
    });

    return () => {
      cancelled = true;
      ready.current = false;
      viewRef.current = null;
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

  const onHostClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Clicks inside the book's iframe never reach here; these are on the page margins or around the page.
    if (e.target !== e.currentTarget && e.target !== viewRef.current) return;
    mark();
    const rect = e.currentTarget.getBoundingClientRect();
    props.onTap(zoneFromX(e.clientX - rect.left, rect.width));
  };

  return <div ref={hostRef} className="epub-host h-full w-full" onClick={onHostClick} />;
});
