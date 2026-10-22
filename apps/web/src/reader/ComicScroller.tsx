import { comicPageLocator, fractionLocator, pageOf } from "@bookraven/locator";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { comicToc, getComicArchive, type ComicArchive } from "../lib/comics";
import { attachLens } from "../lib/lens";
import { pinchController, scrollSurface, type PinchController } from "../lib/pinchZoom";
import { THEMES } from "../lib/settings";
import { useLatest } from "../lib/useLatest";
import { freeZone, USER_NAV_WINDOW_MS, type ReaderHandle, type ReaderProps } from "./types";

/**
 * The page index a locator points at (a comic page, or a percentage once `pageCount` is known,
 * 0 before), in a comic of `pageCount` pages; the first page when it names none.
 */
const indexOf = (locator: string | null, pageCount: number) => (pageOf(locator, pageCount || undefined) ?? 1) - 1;

/** Pages further than this from the current one give their image back (they keep their size). */
const KEEP_AROUND = 10;

/**
 * The strip's pages, watched by two observers shared by all of them: one says which pages are
 * near the screen (their images load), the other which page crosses the middle of the screen
 * (the current one). Images of pages far from the current one are released, so a long strip
 * doesn't keep every page it went past decoded in memory; they load again when they come near.
 */
class StripPages {
  private near: IntersectionObserver | null = null;
  private middle: IntersectionObserver | null = null;
  private pages = new Map<Element, { index: number; load: (on: boolean) => void }>();
  private nearby = new Set<number>();
  private atMiddle = new Set<number>();
  private loaded = new Set<number>();
  private current: number;

  constructor(
    private root: () => HTMLElement | null,
    private onCurrent: (index: number) => void,
    start: number,
  ) {
    this.current = start;
    // The page opened at and its neighbours load right away.
    for (const i of [start - 1, start, start + 1]) if (i >= 0) this.loaded.add(i);
  }

  isLoaded = (index: number) => this.loaded.has(index);

  observe(el: Element, index: number, load: (on: boolean) => void) {
    this.near ??= new IntersectionObserver((entries) => this.onNear(entries), { rootMargin: "150% 0px" });
    // A line across the middle of the strip: the page it crosses is the current one.
    this.middle ??= new IntersectionObserver((entries) => this.onMiddle(entries), { root: this.root(), rootMargin: "-50% 0px -50% 0px" });
    this.pages.set(el, { index, load });
    this.near.observe(el);
    this.middle.observe(el);
    return () => {
      this.pages.delete(el);
      this.near?.unobserve(el);
      this.middle?.unobserve(el);
      this.nearby.delete(index);
      this.atMiddle.delete(index);
    };
  }

  /** The page being read moved: release the images left far behind (or ahead). */
  setCurrent(index: number) {
    this.current = index;
    for (const i of this.loaded) if (this.isFar(i) && !this.nearby.has(i)) this.setLoaded(i, false);
  }

  disconnect() {
    this.near?.disconnect();
    this.middle?.disconnect();
  }

  private isFar = (index: number) => Math.abs(index - this.current) > KEEP_AROUND;

  private setLoaded(index: number, on: boolean) {
    if (on) this.loaded.add(index);
    else this.loaded.delete(index);
    for (const page of this.pages.values()) if (page.index === index) page.load(on);
  }

  private onNear(entries: IntersectionObserverEntry[]) {
    for (const e of entries) {
      const index = this.pages.get(e.target)?.index;
      if (index === undefined) continue;
      if (e.isIntersecting) {
        this.nearby.add(index);
        if (!this.loaded.has(index)) this.setLoaded(index, true);
      } else {
        this.nearby.delete(index);
        if (this.loaded.has(index) && this.isFar(index)) this.setLoaded(index, false);
      }
    }
  }

  private onMiddle(entries: IntersectionObserverEntry[]) {
    for (const e of entries) {
      const index = this.pages.get(e.target)?.index;
      if (index === undefined) continue;
      if (e.isIntersecting) this.atMiddle.add(index);
      else this.atMiddle.delete(index);
    }
    // Two pages touch the line where they meet: the first one is the current one.
    if (this.atMiddle.size) this.onCurrent(Math.min(...this.atMiddle));
  }
}

/**
 * One page: its image is only created when the page comes near the screen, and released when it
 * is far from the page being read. A released page keeps the image's proportions, so the strip
 * keeps its length and the scroll position never jumps.
 */
function Page({ archive, name, index, pages }: { archive: ComicArchive; name: string; index: number; pages: StripPages }) {
  const ref = useRef<HTMLDivElement>(null);
  const [load, setLoad] = useState(() => pages.isLoaded(index));
  const [src, setSrc] = useState<string | null>(null);
  /** "width / height" of the image, once it has been shown. */
  const [ratio, setRatio] = useState<string | null>(null);

  useEffect(() => pages.observe(ref.current!, index, setLoad), [pages, index]);

  useEffect(() => {
    if (!load) return;
    let url: string | null = null;
    let cancelled = false;
    void archive.loadPage(name).then((blob) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      setSrc(null);
    };
  }, [load, archive, name]);

  const onLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    if (w > 0 && h > 0) setRatio(`${w} / ${h}`);
  };

  return (
    <div ref={ref} data-page={index} className={src || ratio ? "" : "min-h-[70vh]"} style={ratio ? { aspectRatio: ratio } : undefined}>
      {src && <img src={src} alt={`Page ${index + 1}`} className="block h-auto w-full select-none" draggable={false} onLoad={onLoad} />}
    </div>
  );
}

