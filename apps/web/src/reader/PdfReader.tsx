import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { authHeaders } from "../lib/api";
import { bookFileUrl } from "../lib/books";
import { pdfjs, type PDFDocumentProxy } from "../lib/pdf";
import { THEMES, type ReaderSettings } from "../lib/settings";
import { zoneFromX, type ReaderHandle, type ReaderProps } from "./types";

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
  const m = locator ? /^page:(\d+)$/.exec(locator) : null;
  return m ? Number(m[1]) : 1;
}

export const PdfReader = forwardRef<ReaderHandle, ReaderProps>(function PdfReader(props, ref) {
  const stageRef = useRef<HTMLDivElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(() => parsePage(props.initialLocator));
  const [size, setSize] = useState({ w: 0, h: 0 });
  const userNav = useRef(false);
  const pageRef = useRef(page);
  pageRef.current = page;
  const propsRef = useRef(props);
  propsRef.current = props;

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
    restore: (locator) => go(parsePage(locator), false),
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
      .then((d) => {
        if (cancelled) return void d.loadingTask.destroy();
        setDoc(d);
        setPage((p) => Math.min(Math.max(1, p), d.numPages));
        propsRef.current.onReady({ totalPages: d.numPages });
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

  // Render the current page into a fresh canvas, then swap (no flicker).
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
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
      const light = ["light", "sepia"].includes(propsRef.current.settings.theme);
      canvas.className = `mx-auto block bg-white ${light ? "shadow-lg" : ""}`;
      renderTask = pdfPage.render({ canvas, viewport });
      await renderTask.promise;
      if (cancelled || !holderRef.current) return;
      holderRef.current.replaceChildren(canvas);
      stageRef.current?.scrollTo({ top: 0 });
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

  // Swipe and tap handling.
  const pointer = useRef<{ x: number; y: number; t: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    pointer.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = pointer.current;
    pointer.current = null;
    if (!start || !stageRef.current) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      go(dx < 0 ? page + 1 : page - 1, true);
    } else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const rect = stageRef.current.getBoundingClientRect();
      props.onTap(zoneFromX(e.clientX - rect.left, rect.width));
    }
  };

  return (
    <div
      ref={stageRef}
      className="h-full w-full overflow-auto select-none"
      style={{ background: THEMES[props.settings.theme].surround, touchAction: "pan-y pinch-zoom" }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <div
        ref={holderRef}
        className="flex min-h-full items-center justify-center p-4"
        style={{ filter: pageFilter(props.settings) }}
      />
    </div>
  );
});
