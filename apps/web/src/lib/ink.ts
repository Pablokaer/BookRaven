import getStroke from "perfect-freehand";
import { apiFetch, apiJson } from "./api";
import { deviceId } from "./device";

/**
 * Handwritten annotations on PDF pages (pen and highlighter).
 *  - A stroke's points are fractions of the page (x, y) plus pen pressure, so ink fits any
 *    screen, zoom, margin or crop. The PDF file is never changed.
 *  - Devices exchange changes ("added these strokes, erased those"), never whole pages, so
 *    pages annotated on two devices (even offline) keep everyone's strokes.
 *  - Changes are saved on the device first (an outbox) and sent in order when online; the
 *    last ink seen for each book is kept for reading offline. Both live in Cache Storage,
 *    which has room for a lot of handwriting (localStorage would fill up).
 */

export type InkTool = "pen" | "highlighter";

export type Stroke = {
  id: string;
  tool: InkTool;
  /** #rrggbb */
  color: string;
  /** Line width as a fraction of the page width. */
  width: number;
  /** [x0, y0, p0, x1, y1, p1, …]: fractions of the page and pressure (0–1). */
  points: number[];
};

/** Strokes of each annotated page. */
export type InkPages = Record<number, Stroke[]>;

export type InkChange = { add: Stroke[]; remove: string[] };
type QueuedChange = InkChange & { id: string; bookId: string; page: number; at: number };

/** Pen and highlighter colors offered in the toolbar. */
export const PEN_COLORS = ["#111827", "#1d4ed8", "#dc2626", "#15803d"];
export const HIGHLIGHTER_COLORS = ["#facc15", "#4ade80", "#f472b6", "#60a5fa"];
/** Line widths (fractions of the page width): fine, medium, bold. */
export const PEN_WIDTHS = [0.002, 0.0035, 0.006];
export const HIGHLIGHTER_WIDTHS = [0.012, 0.02, 0.032];

// ---------- Changes ----------

/** `strokes` with `change` applied: erased strokes go, added ones replace any with the same id. */
export function applyChange(strokes: Stroke[], change: InkChange): Stroke[] {
  const remove = new Set(change.remove);
  const added = new Set(change.add.map((s) => s.id));
  return [...strokes.filter((s) => !remove.has(s.id) && !added.has(s.id)), ...change.add];
}

/** The change that undoes `change`, given the page's strokes before it. */
export function inverseChange(before: Stroke[], change: InkChange): InkChange {
  const byId = new Map(before.map((s) => [s.id, s]));
  return {
    add: change.remove.map((id) => byId.get(id)).filter((s): s is Stroke => !!s),
    remove: change.add.map((s) => s.id),
  };
}

/** Pages with this device's not-yet-sent changes applied on top. */
export function withPendingInk(bookId: string, pages: InkPages, outbox: QueuedChange[]): InkPages {
  const out: InkPages = { ...pages };
  for (const c of outbox) {
    if (c.bookId !== bookId) continue;
    out[c.page] = applyChange(out[c.page] ?? [], c);
  }
  for (const p of Object.keys(out)) if (!out[Number(p)]!.length) delete out[Number(p)];
  return out;
}

// ---------- Storage (Cache Storage, or memory where it is missing) ----------

const STORE = "readsync-ink-v1";
const memory = new Map<string, unknown>();
let writes: Promise<unknown> = Promise.resolve();

