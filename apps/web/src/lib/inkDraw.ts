import getStroke from "perfect-freehand";
import type { Stroke } from "./ink";

/**
 * Drawing handwriting (lib/ink.ts holds the data and its syncing). Kept apart so the drawing
 * library loads with the reader, not with the app.
 *
 * A stroke's outline is computed once, in a fixed space 1000 units wide, and kept as a Path2D:
 * drawing it at any canvas size (zoom, thumbnails) is then a scaled fill, and redrawing a page
 * with hundreds of strokes (the eraser does it on every move) stays cheap.
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/**
 * A pointer position as a stroke point: page fractions (to 1/10000, a little past the edges
 * at most, as the server accepts) and pressure (to 1/100).
 */
export function strokePoint(x: number, y: number, pressure: number) {
  return [round(clamp(x, -0.25, 1.25), 4), round(clamp(y, -0.25, 1.25), 4), round(clamp(pressure, 0, 1), 2)];
}

/** Whether the pressure came from a real pen (mice and fingers report a flat 0.5 or 0). */
const hasPressure = (points: number[]) => {
  for (let i = 2; i < points.length; i += 3) if (points[i] !== 0.5 && points[i] !== 0) return true;
  return false;
};

/** The filled outline of a stroke on a page of w × h pixels, as polygon points. */
export function strokeOutline(stroke: Stroke, w: number, h: number, last = true): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i + 2 < stroke.points.length; i += 3) pts.push([stroke.points[i]! * w, stroke.points[i + 1]! * h, stroke.points[i + 2]! || 0.5]);
  const size = stroke.width * w;
  return stroke.tool === "highlighter"
    ? getStroke(pts, { size, thinning: 0, smoothing: 0.5, streamline: 0.4, simulatePressure: false, last, start: { cap: false }, end: { cap: false } })
    : getStroke(pts, { size, thinning: 0.6, smoothing: 0.5, streamline: 0.4, simulatePressure: !hasPressure(stroke.points), last });
}

/** Width of the space outlines are cached in. */
const UNIT = 1000;
/**
 * Outlines by stroke. Saved strokes never change (an edited stroke is a new object), but the one
 * being drawn grows point by point, so the number of points is part of what a cached outline is for.
 */
const paths = new WeakMap<Stroke, { aspect: number; points: number; path: Path2D | null }>();

/** The stroke's outline as a path in a page UNIT wide and UNIT × aspect high (null: nothing to draw). */
export function strokePath(stroke: Stroke, aspect: number): Path2D | null {
  const hit = paths.get(stroke);
  if (hit && hit.points === stroke.points.length && Math.abs(hit.aspect - aspect) < 1e-6) return hit.path;
  const outline = strokeOutline(stroke, UNIT, UNIT * aspect);
  let path: Path2D | null = null;
  if (outline.length >= 2) {
    path = new Path2D();
    path.moveTo(outline[0]![0]!, outline[0]![1]!);
    // Smooth curve through the midpoints of the outline.
    for (let i = 1; i < outline.length; i++) {
      const [x0, y0] = outline[i - 1]!;
      const [x1, y1] = outline[i]!;
      path.quadraticCurveTo(x0!, y0!, (x0! + x1!) / 2, (y0! + y1!) / 2);
    }
    path.closePath();
  }
  paths.set(stroke, { aspect, points: stroke.points.length, path });
  return path;
}

/** Draws strokes on a canvas the size of the page. Highlighter goes first, under the pen. */
export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], w: number, h: number) {
  if (!w || !h) return;
  const aspect = h / w;
  const k = w / UNIT;
  ctx.save();
  ctx.setTransform(k, 0, 0, k, 0, 0);
  for (const tool of ["highlighter", "pen"] as const) {
    ctx.globalAlpha = tool === "highlighter" ? 0.4 : 1;
    for (const s of strokes) {
      if (s.tool !== tool) continue;
      const path = strokePath(s, aspect);
      if (!path) continue;
      ctx.fillStyle = s.color;
      ctx.fill(path);
    }
  }
  ctx.restore();
}

/** Bounding boxes by stroke, in page fractions: [minX, minY, maxX, maxY]. */
const boxes = new WeakMap<Stroke, [number, number, number, number]>();
function strokeBox(stroke: Stroke) {
  let box = boxes.get(stroke);
  if (!box) {
    box = [Infinity, Infinity, -Infinity, -Infinity];
    const p = stroke.points;
    for (let i = 0; i + 1 < p.length; i += 3) {
      box[0] = Math.min(box[0], p[i]!);
      box[1] = Math.min(box[1], p[i + 1]!);
      box[2] = Math.max(box[2], p[i]!);
      box[3] = Math.max(box[3], p[i + 1]!);
    }
    boxes.set(stroke, box);
  }
  return box;
}

/** Distance from (px, py) to the segment a–b. */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Whether the eraser at (x, y) (page fractions) touches the stroke. Distances are measured
 * in page-width units, so a page's aspect ratio (h / w) doesn't skew them. Strokes whose box
 * is out of reach are skipped without looking at their points.
 */
export function touchesStroke(stroke: Stroke, x: number, y: number, radius: number, aspect: number) {
  const reach = radius + stroke.width / 2;
  const [x0, y0, x1, y1] = strokeBox(stroke);
  if (x < x0 - reach || x > x1 + reach || (y - y1) * aspect > reach || (y0 - y) * aspect > reach) return false;
  const p = stroke.points;
  if (p.length === 3) return Math.hypot(p[0]! - x, (p[1]! - y) * aspect) <= reach;
  for (let i = 0; i + 5 < p.length; i += 3) {
    if (segmentDistance(x, y * aspect, p[i]!, p[i + 1]! * aspect, p[i + 3]!, p[i + 4]! * aspect) <= reach) return true;
  }
  return false;
}
