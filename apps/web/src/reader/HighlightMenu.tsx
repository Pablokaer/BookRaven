import { BookA, Copy, Languages, MessageSquareQuote, StickyNote, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { HighlightColor } from "../lib/api";
import { HIGHLIGHT_COLORS } from "../lib/highlights";

/**
 * Floating bar above selected text (highlight it, add a note, look it up) or above an
 * existing highlight (change its color or note, copy, look up, remove).
 */
export function HighlightMenu({
  rect,
  current,
  onColor,
  onCopy,
  onDelete,
  onNote,
  onDictionary,
  onTranslate,
  onDiscuss,
}: {
  rect: DOMRect;
  /** Color of the highlight being edited; undefined for a new selection. */
  current?: HighlightColor;
  onColor: (color: HighlightColor) => void;
  onCopy: () => void;
  onDelete?: () => void;
  onNote?: () => void;
  /** Shown for a single word only: its language, translation and definitions. */
  onDictionary?: () => void;
  onTranslate?: () => void;
  /** Shown when the book is read in a book club. */
  onDiscuss?: () => void;
}) {
  const actions: { label: string; icon: ReactNode; onClick: () => void; danger?: boolean }[] = [
    ...(onNote ? [{ label: "Note", icon: <StickyNote />, onClick: onNote }] : []),
    ...(onDictionary ? [{ label: "Dictionary", icon: <BookA />, onClick: onDictionary }] : []),
    ...(onTranslate ? [{ label: "Translate", icon: <Languages />, onClick: onTranslate }] : []),
    ...(onDiscuss ? [{ label: "Discuss in club", icon: <MessageSquareQuote />, onClick: onDiscuss }] : []),
    { label: "Copy", icon: <Copy />, onClick: onCopy },
    ...(onDelete ? [{ label: "Remove highlight", icon: <Trash2 />, onClick: onDelete, danger: true }] : []),
  ];
  // Approximate width, only used to keep the bar on screen.
  const width = 4 * 34 + actions.length * 34 + 24;
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
  // Above the text when there is room, otherwise below it.
  const top = rect.top > 64 ? rect.top - 52 : rect.bottom + 8;

  return (
    <div
      className="fixed z-40 flex w-max animate-pop items-center gap-0.5 rounded-full bg-neutral-900 px-2 py-1.5 text-white shadow-2xl ring-1 ring-white/10"
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
      {actions.map((a) => (
        <button
          key={a.label}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10 [&>svg]:h-4 [&>svg]:w-4 ${a.danger ? "text-red-300" : ""}`}
          aria-label={a.label}
          title={a.label}
          onClick={a.onClick}
        >
          {a.icon}
        </button>
      ))}
    </div>
  );
}
