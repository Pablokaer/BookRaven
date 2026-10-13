import type { Highlight } from "../lib/api";
import { HIGHLIGHT_COLORS } from "../lib/highlights";

export function HighlightsPanel({
  highlights,
  onSelect,
  onDelete,
  onClose,
}: {
  highlights: Highlight[];
  onSelect: (h: Highlight) => void;
  onDelete: (h: Highlight) => void;
  onClose: () => void;
}) {
  return (
    <div className="panel left-0 w-full max-w-sm" role="dialog" aria-label="Highlights">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Highlights</h2>
        <button className="btn-icon" onClick={onClose} aria-label="Close highlights">
          ✕
        </button>
      </div>
      {highlights.length ? (
        <ul className="space-y-2">
          {highlights.map((h) => (
            <li key={h.id} className="group flex gap-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
              <button className="min-w-0 flex-1 space-y-1 px-3 py-2 text-left" onClick={() => onSelect(h)}>
                <span
                  className="line-clamp-4 border-l-4 pl-2 text-sm leading-snug"
                  style={{ borderColor: HIGHLIGHT_COLORS[h.color].fill }}
                >
                  {h.text}
                </span>
                {h.label && <span className="block truncate text-xs text-neutral-500">{h.label}</span>}
              </button>
              <button
                className="self-start px-2 py-2 text-sm text-neutral-400 opacity-0 hover:text-red-600 focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                aria-label="Remove highlight"
                onClick={() => onDelete(h)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-500">Select text in the book and pick a color to highlight it.</p>
      )}
    </div>
  );
}