async function load<T>(key: string, fallback: T): Promise<T> {
  if (typeof caches === "undefined") return (memory.get(key) as T) ?? fallback;
  try {
    const hit = await (await caches.open(STORE)).match(`/ink-store/${key}`);
    return hit ? ((await hit.json()) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Writes in call order, so an older value never overwrites a newer one. */
function save(key: string, value: unknown) {
  if (typeof caches === "undefined") {
    memory.set(key, value);
    return Promise.resolve();
  }
  const body = JSON.stringify(value);
  writes = writes
    .then(async () => (await caches.open(STORE)).put(`/ink-store/${key}`, new Response(body, { headers: { "Content-Type": "application/json" } })))
    .catch(() => {});
  return writes;
}

let outbox: QueuedChange[] | null = null;
async function getOutbox() {
  outbox ??= await load<QueuedChange[]>("outbox", []);
  return outbox;
}

// ---------- Sync ----------

/** The book's ink: from the server when reachable, else the last copy seen; plus pending changes. */
export async function loadInk(bookId: string): Promise<InkPages> {
  let pages: InkPages;
  try {
    const list = await apiJson<{ page: number; strokes: Stroke[] }[]>(`/api/books/${bookId}/ink`);
    pages = Object.fromEntries(list.map((p) => [p.page, p.strokes]));
    void save(`book-${bookId}`, pages);
  } catch {
    pages = await load<InkPages>(`book-${bookId}`, {});
  }
  return withPendingInk(bookId, pages, await getOutbox());
}

/** Keeps the offline copy in step with what the reader shows. */
export function rememberInk(bookId: string, pages: InkPages) {
  void save(`book-${bookId}`, pages);
}

/** Pages as the server sent them, with this device's unsent changes applied. */
export async function overlayPending(bookId: string, pages: InkPages) {
  return withPendingInk(bookId, pages, await getOutbox());
}

/** Saves a change made on this device and sends it as soon as possible. */
export async function recordInk(bookId: string, page: number, change: InkChange) {
  const box = await getOutbox();
  box.push({ ...change, id: crypto.randomUUID(), bookId, page, at: Date.now() });
  await save("outbox", box);
  if (flushing) queuedWhileFlushing = true;
  void flushInk();
}

let flushing: Promise<void> | null = null;
let queuedWhileFlushing = false;

async function sendOutbox() {
  const box = await getOutbox();
  while (box.length) {
    const c = box[0]!;
    let res: Response;
    try {
      res = await apiFetch(`/api/books/${c.bookId}/ink/${c.page}`, {
        method: "POST",
        body: JSON.stringify({ add: c.add, remove: c.remove, deviceId }),
      });
    } catch {
      return; // offline
    }
    if (res.status >= 500 || res.status === 401) return;
    // Done, or refused for good (book deleted, page too full): either way it leaves the outbox.
    if (res.status === 413) window.dispatchEvent(new CustomEvent("readsync:ink-rejected", { detail: { page: c.page } }));
    box.shift();
    await save("outbox", box);
  }
}

/** Sends the outbox in order; stops at the first network failure and tries again later. */
export function flushInk(): Promise<void> {
  // .finally runs after `flushing` is set, even when there is nothing to send.
  flushing ??= sendOutbox().finally(() => {
    flushing = null;
    if (queuedWhileFlushing) {
      queuedWhileFlushing = false;
      void flushInk();
    }
  });
  return flushing;
}

let installed = false;
export function installInkFlushers() {
  if (installed) return;
  installed = true;
  window.addEventListener("online", () => void flushInk());
  void flushInk();
}

/** For tests: forget the in-memory outbox and stored values. */
export function resetInkStore() {
  outbox = null;
  memory.clear();
}

// ---------- Geometry ----------

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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

/** Draws strokes on a canvas the size of the page. Highlighter goes first, under the pen. */
export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], w: number, h: number) {
  const ordered = [...strokes.filter((s) => s.tool === "highlighter"), ...strokes.filter((s) => s.tool === "pen")];
  for (const s of ordered) {
    const outline = strokeOutline(s, w, h);
    if (outline.length < 2) continue;
    ctx.globalAlpha = s.tool === "highlighter" ? 0.4 : 1;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.moveTo(outline[0]![0]!, outline[0]![1]!);
    // Smooth curve through the midpoints of the outline.
    for (let i = 1; i < outline.length; i++) {
      const [x0, y0] = outline[i - 1]!;
      const [x1, y1] = outline[i]!;
      ctx.quadraticCurveTo(x0!, y0!, (x0! + x1!) / 2, (y0! + y1!) / 2);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
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
 * in page-width units, so a page's aspect ratio (h / w) doesn't skew them.
 */
export function touchesStroke(stroke: Stroke, x: number, y: number, radius: number, aspect: number) {
  const reach = radius + stroke.width / 2;
  const p = stroke.points;
  if (p.length === 3) return Math.hypot(p[0]! - x, (p[1]! - y) * aspect) <= reach;
  for (let i = 0; i + 5 < p.length; i += 3) {
    if (segmentDistance(x, y * aspect, p[i]!, p[i + 1]! * aspect, p[i + 3]!, p[i + 4]! * aspect) <= reach) return true;
  }
  return false;
}
