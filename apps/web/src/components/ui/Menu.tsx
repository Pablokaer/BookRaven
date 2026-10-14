import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type MenuItem =
  | { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean }
  | { separator: true };

/**
 * Dropdown menu: opens from a trigger button, closes on outside click / Escape,
 * arrow keys move between items.
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
  const [side, setSide] = useState(align);

  // Open on the side that fits: a right-aligned menu under a trigger near the left edge of a
  // phone screen would otherwise be cut off (and the other way round).
  useLayoutEffect(() => {
    if (!open || !root.current || !list.current) return setSide(align);
    const r = root.current.getBoundingClientRect();
    const w = list.current.offsetWidth;
    const margin = 8;
    if (align === "right" && r.right - w < margin && r.left + w <= window.innerWidth - margin) setSide("left");
    else if (align === "left" && r.left + w > window.innerWidth - margin && r.right - w >= margin) setSide("right");
    else setSide(align);
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    list.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

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
      {open && (
        <div
          ref={list}
          id={id}
          role="menu"
          className={`absolute z-50 mt-2 ${menuClassName} origin-top animate-pop overflow-hidden rounded-xl bg-elevated p-1.5 shadow-pop ${
            side === "right" ? "right-0" : "left-0"
          }`}
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
        </div>
      )}
    </div>
  );
}
