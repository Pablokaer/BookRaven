import getStroke from "perfect-freehand";
import { apiFetch, apiJson } from "./api";
import { deviceId } from "./device";
import { cacheStore, createOutbox, type Queued } from "./outbox";

/**
 * Handwritten annotations on PDF pages (pen and highlighter).
 *  - A stroke's points are fractions of the page (x, y) plus pen pressure, so ink fits any
 *    screen, zoom, margin or crop. The PDF file is never changed.
 *  - Devices exchange changes ("added these strokes, erased those"), never whole pages, so
 *    pages annotated on two devices (even offline) keep everyone's strokes. Each change raises
 *    the page's version on the server; live changes carry it, so they are applied in order.
 *  - Changes wait in an outbox (lib/outbox) and are sent in order, several strokes of a page
 *    per request. The last ink seen is kept per page for reading offline. Both live in Cache
 *    Storage, which has room for a lot of handwriting.
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
/** Server version of each page (pages never written on are at 0). */
export type InkVersions = Record<number, number>;

export type InkChange = { add: Stroke[]; remove: string[] };
type PendingChange = InkChange & { bookId: string; page: number };

/** Pen and highlighter colors offered in the toolbar. */
export const PEN_COLORS = ["#111827", "#1d4ed8", "#dc2626", "#15803d"];
export const HIGHLIGHTER_COLORS = ["#facc15", "#4ade80", "#f472b6", "#60a5fa"];
/** Line widths (fractions of the page width): fine, medium, bold. */
export const PEN_WIDTHS = [0.002, 0.0035, 0.006];
export const HIGHLIGHTER_WIDTHS = [0.012, 0.02, 0.032];
/** The server takes up to 10,000 points per stroke; longer ones are split (see PdfReader). */
export const MAX_STROKE_POINTS = 9000;

// ---------- Changes ----------

/** `strokes` with `change` applied: erased strokes go, added ones replace any with the same id (and go on top). */
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

/**
 * Several changes as one, with the same result: the server erases `remove` and the ids in `add`
 * first, then adds `add`.
 */
export function mergeChanges(changes: InkChange[]): InkChange {
  let add: Stroke[] = [];
  const remove = new Set<string>();
  for (const c of changes) {
    add = applyChange(add, c);
    for (const id of c.remove) remove.add(id);
  }
  return { add, remove: [...remove] };
}

/** What to do with a live change at `version` for a page whose known version is `known`. */
export function liveChangeAction(known: number, version: number): "ignore" | "apply" | "refetch" {
  if (version <= known) return "ignore"; // already seen (our own change, or an older one arriving late)
  return version === known + 1 ? "apply" : "refetch"; // a gap: a change was missed
}

/** A short signature of a page's strokes (changes whenever any stroke is added or erased). */
export function inkSignature(strokes: Stroke[]) {
  let h = 5381;
  for (const s of strokes) for (let i = 0; i < s.id.length; i++) h = ((h << 5) + h + s.id.charCodeAt(i)) | 0;
  return `${strokes.length}:${(h >>> 0).toString(36)}`;
}

// ---------- Outbox ----------

const STORE = "readsync-ink-v1";
/** One request carries at most this much (the server allows 500 strokes and 4 MB). */
const BATCH_STROKES = 200;
const BATCH_NUMBERS = 300_000;

/** Changes queued by the first version of this feature (one "outbox" entry), brought over once. */
async function legacyOutbox(): Promise<PendingChange[]> {
  const cache = await caches.open(STORE);
  const res = await cache.match("/ink-store/outbox");
  if (!res) return [];
  const old = (await res.json()) as PendingChange[];
  await cache.delete("/ink-store/outbox");
  return old.map(({ bookId, page, add, remove }) => ({ bookId, page, add, remove }));
}

const outbox = createOutbox<PendingChange>({
  store: cacheStore(STORE, "/ink-store/queue/", legacyOutbox),
  // Consecutive changes to the same page go together, within the server's limits.
  batch: (queue) => {
    const first = queue[0]!;
    let n = 0;
    let strokes = 0;
    let numbers = 0;
    for (const c of queue) {
      if (c.bookId !== first.bookId || c.page !== first.page) break;
      strokes += c.add.length;
      numbers += c.add.reduce((sum, s) => sum + s.points.length, 0);
      if (n && (strokes > BATCH_STROKES || numbers > BATCH_NUMBERS)) break;
      n++;
    }
    return n;
  },
  send: (items) => {
    const { bookId, page } = items[0]!;
    const change = mergeChanges(items);
    return apiFetch(`/api/books/${bookId}/ink/${page}`, { method: "POST", body: JSON.stringify({ ...change, deviceId }) });
  },
  // Refused for good (page full, invalid stroke): the reader shows the server's page again.
  onRejected: (items, status) => {
    const pages = new Map(items.map((c) => [`${c.bookId}:${c.page}`, c]));
    for (const c of pages.values()) {
      window.dispatchEvent(new CustomEvent("readsync:ink-rejected", { detail: { bookId: c.bookId, page: c.page, status } }));
    }
  },
});

