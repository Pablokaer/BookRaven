import { applyChange, inkServer, inkSignature, inverseChange, liveChangeAction, type InkChange, type InkPages, type InkVersions, type Stroke } from "./ink";

/**
 * The handwriting of the PDF being read: which pages are loaded, their versions, live changes
 * from other devices, the offline copy, refused changes and undo/redo, behind one small
 * interface. The reader asks for the pages near the one being read, draws and erases, and
 * shows each snapshot.
 *  - The book opens with a summary of its annotated pages; strokes load page by page.
 *  - This device's unsent changes always go on top of any copy of a page from the server.
 *  - Live changes carry the page's version: they apply in order, a gap makes the page load
 *    again, and one that arrives while the page loads makes it load again once shown.
 *  - The offline copy is kept in step with what is shown, only once the summary has loaded
 *    (until then the empty state would wipe it).
 *  - Requests, the outbox and the device's storage are the `InkServer` (lib/ink.ts).
 */

/** A page's strokes and version, as the server (or, offline, this device) has them. */
export type InkPageCopy = { strokes: Stroke[]; version: number };
/** A page with handwriting as the summary lists it: how many strokes, at which version. */
export type InkSummary = Record<number, { count: number; version: number }>;
/** A page with handwriting: its number of strokes, and a signature that changes with any stroke. */
export type AnnotatedInkPage = { page: number; strokes: number; signature: string };

/** What the session needs from the server, the outbox and the device's storage. */
export type InkServer = {
  /** Every annotated page's stroke count and version (offline, the device's copy). */
  summary(bookId: string): Promise<InkSummary>;
  /** Some pages' strokes, without unsent changes; pages never written on come back empty at version 0. */
  pages(bookId: string, pages: number[]): Promise<Record<number, InkPageCopy>>;
  /** One page fresh from the server; null when it can't be reached. */
  page(bookId: string, page: number): Promise<InkPageCopy | null>;
  /** Queues a change made here; from then on it is in `unsent` until the server has it. */
  send(bookId: string, page: number, change: InkChange): void;
  /** This device's changes to the book not yet accepted by the server, oldest first. */
  unsent(bookId: string): (InkChange & { page: number })[];
  /** Keeps the device's copy of a page in step (for reading offline). */
  remember(bookId: string, page: number, strokes: Stroke[], version: number): void;
  /** Changes to the book's pages made on other devices, with the page's new version. */
  onChange(bookId: string, listener: (page: number, change: InkChange, version: number) => void): () => void;
  /** Changes to the book's pages the server refused for good (already out of the queue). */
  onRejected(bookId: string, listener: (page: number, status: number) => void): () => void;
};

export type InkSnapshot = {
  /** Strokes of the pages loaded so far (pages without strokes are left out). */
  pages: InkPages;
  /** The annotated pages (loaded ones from their strokes, the others from the summary), in page order. */
  annotated: AnnotatedInkPage[];
  canUndo: boolean;
  canRedo: boolean;
};

export type InkSession = {
  snapshot(): InkSnapshot;
  /** Calls `listener` after every new snapshot. */
  subscribe(listener: () => void): () => void;
  /** Keeps the strokes of `page` (being read), its neighbours and pages with unsent changes loaded. */
  showAround(page: number): void;
  /** Loads these pages' strokes (once the summary is in); resolves when they are in the snapshot. */
  load(pages: number[]): Promise<void>;
  /** A change drawn or erased here: shown at once, sent, and undoable. */
  draw(page: number, change: InkChange): void;
  /** Undoes (or redoes) the last change of this session; returns the page it changed (null: nothing to do). */
  undo(): number | null;
  redo(): number | null;
  /** Stops listening; loads still on their way are dropped. */
  close(): void;
};

/** `pages` with one page's strokes replaced (a page left without strokes is dropped). */
function withPage(pages: InkPages, page: number, strokes: Stroke[]): InkPages {
  const next = { ...pages, [page]: strokes };
  if (!strokes.length) delete next[page];
  return next;
}

export const EMPTY_INK: InkSnapshot = { pages: {}, annotated: [], canUndo: false, canRedo: false };

