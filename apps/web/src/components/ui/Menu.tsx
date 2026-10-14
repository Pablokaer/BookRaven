import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type MenuItem =
  | { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean }
  | { separator: true };

/** Space kept between a menu and the screen's edges. */
const EDGE = 8;

/**
 * Dropdown menu: opens from a trigger button, closes on outside click / Escape,
 * arrow keys move between items.
 *
 * The list is drawn in <body> with a fixed position worked out from the trigger: aligned to
 * its right (or left) edge, then pushed back inside the screen (centered when it is nearly as
 * wide as the screen), and above the trigger when there is no room below. Being outside the page's layout it can't be clipped by a parent or
 * placed against a blurred header (`backdrop-filter` makes an element the containing block of
 * its fixed descendants); the position follows rotation, resizing and scrolling.
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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    const trigger = root.current?.getBoundingClientRect();
    const menu = list.current;
    if (!trigger || !menu) return;
    const { innerWidth: vw, innerHeight: vh } = window;
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    // A menu nearly as wide as the screen (a phone) is centered; others hang off the trigger.
    const left = w > vw * 0.7 ? (vw - w) / 2 : Math.min(Math.max(EDGE, align === "right" ? trigger.right - w : trigger.left), vw - w - EDGE);
    const below = trigger.bottom + EDGE;
    const top = below + h <= vh - EDGE || trigger.top - EDGE - h < EDGE ? below : trigger.top - EDGE - h;
    setPos({ top, left });
  }, [align]);

  // Measure once rendered (hidden), then follow rotation, resizing and scrolling.
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    // The list lives in <body>, outside `root`: a press inside either keeps the menu open.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!root.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // First item focused once placed (a hidden element can't take focus).
  const placed = pos !== null;
  useEffect(() => {
    if (open && placed) list.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [open, placed]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      root.current?.querySelector<HTMLElement>("button")?.focus();
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
            className={`fixed z-[80] ${menuClassName} max-w-[calc(100vw-1rem)] origin-top animate-pop overflow-hidden rounded-xl bg-elevated p-1.5 shadow-pop`}
            // Hidden for the first frame, until measured and placed.
            style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
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
