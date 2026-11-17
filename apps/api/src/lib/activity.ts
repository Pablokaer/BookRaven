import { config } from "../config.js";
import { query } from "../db.js";
import { TtlCache } from "./cache.js";
import { log } from "./log.js";

/** How often an account's "last seen" moves while it keeps using the app. */
const EVERY_MS = 5 * 60_000;
const recent = new TtlCache<true>(20_000);

/**
 * Notes that an account just used the app. Called once per signed-in request, after it was answered
 * (the `onResponse` hook in app.ts), whatever way it signed in: web, Android, KOReader, OPDS. Writes
 * at most once every 5 minutes per account and never makes a request wait; a failed write is retried
 * on the account's next request.
 */
export function noteActivity(userId: string): Promise<void> {
  if (recent.get(userId)) return Promise.resolve();
  recent.set(userId, true, EVERY_MS);
  // Also the hour, for the account's usage pattern in Admin (one row per hour of use).
  return query(
    `WITH seen AS (
       INSERT INTO user_activity (user_id, last_seen_at) VALUES ($1, now())
       ON CONFLICT (user_id) DO UPDATE SET last_seen_at = now()
     )
     INSERT INTO user_activity_hour (user_id, hour) VALUES ($1, date_trunc('hour', now())) ON CONFLICT DO NOTHING`,
    [userId],
  ).then(
    () => undefined,
    (err) => {
      recent.forget((_, key) => key === userId);
      log.warn({ err, userId }, "activity: could not note the account's last use");
    },
  );
}

/** Hours of use older than this are deleted (the privacy policy says a year). */
const KEEP_DAYS = 365;

export async function pruneActivityHours() {
  const { rowCount } = await query(`DELETE FROM user_activity_hour WHERE hour < now() - make_interval(days => $1)`, [KEEP_DAYS]);
  return rowCount ?? 0;
}

/** Started with the server: prunes old hours of use now and once a day. */
export function scheduleActivityPrune() {
  if (config.isTest) return;
  const run = () => pruneActivityHours().catch((err) => log.error({ err }, "pruning hours of use failed"));
  void run();
  setInterval(run, 24 * 60 * 60 * 1000).unref();
}

/** Tests: forget which accounts were noted lately, so the next request writes again. */
export function forgetRecentActivity() {
  recent.forget(() => true);
}
