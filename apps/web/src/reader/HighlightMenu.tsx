import type { HighlightColor } from "../lib/api";
import { HIGHLIGHT_COLORS } from "../lib/highlights";

/**
 * Floating bar above selected text (pick a color to highlight it) or above an
 * existing highlight (change its color, copy or remove it).
 */
export function HighlightMenu({
  rect,
  current,
  onColor,
  onCopy,
  onDelete,
}: {
  rect: DOMRect;
  /** Color of the highlight being edited; undefined for a new selection. */
  current?: HighlightColor;
  onColor: (color: HighlightColor) => void;
  onCopy: () => void;
  onDelete?: () => void;
}) {
  // Approximate width, only used to keep the bar on screen.
  const width = onDelete ? 290 : 220;
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
  // Above the text when there is room, otherwise below it.
  const top = rect.top > 64 ? rect.top - 52 : rect.bottom + 8;

  return (
    <div
      className="fixed z-40 flex w-max items-center gap-1 rounded-full bg-neutral-900 px-2 py-1.5 text-white shadow-2xl"
      style={{ left, top }}
      role="toolbar"
      aria-label="Highlight"
      onPointerDown={(e) => e.preventDefault()} // keep the text selection while clicking
    >
      {(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map((c) => (
        <button
          key={c}
          aria-label={`Highlight ${HIGHLIGHT_COLORS[c].label.toLowerCase()}`}
          title={HIGHLIGHT_COLORS[c].label}
          onClick={() => onColor(c)}
          className={`h-8 w-8 shrink-0 rounded-full border-2 ${current === c ? "border-white" : "border-transparent"}`}
        >
          <span className="mx-auto block h-5 w-5 rounded-full" style={{ background: HIGHLIGHT_COLORS[c].fill }} />
        </button>
      ))}
      <span className="mx-1 h-5 w-px bg-white/20" />
      <button className="rounded-full px-2 py-1 text-sm hover:bg-white/10" onClick={onCopy}>
        Copy
      </button>
      {onDelete && (
        <button className="rounded-full px-2 py-1 text-sm text-red-300 hover:bg-white/10" onClick={onDelete}>
          Remove
        </button>
      )}
    </div>
  );
}
