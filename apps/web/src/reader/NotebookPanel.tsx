import { Bookmark as BookmarkIcon, Download, Pencil, PenLine, StickyNote, X, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { Bookmark, Highlight } from "../lib/api";
import { percent } from "../lib/format";
import { HIGHLIGHT_COLORS } from "../lib/highlights";
import type { AnnotatedInkPage } from "../lib/inkSession";
import { PanelShell } from "./PanelShell";

export type NotebookTab = "highlights" | "bookmarks" | "ink";

/** The reader's notebook: highlights (books with text), bookmarked pages (every format) and handwritten PDF pages. */
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
  inkPages,
  thumbnail,
  onSelectInkPage,
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
  /** PDFs: the pages with handwriting and their number of strokes. */
  inkPages?: AnnotatedInkPage[];
  thumbnail: (page: number) => Promise<string | null>;
  onSelectInkPage: (page: number) => void;
  onClose: () => void;
}) {
  const tabs: { id: NotebookTab; label: string; count: number }[] = [
    ...(highlights ? [{ id: "highlights" as const, label: "Highlights", count: highlights.length }] : []),
    { id: "bookmarks", label: "Bookmarks", count: bookmarks.length },
    ...(inkPages ? [{ id: "ink" as const, label: "Handwriting", count: inkPages.length }] : []),
  ];
  const [tab, setTab] = useState<NotebookTab>(tabs.some((t) => t.id === initialTab) ? initialTab : "bookmarks");

  return (
    <PanelShell
      side="left"
      label="Notebook"
      title="Notebook"
      closeLabel="Close notebook"
      onClose={onClose}
      actions={
        tab === "highlights" &&
        !!highlights?.length && (
          <button className="btn-icon text-sm" onClick={onExport} aria-label="Export highlights as Markdown" title="Export as Markdown">
            <Download className="h-4 w-4" />
          </button>
        )
      }
    >
      {tabs.length > 1 && (
        <div className={`grid gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800 ${tabs.length === 3 ? "grid-cols-3" : "grid-cols-2"}`} role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-2 py-1.5 text-sm font-medium transition ${tab === t.id ? "bg-white shadow-sm dark:bg-neutral-700" : "opacity-70 hover:opacity-100"}`}
            >
              {t.label}
              {t.count > 0 && <span className="ml-1.5 text-xs tabular-nums opacity-60">{t.count}</span>}
            </button>
          ))}
        </div>
      )}

      {tab === "highlights" && highlights ? (
        <HighlightList highlights={highlights} onSelect={onSelectHighlight} onDelete={onDeleteHighlight} onEditNote={onEditNote} />
      ) : tab === "ink" && inkPages ? (
        <InkPageList pages={inkPages} thumbnail={thumbnail} onSelect={onSelectInkPage} />
      ) : (
        <BookmarkList bookmarks={bookmarks} onSelect={onSelectBookmark} onRename={onRenameBookmark} onDelete={onDeleteBookmark} />
      )}
    </PanelShell>
  );
}

/** A row's edit and remove buttons: on hover, always on touch screens. */
function RowActions(p: { edit: string; editTitle?: string; icon: LucideIcon; onEdit: () => void; remove: string; onRemove: () => void }) {
  return (
    <div className="flex flex-col py-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
      <button className="px-2 py-1.5 text-neutral-400 hover:text-teal-600" aria-label={p.edit} title={p.editTitle ?? p.edit} onClick={p.onEdit}>
        <p.icon className="h-3.5 w-3.5" />
      </button>
      <button className="px-2 py-1.5 text-neutral-400 hover:text-red-600" aria-label={p.remove} title="Remove" onClick={p.onRemove}>
        <X className="h-3.5 w-3.5" />
      </button>
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
            <RowActions edit={h.note ? "Edit note" : "Add note"} icon={StickyNote} onEdit={() => onEditNote(h)} remove="Remove highlight" onRemove={() => onDelete(h)} />
          </li>
        ))}
      </ul>
    </>
  );
}

/** Pages with handwriting, as small pictures (drawn one after another, so the list opens at once). */
function InkPageList({
  pages,
  thumbnail,
  onSelect,
}: {
  pages: AnnotatedInkPage[];
  thumbnail: (page: number) => Promise<string | null>;
  onSelect: (page: number) => void;
}) {
  const [pictures, setPictures] = useState<Record<number, string>>({});
  const key = pages.map((p) => `${p.page}:${p.signature}`).join(",");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const { page } of pages) {
        const url = await thumbnail(page).catch(() => null);
        if (cancelled) return;
        if (url) setPictures((prev) => ({ ...prev, [page]: url }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // `key` changes when a page's strokes do (any stroke added or erased): then the pictures are drawn again.
  }, [key]);

  if (!pages.length) {
    return (
      <p className="text-sm text-neutral-500">
        Tap <PenLine className="inline h-3.5 w-3.5 align-[-2px]" /> in the top bar to write on the pages with a pen, a mouse or a finger.
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-3">
      {pages.map(({ page, strokes }) => (
        <li key={page}>
          <button className="block w-full space-y-1 rounded-lg p-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={() => onSelect(page)}>
            <span className="block aspect-[3/4] overflow-hidden rounded border border-neutral-200 bg-white dark:border-neutral-700">
              {pictures[page] ? <img src={pictures[page]} alt={`Page ${page} with handwriting`} className="h-full w-full object-contain" /> : null}
            </span>
            <span className="block text-sm font-medium">Page {page}</span>
            <span className="block text-xs text-neutral-500">
              {strokes} stroke{strokes === 1 ? "" : "s"}
            </span>
          </button>
        </li>
      ))}
    </ul>
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
            <RowActions edit="Rename bookmark" editTitle="Rename" icon={Pencil} onEdit={() => setEditing(b.locator)} remove="Remove bookmark" onRemove={() => onDelete(b)} />
          )}
        </li>
      ))}
    </ul>
  );
}