export function createInkSession(
  bookId: string,
  options: {
    /** The server refused a change to `page` for good (it is shown as the server has it again). */
    onRejected?(page: number, status: number): void;
    server?: InkServer;
  } = {},
): InkSession {
  const server = options.server ?? inkServer;
  let closed = false;
  let pages: InkPages = {};
  let summary: InkSummary = {};
  let summaryLoaded = false;
  /** Pages whose strokes are loaded (or known to be empty), and those being loaded. */
  const loaded = new Set<number>();
  const loading = new Map<number, Promise<void>>();
  /** The server version of each loaded page, and the newest version heard of for any page. */
  const versions: InkVersions = {};
  const latest: InkVersions = {};
  /** What the offline copy holds (written or loaded), per page. */
  let saved: InkPages = {};
  /** This session's changes, each with the change that reverts it. */
  const history: Record<"undo" | "redo", { page: number; change: InkChange }[]> = { undo: [], redo: [] };
  /** The page being read (0: none yet). */
  let around = 0;
  let snapshot = EMPTY_INK;
  const listeners = new Set<() => void>();

  const withUnsent = (page: number, strokes: Stroke[]) => server.unsent(bookId).reduce((acc, c) => (c.page === page ? applyChange(acc, c) : acc), strokes);

  function annotated() {
    const list = new Map<number, AnnotatedInkPage>();
    for (const [p, s] of Object.entries(summary)) {
      if (s.count > 0 && !loaded.has(Number(p))) list.set(Number(p), { page: Number(p), strokes: s.count, signature: `v${s.version}` });
    }
    for (const [p, strokes] of Object.entries(pages)) list.set(Number(p), { page: Number(p), strokes: strokes.length, signature: inkSignature(strokes) });
    return [...list.values()].sort((a, b) => a.page - b.page);
  }

  /** Writes the pages that changed since the offline copy last had them (once the summary is in). */
  function rememberChanged() {
    if (!summaryLoaded) return;
    for (const page of new Set([...Object.keys(saved), ...Object.keys(pages)].map(Number))) {
      if (saved[page] !== pages[page]) server.remember(bookId, page, pages[page] ?? [], versions[page] ?? 0);
    }
    saved = pages;
  }

  function publish() {
    rememberChanged();
    snapshot = { pages, annotated: annotated(), canUndo: history.undo.length > 0, canRedo: history.redo.length > 0 };
    for (const listener of listeners) listener();
  }

  /** The server's copy of a page, with this device's unsent changes on top. */
  async function reload(page: number) {
    const fresh = await server.page(bookId, page);
    if (!fresh || closed || fresh.version < (versions[page] ?? 0)) return;
    versions[page] = fresh.version;
    pages = withPage(pages, page, withUnsent(page, fresh.strokes));
    publish();
  }

  /** Puts a page's strokes (as loaded) in the snapshot, with unsent changes on top. */
  function show(page: number, strokes: Stroke[], version: number) {
    if (closed) return;
    loaded.add(page);
    versions[page] = version;
    const shown = withUnsent(page, strokes);
    saved = withPage(saved, page, shown); // already in the offline copy
    pages = withPage(pages, page, shown);
    publish();
    // A live change arrived while this page was loading: load it again.
    if ((latest[page] ?? 0) > version) void reload(page);
  }

  /** Loads the strokes of `wanted` pages not loaded yet, in one request; resolves when they are shown. */
  function ensure(wanted: number[]) {
    if (closed) return Promise.resolve();
    const waiting: Promise<void>[] = [];
    const toFetch: number[] = [];
    for (const page of new Set(wanted)) {
      if (page < 1 || loaded.has(page)) continue;
      const pending = loading.get(page);
      if (pending) waiting.push(pending);
      else if ((summary[page]?.count ?? 0) > 0) toFetch.push(page);
      else show(page, [], summary[page]?.version ?? 0); // nothing written there
    }
    if (toFetch.length) {
      const job = server.pages(bookId, toFetch).then((copies) => {
        for (const page of toFetch) {
          loading.delete(page);
          show(page, copies[page]!.strokes, copies[page]!.version);
        }
      });
      for (const page of toFetch) loading.set(page, job);
      waiting.push(job);
    }
    return Promise.all(waiting).then(() => {});
  }

  /** The page being read and its neighbours, and pages with unsent changes (they must show before the server has them). */
  function ensureAround() {
    if (!summaryLoaded || !around) return;
    void ensure([around - 1, around, around + 1, around + 2, ...server.unsent(bookId).map((c) => c.page)]);
  }

  const summaryReady = server.summary(bookId).then(
    (loadedSummary) => {
      if (closed) return;
      for (const [page, s] of Object.entries(loadedSummary)) latest[Number(page)] = Math.max(latest[Number(page)] ?? 0, s.version);
      summary = loadedSummary;
      summaryLoaded = true;
      publish();
      ensureAround();
    },
    () => {},
  );

  const offChange = server.onChange(bookId, (page, change, version) => {
    latest[page] = Math.max(latest[page] ?? 0, version);
    if (!loaded.has(page)) {
      // Not loaded here: the summary keeps the notebook right, and the strokes load when needed.
      const was = summary[page];
      summary = { ...summary, [page]: { version: Math.max(was?.version ?? 0, version), count: Math.max(0, (was?.count ?? 0) + change.add.length - change.remove.length) } };
      publish();
      ensureAround();
      return;
    }
    const action = liveChangeAction(versions[page] ?? 0, version);
    if (action === "refetch") return void reload(page);
    if (action === "ignore") return;
    versions[page] = version;
    pages = withPage(pages, page, withUnsent(page, applyChange(pages[page] ?? [], change)));
    publish();
  });

  const offRejected = server.onRejected(bookId, (page, status) => {
    options.onRejected?.(page, status);
    void reload(page);
  });

  /** Applies a change here and queues it for the server (queued first, so it already counts as unsent). */
  function apply(page: number, change: InkChange) {
    server.send(bookId, page, change);
    pages = withPage(pages, page, applyChange(pages[page] ?? [], change));
    publish();
  }

  /** Undo (or redo): applies the stored change, keeping the one that reverts it on the other stack. */
  function step(from: "undo" | "redo") {
    if (closed) return null;
    const last = history[from].pop();
    if (!last) return null;
    history[from === "undo" ? "redo" : "undo"].push({ page: last.page, change: inverseChange(pages[last.page] ?? [], last.change) });
    apply(last.page, last.change);
    return last.page;
  }

  return {
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    showAround(page) {
      around = page;
      ensureAround();
    },
    load: (wanted) => summaryReady.then(() => ensure(wanted)),
    draw(page, change) {
      if (closed) return;
      history.undo.push({ page, change: inverseChange(pages[page] ?? [], change) });
      history.redo = [];
      apply(page, change);
    },
    undo: () => step("undo"),
    redo: () => step("redo"),
    close() {
      closed = true;
      offChange();
      offRejected();
      listeners.clear();
    },
  };
}
