import { useState } from "react";

export type Column = {
  key: string;
  /** Axis label; only some are shown (see `showLabel`). */
  label: string;
  value: number;
  /** Tooltip and table: the value as text ("12 min") and what it is ("Mon 12 Oct"). */
  valueText: string;
  title: string;
};

/** 1, 2 or 5 times a power of ten, at or above `n` (a clean top for the axis). */
export function niceCeil(n: number) {
  if (n <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(n));
  return ([1, 2, 5, 10].find((m) => m * p >= n) ?? 10) * p;
}

/**
 * Single-series column chart: thin columns (at most 24 px) in the accent color, rounded at the
 * top and square at the baseline, a 3-line recessive grid, a tooltip on hover and focus, and
 * the same data as a table for screen readers and anyone who prefers numbers.
 */
export function ColumnChart({
  data,
  caption,
  axis,
  showLabel,
  top,
  height = 160,
}: {
  data: Column[];
  /** What the chart shows, for its accessible name and the table. */
  caption: string;
  /** Formats an axis tick (e.g. minutes → "1 h"). */
  axis: (v: number) => string;
  /** The axis top for the largest value: clean in the axis's own unit (minutes, whole books). */
  top: (max: number) => number;
  showLabel: (i: number) => boolean;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = top(Math.max(0, ...data.map((d) => d.value)));
  const ticks = [max, max / 2, 0];

  return (
    <figure className="space-y-3">
      <div className="flex gap-2" onPointerLeave={() => setActive(null)}>
        {/* Axis ticks */}
        <div className="relative w-12 shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums text-muted" style={{ height }} aria-hidden="true">
          {ticks.map((t, i) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(i / 2) * 100}%` }}>
              {axis(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height }} role="img" aria-label={caption}>
          {ticks.map((t, i) => (
            <div key={t} className="absolute inset-x-0 h-px bg-line" style={{ top: `${(i / 2) * 100}%` }} aria-hidden="true" />
          ))}
          <div className="absolute inset-0 flex items-end">
            {data.map((d, i) => (
              <div
                key={d.key}
                className="relative flex h-full flex-1 items-end justify-center"
                onPointerEnter={() => setActive(i)}
                aria-hidden="true"
              >
                <div
                  className={`w-[70%] max-w-6 rounded-t-[4px] bg-accent transition-opacity ${active !== null && active !== i ? "opacity-50" : ""}`}
                  style={{ height: d.value > 0 ? `max(2px, ${(d.value / max) * 100}%)` : 0 }}
                />
                {active === i && (
                  <div
                    className="pointer-events-none absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-center shadow-pop"
                    style={{ [i < data.length / 2 ? "left" : "right"]: 0 }}
                  >
                    <div className="text-sm font-semibold">{d.valueText}</div>
                    <div className="text-xs text-muted">{d.title}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="ml-14 flex text-[11px] text-muted" aria-hidden="true">
        {data.map((d, i) => (
          <span key={d.key} className="flex-1 overflow-visible whitespace-nowrap text-center">
            {showLabel(i) ? d.label : ""}
          </span>
        ))}
      </div>
      <DataTable caption={caption} rows={data.map((d) => [d.title, d.valueText])} />
    </figure>
  );
}

/** The chart's numbers as a table, folded away by default. */
export function DataTable({ caption, rows }: { caption: string; rows: [string, string][] }) {
  return (
    <details className="text-xs text-muted">
      <summary className="cursor-pointer select-none hover:text-fg">Show as table</summary>
      <table className="mt-2 w-full max-w-sm text-left">
        <caption className="sr-only">{caption}</caption>
        <tbody>
          {rows.map(([a, b]) => (
            <tr key={a} className="border-b border-line/60 last:border-0">
              <th scope="row" className="py-1 pr-4 font-normal">
                {a}
              </th>
              <td className="py-1 text-right tabular-nums text-fg">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export type HeatCell = { date: Date; seconds: number; read: boolean } | null;

/** Reading time to one of five steps of the accent color (none, under 15 min, 30, 60, more). */
function level(c: NonNullable<HeatCell>) {
  if (!c.read) return "bg-fg/[0.06]";
  const m = c.seconds / 60;
  if (m < 15) return "bg-accent/30";
  if (m < 30) return "bg-accent/55";
  if (m < 60) return "bg-accent/80";
  return "bg-accent";
}

/**
 * Days read in the last weeks, one column per week (Monday on top). Hovering a day names it
 * and its reading time in the line above the grid.
 */
export function Heatmap({ weeks, describe }: { weeks: HeatCell[][]; describe: (c: NonNullable<HeatCell>) => string }) {
  const [active, setActive] = useState<NonNullable<HeatCell> | null>(null);
  const monthLabel = (w: HeatCell[], i: number) => {
    const first = w.find(Boolean);
    if (!first) return "";
    const prev = weeks[i - 1]?.find(Boolean);
    return !prev || prev.date.getMonth() !== first.date.getMonth() ? first.date.toLocaleDateString(undefined, { month: "short" }) : "";
  };
  return (
    <figure className="space-y-3">
      <p className="h-5 text-sm" aria-live="polite">
        {active ? describe(active) : <span className="text-muted">Hover a day to see your reading time.</span>}
      </p>
      {/* Scrolls on narrow screens; the newest weeks are on the right. */}
      <div className="overflow-x-auto pb-1" dir="rtl">
        <div className="inline-flex gap-[3px]" dir="ltr" onPointerLeave={() => setActive(null)}>
          {weeks.map((w, i) => (
            <div key={i} className="flex flex-col gap-[3px]">
              <span className="h-4 whitespace-nowrap text-[11px] text-muted" aria-hidden="true">
                {monthLabel(w, i)}
              </span>
              {w.map((c, d) =>
                c ? (
                  // Not a tab stop each (180 of them); screen readers read the labels in browse mode.
                  <span key={d} role="img" className={`h-3.5 w-3.5 rounded-[3px] ${level(c)}`} aria-label={describe(c)} onPointerEnter={() => setActive(c)} />
                ) : (
                  <span key={d} className="h-3.5 w-3.5" />
                ),
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted" aria-hidden="true">
        Less
        {["bg-fg/[0.06]", "bg-accent/30", "bg-accent/55", "bg-accent/80", "bg-accent"].map((c) => (
          <span key={c} className={`h-3 w-3 rounded-[3px] ${c}`} />
        ))}
        More
      </div>
    </figure>
  );
}
