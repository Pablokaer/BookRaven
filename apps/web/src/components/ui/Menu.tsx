import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type MenuItem =
  | { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean }
  | { separator: true };

/** Space kept between a menu and the screen's edges. */
const EDGE = 8;

type Placement = { top: number; left: number; maxHeight: number; up: boolean };

/**
 * Dropdown menu: opens from a trigger button, closes on outside click / Escape, arrow keys
 * move between items.
 *
 * The list is drawn in <body> with a fixed position worked out from the trigger: aligned to its
 * right (or left) edge, then clamped inside the screen (centered when it is nearly as wide as
 * the screen), on whichever side — below or above — has more room, and never taller than that
 * room (it scrolls inside instead). Being outside the page's layout it can't be clipped by a
 * parent or placed against a blurred header (`backdrop-filter` makes an element the containing
 * block of its fixed descendants); the position follows rotation, resizing, scrolling and the
 * list's own size changing.
 */
export function Menu({
  trigger,
  label,
  items,
  align = "right",
  triggerClassName = "icon-btn",
  header,
  menuClassName = "min-w-52",
}: {
  trigger: ReactNode;
  /** Accessible name of the trigger button. */
  label: string;
  items: MenuItem[];
  align?: "left" | "right";
  triggerClassName?: string;
  header?: ReactNode;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const [pos, setPos] = useState<Placement | null>(null);

  const place = useCallback(() => {
    const t = root.current?.getBoundingClientRect();
    const menu = list.current;
    if (!t || !menu) return;
    const { innerWidth: vw, innerHeight: vh } = window;
    const w = menu.offsetWidth;
    // The menu's natural height (unclamped): max-height is set to "auto" between measurements.
    const h = menu.scrollHeight;
    // A menu nearly as wide as the screen (a phone) is centered; others hang off the trigger.
    const left = w > vw * 0.7 ? (vw - w) / 2 : Math.min(Math.max(EDGE, align === "right" ? t.right - w : t.left), vw - w - EDGE);
    const roomBelow = vh - EDGE - (t.bottom + EDGE);
    const roomAbove = t.top - EDGE - EDGE;
    // Open on the side that fits; if neither does, the side with more room, and scroll inside.
    const up = h > roomBelow && roomAbove > roomBelow;
    const maxHeight = Math.max(80, Math.min(h, up ? roomAbove : roomBelow));
    const top = up ? t.top - EDGE - maxHeight : t.bottom + EDGE;
    setPos((prev) =>
      prev && prev.top === top && prev.left === left && prev.maxHeight === maxHeight && prev.up === up ? prev : { top, left, maxHeight, up },
    );
  }, [align]);

  // Measure once rendered (hidden), then follow rotation, resizing, scrolling and the list's
  // own size changing. Reads are throttled to one animation frame so scrolling stays smooth.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        place();
      });
    };
    place();
    const ro = new ResizeObserver(schedule);
    if (list.current) ro.observe(list.current);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [open, place]);

  const close = useCallback((focusTrigger = false) => {
    setOpen(false);
    if (focusTrigger) root.current?.querySelector<HTMLElement>("button")?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    // The list lives in <body>, outside `root`: a press or a focus inside either keeps it open.
    const inside = (t: Node | null) => !!t && (!!root.current?.contains(t) || !!list.current?.contains(t));
    const onDown = (e: PointerEvent) => inside(e.target as Node) || close();
    // Portaling breaks the natural Tab order, so close once focus leaves both parts (Tab out).
    const onFocus = (e: FocusEvent) => inside(e.target as Node) || close();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("focusin", onFocus);
    };
  }, [open, close]);

  // First item focused once placed (a hidden element can't take focus).
  const placed = pos !== null;
  useEffect(() => {
    if (open && placed) list.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [open, placed]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close(true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const els = [...(list.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
      const i = els.indexOf(document.activeElement as HTMLElement);
      els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length]?.focus();
    }
  };

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        type="button"
        className={triggerClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={list}
            id={id}
            role="menu"
            // z-55: above the header (z-30), bottom nav (z-40) and panels (z-50); below the
            // modal (z-60) and the full-screen overlays/toasts (z-70).
            className={`fixed z-[55] ${menuClassName} max-w-[calc(100vw-1rem)] animate-pop overflow-y-auto overscroll-contain rounded-xl bg-elevated p-1.5 shadow-pop ${
              pos?.up ? "origin-bottom" : "origin-top"
            }`}
            style={
              pos
                ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight }
                : // Hidden and unclamped for the first frame, until measured and placed.
                  { top: 0, left: 0, visibility: "hidden" }
            }
            // React events bubble through the portal to `root` (keys included); clicks stop here.
            onClick={(e) => e.stopPropagation()}
          >
            {header}
            {items.map((item, i) =>
              "separator" in item ? (
                <div key={i} className="my-1 h-px bg-line" />
              ) : (
                <button
                  key={i}
                  type="button"
                  role="menuitem"
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm outline-none transition hover:bg-white/5 focus-visible:bg-white/5 ${
                    item.danger ? "text-rose-300" : "text-fg"
                  }`}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  {item.icon && <span className="text-muted [&>svg]:h-4 [&>svg]:w-4">{item.icon}</span>}
                  {item.label}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
