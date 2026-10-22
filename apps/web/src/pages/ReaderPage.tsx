import { pageLocator, pageOf, parseLocator } from "@bookraven/locator";
import { compare as compareCfi, parse as parseCfi, type ParsedCfi } from "foliate-js/epubcfi.js";
import type { TocItem } from "foliate-js/view.js";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Bookmark as BookmarkIcon, NotebookText, PenLine, Search, TableOfContents, ZoomIn, ZoomOut, type LucideIcon } from "lucide-react";
import { serverConfig, type Book, type Highlight, type HighlightColor, type ServerConfig } from "../lib/api";
import {
  applyChange,
  fetchInkPage,
  inkSignature,
  inverseChange,
  liveChangeAction,
  loadInkPages,
  loadInkSummary,
  pendingInkPages,
  recordInk,
  rememberInkPage,
  withPendingInk,
  type InkChange,
  type InkPages,
  type InkSummary,
  type InkVersions,
  type Stroke,
} from "../lib/ink";
import { getBook } from "../lib/books";
import { useLibraryActions } from "../lib/libraryStore";
import { listClubs, type ClubSummary } from "../lib/clubs";
import { isComicFormat } from "../lib/comicFormats";
import { onServerEvent } from "../lib/events";
import { percent, timeAgo } from "../lib/format";
import { createHighlight, deleteHighlight, downloadText, highlightsToMarkdown, listHighlights, updateHighlight } from "../lib/highlights";
import { afterIdle } from "../lib/idle";
import { flushProgress, getLocalPending, saveProgress, type Position } from "../lib/progress";
import { THEMES, useSettings } from "../lib/settings";
import { useDocumentEvent, useLatest } from "../lib/useLatest";
import { DiscussDialog } from "../reader/DiscussDialog";
import { HighlightMenu } from "../reader/HighlightMenu";
import { LookupCard } from "../reader/LookupCard";
import { NoteDialog } from "../reader/NoteDialog";
import { InkToolbar, useInkTools } from "../reader/InkToolbar";
import { NotebookPanel, type InkPageSummary, type NotebookTab } from "../reader/NotebookPanel";
import { SearchPanel } from "../reader/SearchPanel";
import { SettingsPanel } from "../reader/SettingsPanel";
import { TocPanel } from "../reader/TocPanel";
import type { ReaderHandle, TapZone, TextSelection } from "../reader/types";
import { useBookmarks } from "../reader/useBookmarks";
import { useRemoteProgress } from "../reader/useRemoteProgress";

// Each reader loads with the first book that needs it (pdf.js, for one, is big: only PDFs load it).
const PdfReader = lazy(() => import("../reader/PdfReader").then((m) => ({ default: m.PdfReader })));
const EpubReader = lazy(() => import("../reader/EpubReader").then((m) => ({ default: m.EpubReader })));
const ComicScroller = lazy(() => import("../reader/ComicScroller").then((m) => ({ default: m.ComicScroller })));

type Panel = "settings" | "toc" | "notebook" | "search";

/** A PDF highlight's page and first character ("pdf:<page>:<start>-<end>"). */
const pdfPos = (cfi: string) => {
  const l = parseLocator(cfi);
  return l?.kind === "pdfRange" ? [l.page, l.start] : null;
};

/**
 * Book order (by position in the text), falling back to creation order. Each CFI is parsed once
 * per sort rather than at every comparison (compare parses strings itself, so the order is the same).
 */
function sortHighlights(list: Highlight[]) {
  const parsed = new Map<string, ParsedCfi | null>();
  const cfiOf = (cfi: string) => {
    let p = parsed.get(cfi);
    if (p === undefined) {
      try {
        p = parseCfi(cfi);
      } catch {
        p = null;
      }
      parsed.set(cfi, p);
    }
    return p;
  };
  return [...list].sort((a, b) => {
    const pa = pdfPos(a.cfi);
    const pb = pdfPos(b.cfi);
    if (pa && pb) return pa[0]! - pb[0]! || pa[1]! - pb[1]!;
    const ca = cfiOf(a.cfi);
    const cb = cfiOf(b.cfi);
    if (ca && cb) {
      try {
        return compareCfi(ca, cb);
      } catch {
        /* not comparable: creation order */
      }
    }
    return a.createdAt.localeCompare(b.createdAt);
  });
}

/** `pages` with one page's strokes replaced (a page left without strokes is dropped). */
function withPage(pages: InkPages, page: number, strokes: Stroke[]): InkPages {
  const next = { ...pages, [page]: strokes };
  if (!strokes.length) delete next[page];
  return next;
}

/**
 * PDF handwriting state of the open book: the pages whose strokes are loaded (or known to be
 * empty) and those being loaded, the server version of each loaded page and the newest version
 * heard of for any page, and what the offline copy holds.
 */
