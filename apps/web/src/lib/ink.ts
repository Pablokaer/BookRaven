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
 *  - A book opens with a summary of its annotated pages; strokes are loaded page by page,
 *    around the page being read (and for the notebook's pictures).
 *  - Changes wait in an outbox (lib/outbox) and are sent in order, several strokes of a page
 *    per request. The last ink seen is kept per page for reading offline. Both live in Cache
 *    Storage, which has room for a lot of handwriting.
 *  - Drawing strokes lives in lib/inkDraw.ts, which loads with the reader only.
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

/** The device's copy of a book's pages (all, or `only` these). */
async function readCachedPages(bookId: string, only?: number[]): Promise<Record<number, CachedPage>> {
  const cache = await openStore();
  if (!cache) return {};
  const out: Record<number, CachedPage> = {};
  const prefix = `/ink-store/book-${bookId}/page-`;
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (!path.startsWith(prefix)) continue;
    const page = Number(path.slice(prefix.length));
    if (only && !only.includes(page)) continue;
    const res = await cache.match(req);
    if (res) out[page] = await res.json();
  }
  // The first version kept a whole book in one entry.
  const legacy = await cache.match(`/ink-store/book-${bookId}`);
  if (legacy && !Object.keys(out).length) {
    for (const [p, strokes] of Object.entries((await legacy.json()) as InkPages)) if (!only || only.includes(Number(p))) out[Number(p)] = { strokes, version: 0 };
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
/** A page with handwriting as the summary lists it: how many strokes, at which version. */
export type InkSummary = Record<number, { count: number; version: number }>;

/** Pages with changes still waiting to be sent (they must show even before the server has them). */
export function pendingInkPages(bookId: string) {
  return [...new Set(outbox.pending().filter((c) => c.bookId === bookId).map((c) => c.page))];
}

/**
 * Which pages of a book have handwriting (stroke count and version, no strokes): one small
 * request, so a heavily annotated book opens fast. Offline, the copy on this device answers.
 * Pages the server no longer has are dropped from that copy.
 */
export async function loadInkSummary(bookId: string): Promise<InkSummary> {
  try {
    const list = await apiJson<{ page: number; version: number; count: number }[]>(`/api/books/${bookId}/ink?summary=1`);
    const summary: InkSummary = Object.fromEntries(list.map((p) => [p.page, { count: p.count, version: p.version }]));
    void pruneCachedPages(bookId, summary);
    return summary;
  } catch {
    const cached = await readCachedPages(bookId);
    return Object.fromEntries(Object.entries(cached).map(([p, c]) => [p, { count: c.strokes.length, version: c.version }]));
  } finally {
    await outbox.ready;
  }
}

/**
 * The strokes of some pages (as the server has them; offline, as this device last saw them),
 * kept on the device as they arrive. Pages without handwriting come back empty at version 0.
 * Unsent changes are not included: add them with withPendingInk.
 */
export async function loadInkPages(bookId: string, pages: number[]): Promise<Record<number, { strokes: Stroke[]; version: number }>> {
  const out: Record<number, { strokes: Stroke[]; version: number }> = Object.fromEntries(pages.map((p) => [p, { strokes: [], version: 0 }]));
  if (!pages.length) return out;
  try {
    const list = await apiJson<ServerPage[]>(`/api/books/${bookId}/ink?pages=${pages.join(",")}`);
    for (const p of list) {
      out[p.page] = { strokes: p.strokes, version: p.version };
      rememberInkPage(bookId, p.page, p.strokes, p.version);
    }
  } catch {
    const cached = await readCachedPages(bookId, pages);
    for (const p of pages) if (cached[p]) out[p] = cached[p];
  }
  return out;
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

/** Drops pages from the device's copy that the server no longer has (and the first version's single entry). */
async function pruneCachedPages(bookId: string, summary: InkSummary) {
  const cache = await openStore();
  if (!cache) return;
  try {
    const prefix = `/ink-store/book-${bookId}/page-`;
    for (const req of await cache.keys()) {
      const path = new URL(req.url).pathname;
      if (path.startsWith(prefix) && !(Number(path.slice(prefix.length)) in summary)) await cache.delete(req);
    }
    await cache.delete(`/ink-store/book-${bookId}`);
  } catch {
    /* storage unavailable: nothing to tidy */
  }
}
