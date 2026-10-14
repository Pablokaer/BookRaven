import { describe, expect, it } from "vitest";
import type { Book } from "./api";
import { computeStats, duration, heatmapWeeks, type Activity } from "./stats";

/** An hour of activity at a local date and time. */
const at = (y: number, m: number, d: number, h: number, seconds: number, bookId: string | null = "a", finished = false): Activity => ({
  hour: new Date(y, m - 1, d, h).toISOString(),
  bookId,
  seconds,
  finished,
});

const book = (id: string, percentage: number, updatedAt: Date) =>
  ({ id, progress: { percentage, updatedAt: updatedAt.toISOString() } }) as unknown as Book;

const now = new Date(2026, 9, 14, 15); // Wednesday 14 October 2026, 15:00 local

describe("reading stats", () => {
  it("formats durations", () => {
    expect(duration(0)).toBe("0 min");
    expect(duration(12 * 60 + 20)).toBe("12 min");
    expect(duration(65 * 60)).toBe("1 h 05 min");
  });

  it("groups hours into local days and counts streaks", () => {
    const activity = [
      at(2026, 10, 1, 9, 600),
      at(2026, 10, 2, 9, 600),
      at(2026, 10, 3, 9, 600), // best run: 1-3 October
      at(2026, 10, 12, 21, 300),
      at(2026, 10, 12, 22, 300, "b"), // same day, two books
      at(2026, 10, 13, 8, 900),
    ];
    const s = computeStats(activity, [], now);
    // Nothing yet today: the streak still counts up to yesterday.
    expect(s.streak).toBe(2);
    expect(s.bestStreak).toBe(3);
    expect(s.daysThisMonth).toBe(5);
    expect(s.weekSeconds).toBe(1500);
    expect(s.last30).toHaveLength(30);
    expect(s.last30.at(-1)!.seconds).toBe(0);
    expect(s.last30.at(-3)!.books.size).toBe(2);
    expect(s.topThisMonth).toEqual([
      { bookId: "a", seconds: 3000 },
      { bookId: "b", seconds: 300 },
    ]);
    expect(computeStats([...activity, at(2026, 10, 14, 10, 60)], [], now).streak).toBe(3);
    expect(computeStats([at(2026, 10, 11, 9, 60)], [], now).streak).toBe(0);
  });

  it("counts finished books once, also from progress saved before the history existed", () => {
    const activity = [at(2026, 3, 5, 20, 100, "a", true), at(2026, 3, 9, 20, 100, "a", true), at(2025, 12, 1, 9, 50, null, true)];
    const books = [book("a", 1, new Date(2026, 2, 9)), book("old", 0.99, new Date(2026, 0, 20)), book("open", 0.5, new Date(2026, 5, 1))];
    const s = computeStats(activity, books, now);
    expect(s.finishedThisYear).toBe(2); // "a" twice counts once, plus "old"
    expect(s.finishedByMonth).toHaveLength(12);
    expect(s.finishedByMonth[0]!.date).toEqual(new Date(2025, 10, 1)); // November 2025 … October 2026
    expect(s.finishedByMonth.find((m) => m.date.getMonth() === 2 && m.date.getFullYear() === 2026)!.count).toBe(1);
    expect(s.finishedByMonth.find((m) => m.date.getMonth() === 11)!.count).toBe(1); // the deleted book
  });

  it("lays out the heatmap in weeks from Monday, without future days", () => {
    const s = computeStats([at(2026, 10, 12, 9, 120)], [], now);
    const weeks = heatmapWeeks(s, 4, now);
    expect(weeks).toHaveLength(4);
    const last = weeks.at(-1)!;
    expect(last[0]!.date).toEqual(new Date(2026, 9, 12)); // Monday
    expect(last[0]).toMatchObject({ seconds: 120, read: true });
    expect(last[2]!.date).toEqual(new Date(2026, 9, 14)); // today, Wednesday
    expect(last[3]).toBeNull(); // Thursday is in the future
  });
});