const newInkState = () => ({ loaded: new Set<number>(), loading: new Map<number, Promise<void>>(), versions: {} as InkVersions, latest: {} as InkVersions, saved: {} as InkPages });

/** A top-bar button with an icon. */
function BarButton({ icon: Icon, iconClass, className, children, ...props }: React.ComponentProps<"button"> & { icon: LucideIcon; iconClass?: string }) {
  return (
    <button className={className === undefined ? "btn-icon" : `btn-icon ${className}`} {...props}>
      <Icon className={iconClass === undefined ? "h-[18px] w-[18px]" : `h-[18px] w-[18px] ${iconClass}`} />
      {children}
    </button>
  );
}

/** A single word (or a short hyphenated one): what the dictionary can look up. */
const isWord = (text: string) => /^[\p{L}\p{M}'’-]{1,40}$/u.test(text.trim());

/** Picks the newest of the server position and a not-yet-synced local one. */
function initialLocator(book: Book): string | null {
  const local = getLocalPending(book.id);
  const server = book.progress;
  if (local && (!server || local.clientUpdatedAt > new Date(server.updatedAt).getTime())) return local.locator;
  return server?.locator ?? null;
}

export function ReaderPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [toc, setToc] = useState<TocItem[] | null>(null);
  const [chrome, setChrome] = useState(true);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [notebookTab, setNotebookTab] = useState<NotebookTab>("highlights");
  const [lookup, setLookup] = useState<{ mode: "dictionary" | "translate"; text: string; rect: DOMRect } | null>(null);
  const [noteFor, setNoteFor] = useState<{ highlight: Highlight } | { selection: TextSelection } | null>(null);
  const [bookLanguage, setBookLanguage] = useState<string | null>(null);
  const [magnifier, setMagnifier] = useState(false);
  /** PDFs: zoom level (1 = the fitted page). */
  const [pdfZoom, setPdfZoom] = useState(1);
  /** Book clubs reading this book (for "Discuss in club"). */
  const [clubs, setClubs] = useState<ClubSummary[]>([]);
  const [discuss, setDiscuss] = useState<{ quote: string; locator: string } | null>(null);
  // "?at=<locator>" (from a club message) opens the book at that passage.
  const [params] = useSearchParams();
  const jumpTo = useRef(params.get("at"));
  const [features, setFeatures] = useState<Pick<ServerConfig, "dictionaryEnabled" | "translateEnabled"> | null>(null);
  // The word dictionary detects a word's language with the dictionary and translates it: either is enough.
  const hasDictionary = !!(features?.dictionaryEnabled || features?.translateEnabled);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  /** PDFs: handwriting of the pages loaded so far (around the page being read), and whether the pen is out. */
  const [ink, setInk] = useState<InkPages>({});
  const inkRef = useLatest(ink);
  /** Every annotated page's stroke count and version, loaded when the book opens (strokes load page by page). */
  const [inkSummary, setInkSummary] = useState<InkSummary>({});
  const inkSummaryRef = useLatest(inkSummary);
  const inkState = useRef(newInkState());
  /** The book whose handwriting summary is loaded (null while loading). */
  const [inkLoadedFor, setInkLoadedFor] = useState<string | null>(null);
  /** Notebook pictures of annotated pages: the latest one of each page, with the strokes it shows. */
  const inkThumbs = useRef(new Map<number, { signature: string; url: string }>());
  const [inking, setInking] = useState(false);
  const inkTools = useInkTools();
  /** Undo and redo stacks of this session's handwriting changes (each with the change that reverts it). */
  const inkHistory = useRef<{ undo: { page: number; change: InkChange }[]; redo: { page: number; change: InkChange }[] }>({ undo: [], redo: [] });
  const [inkHistorySize, setInkHistorySize] = useState({ undo: 0, redo: 0 });
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [activeHighlight, setActiveHighlight] = useState<{ highlight: Highlight; rect: DOMRect } | null>(null);
  const [startLocator, setStartLocator] = useState<string | null>(null);
  const reader = useRef<ReaderHandle>(null);
  const positionRef = useRef<Position | null>(null);
  const { remote, setRemote, offerRemote } = useRemoteProgress(id, positionRef);

  // Read once when the book opens: subscribing to the library would re-render the whole reader
  // on every change to it (reading positions from other devices…).
  const { getBook: libraryBook } = useLibraryActions();

  useEffect(() => {
    let cancelled = false;
    // The library already has the book: open it right away (also offline) and check the server meanwhile.
    const known = libraryBook(id) ?? null;
    if (known) {
      setStartLocator(initialLocator(known));
      setBook(known);
    }
    getBook(id)
      .then((b) => {
        if (cancelled) return;
        if (!known) {
          setStartLocator(initialLocator(b));
          setBook(b);
        } else if (b.progress && b.progress.updatedAt !== known.progress?.updatedAt) {
          offerRemote(b.progress); // the library's copy may be older
        }
      })
      .catch(() => !cancelled && !known && setError("Book not found"));
    return () => {
      cancelled = true;
      flushProgress();
    };
  }, [id, libraryBook, offerRemote]);

  // Only the menu over selected text needs the clubs: they load once the book is open.
  useEffect(
    () =>
      afterIdle(() =>
        listClubs(id)
          .then(setClubs)
          .catch(() => {}),
      ),
    [id],
  );

  useEffect(() => {
    serverConfig()
      .then(setFeatures)
      .catch(() => {});
  }, []);

  // Hide the chrome a few seconds after opening, like most readers.
  useEffect(() => {
    if (!book) return;
    const t = setTimeout(() => setChrome(false), 2500);
    return () => clearTimeout(t);
  }, [book]);

  // Highlights (text books and PDFs; comics are images), kept in sync with other devices.
  useEffect(() => {
    if (!book || isComicFormat(book.format)) return;
    let cancelled = false;
    listHighlights(book.id)
      .then((list) => !cancelled && setHighlights(sortHighlights(list)))
      .catch(() => {});
    const off = onServerEvent((event, data) => {
      if (data?.bookId !== book.id) return;
      if (event === "highlight.saved") {
        setHighlights((prev) => sortHighlights([...prev.filter((h) => h.id !== data.id), data as Highlight]));
      } else if (event === "highlight.deleted") {
        setHighlights((prev) => prev.filter((h) => h.id !== data.id));
      }
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [book]);

  /** The book whose handwriting is being shown (loads for another book are dropped). */
  const inkBook = useRef<string | null>(null);

  /** The server's copy of a loaded page, with this device's unsent changes on top. */
  const reloadInkPage = useCallback(
    async (page: number) => {
      if (!book) return;
      const fresh = await fetchInkPage(book.id, page);
      if (!fresh || book.id !== inkBook.current || fresh.version < (inkState.current.versions[page] ?? 0)) return;
      inkState.current.versions[page] = fresh.version;
      setInk((prev) => withPage(prev, page, withPendingInk(book.id, page, fresh.strokes)));
    },
    [book],
  );

  /** Puts a page's strokes (as loaded) on screen, with unsent changes on top. */
  const showInkPage = useCallback(
    (bookId: string, page: number, strokes: Stroke[], version: number) => {
      if (bookId !== inkBook.current) return;
      const state = inkState.current;
      state.loaded.add(page);
      state.versions[page] = version;
      const shown = withPendingInk(bookId, page, strokes);
      state.saved = withPage(state.saved, page, shown); // already in the offline copy
      inkRef.current = withPage(inkRef.current, page, shown); // for callers awaiting the load (thumbnails)
      setInk((prev) => withPage(prev, page, shown));
      // A live change arrived while this page was loading: load it again.
      if ((state.latest[page] ?? 0) > version) void reloadInkPage(page);
    },
    [reloadInkPage, inkRef],
  );

  /** Loads the strokes of `pages` that aren't loaded yet, in one request; resolves when they are on screen. */
  const ensureInkPages = useCallback(
    (pages: number[]) => {
      if (book?.format !== "pdf" || inkBook.current !== book.id) return Promise.resolve();
      const bookId = book.id;
      const waiting: Promise<void>[] = [];
      const toFetch: number[] = [];
      for (const page of new Set(pages)) {
        if (page < 1 || inkState.current.loaded.has(page)) continue;
        const loading = inkState.current.loading.get(page);
        if (loading) waiting.push(loading);
        else if ((inkSummaryRef.current[page]?.count ?? 0) > 0) toFetch.push(page);
        else showInkPage(bookId, page, [], inkSummaryRef.current[page]?.version ?? 0); // nothing written there
      }
      if (toFetch.length) {
        const job = loadInkPages(bookId, toFetch).then((loaded) => {
          for (const page of toFetch) {
            inkState.current.loading.delete(page);
            showInkPage(bookId, page, loaded[page]!.strokes, loaded[page]!.version);
          }
        });
        for (const page of toFetch) inkState.current.loading.set(page, job);
        waiting.push(job);
      }
      return Promise.all(waiting).then(() => {});
    },
    [book, showInkPage, inkSummaryRef],
  );

  // PDF handwriting, kept in sync with other devices; changes work offline (lib/ink). The book
  // opens with a summary of its annotated pages; strokes load around the page being read. Live
  // changes carry the page's version: they apply in order, and a missed one makes the page load again.
  useEffect(() => {
    inkThumbs.current.clear(); // another book's pictures
    if (book?.format !== "pdf") return;
    let cancelled = false;
    inkBook.current = book.id;
    inkState.current = newInkState();
    setInk({});
    setInkSummary({});
    setInkLoadedFor(null);
    loadInkSummary(book.id)
      .then((summary) => {
        if (cancelled) return;
        for (const [page, s] of Object.entries(summary)) inkState.current.latest[Number(page)] = s.version;
        setInkSummary(summary);
        setInkLoadedFor(book.id);
      })
      .catch(() => {});
    const off = onServerEvent((event, data) => {
      if (event !== "ink.updated" || data?.bookId !== book.id) return;
      const page = data.page as number;
      const state = inkState.current;
      state.latest[page] = Math.max(state.latest[page] ?? 0, data.version);
      if (!state.loaded.has(page)) {
        // Not loaded here: the summary keeps the notebook right, and the strokes load when needed.
        setInkSummary((prev) => ({
          ...prev,
          [page]: { version: Math.max(prev[page]?.version ?? 0, data.version), count: Math.max(0, (prev[page]?.count ?? 0) + data.add.length - data.remove.length) },
        }));
        return;
      }
      const action = liveChangeAction(state.versions[page] ?? 0, data.version);
      if (action === "refetch") return void reloadInkPage(page);
      if (action === "ignore") return;
      state.versions[page] = data.version;
      // Unsent changes are read when the update runs, so a stroke just drawn is never lost.
      setInk((prev) => withPage(prev, page, withPendingInk(book.id, page, applyChange(prev[page] ?? [], data as InkChange))));
    });
    const onRejected = (e: Event) => {
      const { bookId, page, status } = (e as CustomEvent<{ bookId: string; page: number; status: number }>).detail;
      if (bookId !== book.id) return;
      window.alert(
        status === 413
          ? `Page ${page} has too much handwriting to save. The last strokes were not kept; erase some strokes to make room.`
          : `Some handwriting on page ${page} could not be saved.`,
      );
      void reloadInkPage(page);
    };
    window.addEventListener("readsync:ink-rejected", onRejected);
    return () => {
      cancelled = true;
      inkBook.current = null;
      off();
      window.removeEventListener("readsync:ink-rejected", onRejected);
    };
  }, [book, reloadInkPage]);

  // Strokes of the page being read and its neighbours (and pages with unsent changes) are loaded.
  const pdfPageNow = book?.format === "pdf" && position ? (pageOf(position.locator) ?? 0) : 0;
  useEffect(() => {
    if (!book || inkLoadedFor !== book.id || !pdfPageNow) return;
    void ensureInkPages([pdfPageNow - 1, pdfPageNow, pdfPageNow + 1, pdfPageNow + 2, ...pendingInkPages(book.id)]);
  }, [book, inkLoadedFor, pdfPageNow, inkSummary, ensureInkPages]);

  // Keep changed pages in the offline copy (only once the book's handwriting is loaded: until
  // then the reader's empty state would wipe it).
  useEffect(() => {
    if (!book || inkLoadedFor !== book.id) return;
    const state = inkState.current;
    for (const page of new Set([...Object.keys(state.saved), ...Object.keys(ink)].map(Number))) {
      if (state.saved[page] !== ink[page]) rememberInkPage(book.id, page, ink[page] ?? [], state.versions[page] ?? 0);
    }
    state.saved = ink;
  }, [book, ink, inkLoadedFor]);

  /** The notebook's annotated pages: loaded ones from their strokes, the others from the summary. */
  const inkPageList = useMemo(() => {
    const pages = new Map<number, InkPageSummary>();
    for (const [p, s] of Object.entries(inkSummary)) {
      if (s.count > 0 && !inkState.current.loaded.has(Number(p))) pages.set(Number(p), { page: Number(p), strokes: s.count, signature: `v${s.version}` });
    }
    for (const [p, strokes] of Object.entries(ink)) pages.set(Number(p), { page: Number(p), strokes: strokes.length, signature: inkSignature(strokes) });
    return [...pages.values()].sort((a, b) => a.page - b.page);
  }, [ink, inkSummary]);

  /** A notebook picture: loads the page (and the next annotated ones, in the same request), kept for reuse. */
  const inkThumbnail = useCallback(
    async (page: number) => {
      const after = inkPageList.filter((p) => p.page > page).slice(0, 7).map((p) => p.page);
      await ensureInkPages([page, ...after]);
      const strokes = inkRef.current[page] ?? [];
      const signature = inkSignature(strokes);
      const hit = inkThumbs.current.get(page);
      if (hit?.signature === signature) return hit.url;
      const url = (await reader.current?.thumbnail?.(page, 240, strokes)) ?? null;
      if (url) inkThumbs.current.set(page, { signature, url });
      return url;
    },
    [inkPageList, ensureInkPages, inkRef],
  );

  /** Applies a handwriting change here and queues it for the server (queued first, so it already counts as unsent). */
  const applyInk = useCallback(
    (page: number, change: InkChange) => {
      if (!book) return;
      recordInk(book.id, page, change);
      setInk((prev) => withPage(prev, page, applyChange(prev[page] ?? [], change)));
    },
    [book],
  );

  const onInkChange = useCallback(
    (page: number, change: InkChange) => {
      const h = inkHistory.current;
      h.undo.push({ page, change: inverseChange(inkRef.current[page] ?? [], change) });
      h.redo = [];
      setInkHistorySize({ undo: h.undo.length, redo: 0 });
      applyInk(page, change);
    },
    [applyInk, inkRef],
  );

  /** Undo (or redo): applies the stored change, keeping the one that reverts it on the other stack. */
  const stepInkHistory = useCallback(
    (from: "undo" | "redo") => {
      const h = inkHistory.current;
      const step = h[from].pop();
      if (!step) return;
      h[from === "undo" ? "redo" : "undo"].push({ page: step.page, change: inverseChange(inkRef.current[step.page] ?? [], step.change) });
      setInkHistorySize({ undo: h.undo.length, redo: h.redo.length });
      applyInk(step.page, step.change);
      // Show the page that changed.
      if (positionRef.current?.locator !== pageLocator(step.page)) reader.current?.goToHref?.(pageLocator(step.page));
    },
    [applyInk, inkRef],
  );

  // Ctrl/⌘ + Z undoes, Ctrl/⌘ + Y or Ctrl/⌘ + Shift + Z redoes, while annotating.
  useDocumentEvent(
    "keydown",
    (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        stepInkHistory(e.shiftKey ? "redo" : "undo");
      } else if (key === "y") {
        e.preventDefault();
        stepInkHistory("redo");
      }
    },
    inking,
  );

  const startInking = () => {
    setPanel(null);
    setChrome(false);
    setInking(true);
  };

  const { bookmarks, pageBookmark, toggleBookmark, renameBookmark, removeBookmark } = useBookmarks(book, position);
  const inkingRef = useLatest(inking);
  const toggleBookmarkRef = useLatest(toggleBookmark);

  const togglePanel = (p: Panel) => setPanel(panel === p ? null : p);
  const openNotebook = (tab: NotebookTab) => {
    if (panel === "notebook") return setPanel(null);
    setNotebookTab(tab);
    setPanel("notebook");
  };
  /** Shows a place picked in a panel, and closes the panel. */
  const goAndClose = (href: string) => {
    reader.current?.goToHref?.(href);
    setPanel(null);
  };

  const addHighlight = useCallback(
    async (color: HighlightColor, sel: TextSelection | null = selection, note?: string) => {
      if (!sel || !book) return;
      reader.current?.clearSelection?.();
      setSelection(null);
      try {
        const saved = await createHighlight(book.id, {
          cfi: sel.cfi,
          text: sel.text.slice(0, 10000),
          color,
          label: positionRef.current?.label ?? null,
          note: note || null,
        });
        setHighlights((prev) => sortHighlights([...prev.filter((h) => h.id !== saved.id), saved]));
      } catch {
        window.alert("Could not save the highlight, try again.");
      }
    },
    [selection, book],
  );

  const changeHighlight = useCallback(async (h: Highlight, patch: { color?: HighlightColor; note?: string | null }) => {
    setActiveHighlight(null);
    if (patch.color === h.color && patch.note === undefined) return;
    setHighlights((prev) => prev.map((x) => (x.id === h.id ? { ...x, ...patch } : x)));
    await updateHighlight(h.id, patch).catch(() => {
      setHighlights((prev) => prev.map((x) => (x.id === h.id ? h : x)));
    });
  }, []);

  const saveNote = (note: string) => {
    if (!noteFor) return;
    if ("highlight" in noteFor) void changeHighlight(noteFor.highlight, { note: note || null });
    else if (note) void addHighlight("yellow", noteFor.selection, note);
    else reader.current?.clearSelection?.();
    setNoteFor(null);
  };

  const exportHighlights = () => {
    if (!book) return;
    const name = `${book.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "highlights"} - highlights.md`;
    downloadText(name, highlightsToMarkdown(book, highlights));
  };

  const removeHighlight = useCallback(async (h: Highlight) => {
    setActiveHighlight(null);
    setHighlights((prev) => prev.filter((x) => x.id !== h.id));
    await deleteHighlight(h.id).catch(() => {
      setHighlights((prev) => sortHighlights([...prev, h]));
    });
  }, []);

  const copyText = (text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => {});
  };

  const onSelection = useCallback((sel: TextSelection | null) => {
    setSelection(sel);
    if (sel) setActiveHighlight(null);
  }, []);

  const onHighlightClick = useCallback((highlight: Highlight, rect: DOMRect) => {
    setSelection(null);
    setActiveHighlight({ highlight, rect });
  }, []);

  const onRelocate = useCallback(
    (raw: Position, byUser: boolean) => {
      const pos = { ...raw, percentage: Number.isFinite(raw.percentage) ? raw.percentage : 0 };
      positionRef.current = pos;
      setPosition(pos);
      // Menus point at text that just moved off screen.
      setActiveHighlight(null);
      if (byUser) {
        reader.current?.clearSelection?.();
        saveProgress(id, pos);
        setRemote(null);
      }
    },
    [id, setRemote],
  );

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case "ArrowRight":
      case "PageDown":
        e.preventDefault();
        reader.current?.next();
        break;
      case " ":
        e.preventDefault();
        if (e.shiftKey) reader.current?.prev();
        else reader.current?.next();
        break;
      case "ArrowLeft":
      case "PageUp":
        e.preventDefault();
        reader.current?.prev();
        break;
      case "Escape":
        setPanel(null);
        if (inkingRef.current) setInking(false);
        else setChrome((c) => !c);
        break;
      case "b":
      case "B":
        e.preventDefault();
        toggleBookmarkRef.current();
        break;
    }
  }, [inkingRef, toggleBookmarkRef]);
  useDocumentEvent("keydown", onKeyDown);

  const onTap = useCallback(
    (zone: TapZone) => {
      if (panel) return setPanel(null);
      if (lookup) return setLookup(null);
      if (activeHighlight) return setActiveHighlight(null);
      if (zone === "left") reader.current?.prev();
      else if (zone === "right") reader.current?.next();
      else if (!inking) setChrome((c) => !c); // while writing, the toolbar stays alone on top
    },
    [panel, activeHighlight, lookup, inking],
  );

  const onReady = useCallback((info: { toc?: TocItem[]; language?: string | null }) => {
    setToc(info.toc ?? null);
    setBookLanguage(info.language ?? null);
    if (jumpTo.current) {
      const at = jumpTo.current;
      jumpTo.current = null;
      setTimeout(() => reader.current?.goToHref?.(at), 50);
    }
  }, []);

  if (error) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p>{error}</p>
        <Link to="/" className="btn">
          Back to library
        </Link>
      </div>
    );
  }

  const theme = THEMES[settings.theme];
  const isPdf = book?.format === "pdf";
  const isComic = !!book && isComicFormat(book.format);
  // Highlights, notes and search work on text: ebooks and PDFs (not comic images).
  const canAnnotate = !isComic;
  // Comics read as pages (foliate) or as one vertical strip (webtoons).
  const ReaderComponent = isPdf ? PdfReader : isComic && settings.comicScroll ? ComicScroller : EpubReader;
  // The menu over selected text, or over a highlight that was tapped (never both at once).
  const menu = selection
    ? !discuss && { ...selection, highlight: null, noteFor: { selection }, done: () => reader.current?.clearSelection?.() }
    : activeHighlight && {
        ...activeHighlight.highlight,
        rect: activeHighlight.rect,
        highlight: activeHighlight.highlight,
        noteFor: { highlight: activeHighlight.highlight },
        done: () => setActiveHighlight(null),
      };

  return (
    <div className="relative h-dvh w-full overflow-hidden" style={{ background: theme.surround, color: theme.fg }}>
      <div className="h-full w-full" style={{ filter: settings.contrast !== 100 ? `contrast(${settings.contrast}%)` : undefined }}>
        {book && (
          <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center opacity-60">Loading…</div>}>
            <ReaderComponent
              ref={reader}
              book={book}
              // Switching reader (e.g. comic pages <-> vertical scroll) starts where you are now.
              initialLocator={position?.locator ?? startLocator}
              settings={settings}
              onRelocate={onRelocate}
              onTap={onTap}
              onKeyDown={onKeyDown}
              onReady={onReady}
              onError={setError}
              highlights={canAnnotate ? highlights : undefined}
              onSelection={onSelection}
              onHighlightClick={onHighlightClick}
              magnifier={isComic && magnifier}
              onZoom={setPdfZoom}
              ink={isPdf ? ink : undefined}
              inkMode={isPdf && inking ? inkTools.mode : null}
              onInkChange={onInkChange}
            />
          </Suspense>
        )}
      </div>

      {!book && <div className="absolute inset-0 flex items-center justify-center opacity-60">Loading…</div>}

      {/* Ribbon on a bookmarked page (with the bars showing, their bookmark button says it) */}
      {pageBookmark && !chrome && (
        <svg
          className="pointer-events-none absolute right-6 top-0 z-10 h-9 w-6 drop-shadow"
          style={{ marginTop: "env(safe-area-inset-top)" }}
          viewBox="0 0 24 36"
          role="img"
          aria-label="Bookmarked page"
        >
          <path d="M0 0h24v36l-12-8-12 8z" fill="#ef4444" />
        </svg>
      )}

      {/* Invisible strip at the top: tapping it brings the chrome back (not while writing: the pen needs the whole page) */}
      {!chrome && !inking && (
        <div
          className="absolute inset-x-0 top-0 z-10 h-[calc(env(safe-area-inset-top)+64px)]"
          aria-label="Show menu"
          onClick={() => setChrome(true)}
        />
      )}

      {/* Top bar */}
      <header
        className={`reader-bar top-0 pt-[env(safe-area-inset-top)] ${chrome ? "" : "-translate-y-full opacity-0"}`}
      >
        <div className="flex items-center gap-1 px-3 py-2 sm:gap-2">
          <button className="btn-icon" aria-label="Back to library" onClick={() => navigate("/")}>
            ←
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{book?.title}</div>
            {book?.author && <div className="truncate text-xs opacity-70">{book.author}</div>}
          </div>
          {canAnnotate && <BarButton icon={Search} aria-label="Search in book" title="Search" onClick={() => togglePanel("search")} />}
          <BarButton
            icon={BookmarkIcon}
            className={pageBookmark ? "text-red-400" : ""}
            iconClass={pageBookmark ? "fill-current" : ""}
            aria-label={pageBookmark ? "Remove bookmark from this page" : "Bookmark this page"}
            aria-pressed={!!pageBookmark}
            title={pageBookmark ? "Remove bookmark (B)" : "Bookmark this page (B)"}
            disabled={!position}
            onClick={toggleBookmark}
          />
          {isPdf && <BarButton icon={PenLine} aria-label="Write on the page" title="Write on the page (pen, highlighter)" onClick={startInking} />}
          <BarButton
            icon={NotebookText}
            aria-label="Notebook: highlights and bookmarks"
            title="Notebook: highlights and bookmarks"
            onClick={() => openNotebook(canAnnotate ? "highlights" : "bookmarks")}
          >
            {(canAnnotate ? highlights.length : 0) + bookmarks.length > 0 && (
              <span className="ml-0.5 text-xs tabular-nums opacity-70">{(canAnnotate ? highlights.length : 0) + bookmarks.length}</span>
            )}
          </BarButton>
          {isComic && (
            <BarButton
              icon={ZoomIn}
              className={magnifier ? "bg-white/20 text-teal-300" : ""}
              aria-label="Magnifier"
              aria-pressed={magnifier}
              title={magnifier ? "Magnifier on: move over the page (tap here to turn off)" : "Magnifier"}
              onClick={() => setMagnifier((m) => !m)}
            />
          )}
          {!isPdf && <BarButton icon={TableOfContents} aria-label={isComic ? "Pages" : "Contents"} title={isComic ? "Pages" : "Contents"} onClick={() => togglePanel("toc")} />}
          <button className="btn-icon" aria-label="Display settings" onClick={() => togglePanel("settings")}>
            Aa
          </button>
        </div>
      </header>

      {/* Bottom bar */}
      <footer
        className={`reader-bar bottom-0 pb-[env(safe-area-inset-bottom)] ${chrome ? "" : "translate-y-full opacity-0"}`}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <button className="btn-icon" aria-label="Previous page" onClick={() => reader.current?.prev()}>
            ‹
          </button>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round((position?.percentage ?? 0) * 1000)}
            onChange={(e) => reader.current?.goToFraction(Number(e.target.value) / 1000)}
            className="flex-1 accent-teal-600"
            aria-label="Position in book"
          />
          <button className="btn-icon" aria-label="Next page" onClick={() => reader.current?.next()}>
            ›
          </button>
        </div>
        <div className="flex items-center gap-2 px-4 pb-2 text-xs">
          {isPdf && <div className="w-[104px] shrink-0" />}
          <div className="min-w-0 flex-1 truncate text-center opacity-70">
            {position ? `${percent(position.percentage)}${position.label ? ` · ${position.label}` : ""}` : ""}
          </div>
          {isPdf && (
            <div className="flex w-[104px] shrink-0 items-center justify-end">
              <button className="btn-icon h-8 min-w-8 disabled:opacity-30" aria-label="Zoom out" title="Zoom out (Ctrl −)" disabled={pdfZoom <= 1} onClick={() => reader.current?.zoom?.("out")}>
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                className="rounded px-1 tabular-nums opacity-80 hover:opacity-100"
                aria-label="Fit page"
                title="Fit page (Ctrl 0)"
                onClick={() => reader.current?.zoom?.("reset")}
              >
                {Math.round(pdfZoom * 100)}%
              </button>
              <button className="btn-icon h-8 min-w-8 disabled:opacity-30" aria-label="Zoom in" title="Zoom in (Ctrl +)" disabled={pdfZoom >= 4} onClick={() => reader.current?.zoom?.("in")}>
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </footer>

      {/* Discreet progress when chrome is hidden */}
      {!chrome && position && (
        <div className="pointer-events-none absolute bottom-[max(4px,env(safe-area-inset-bottom))] right-3 text-[11px] opacity-50">
          {percent(position.percentage)}
        </div>
      )}

      {/* "Continue where you left off on another device" */}
      {remote && (
        <div className="absolute inset-x-0 top-[calc(env(safe-area-inset-top)+64px)] z-30 mx-auto w-[min(92%,28rem)] rounded-xl bg-neutral-900 p-4 text-white shadow-2xl">
          <p className="text-sm">
            You reached <b>{percent(remote.percentage)}</b>
            {remote.label ? ` (${remote.label})` : ""} on <b>{remote.deviceName ?? "another device"}</b>{" "}
            {timeAgo(remote.updatedAt)}.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button className="rounded-lg px-3 py-1.5 text-sm text-neutral-300 hover:bg-white/10" onClick={() => setRemote(null)}>
              Stay here
            </button>
            <button
              className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium hover:bg-teal-500"
              onClick={() => {
                reader.current?.restore(remote.locator);
                setRemote(null);
              }}
            >
              Jump there
            </button>
          </div>
        </div>
      )}

      {menu && !panel && !lookup && !noteFor && (
        <HighlightMenu
          key={menu.highlight ? "highlight" : "selection"}
          rect={menu.rect}
          current={menu.highlight?.color}
          onColor={(c) => void (menu.highlight ? changeHighlight(menu.highlight, { color: c }) : addHighlight(c))}
          onNote={() => {
            setNoteFor(menu.noteFor);
            if (menu.highlight) menu.done();
          }}
          onDictionary={hasDictionary && isWord(menu.text) ? () => setLookup({ mode: "dictionary", text: menu.text, rect: menu.rect }) : undefined}
          onTranslate={features?.translateEnabled ? () => setLookup({ mode: "translate", text: menu.text, rect: menu.rect }) : undefined}
          onDiscuss={
            clubs.length
              ? () => {
                  setDiscuss({ quote: menu.text, locator: menu.cfi });
                  menu.done();
                }
              : undefined
          }
          onCopy={() => {
            copyText(menu.text);
            menu.done();
          }}
          onDelete={menu.highlight ? () => void removeHighlight(menu.highlight!) : undefined}
        />
      )}
      {isPdf && inking && (
        <InkToolbar
          tools={inkTools.tools}
          update={inkTools.update}
          canUndo={inkHistorySize.undo > 0}
          canRedo={inkHistorySize.redo > 0}
          onUndo={() => stepInkHistory("undo")}
          onRedo={() => stepInkHistory("redo")}
          onDone={() => setInking(false)}
        />
      )}
      {discuss && clubs.length > 0 && <DiscussDialog clubs={clubs} quote={discuss.quote} locator={discuss.locator} onClose={() => setDiscuss(null)} />}
      {lookup && <LookupCard mode={lookup.mode} text={lookup.text} bookLanguage={bookLanguage} rect={lookup.rect} onClose={() => setLookup(null)} />}
      {noteFor && (
        <NoteDialog
          quote={"highlight" in noteFor ? noteFor.highlight.text : noteFor.selection.text}
          initial={"highlight" in noteFor ? (noteFor.highlight.note ?? "") : ""}
          onSave={saveNote}
          onClose={() => setNoteFor(null)}
        />
      )}
      {panel === "search" && (
        <SearchPanel
          reader={reader.current}
          onClose={() => setPanel(null)}
          onSelect={(r) => {
            reader.current?.goToHref?.(r.locator);
            // Small screens: get the panel out of the way to show the match.
            if (window.innerWidth < 768) setPanel(null);
          }}
        />
      )}

      {panel === "notebook" && (
        <NotebookPanel
          tab={notebookTab}
          highlights={canAnnotate ? highlights : undefined}
          bookmarks={bookmarks}
          onClose={() => setPanel(null)}
          onDeleteHighlight={(h) => void removeHighlight(h)}
          onEditNote={(h) => setNoteFor({ highlight: h })}
          onExport={exportHighlights}
          onSelectHighlight={(h) => goAndClose(h.cfi)}
          onSelectBookmark={(b) => goAndClose(b.locator)}
          onRenameBookmark={renameBookmark}
          onDeleteBookmark={removeBookmark}
          inkPages={isPdf ? inkPageList : undefined}
          thumbnail={inkThumbnail}
          onSelectInkPage={(page) => goAndClose(pageLocator(page))}
        />
      )}
      {panel === "settings" && <SettingsPanel kind={isPdf ? "pdf" : isComic ? "comic" : "text"} onClose={() => setPanel(null)} />}
      {panel === "toc" && toc && <TocPanel toc={toc} title={isComic ? "Pages" : "Contents"} onClose={() => setPanel(null)} onSelect={goAndClose} />}
    </div>
  );
}
