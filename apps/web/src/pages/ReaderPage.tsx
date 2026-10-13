import { compare as compareCfi } from "foliate-js/epubcfi.js";
import type { TocItem } from "foliate-js/view.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Search, ZoomIn } from "lucide-react";
import { apiJson, type Book, type Highlight, type HighlightColor, type Progress, type ServerConfig } from "../lib/api";
import { getBook } from "../lib/books";
import { listClubs, type ClubSummary } from "../lib/clubs";
import { isComicFormat } from "../lib/comics";
import { deviceId } from "../lib/device";
import { onServerEvent } from "../lib/events";
import { percent, timeAgo } from "../lib/format";
import { createHighlight, deleteHighlight, downloadText, highlightsToMarkdown, listHighlights, updateHighlight } from "../lib/highlights";
import { fetchProgress, flushProgress, getLocalPending, lastLocalUpdate, saveProgress, type Position } from "../lib/progress";
import { THEMES, useSettings } from "../lib/settings";
import { ComicScroller } from "../reader/ComicScroller";
import { DiscussDialog } from "../reader/DiscussDialog";
import { EpubReader } from "../reader/EpubReader";
import { HighlightMenu } from "../reader/HighlightMenu";
import { HighlightsPanel } from "../reader/HighlightsPanel";
import { LookupCard } from "../reader/LookupCard";
import { NoteDialog } from "../reader/NoteDialog";
import { PdfReader } from "../reader/PdfReader";
import { SearchPanel } from "../reader/SearchPanel";
import { SettingsPanel } from "../reader/SettingsPanel";
import { TocPanel } from "../reader/TocPanel";
import type { ReaderHandle, TapZone, TextSelection } from "../reader/types";

type Remote = Pick<Progress, "locator" | "percentage" | "label" | "deviceName" | "updatedAt">;

