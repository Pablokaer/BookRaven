/**
 * Pinch-to-zoom for comic pages, done by the app itself: Android's WebView (the Capacitor app)
 * does not zoom pages, and the browser's own zoom would also enlarge the toolbars.
 *
 * Two fingers zoom around the point between them, double-tap toggles a close-up, and
 * Ctrl + wheel (a trackpad pinch on desktop) zooms at the pointer. With a mouse, double-click
 * also toggles the close-up and dragging moves the zoomed page. Touches can come from the
 * page's iframes (the paged reader) or from the main document (the vertical strip); points
 * are converted to the top window's coordinates.
 */

export const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
/** After a pinch, the finger that is lifted last must not count as a swipe or a tap. */
const SETTLE_MS = 400;

type Point = { x: number; y: number };

/** A point of `ev` (from any document) in the top window's coordinates. */
function toTop(doc: Document, x: number, y: number): Point {
  const frame = doc.defaultView?.frameElement as HTMLElement | null;
  if (!frame) return { x, y };
  const r = frame.getBoundingClientRect();
  const scale = frame.offsetWidth ? r.width / frame.offsetWidth : 1;
  return { x: r.left + x * scale, y: r.top + y * scale };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export type ZoomSurface = {
  scale: () => number;
  /** Zooms to `scale`, keeping the content under `anchor` (top-window point) where it is. */
  zoomAt: (scale: number, anchor: Point) => void;
  /** Moves the zoomed content by a finger's movement (only the transform surface needs this; a scroller pans natively). */
  pan?: (dx: number, dy: number) => void;
};

export type PinchController = {
  /** Listens to touches and wheel events on one more document (each page iframe) or element. */
  attach: (target: Document | HTMLElement) => () => void;
  /** True while zoomed in or just after a pinch: page turning by swipe or tap should wait. */
  busy: () => boolean;
  reset: () => void;
};

export function pinchController(
  surface: ZoomSurface & { reset: () => void },
  /** `dblClick: false` leaves double-click alone (on a PDF it selects a word). */
  { dblClick = true }: { dblClick?: boolean } = {},
): PinchController {
  let pinch: { dist: number; scale: number } | null = null;
  let pan: Point | null = null;
  let settledAt = 0;
  let lastTap: { t: number; p: Point } | null = null;
  let moved = false;

  const attach = (target: Document | HTMLElement) => {
    const doc = target.nodeType === Node.DOCUMENT_NODE ? (target as Document) : (target as HTMLElement).ownerDocument;
    const pts = (ev: TouchEvent) => Array.from(ev.touches, (t) => toTop(doc, t.clientX, t.clientY));
    const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

    const onStart = (ev: TouchEvent) => {
      const p = pts(ev);
      moved = false;
      if (p.length >= 2) {
        pinch = { dist: dist(p[0]!, p[1]!) || 1, scale: surface.scale() };
        pan = null;
      } else if (surface.scale() > 1.01 && surface.pan) {
        pan = p[0]!;
      }
    };

    const onMove = (ev: TouchEvent) => {
      const p = pts(ev);
      moved = true;
      if (pinch && p.length >= 2) {
        ev.preventDefault();
        const s = clamp((pinch.scale * dist(p[0]!, p[1]!)) / pinch.dist, 1, MAX_ZOOM);
        surface.zoomAt(s, mid(p[0]!, p[1]!));
      } else if (pan && p.length === 1 && surface.pan) {
        ev.preventDefault();
        surface.pan(p[0]!.x - pan.x, p[0]!.y - pan.y);
        pan = p[0]!;
      }
    };

    const onEnd = (ev: TouchEvent) => {
      if (pinch) {
        settledAt = Date.now();
        if (ev.touches.length < 2) {
          pinch = null;
          // Nearly back to the page size: snap to it.
          if (surface.scale() < 1.08) surface.reset();
          // One finger still down: it keeps panning.
          const rest = pts(ev)[0];
          pan = rest && surface.scale() > 1.01 && surface.pan ? rest : null;
        }
        return;
      }
      if (ev.touches.length) return;
      pan = null;
      const t = ev.changedTouches[0];
      if (!t || moved) return;
      // Double tap: a close-up where tapped, or back to the whole page.
      const p = toTop(doc, t.clientX, t.clientY);
      const now = Date.now();
      if (lastTap && now - lastTap.t < 300 && Math.hypot(p.x - lastTap.p.x, p.y - lastTap.p.y) < 30) {
        ev.preventDefault(); // no click: the second tap must not also turn the page
        lastTap = null;
        settledAt = now;
        if (surface.scale() > 1.01) surface.reset();
        else surface.zoomAt(DOUBLE_TAP_ZOOM, p);
      } else {
        lastTap = { t: now, p };
      }
    };

    // Ctrl + wheel is also what a trackpad pinch sends on desktop browsers.
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      const s = clamp(surface.scale() * Math.exp(-ev.deltaY / 200), 1, MAX_ZOOM);
      if (s < 1.02) surface.reset();
      else surface.zoomAt(s, toTop(doc, ev.clientX, ev.clientY));
      settledAt = Date.now();
    };

    const onDblClick = (ev: MouseEvent) => {
      const p = toTop(doc, ev.clientX, ev.clientY);
      settledAt = Date.now();
      if (surface.scale() > 1.01) surface.reset();
      else surface.zoomAt(DOUBLE_TAP_ZOOM, p);
    };

    // Mouse drag pans a zoomed page (touch panning is handled above).
    let drag: Point | null = null;
    let dragged = false;
    const onMouseDown = (ev: MouseEvent) => {
      if (ev.button !== 0 || surface.scale() <= 1.01 || !surface.pan) return;
      drag = toTop(doc, ev.clientX, ev.clientY);
      dragged = false;
    };
    const onMouseMove = (ev: MouseEvent) => {
      if (!drag) return;
      const p = toTop(doc, ev.clientX, ev.clientY);
      if (!dragged && Math.hypot(p.x - drag.x, p.y - drag.y) < 4) return;
      dragged = true;
      ev.preventDefault();
      surface.pan!(p.x - drag.x, p.y - drag.y);
      drag = p;
    };
    const onMouseUp = () => {
      if (dragged) settledAt = Date.now(); // the click that ends a drag is not a tap
      drag = null;
    };

    const on = target.addEventListener.bind(target) as Document["addEventListener"];
    const off = target.removeEventListener.bind(target) as Document["removeEventListener"];
    on("touchstart", onStart, { passive: true });
    on("touchmove", onMove, { passive: false });
    on("touchend", onEnd, { passive: false });
    on("touchcancel", onEnd, { passive: false });
    on("wheel", onWheel, { passive: false });
    if (dblClick) on("dblclick", onDblClick);
    on("mousedown", onMouseDown);
    on("mousemove", onMouseMove);
    on("mouseup", onMouseUp);
    return () => {
      off("touchstart", onStart);
      off("touchmove", onMove);
      off("touchend", onEnd);
      off("touchcancel", onEnd);
      off("wheel", onWheel);
      off("dblclick", onDblClick);
      off("mousedown", onMouseDown);
      off("mousemove", onMouseMove);
      off("mouseup", onMouseUp);
    };
  };

  return {
    attach,
    busy: () => !!pinch || surface.scale() > 1.01 || Date.now() - settledAt < SETTLE_MS,
    reset: () => {
      pinch = null;
      pan = null;
      surface.reset();
    },
  };
}

