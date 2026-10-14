import { apiJson, type Book } from "./api";
import { isFinished } from "./bookStats";

/** One hour (UTC) in which the position of a book moved; see apps/api/src/routes/stats.ts. */
export type Activity = { hour: string; bookId: string | null; seconds: number; finished: boolean };

export const getActivity = () => apiJson<{ activity: Activity[] }>("/api/stats").then((r) => r.activity);

/** "2026-03-10" in the reader's own time zone. */
export function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** "1 h 05 min", "12 min", "0 min". */
export function duration(seconds: number) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export type Day = { key: string; date: Date; seconds: number; books: Set<string> };

export type ReadingStats = {
  /** Every day with activity, by key. */
  days: Map<string, Day>;
  /** Consecutive days read, ending today (or yesterday, if today has no reading yet). */
  streak: number;
  bestStreak: number;
  weekSeconds: number;
  daysThisMonth: number;
  /** Distinct books finished this calendar year. */
  finishedThisYear: number;
  /** Last 30 days, oldest first. */
  last30: Day[];
  /** Books finished in each of the last 12 months, oldest first. */
  finishedByMonth: { date: Date; count: number }[];
  /** Time per book this month, most read first. */
  topThisMonth: { bookId: string; seconds: number }[];
  /** First day with any recorded activity. */
  since: Date | null;
};

/**
 * Groups the hourly history into the reader's local days and works out the figures of the
 * stats page. `books` fills in finished books read before the history existed: their last
 * saved position stands in for the day they were finished.
 */
export function computeStats(activity: Activity[], books: Book[], now = new Date()): ReadingStats {
  const days = new Map<string, Day>();
  const finishes: { bookKey: string; date: Date }[] = [];
  activity.forEach((a, i) => {
    const date = new Date(a.hour);
    const key = dayKey(date);
    const day = days.get(key) ?? { key, date: new Date(date.getFullYear(), date.getMonth(), date.getDate()), seconds: 0, books: new Set<string>() };
    day.seconds += a.seconds;
    if (a.bookId) day.books.add(a.bookId);
    days.set(key, day);
    // A deleted book (null id) still counts once per finish.
    if (a.finished) finishes.push({ bookKey: a.bookId ?? `deleted-${i}`, date });
  });
  const recorded = new Set(finishes.map((f) => f.bookKey));
  for (const b of books) {
    if (isFinished(b) && !recorded.has(b.id)) finishes.push({ bookKey: b.id, date: new Date(b.progress!.updatedAt) });
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let streak = 0;
  for (let d = days.has(dayKey(today)) ? today : addDays(today, -1); days.has(dayKey(d)); d = addDays(d, -1)) streak++;

  let bestStreak = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const day of [...days.values()].sort((a, b) => a.date.getTime() - b.date.getTime())) {
    run = prev && dayKey(addDays(prev, 1)) === day.key ? run + 1 : 1;
    bestStreak = Math.max(bestStreak, run);
    prev = day.date;
  }

  const last30 = Array.from({ length: 30 }, (_, i) => {
    const date = addDays(today, i - 29);
    return days.get(dayKey(date)) ?? { key: dayKey(date), date, seconds: 0, books: new Set<string>() };
  });
  const weekSeconds = last30.slice(-7).reduce((n, d) => n + d.seconds, 0);
  const daysThisMonth = [...days.values()].filter((d) => d.date.getFullYear() === today.getFullYear() && d.date.getMonth() === today.getMonth()).length;

  const finishedThisYear = new Set(finishes.filter((f) => f.date.getFullYear() === today.getFullYear()).map((f) => f.bookKey)).size;
  const finishedByMonth = Array.from({ length: 12 }, (_, i) => {
    const date = new Date(today.getFullYear(), today.getMonth() - 11 + i, 1);
    const ids = new Set(finishes.filter((f) => f.date.getFullYear() === date.getFullYear() && f.date.getMonth() === date.getMonth()).map((f) => f.bookKey));
    return { date, count: ids.size };
  });

  const perBook = new Map<string, number>();
  for (const a of activity) {
    const d = new Date(a.hour);
    if (!a.bookId || d.getFullYear() !== today.getFullYear() || d.getMonth() !== today.getMonth()) continue;
    perBook.set(a.bookId, (perBook.get(a.bookId) ?? 0) + a.seconds);
  }
  const topThisMonth = [...perBook].map(([bookId, seconds]) => ({ bookId, seconds })).filter((b) => b.seconds > 0).sort((a, b) => b.seconds - a.seconds);

  const first = activity[0] ? new Date(activity[0].hour) : null;
  return { days, streak, bestStreak, weekSeconds, daysThisMonth, finishedThisYear, last30, finishedByMonth, topThisMonth, since: first };
}

/**
 * The heatmap's weeks: columns of seven days (Monday first) for the last `weeks` weeks,
 * ending with the current week; days after today are null.
 */
export function heatmapWeeks(stats: ReadingStats, weeks: number, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addDays(monday, (w - weeks + 1) * 7 + d);
      if (date > today) return null;
      return { date, seconds: stats.days.get(dayKey(date))?.seconds ?? 0, read: stats.days.has(dayKey(date)) };
    }),
  );
}
