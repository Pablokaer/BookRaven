import { query } from "../db.js";
import { notifyClubProgress } from "./clubs.js";
import { publish } from "./events.js";
import { log } from "./log.js";

export type ProgressRow = {
  locator: string;
  percentage: number;
  label: string | null;
  device_id: string;
  device_name: string | null;
  updated_at: Date;
};

export type Position = { locator: string; percentage: number; updated_at: Date };

/** Progress at or past this point counts as finished (same mark as the app's). */
const FINISHED_AT = 0.98;
/** A longer pause between two saved positions is a break, not reading time. */
const MAX_GAP_SECONDS = 600;

/**
 * Adds a moved position to the reading history (the stats page): the time since the previous
 * position, when it was a short gap, and whether the book was just finished. Opening a book
 * without turning a page records nothing.
 */
async function recordActivity(
  userId: string,
  bookId: string,
  prev: Position | null,
  locator: string,
  percentage: number,
  at: Date,
) {
  if (prev?.locator === locator) return;
  const gap = prev ? (at.getTime() - prev.updated_at.getTime()) / 1000 : 0;
  const seconds = gap > 0 && gap <= MAX_GAP_SECONDS ? Math.round(gap) : 0;
  const finished = (prev?.percentage ?? 0) < FINISHED_AT && percentage >= FINISHED_AT;
  await query(
    `INSERT INTO reading_activity (user_id, book_id, hour, seconds, finished)
     VALUES ($1, $2, date_trunc('hour', $3::timestamptz), $4, $5)
     ON CONFLICT (user_id, book_id, hour) DO UPDATE SET
       seconds = reading_activity.seconds + EXCLUDED.seconds,
       finished = reading_activity.finished OR EXCLUDED.finished`,
    [userId, bookId, at, seconds, finished],
  );
}

export function progressDto(bookId: string, r: ProgressRow) {
  return {
    bookId,
    locator: r.locator,
    percentage: r.percentage,
    label: r.label,
    deviceId: r.device_id,
    deviceName: r.device_name,
    updatedAt: r.updated_at.toISOString(),
  };
}

/**
 * Stores a reading position if it is newer than the stored one (last write wins on the
 * time the position was reached, so a device syncing late cannot overwrite newer progress).
 * `prev` is the stored position when the caller has already read it. Returns the stored row
 * afterwards and whether this position was applied.
 */
export async function saveReadingProgress(
  userId: string,
  bookId: string,
  p: { locator: string; percentage: number; label: string | null; deviceId: string; deviceName: string | null; at: Date },
  prev?: Position | null,
) {
  const ts = new Date(Math.min(p.at.getTime(), Date.now())); // never in the future (bad device clocks)
  const before =
    prev !== undefined
      ? prev
      : ((await query<Position>("SELECT locator, percentage, updated_at FROM reading_progress WHERE user_id = $1 AND book_id = $2", [userId, bookId])).rows[0] ?? null);
  // The new row when applied, else the stored one (as of the statement's snapshot).
  const { rows } = await query<ProgressRow & { applied: boolean }>(
    `WITH up AS (
       INSERT INTO reading_progress (user_id, book_id, locator, percentage, label, device_id, device_name, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, book_id) DO UPDATE SET
         locator = EXCLUDED.locator, percentage = EXCLUDED.percentage, label = EXCLUDED.label,
         device_id = EXCLUDED.device_id, device_name = EXCLUDED.device_name, updated_at = EXCLUDED.updated_at
       WHERE reading_progress.updated_at < EXCLUDED.updated_at
       RETURNING *
     )
     SELECT *, true AS applied FROM up
     UNION ALL
     SELECT *, false FROM reading_progress WHERE user_id = $1 AND book_id = $2 AND NOT EXISTS (SELECT 1 FROM up)`,
    [userId, bookId, p.locator, p.percentage, p.label, p.deviceId, p.deviceName, ts],
  );
  // A first position saved concurrently by another device is not in that snapshot.
  const row = rows[0] ?? { ...(await query<ProgressRow>("SELECT * FROM reading_progress WHERE user_id = $1 AND book_id = $2", [userId, bookId])).rows[0]!, applied: false };
  if (row.applied) {
    await recordActivity(userId, bookId, before, p.locator, p.percentage, ts);
    publish(userId, "progress.updated", progressDto(bookId, row));
    // Fellow book-club members see each other's progress live.
    await notifyClubProgress(userId, bookId).catch((err) => log.warn({ err, userId, bookId }, "book club progress notification failed"));
  }
  return row;
}