/**
 * Zooms an element with a CSS transform inside its parent (the paged reader): the parent's
 * box is the frame, and panning stops at the zoomed content's edges.
 */
export function transformSurface(el: HTMLElement): ZoomSurface & { reset: () => void } {
  let s = 1;
  let tx = 0;
  let ty = 0;
  el.style.transformOrigin = "0 0";
  const box = () => (el.parentElement ?? el).getBoundingClientRect();
  const apply = () => {
    const b = box();
    tx = clamp(tx, b.width * (1 - s), 0);
    ty = clamp(ty, b.height * (1 - s), 0);
    el.style.transform = s === 1 ? "" : `translate(${tx}px, ${ty}px) scale(${s})`;
  };
  return {
    scale: () => s,
    zoomAt: (next, anchor) => {
      const b = box();
      // The content point under the anchor stays under it.
      const cx = (anchor.x - b.left - tx) / s;
      const cy = (anchor.y - b.top - ty) / s;
      s = next;
      tx = anchor.x - b.left - cx * s;
      ty = anchor.y - b.top - cy * s;
      apply();
    },
    pan: (dx, dy) => {
      tx += dx;
      ty += dy;
      apply();
    },
    reset: () => {
      s = 1;
      tx = 0;
      ty = 0;
      apply();
    },
  };
}

/**
 * Zooms a column of pages inside a scroll container (the vertical strip) by widening it, so
 * one finger keeps panning and flinging natively in both directions.
 */
export function scrollSurface(scroller: HTMLElement, column: HTMLElement): ZoomSurface & { reset: () => void } {
  let s = 1;
  let base = 0;
  return {
    scale: () => s,
    zoomAt: (next, anchor) => {
      if (s === 1) base = column.getBoundingClientRect().width;
      const r = scroller.getBoundingClientRect();
      const mx = anchor.x - r.left;
      const my = anchor.y - r.top;
      const colLeft = column.getBoundingClientRect().left - r.left + scroller.scrollLeft;
      // Content position under the anchor, at scale 1.
      const cx = (scroller.scrollLeft + mx - colLeft) / s;
      const cy = (scroller.scrollTop + my) / s;
      s = next;
      column.style.width = `${base * s}px`;
      column.style.maxWidth = "none";
      const newLeft = column.getBoundingClientRect().left - r.left + scroller.scrollLeft;
      scroller.scrollLeft = newLeft + cx * s - mx;
      scroller.scrollTop = cy * s - my;
    },
    reset: () => {
      if (s === 1) return;
      const r = scroller.getBoundingClientRect();
      const cy = (scroller.scrollTop + r.height / 2) / s;
      s = 1;
      column.style.width = "";
      column.style.maxWidth = "";
      scroller.scrollTop = cy - r.height / 2;
    },
  };
}
