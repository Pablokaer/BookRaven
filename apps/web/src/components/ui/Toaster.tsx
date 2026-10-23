import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { dismissToast, onToast, type Toast } from "../../lib/toast";

/** The message from `showToast` (lib/toast.ts), at the bottom of the screen above everything else. */
export function Toaster() {
  const [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => onToast(setToast), []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex justify-center px-4" role="status" aria-live="polite">
      {toast && (
        <div
          key={toast.id}
          className="pointer-events-auto flex max-w-md animate-rise items-center gap-3 rounded-2xl border border-line bg-elevated py-2.5 pl-4 pr-2 text-sm shadow-pop"
        >
          {toast.tone === "error" ? <CircleAlert className="h-4 w-4 shrink-0 text-rose-300" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />}
          <span className="min-w-0 flex-1">{toast.message}</span>
          <button type="button" className="icon-btn h-7 w-7" aria-label="Dismiss" onClick={dismissToast}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
