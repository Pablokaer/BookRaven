import type { ReactNode } from "react";

/** A form field with a visible label: placeholders vanish while typing, labels don't. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5 text-left">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
