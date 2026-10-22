import { keptForAccount } from "./accountData";
import { apiFetch, apiJson } from "./api";
import { deviceId } from "./device";
import { onServerEvent } from "./events";
import { afterIdle } from "./idle";
import type { InkPageCopy, InkServer, InkSummary } from "./inkSession";
import { cacheStore, createOutbox } from "./outbox";

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
 *  - This file is the way to the server and the device's storage (`inkServer`); the open book's
 *    handwriting (pages loaded, versions, live changes, undo) is lib/inkSession.ts. Drawing
 *    strokes lives in lib/inkDraw.ts, which loads with the reader only.
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

const signatures = new WeakMap<Stroke[], string>();

/**
 * A short signature of a page's strokes (changes whenever any stroke is added or erased). Kept
 * per list: a page's list is replaced, never changed in place, whenever its strokes change.
 */
export function inkSignature(strokes: Stroke[]) {
  let sig = signatures.get(strokes);
  if (sig === undefined) {
    let h = 5381;
    for (const s of strokes) for (let i = 0; i < s.id.length; i++) h = ((h << 5) + h + s.id.charCodeAt(i)) | 0;
    sig = `${strokes.length}:${(h >>> 0).toString(36)}`;
    signatures.set(strokes, sig);
  }
  return sig;
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
    for (const c of pages.values()) for (const listener of rejectionListeners) listener(c.bookId, c.page, status);
  },
});

/** Told of every page whose change the server refused for good. */
const rejectionListeners = new Set<(bookId: string, page: number, status: number) => void>();

/** Forgets unsent handwriting and the offline copy of every page (sign-out). */
async function clearInk() {
  for (const t of writeTimers.values()) clearTimeout(t);
  writeTimers.clear();
  await outbox.clear();
  if (typeof caches !== "undefined") await caches.delete(STORE).catch(() => {});
}

keptForAccount({ flush: () => outbox.flush(), forget: clearInk });

// ---------- Offline copy, one entry per page ----------

type CachedPage = InkPageCopy;
const pageUrl = (bookId: string, page: number) => `/ink-store/book-${bookId}/page-${page}`;

async function openStore() {
  return typeof caches === "undefined" ? null : caches.open(STORE).catch(() => null);
}

/** The device's entries for a book's pages, with their page numbers. */
async function* cachedPageKeys(cache: Cache, bookId: string) {
  const prefix = `/ink-store/book-${bookId}/page-`;
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (path.startsWith(prefix)) yield { req, page: Number(path.slice(prefix.length)) };
  }
}

/** The device's copy of a book's pages (all, or `only` these). */
async function readCachedPages(bookId: string, only?: number[]): Promise<Record<number, CachedPage>> {
  const cache = await openStore();
  if (!cache) return {};
  const out: Record<number, CachedPage> = {};
  const wanted = only && new Set(only);
  const reads: Promise<void>[] = [];
  for await (const { req, page } of cachedPageKeys(cache, bookId)) {
    if (wanted && !wanted.has(page)) continue;
    reads.push(
      cache.match(req).then(async (res) => {
        if (res) out[page] = await res.json();
      }),
    );
  }
  await Promise.all(reads);
  // The first version kept a whole book in one entry.
  const legacy = await cache.match(`/ink-store/book-${bookId}`);
  if (legacy && !Object.keys(out).length) {
    for (const [p, strokes] of Object.entries((await legacy.json()) as InkPages)) if (!wanted || wanted.has(Number(p))) out[Number(p)] = { strokes, version: 0 };
  }
  return out;
}

const writeTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** When each page's copy was last changed here (the tidying after a book opens keeps those changed since). */
const rememberedAt = new Map<string, number>();

/**
 * Keeps the offline copy of one page in step with what the reader shows. Writes wait a moment,
 * so a burst of strokes costs one write (unsent strokes are safe in the outbox meanwhile).
 */
function rememberInkPage(bookId: string, page: number, strokes: Stroke[], version: number) {
  const url = pageUrl(bookId, page);
  rememberedAt.set(url, Date.now());
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
 * Which pages of a book have handwriting (stroke count and version, no strokes): one small
 * request, so a heavily annotated book opens fast. Offline, the copy on this device answers.
 * Pages the server no longer has are dropped from that copy.
 */
async function loadInkSummary(bookId: string): Promise<InkSummary> {
  try {
    const asked = Date.now();
    const list = await apiJson<{ page: number; version: number; count: number }[]>(`/api/books/${bookId}/ink?summary=1`);
    const summary: InkSummary = Object.fromEntries(list.map((p) => [p.page, { count: p.count, version: p.version }]));
    afterIdle(() => void pruneCachedPages(bookId, summary, asked)); // tidying can wait for the book to be open
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
 * Unsent changes are not included.
 */
async function loadInkPages(bookId: string, pages: number[]): Promise<Record<number, InkPageCopy>> {
  const out: Record<number, InkPageCopy> = Object.fromEntries(pages.map((p) => [p, { strokes: [], version: 0 }]));
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
async function fetchInkPage(bookId: string, page: number): Promise<InkPageCopy | null> {
  try {
    const p = await apiJson<ServerPage>(`/api/books/${bookId}/ink/${page}`);
    return { strokes: p.strokes, version: p.version };
  } catch {
    return null;
  }
}

/**
 * Drops pages from the device's copy that the server no longer had at `asked` (and the first
 * version's single entry). Pages written here since then (just annotated) stay.
 */
async function pruneCachedPages(bookId: string, summary: InkSummary, asked: number) {
  const cache = await openStore();
  if (!cache) return;
  try {
    for await (const { req, page } of cachedPageKeys(cache, bookId)) {
      if (!(page in summary) && (rememberedAt.get(pageUrl(bookId, page)) ?? 0) < asked) await cache.delete(req);
    }
    await cache.delete(`/ink-store/book-${bookId}`);
  } catch {
    /* storage unavailable: nothing to tidy */
  }
}

// ---------- The reader's way to all of the above ----------

/** The server, the outbox and the device's copy, as lib/inkSession uses them. */
export const inkServer: InkServer = {
  summary: loadInkSummary,
  pages: loadInkPages,
  page: fetchInkPage,
  send: (bookId, page, change) => void outbox.push({ bookId, page, add: change.add, remove: change.remove }),
  unsent: (bookId) => outbox.pending().filter((c) => c.bookId === bookId),
  remember: rememberInkPage,
  onChange: (bookId, listener) =>
    onServerEvent((event, data) => {
      if (event === "ink.updated" && data?.bookId === bookId) listener(data.page as number, { add: data.add, remove: data.remove }, data.version as number);
    }),
  onRejected: (bookId, listener) => {
    const forBook = (b: string, page: number, status: number) => b === bookId && listener(page, status);
    rejectionListeners.add(forBook);
    return () => void rejectionListeners.delete(forBook);
  },
};
