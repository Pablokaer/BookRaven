import { X } from "lucide-react";
import type { ReactNode } from "react";

/** A reader side panel: its title, a close button (after any `actions`) and the content. */
export function PanelShell({
  side,
  label,
  title,
  closeLabel,
  closeIcon = <X className="h-4 w-4" />,
  actions,
  onClose,
  children,
}: {
  side: "left" | "right";
  /** The dialog's accessible name. */
  label: string;
  title: string;
  closeLabel: string;
  closeIcon?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const close = (
    <button className="btn-icon" onClick={onClose} aria-label={closeLabel}>
      {closeIcon}
    </button>
  );
  return (
    <div className={`panel ${side === "left" ? "left-0" : "right-0"} w-full max-w-sm`} role="dialog" aria-label={label}>
      <div className={actions === undefined ? "flex items-center justify-between" : "flex items-center justify-between gap-2"}>
        <h2 className="text-lg font-semibold">{title}</h2>
        {actions === undefined ? close : <div className="flex items-center gap-1">{actions}{close}</div>}
      </div>
      {children}
    </div>
  );
}
