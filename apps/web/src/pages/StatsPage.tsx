import { BarChart3, BookCheck, CalendarDays, Clock, Flame } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router";
import { EmptyState } from "../components/books/BookBrowser";
import { BookCover } from "../components/books/BookCover";
import { ColumnChart, Heatmap, niceCeil } from "../components/stats/Charts";
import { PageHeader } from "../components/ui/PageHeader";
import { useLibrary } from "../lib/libraryStore";
import { useSettings } from "../lib/settings";
import { computeStats, duration, getActivity, heatmapWeeks } from "../lib/stats";
import { useApi } from "../lib/useApi";
import { useMediaQuery } from "../lib/useMediaQuery";

function Tile({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="surface p-4 sm:p-5">
      <div className="flex items-center gap-2 text-xs text-muted [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-accent">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold leading-tight sm:text-3xl">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="surface p-5 sm:p-6" aria-label={title}>
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

const minutesAxis = (s: number) => {
  const m = Math.round(s / 60);
  return m >= 60 && m % 60 === 0 ? `${m / 60} h` : `${m} min`;
};
/** Clean minute values: 10, 20, 50, 100 min… (30-minute steps once past an hour, so ticks read 1 h, 2 h). */
const minutesTop = (s: number) => {
  const m = Math.max(10, s / 60);
  return (m > 60 ? Math.ceil(m / 60) * 60 : niceCeil(m)) * 60;
};
/** Whole books at every tick: an even top, at least 2. */
const booksTop = (n: number) => Math.max(2, Math.ceil(n / 2) * 2);

/** "/stats" — reading time, streaks, active days and books finished, from the reading history. */
export function StatsPage() {
  const { books } = useLibrary();
  const { settings } = useSettings();
  const { data: activity, error } = useApi(getActivity, []);
  const wide = useMediaQuery("(min-width: 640px)");

  const stats = useMemo(() => (activity ? computeStats(activity, books ?? []) : null), [activity, books]);
  const year = new Date().getFullYear();

  if (error) {
    return (
      <EmptyState icon={<BarChart3 />} title="Could not load your stats">
        Check your connection and try again.
      </EmptyState>
    );
  }
  if (!stats) return <div className="h-96 animate-pulse rounded-2xl bg-card/60" />;

  const title = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const byId = new Map((books ?? []).map((b) => [b.id, b]));
  const top = stats.topThisMonth.filter((t) => byId.has(t.bookId)).slice(0, 5);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader title="Reading stats" subtitle="Time read, streaks and finished books, from every device you read on." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={<Clock />} label="Last 7 days" value={duration(stats.weekSeconds)} />
        <Tile
          icon={<Flame />}
          label="Streak"
          value={`${stats.streak} ${stats.streak === 1 ? "day" : "days"}`}
          sub={`Best: ${stats.bestStreak} ${stats.bestStreak === 1 ? "day" : "days"}`}
        />
        <Tile icon={<CalendarDays />} label="Days read this month" value={String(stats.daysThisMonth)} />
        <Tile icon={<BookCheck />} label={`Finished in ${year}`} value={String(stats.finishedThisYear)} sub={`Goal: ${settings.readingGoal}`} />
      </div>

      {!stats.since && (
        <p className="surface px-5 py-4 text-sm text-muted">
          Your history starts with your next page turn. Read on any device, including KOReader, and it shows up here.
        </p>
      )}

      <Card title="Last 30 days" note="Reading time per day">
        <ColumnChart
          caption="Reading time per day, last 30 days"
          data={stats.last30.map((d) => ({
            key: d.key,
            label: d.date.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
            value: d.seconds,
            valueText: duration(d.seconds),
            title: title(d.date),
          }))}
          axis={minutesAxis}
          top={minutesTop}
          // Every week on wide screens, every other week on phones, always ending today.
          showLabel={(i) => (29 - i) % (wide ? 7 : 14) === 0}
        />
      </Card>

      <div className="grid gap-8 lg:grid-cols-2">
        <Card title="Activity" note={wide ? "The last 26 weeks" : "The last 16 weeks"}>
          <Heatmap
            weeks={heatmapWeeks(stats, wide ? 26 : 16)}
            describe={(c) => `${title(c.date)} · ${c.read ? duration(c.seconds) : "no reading"}`}
          />
        </Card>

        <Card title="Books finished" note="The last 12 months">
          <ColumnChart
            caption="Books finished per month, last 12 months"
            data={stats.finishedByMonth.map((m) => ({
              key: m.date.toISOString(),
              label: m.date.toLocaleDateString(undefined, { month: "narrow" }),
              value: m.count,
              valueText: `${m.count} ${m.count === 1 ? "book" : "books"}`,
              title: m.date.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
            }))}
            axis={(n) => String(n)}
            top={booksTop}
            showLabel={() => true}
            height={128}
          />
        </Card>
      </div>

      <Card title="Most read this month">
        {top.length === 0 ? (
          <p className="text-sm text-muted">No reading time recorded this month yet.</p>
        ) : (
          <ol className="space-y-3">
            {top.map((t, i) => {
              const b = byId.get(t.bookId)!;
              return (
                <li key={t.bookId}>
                  <Link to={`/books/${b.id}`} className="flex items-center gap-3 rounded-xl p-1 transition hover:bg-fg/5">
                    <span className="w-5 text-right text-sm tabular-nums text-muted">{i + 1}</span>
                    <BookCover book={b} size="xs" className="w-9" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{b.title}</span>
                      <span className="block truncate text-xs text-muted">{b.author ?? "Unknown author"}</span>
                    </span>
                    <span className="shrink-0 text-sm tabular-nums">{duration(t.seconds)}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <p className="text-xs text-muted">
        Reading time is estimated from page turns: pauses longer than 10 minutes don’t count.
        {stats.since ? ` History since ${stats.since.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}.` : ""}
      </p>
    </div>
  );
}
