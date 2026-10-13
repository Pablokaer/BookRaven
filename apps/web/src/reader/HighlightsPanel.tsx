import { Download, StickyNote, X } from "lucide-react";
import type { Highlight } from "../lib/api";
import { HIGHLIGHT_COLORS } from "../lib/highlights";

export function HighlightsPanel({
  highlights,
  onSelect,
  onDelete,
  onEditNote,
  onExport,
  onClose,
}: {
  highlights: Highlight[];
  onSelect: (h: Highlight) => void;
  onDelete: (h: Highlight) => void;
  onEditNote: (h: Highlight) => void;
  onExport: () => void;
  onClose: () => void;
}) {
  const notes = highlights.filter((h) => h.note).length;
  return (
    <div className="panel left-0 w-full max-w-sm" role="dialog" aria-label="Highlights">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Highlights</h2>
        <div className="flex items-center gap-1">
          {highlights.length > 0 && (
            <button className="btn-icon text-sm" onClick={onExport} aria-label="Export highlights as Markdown" title="Export as Markdown">
              <Download className="h-4 w-4" />
            </button>
          )}
          <button className="btn-icon" onClick={onClose} aria-label="Close highlights">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {highlights.length > 0 && (
        <p className="text-xs opacity-60">
          {highlights.length} highlight{highlights.length === 1 ? "" : "s"}
          {notes ? ` · ${notes} with notes` : ""}
        </p>
      )}
      {highlights.length ? (
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
      ) : (
        <p className="text-sm text-neutral-500">Select text in the book and pick a color to highlight it, or add a note.</p>
      )}
    </div>
  );
}
