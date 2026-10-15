import { Bookmark as BookmarkIcon, Download, Pencil, StickyNote, X } from "lucide-react";
import { useState } from "react";
import type { Bookmark, Highlight } from "../lib/api";
import { percent } from "../lib/format";
import { HIGHLIGHT_COLORS } from "../lib/highlights";

export type NotebookTab = "highlights" | "bookmarks";

/** The reader's notebook: highlights (books with text) and bookmarked pages (every format). */
export function NotebookPanel({
  tab: initialTab,
  highlights,
  bookmarks,
  onSelectHighlight,
  onDeleteHighlight,
  onEditNote,
  onExport,
  onSelectBookmark,
  onRenameBookmark,
  onDeleteBookmark,
  onClose,
}: {
  tab: NotebookTab;
  /** Undefined for comics (no text to highlight). */
  highlights?: Highlight[];
  bookmarks: Bookmark[];
  onSelectHighlight: (h: Highlight) => void;
  onDeleteHighlight: (h: Highlight) => void;
  onEditNote: (h: Highlight) => void;
  onExport: () => void;
  onSelectBookmark: (b: Bookmark) => void;
  onRenameBookmark: (b: Bookmark, title: string | null) => void;
  onDeleteBookmark: (b: Bookmark) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<NotebookTab>(highlights ? initialTab : "bookmarks");
  const tabs: { id: NotebookTab; label: string; count: number }[] = [
    ...(highlights ? [{ id: "highlights" as const, label: "Highlights", count: highlights.length }] : []),
    { id: "bookmarks", label: "Bookmarks", count: bookmarks.length },
  ];

  return (
    <div className="panel left-0 w-full max-w-sm" role="dialog" aria-label="Notebook">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Notebook</h2>
        <div className="flex items-center gap-1">
          {tab === "highlights" && highlights && highlights.length > 0 && (
            <button className="btn-icon text-sm" onClick={onExport} aria-label="Export highlights as Markdown" title="Export as Markdown">
              <Download className="h-4 w-4" />
            </button>
          )}
          <button className="btn-icon" onClick={onClose} aria-label="Close notebook">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {tabs.length > 1 && (
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${tab === t.id ? "bg-white shadow-sm dark:bg-neutral-700" : "opacity-70 hover:opacity-100"}`}
            >
              {t.label}
              {t.count > 0 && <span className="ml-1.5 text-xs tabular-nums opacity-60">{t.count}</span>}
            </button>
          ))}
        </div>
      )}

      {tab === "highlights" && highlights ? (
        <HighlightList highlights={highlights} onSelect={onSelectHighlight} onDelete={onDeleteHighlight} onEditNote={onEditNote} />
      ) : (
        <BookmarkList bookmarks={bookmarks} onSelect={onSelectBookmark} onRename={onRenameBookmark} onDelete={onDeleteBookmark} />
      )}
    </div>
  );
}

function HighlightList({
  highlights,
  onSelect,
  onDelete,
  onEditNote,
}: {
  highlights: Highlight[];
  onSelect: (h: Highlight) => void;
  onDelete: (h: Highlight) => void;
  onEditNote: (h: Highlight) => void;
}) {
  const notes = highlights.filter((h) => h.note).length;
  if (!highlights.length) return <p className="text-sm text-neutral-500">Select text in the book and pick a color to highlight it, or add a note.</p>;
  return (
    <>
      <p className="text-xs opacity-60">
        {highlights.length} highlight{highlights.length === 1 ? "" : "s"}
        {notes ? ` · ${notes} with notes` : ""}
      </p>
      <ul className="space-y-2">
        {highlights.map((h) => (
          <li key={h.id} className="group flex gap-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <button className="min-w-0 flex-1 space-y-1.5 px-3 py-2 text-left" onClick={() => onSelect(h)}>
              <span className="line-clamp-4 border-l-4 pl-2 text-sm leading-snug" style={{ borderColor: HIGHLIGHT_COLORS[h.color].fill }}>
                {h.text}
              </span>
              {h.note && (
                <span className="flex gap-1.5 rounded-md bg-amber-100/60 px-2 py-1.5 text-xs leading-relaxed text-neutral-800 dark:bg-amber-400/10 dark:text-amber-100">
                  <StickyNote className="mt-0.5 h-3 w-3 shrink-0 opacity-70" />
                  <span className="whitespace-pre-wrap">{h.note}</span>
                </span>
              )}
              {h.label && <span className="block truncate text-xs text-neutral-500">{h.label}</span>}
            </button>
            <div className="flex flex-col py-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
              <button className="px-2 py-1.5 text-neutral-400 hover:text-teal-600" aria-label={h.note ? "Edit note" : "Add note"} title={h.note ? "Edit note" : "Add note"} onClick={() => onEditNote(h)}>
                <StickyNote className="h-3.5 w-3.5" />
              </button>
              <button className="px-2 py-1.5 text-neutral-400 hover:text-red-600" aria-label="Remove highlight" title="Remove" onClick={() => onDelete(h)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function BookmarkList({
  bookmarks,
  onSelect,
  onRename,
  onDelete,
}: {
  bookmarks: Bookmark[];
  onSelect: (b: Bookmark) => void;
  onRename: (b: Bookmark, title: string | null) => void;
  onDelete: (b: Bookmark) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  if (!bookmarks.length) {
    return (
      <p className="text-sm text-neutral-500">
        Tap <BookmarkIcon className="inline h-3.5 w-3.5 align-[-2px]" /> in the top bar (or press B) to bookmark the page you are on.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {bookmarks.map((b) => (
        <li key={b.locator} className="group flex items-start gap-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
          {editing === b.locator ? (
            <form
              className="min-w-0 flex-1 px-3 py-2"
              onSubmit={(e) => {
                e.preventDefault();
                const title = (new FormData(e.currentTarget).get("title") as string).trim();
                onRename(b, title || null);
                setEditing(null);
              }}
            >
              <input
                name="title"
                autoFocus
                defaultValue={b.title ?? ""}
                maxLength={200}
                placeholder={b.label ?? "Name this bookmark"}
                aria-label="Bookmark name"
                className="w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-600"
                onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                onBlur={(e) => e.currentTarget.form?.requestSubmit()}
              />
            </form>
          ) : (
            <button className="flex min-w-0 flex-1 gap-2.5 px-3 py-2 text-left" onClick={() => onSelect(b)}>
              <BookmarkIcon className="mt-0.5 h-4 w-4 shrink-0 fill-red-500 text-red-500" />
              <span className="min-w-0 space-y-0.5">
                <span className="block truncate text-sm font-medium">{b.title || b.label || "Bookmark"}</span>
                <span className="block truncate text-xs text-neutral-500">
                  {percent(b.percentage)}
                  {b.title && b.label ? ` · ${b.label}` : ""}
                </span>
              </span>
            </button>
          )}
          {editing !== b.locator && (
            <div className="flex flex-col py-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
              <button className="px-2 py-1.5 text-neutral-400 hover:text-teal-600" aria-label="Rename bookmark" title="Rename" onClick={() => setEditing(b.locator)}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button className="px-2 py-1.5 text-neutral-400 hover:text-red-600" aria-label="Remove bookmark" title="Remove" onClick={() => onDelete(b)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