/** PDF highlight positions: "pdf:<page>:<start>-<end>". */
const pdfPos = (cfi: string) => {
  const m = /^pdf:(\d+):(\d+)-/.exec(cfi);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

/** Book order (by position in the text), falling back to creation order. */
function sortHighlights(list: Highlight[]) {
  return [...list].sort((a, b) => {
    const pa = pdfPos(a.cfi);
    const pb = pdfPos(b.cfi);
    if (pa && pb) return pa[0]! - pb[0]! || pa[1]! - pb[1]!;
    try {
      return compareCfi(a.cfi, b.cfi);
    } catch {
      return a.createdAt.localeCompare(b.createdAt);
    }
  });
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
  const [panel, setPanel] = useState<"settings" | "toc" | "highlights" | "search" | null>(null);
  const [lookup, setLookup] = useState<{ mode: "define" | "translate"; text: string; rect: DOMRect } | null>(null);
  const [noteFor, setNoteFor] = useState<{ highlight: Highlight } | { selection: TextSelection } | null>(null);
  const [bookLanguage, setBookLanguage] = useState<string | null>(null);
  const [magnifier, setMagnifier] = useState(false);
  /** Book clubs reading this book (for "Discuss in club"). */
  const [clubs, setClubs] = useState<ClubSummary[]>([]);
  const [discuss, setDiscuss] = useState<{ quote: string; locator: string } | null>(null);
  // "?at=<locator>" (from a club message) opens the book at that passage.
  const [params] = useSearchParams();
  const jumpTo = useRef(params.get("at"));
  const [features, setFeatures] = useState<Pick<ServerConfig, "dictionaryEnabled" | "translateEnabled"> | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [activeHighlight, setActiveHighlight] = useState<{ highlight: Highlight; rect: DOMRect } | null>(null);
  const [remote, setRemote] = useState<Remote | null>(null);
  const [startLocator, setStartLocator] = useState<string | null>(null);
  const reader = useRef<ReaderHandle>(null);
  const positionRef = useRef<Position | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBook(id)
      .then((b) => {
        if (cancelled) return;
        setStartLocator(initialLocator(b));
        setBook(b);
      })
      .catch(() => !cancelled && setError("Book not found"));
    return () => {
      cancelled = true;
      flushProgress();
    };
  }, [id]);

  useEffect(() => {
    listClubs(id)
      .then(setClubs)
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    apiJson<ServerConfig>("/api/config")
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

  const offerRemote = useCallback(
    (p: Remote & { deviceId?: string | null }) => {
      if (p.deviceId === deviceId) return;
      if (new Date(p.updatedAt).getTime() <= lastLocalUpdate(id)) return;
      if (positionRef.current?.locator === p.locator) return;
      setRemote(p);
    },
    [id],
  );

  // Another device moved forward: offer to jump there (live, via SSE).
  useEffect(
    () =>
      onServerEvent((event, data) => {
        if (event === "progress.updated" && data.bookId === id) offerRemote(data);
      }),
    [id, offerRemote],
  );

  // Coming back to the app (phone unlocked, tab focused): check the server too.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      fetchProgress(id)
        .then((p) => p && offerRemote(p))
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [id, offerRemote]);

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
    [id],
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
        setChrome((c) => !c);
        break;
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKeyDown(e);
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onKeyDown]);

  const onTap = useCallback(
    (zone: TapZone) => {
      if (panel) return setPanel(null);
      if (lookup) return setLookup(null);
      if (activeHighlight) return setActiveHighlight(null);
      if (zone === "left") reader.current?.prev();
      else if (zone === "right") reader.current?.next();
      else setChrome((c) => !c);
    },
    [panel, activeHighlight, lookup],
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

  return (
    <div className="relative h-dvh w-full overflow-hidden" style={{ background: theme.surround, color: theme.fg }}>
      <div className="h-full w-full" style={{ filter: settings.contrast !== 100 ? `contrast(${settings.contrast}%)` : undefined }}>
        {book && (
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
          />
        )}
      </div>

      {!book && <div className="absolute inset-0 flex items-center justify-center opacity-60">Loading…</div>}

      {/* Invisible strip at the top: tapping it brings the chrome back */}
      {!chrome && (
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
        <div className="flex items-center gap-2 px-3 py-2">
          <button className="btn-icon" aria-label="Back to library" onClick={() => navigate("/")}>
            ←
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{book?.title}</div>
            {book?.author && <div className="truncate text-xs opacity-70">{book.author}</div>}
          </div>
          {canAnnotate && (
            <button className="btn-icon" aria-label="Search in book" title="Search" onClick={() => setPanel(panel === "search" ? null : "search")}>
              <Search className="h-[18px] w-[18px]" />
            </button>
          )}
          {canAnnotate && (
            <button
              className="btn-icon text-base"
              aria-label="Highlights"
              title="Highlights"
              onClick={() => setPanel(panel === "highlights" ? null : "highlights")}
            >
              🖍{highlights.length > 0 && <span className="ml-0.5 text-xs tabular-nums opacity-70">{highlights.length}</span>}
            </button>
          )}
          {isComic && (
            <button
              className={`btn-icon ${magnifier ? "bg-white/20 text-teal-300" : ""}`}
              aria-label="Magnifier"
              aria-pressed={magnifier}
              title={magnifier ? "Magnifier on: move over the page (tap here to turn off)" : "Magnifier"}
              onClick={() => setMagnifier((m) => !m)}
            >
              <ZoomIn className="h-[18px] w-[18px]" />
            </button>
          )}
          {!isPdf && (
            <button
              className="btn-icon"
              aria-label={isComic ? "Pages" : "Contents"}
              title={isComic ? "Pages" : "Contents"}
              onClick={() => setPanel(panel === "toc" ? null : "toc")}
            >
              ☰
            </button>
          )}
          <button className="btn-icon" aria-label="Display settings" onClick={() => setPanel(panel === "settings" ? null : "settings")}>
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
        <div className="truncate px-4 pb-2 text-center text-xs opacity-70">
          {position ? `${percent(position.percentage)}${position.label ? ` · ${position.label}` : ""}` : ""}
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

      {selection && !panel && !lookup && !noteFor && !discuss && (
        <HighlightMenu
          rect={selection.rect}
          onColor={(c) => void addHighlight(c)}
          onNote={() => setNoteFor({ selection })}
          onDefine={features?.dictionaryEnabled && isWord(selection.text) ? () => setLookup({ mode: "define", text: selection.text, rect: selection.rect }) : undefined}
          onTranslate={features?.translateEnabled ? () => setLookup({ mode: "translate", text: selection.text, rect: selection.rect }) : undefined}
          onDiscuss={
            clubs.length
              ? () => {
                  setDiscuss({ quote: selection.text, locator: selection.cfi });
                  reader.current?.clearSelection?.();
                }
              : undefined
          }
          onCopy={() => {
            copyText(selection.text);
            reader.current?.clearSelection?.();
          }}
        />
      )}
      {activeHighlight && !panel && !lookup && !noteFor && (
        <HighlightMenu
          rect={activeHighlight.rect}
          current={activeHighlight.highlight.color}
          onColor={(c) => void changeHighlight(activeHighlight.highlight, { color: c })}
          onNote={() => {
            setNoteFor({ highlight: activeHighlight.highlight });
            setActiveHighlight(null);
          }}
          onDefine={
            features?.dictionaryEnabled && isWord(activeHighlight.highlight.text)
              ? () => setLookup({ mode: "define", text: activeHighlight.highlight.text, rect: activeHighlight.rect })
              : undefined
          }
          onTranslate={features?.translateEnabled ? () => setLookup({ mode: "translate", text: activeHighlight.highlight.text, rect: activeHighlight.rect }) : undefined}
          onDiscuss={
            clubs.length
              ? () => {
                  setDiscuss({ quote: activeHighlight.highlight.text, locator: activeHighlight.highlight.cfi });
                  setActiveHighlight(null);
                }
              : undefined
          }
          onCopy={() => {
            copyText(activeHighlight.highlight.text);
            setActiveHighlight(null);
          }}
          onDelete={() => void removeHighlight(activeHighlight.highlight)}
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

      {panel === "highlights" && (
        <HighlightsPanel
          highlights={highlights}
          onClose={() => setPanel(null)}
          onDelete={(h) => void removeHighlight(h)}
          onEditNote={(h) => setNoteFor({ highlight: h })}
          onExport={exportHighlights}
          onSelect={(h) => {
            reader.current?.goToHref?.(h.cfi);
            setPanel(null);
          }}
        />
      )}
      {panel === "settings" && <SettingsPanel kind={isPdf ? "pdf" : isComic ? "comic" : "text"} onClose={() => setPanel(null)} />}
      {panel === "toc" && toc && (
        <TocPanel
          toc={toc}
          title={isComic ? "Pages" : "Contents"}
          onClose={() => setPanel(null)}
          onSelect={(href) => {
            reader.current?.goToHref?.(href);
            setPanel(null);
          }}
        />
      )}
    </div>
  );
}
