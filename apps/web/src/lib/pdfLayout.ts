/**
 * Page layout math for the PDF reader: fitting a page (or its cropped part) on screen,
 * finding where a page's content is (to crop white margins), and keeping canvases within
 * what phones can draw.
 */

/** Part of a page, as fractions of its width and height (0–1). */
export type PageBox = { x0: number; y0: number; x1: number; y1: number };

export const FULL_PAGE: PageBox = { x0: 0, y0: 0, x1: 1, y1: 1 };

/** Larger canvases fail to draw (blank pages) in Android WebViews and iOS Safari. */
export const MAX_CANVAS_PIXELS = 16_000_000;

/** Scale (CSS px per PDF unit) that fits `content` in `area`, leaving `margin` px on every side. */
export function fitScale(
  content: { w: number; h: number },
  area: { w: number; h: number },
  margin: number,
  fit: "width" | "page",
) {
  const width = Math.max(0.05, (area.w - margin * 2) / content.w);
  if (fit === "width") return width;
  return Math.max(0.05, Math.min(width, (area.h - margin * 2) / content.h));
}

/** Device pixels per CSS pixel for a canvas of cssW × cssH: sharp, but never too large to draw. */
export function canvasPixelRatio(cssW: number, cssH: number, devicePixelRatio: number) {
  const fits = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, cssW * cssH));
  return Math.min(devicePixelRatio || 1, 3, fits);
}

/**
 * The box around a rendered page's content (RGBA pixels on white), plus a little room, or
 * the whole page when it is blank. A row or column needs two dark pixels to count, so specks
 * of scanner dust don't stop the crop.
 */
export function contentBox(data: ArrayLike<number>, width: number, height: number, padding = 0.02): PageBox {
  const rows = new Uint32Array(height);
  const cols = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const ink = data[i + 3]! > 16 && Math.min(data[i]!, data[i + 1]!, data[i + 2]!) < 220;
      if (ink) {
        rows[y]!++;
        cols[x]!++;
      }
    }
  }
  const first = (counts: Uint32Array) => counts.findIndex((n) => n > 1);
  const last = (counts: Uint32Array) => {
    for (let i = counts.length - 1; i >= 0; i--) if (counts[i]! > 1) return i;
    return -1;
  };
  const top = first(rows);
  const left = first(cols);
  if (top < 0 || left < 0) return FULL_PAGE;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return {
    x0: clamp(left / width - padding),
    y0: clamp(top / height - padding),
    x1: clamp((last(cols) + 1) / width + padding),
    y1: clamp((last(rows) + 1) / height + padding),
  };
}
