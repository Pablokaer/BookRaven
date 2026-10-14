import type { ReactNode } from "react";

export function StatCard({ icon, label, value, hint }: { icon: ReactNode; label: string; value: number | null; hint?: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-line/80 bg-app/40 p-3 sm:gap-3 sm:p-4" title={hint}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent ring-1 ring-inset ring-accent/20 sm:h-10 sm:w-10 [&>svg]:h-[18px] [&>svg]:w-[18px]">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xl font-semibold tabular-nums leading-tight">
          {value === null ? <span className="inline-block h-5 w-8 animate-pulse rounded bg-fg/10 align-middle" /> : value}
        </div>
        <div className="truncate text-xs text-muted">{label}</div>
      </div>
    </div>
  );
}