/**
 * Comics as one continuous vertical strip (webtoon / manhwa style). Shares the page
 * position format with the paged reader, so switching modes keeps your place.
 */
export const ComicScroller = forwardRef<ReaderHandle, ReaderProps>(function ComicScroller(props, ref) {
  const stageRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<PinchController | null>(null);
  const [archive, setArchive] = useState<ComicArchive | null>(null);
  const [startLocator] = useState(props.initialLocator);
  const lastInteraction = useRef(0);
  const ready = useRef(false);
  const propsRef = useLatest(props);
  const count = archive?.pages.length ?? 0;
  // Before the archive is open a percentage has no page yet: the strip starts loading at the top.
  const [firstGuess] = useState(() => indexOf(startLocator, 0));
  const current = useRef(firstGuess);
  const reportRef = useRef<(index: number) => void>(() => {});
  const [pages] = useState(
    () => new StripPages(() => stageRef.current, (i) => i !== current.current && reportRef.current(i), firstGuess),
  );
  useEffect(() => () => pages.disconnect(), [pages]);

  const mark = () => (lastInteraction.current = Date.now());
  /** A screen's height (a bit less, to keep some context) down or up. */
  const scrollPage = (dir: 1 | -1) => {
    mark();
    const el = stageRef.current;
    el?.scrollBy({ top: dir * el.clientHeight * 0.85, behavior: "smooth" });
  };

  const scrollToPage = useCallback((index: number, smooth = false) => {
    const el = stageRef.current?.querySelector(`[data-page="${index}"]`);
    el?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
  }, []);

  const report = useCallback(
    (index: number) => {
      if (!count) return;
      current.current = index;
      pages.setCurrent(index);
      const byUser = ready.current && Date.now() - lastInteraction.current < USER_NAV_WINDOW_MS;
      propsRef.current.onRelocate(
        { locator: comicPageLocator(index), percentage: count > 1 ? index / (count - 1) : 1, label: `Page ${index + 1} of ${count}` },
        byUser,
      );
    },
    [count, pages],
  );

  useImperativeHandle(ref, () => ({
    next: () => scrollPage(1),
    prev: () => scrollPage(-1),
    goToFraction: (f) => {
      mark();
      scrollToPage(indexOf(fractionLocator(f), count));
    },
    goToHref: (href) => {
      mark();
      const byName = archive?.pages.findIndex((p) => p.name === href) ?? -1;
      scrollToPage(byName >= 0 ? byName : indexOf(href, count));
    },
    restore: (locator) => {
      lastInteraction.current = 0;
      scrollToPage(indexOf(locator, count));
    },
  }));

  // Open (or reuse) the archive: pages download as they scroll into view.
  useEffect(() => {
    let cancelled = false;
    getComicArchive(props.book)
      .then((a) => {
        if (cancelled) return;
        setArchive(a);
        propsRef.current.onReady({ toc: comicToc(a) });
      })
      .catch((err) => !cancelled && propsRef.current.onError(err?.message ?? "Could not open this comic"));
    return () => {
      cancelled = true;
    };
  }, [props.book]);

  // Jump to the saved page once the strip exists, then start reporting the position.
  useEffect(() => {
    if (!archive) return;
    const start = indexOf(startLocator, archive.pages.length);
    scrollToPage(start);
    report(start);
    const t = setTimeout(() => (ready.current = true), 300);
    return () => clearTimeout(t);
  }, [archive, startLocator, scrollToPage, report]);

  // The page crossing the middle of the screen is the current one (StripPages watches for it).
  reportRef.current = report;

  // Pinch-to-zoom: widens the strip; one finger keeps scrolling it in both directions.
  useEffect(() => {
    const el = stageRef.current;
    const column = columnRef.current;
    if (!el || !column) return;
    const zoom = pinchController(scrollSurface(el, column));
    zoomRef.current = zoom;
    const detach = zoom.attach(el);
    return () => {
      detach();
      zoomRef.current = null;
    };
  }, []);

  // Magnifying glass over the pages.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    return attachLens(el, { isActive: () => !!propsRef.current.magnifier });
  }, []);

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (props.magnifier) return;
    const rect = e.currentTarget.getBoundingClientRect();
    mark();
    const zone = freeZone(e.clientX - rect.left, rect.width, zoomRef.current); // zoomed in: side taps don't scroll away
    if (zone) props.onTap(zone);
  };

  return (
    <div
      ref={stageRef}
      className="h-full w-full overflow-auto"
      style={{
        background: THEMES[props.settings.theme].surround,
        cursor: props.magnifier ? "zoom-in" : undefined,
        // The app zooms the strip itself (pinchZoom.ts), so the browser's own pinch stays off.
        touchAction: props.magnifier ? "none" : "pan-x pan-y",
      }}
      onClick={onClick}
      onWheel={mark}
      onTouchStart={mark}
    >
      <div ref={columnRef} className={`mx-auto ${props.settings.comicFit === "width" ? "w-full" : "w-full max-w-[860px]"}`}>
        {archive?.pages.map((p, i) => (
          <Page key={p.name} archive={archive} name={p.name} index={i} pages={pages} />
        ))}
      </div>
    </div>
  );
});
