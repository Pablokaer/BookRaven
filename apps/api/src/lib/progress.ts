import { query } from "../db.js";
import { notifyClubProgress } from "./clubs.js";
import { publish } from "./events.js";

export type ProgressRow = {
  locator: string;
  percentage: number;
  label: string | null;
  device_id: string;
  device_name: string | null;
  updated_at: Date;
};

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
 * Returns the new row, or null when a newer position already exists.
 */
export async function saveReadingProgress(
  userId: string,
  bookId: string,
  p: { locator: string; percentage: number; label: string | null; deviceId: string; deviceName: string | null; at: Date },
) {
  const ts = new Date(Math.min(p.at.getTime(), Date.now())); // never in the future (bad device clocks)
  const { rows } = await query<ProgressRow>(
    `INSERT INTO reading_progress (user_id, book_id, locator, percentage, label, device_id, device_name, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id, book_id) DO UPDATE SET
       locator = EXCLUDED.locator, percentage = EXCLUDED.percentage, label = EXCLUDED.label,
       device_id = EXCLUDED.device_id, device_name = EXCLUDED.device_name, updated_at = EXCLUDED.updated_at
     WHERE reading_progress.updated_at < EXCLUDED.updated_at
     RETURNING *`,
    [userId, bookId, p.locator, p.percentage, p.label, p.deviceId, p.deviceName, ts],
  );
  if (rows[0]) {
    publish(userId, "progress.updated", progressDto(bookId, rows[0]));
    // Fellow book-club members see each other's progress live.
    await notifyClubProgress(userId, bookId).catch(() => {});
  }
  return rows[0] ?? null;
}
