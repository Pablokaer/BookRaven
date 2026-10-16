import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { comicIndexFromLocator, comicLocator, getComicArchive, type ComicArchive } from "../lib/comics";
import { attachLens } from "../lib/lens";
import { pinchController, scrollSurface, type PinchController } from "../lib/pinchZoom";
import { THEMES } from "../lib/settings";
import { USER_NAV_WINDOW_MS, zoneFromX, type ReaderHandle, type ReaderProps } from "./types";

/** One page: its image is only created when the page comes near the screen. */
function Page({ archive, name, index, eager }: { archive: ComicArchive; name: string; index: number; eager: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [near, setNear] = useState(eager);

  useEffect(() => {
    if (near) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "150% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near && !eager) return;
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
    };
  }, [near, eager, archive, name]);

  return (
    <div ref={ref} data-page={index} className={src ? "" : "min-h-[70vh]"}>
      {src && <img src={src} alt={`Page ${index + 1}`} className="block h-auto w-full select-none" draggable={false} />}
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
  const [startIndex] = useState(() => comicIndexFromLocator(props.initialLocator));
  const current = useRef(startIndex);
  const lastInteraction = useRef(0);
  const ready = useRef(false);
  const propsRef = useRef(props);
  propsRef.current = props;
  const count = archive?.pages.length ?? 0;

  const mark = () => (lastInteraction.current = Date.now());

  const scrollToPage = useCallback((index: number, smooth = false) => {
    const el = stageRef.current?.querySelector(`[data-page="${index}"]`);
    el?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
  }, []);

  const report = useCallback(
    (index: number) => {
      if (!count) return;
      current.current = index;
      const byUser = ready.current && Date.now() - lastInteraction.current < USER_NAV_WINDOW_MS;
      propsRef.current.onRelocate(
        { locator: comicLocator(index), percentage: count > 1 ? index / (count - 1) : 1, label: `Page ${index + 1} of ${count}` },
        byUser,
      );
    },
    [count],
  );

  useImperativeHandle(ref, () => ({
    next: () => {
      mark();
      const el = stageRef.current;
      el?.scrollBy({ top: el.clientHeight * 0.85, behavior: "smooth" });
    },
    prev: () => {
      mark();
      const el = stageRef.current;
      el?.scrollBy({ top: -el.clientHeight * 0.85, behavior: "smooth" });
    },
    goToFraction: (f) => {
      mark();
      scrollToPage(Math.round(f * Math.max(0, count - 1)));
    },
    goToHref: (href) => {
      mark();
      const byName = archive?.pages.findIndex((p) => p.name === href) ?? -1;
      scrollToPage(byName >= 0 ? byName : comicIndexFromLocator(href));
    },
    restore: (locator) => {
      lastInteraction.current = 0;
      scrollToPage(comicIndexFromLocator(locator));
    },
  }));

  // Open (or reuse) the archive: pages download as they scroll into view.
  useEffect(() => {
    let cancelled = false;
    getComicArchive(props.book)
      .then((a) => {
        if (cancelled) return;
        setArchive(a);
        propsRef.current.onReady({ toc: a.pages.map((p, i) => ({ label: `Page ${i + 1}`, href: p.name })) });
      })
      .catch((err) => !cancelled && propsRef.current.onError(err?.message ?? "Could not open this comic"));
    return () => {
      cancelled = true;
    };
  }, [props.book]);

  // Jump to the saved page once the strip exists, then start reporting the position.
  useEffect(() => {
    if (!archive) return;
    scrollToPage(Math.min(startIndex, archive.pages.length - 1));
    report(Math.min(startIndex, archive.pages.length - 1));
    const t = setTimeout(() => (ready.current = true), 300);
    return () => clearTimeout(t);
  }, [archive, startIndex, scrollToPage, report]);

  // The page crossing the middle of the screen is the current one.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !archive) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const mid = el.getBoundingClientRect().top + el.clientHeight / 2;
        for (const p of el.querySelectorAll<HTMLElement>("[data-page]")) {
          const r = p.getBoundingClientRect();
          if (r.top <= mid && r.bottom >= mid) {
            const i = Number(p.dataset.page);
            if (i !== current.current) report(i);
            break;
          }
        }
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [archive, report]);

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
    const zone = zoneFromX(e.clientX - rect.left, rect.width);
    if (zone !== "center" && zoomRef.current?.busy()) return; // zoomed in: side taps don't scroll away
    props.onTap(zone);
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
          <Page key={p.name} archive={archive} name={p.name} index={i} eager={Math.abs(i - startIndex) <= 1} />
        ))}
      </div>
    </div>
  );
});