/** Saves a change made on this device (synchronously, so it already counts as pending) and sends it soon. */
export function recordInk(bookId: string, page: number, change: InkChange) {
  outbox.push({ bookId, page, add: change.add, remove: change.remove });
}

/** `strokes` (the server's page) with this device's unsent changes to it on top. */
export function withPendingInk(bookId: string, page: number, strokes: Stroke[], pending: Queued<PendingChange>[] = outbox.pending()) {
  return pending.reduce((acc, c) => (c.bookId === bookId && c.page === page ? applyChange(acc, c) : acc), strokes);
}

export const flushInk = () => outbox.flush();

let installed = false;
export function installInkFlushers() {
  if (installed) return;
  installed = true;
  window.addEventListener("online", () => void flushInk());
  void flushInk();
}

// ---------- Offline copy, one entry per page ----------

type CachedPage = { strokes: Stroke[]; version: number };
const pageUrl = (bookId: string, page: number) => `/ink-store/book-${bookId}/page-${page}`;

async function openStore() {
  return typeof caches === "undefined" ? null : caches.open(STORE).catch(() => null);
}

async function readCachedPages(bookId: string): Promise<Record<number, CachedPage>> {
  const cache = await openStore();
  if (!cache) return {};
  const out: Record<number, CachedPage> = {};
  const prefix = `/ink-store/book-${bookId}/page-`;
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (!path.startsWith(prefix)) continue;
    const res = await cache.match(req);
    if (res) out[Number(path.slice(prefix.length))] = await res.json();
  }
  // The first version kept a whole book in one entry.
  const legacy = await cache.match(`/ink-store/book-${bookId}`);
  if (legacy && !Object.keys(out).length) {
    for (const [p, strokes] of Object.entries((await legacy.json()) as InkPages)) out[Number(p)] = { strokes, version: 0 };
  }
  return out;
}

const writeTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Keeps the offline copy of one page in step with what the reader shows. Writes wait a moment,
 * so a burst of strokes costs one write (unsent strokes are safe in the outbox meanwhile).
 */
export function rememberInkPage(bookId: string, page: number, strokes: Stroke[], version: number) {
  const url = pageUrl(bookId, page);
  clearTimeout(writeTimers.get(url));
  writeTimers.set(
    url,
    setTimeout(() => {
      writeTimers.delete(url);
      void (async () => {
        const cache = await openStore();
        if (!cache) return;
        if (strokes.length || version) {
          await cache.put(url, new Response(JSON.stringify({ strokes, version } satisfies CachedPage), { headers: { "Content-Type": "application/json" } }));
        } else await cache.delete(url);
      })().catch(() => {});
    }, 600),
  );
}

type ServerPage = { page: number; version: number; strokes: Stroke[] };

/**
 * The book's handwriting: from the server when reachable (then also kept offline), else the
 * last copy seen; with this device's unsent changes on top.
 */
export async function loadInk(bookId: string): Promise<{ pages: InkPages; versions: InkVersions }> {
  let server: Record<number, CachedPage> | null = null;
  try {
    const list = await apiJson<ServerPage[]>(`/api/books/${bookId}/ink`);
    server = Object.fromEntries(list.map((p) => [p.page, { strokes: p.strokes, version: p.version }]));
  } catch {
    /* offline: use the copy on this device */
  }
  const saved = server ?? (await readCachedPages(bookId));
  if (server) void replaceCachedBook(bookId, server);
  await outbox.ready;
  const pages: InkPages = {};
  const versions: InkVersions = {};
  const touched = new Set([...Object.keys(saved).map(Number), ...outbox.pending().filter((c) => c.bookId === bookId).map((c) => c.page)]);
  for (const page of touched) {
    versions[page] = saved[page]?.version ?? 0;
    const strokes = withPendingInk(bookId, page, saved[page]?.strokes ?? []);
    if (strokes.length) pages[page] = strokes;
  }
  return { pages, versions };
}

/** One page from the server (after a missed live change, or a refused one); null when offline. */
export async function fetchInkPage(bookId: string, page: number): Promise<{ strokes: Stroke[]; version: number } | null> {
  try {
    const p = await apiJson<ServerPage>(`/api/books/${bookId}/ink/${page}`);
    return { strokes: p.strokes, version: p.version };
  } catch {
    return null;
  }
}

/** Stores the server's copy of a book's pages, dropping pages it no longer has. */
async function replaceCachedBook(bookId: string, pages: Record<number, CachedPage>) {
  const cache = await openStore();
  if (!cache) return;
  try {
    const prefix = `/ink-store/book-${bookId}/`;
    for (const req of await cache.keys()) {
      const path = new URL(req.url).pathname;
      if (path.startsWith(prefix) && !(Number(path.slice(`${prefix}page-`.length)) in pages)) await cache.delete(req);
    }
    await cache.delete(`/ink-store/book-${bookId}`); // the first version's single entry
    for (const [p, data] of Object.entries(pages)) {
      await cache.put(pageUrl(bookId, Number(p)), new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } }));
    }
  } catch {
    /* storage full: the reader still works online */
  }
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
