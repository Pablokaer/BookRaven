import { Check, Eraser, Hand, Highlighter, PenLine, Redo2, Undo2 } from "lucide-react";
import { useCallback, useState } from "react";
import { HIGHLIGHTER_COLORS, HIGHLIGHTER_WIDTHS, PEN_COLORS, PEN_WIDTHS } from "../lib/ink";
import type { InkMode } from "./types";

type Tools = {
  tool: InkMode["tool"];
  pen: { color: string; size: number };
  highlighter: { color: string; size: number };
  fingerDraws: boolean;
};

const KEY = "readsync.inkTools";
const DEFAULT_TOOLS: Tools = {
  tool: "pen",
  pen: { color: PEN_COLORS[1]!, size: 1 },
  highlighter: { color: HIGHLIGHTER_COLORS[0]!, size: 1 },
  fingerDraws: false,
};

function loadTools(): Tools {
  try {
    return { ...DEFAULT_TOOLS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULT_TOOLS;
  }
}

/** The pen, highlighter and eraser settings, remembered on this device. */
export function useInkTools() {
  const [tools, setTools] = useState<Tools>(loadTools);
  const update = useCallback((patch: Partial<Tools>) => {
    setTools((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const ink = tools.tool === "highlighter" ? tools.highlighter : tools.pen;
  const widths = tools.tool === "highlighter" ? HIGHLIGHTER_WIDTHS : PEN_WIDTHS;
  const mode: InkMode = { tool: tools.tool, color: ink.color, width: widths[ink.size] ?? widths[1]!, fingerDraws: tools.fingerDraws };
  return { tools, update, mode };
}

/** Floating toolbar while annotating a PDF with the pen. */
export function InkToolbar({
  tools,
  update,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onDone,
}: {
  tools: Tools;
  update: (patch: Partial<Tools>) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDone: () => void;
}) {
  const drawing = tools.tool === "eraser" ? null : tools.tool;
  const colors = drawing === "highlighter" ? HIGHLIGHTER_COLORS : PEN_COLORS;
  const current = drawing ? tools[drawing] : null;
  const setInk = (patch: Partial<Tools["pen"]>) => drawing && update({ [drawing]: { ...tools[drawing], ...patch } });
  const toolButton = (id: Tools["tool"], label: string, Icon: typeof PenLine) => (
    <button
      className={`btn-icon h-9 min-w-9 px-1.5 ${tools.tool === id ? "bg-white/20 text-teal-300" : ""}`}
      aria-label={label}
      aria-pressed={tools.tool === id}
      title={label}
      onClick={() => update({ tool: id })}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
  const sep = <span className="mx-0.5 h-6 w-px bg-white/20" aria-hidden />;

  return (
    <div
      // Phones: at the bottom, out of the way of the page's top; wider screens: at the top.
      className="absolute bottom-[calc(env(safe-area-inset-bottom)+8px)] left-1/2 z-30 flex w-max max-w-[calc(100vw-16px)] -translate-x-1/2 flex-wrap items-center justify-center gap-0.5 rounded-2xl bg-neutral-900/95 px-1.5 py-1 text-white shadow-2xl backdrop-blur sm:bottom-auto sm:top-[calc(env(safe-area-inset-top)+8px)]"
      role="toolbar"
      aria-label="Annotation tools"
    >
      {toolButton("pen", "Pen", PenLine)}
      {toolButton("highlighter", "Highlighter", Highlighter)}
      {toolButton("eraser", "Eraser (erases whole strokes)", Eraser)}
      {current && (
        <>
          {sep}
          {colors.map((c) => (
            <button
              key={c}
              className="flex h-9 w-6 items-center justify-center"
              aria-label={`Color ${c}`}
              aria-pressed={current.color === c}
              onClick={() => setInk({ color: c })}
            >
              <span className={`h-5 w-5 rounded-full border-2 ${current.color === c ? "border-white" : "border-transparent"}`} style={{ background: c }} />
            </button>
          ))}
          {sep}
          {[0, 1, 2].map((size) => (
            <button
              key={size}
              className="flex h-9 w-6 items-center justify-center"
              aria-label={["Fine", "Medium", "Bold"][size]}
              aria-pressed={current.size === size}
              title={["Fine", "Medium", "Bold"][size]}
              onClick={() => setInk({ size })}
            >
              <span className={`rounded-full ${current.size === size ? "bg-teal-300" : "bg-white/70"}`} style={{ width: 4 + size * 4, height: 4 + size * 4 }} />
            </button>
          ))}
        </>
      )}
      {sep}
      <button className="btn-icon h-9 min-w-9 px-1.5 disabled:opacity-30" aria-label="Undo" title="Undo (Ctrl Z)" disabled={!canUndo} onClick={onUndo}>
        <Undo2 className="h-[18px] w-[18px]" />
      </button>
      <button className="btn-icon h-9 min-w-9 px-1.5 disabled:opacity-30" aria-label="Redo" title="Redo (Ctrl Y)" disabled={!canRedo} onClick={onRedo}>
        <Redo2 className="h-[18px] w-[18px]" />
      </button>
      <button
        className={`btn-icon h-9 min-w-9 px-1.5 ${tools.fingerDraws ? "bg-white/20 text-teal-300" : ""}`}
        aria-label="Draw with a finger"
        aria-pressed={tools.fingerDraws}
        title={tools.fingerDraws ? "Fingers draw (tap to scroll with fingers again)" : "Fingers scroll and zoom; a pen or mouse draws. Tap to draw with a finger."}
        onClick={() => update({ fingerDraws: !tools.fingerDraws })}
      >
        <Hand className="h-[18px] w-[18px]" />
      </button>
      <button className="btn-icon h-9 min-w-9 px-1.5 text-teal-300" aria-label="Done annotating" title="Done" onClick={onDone}>
        <Check className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
}
