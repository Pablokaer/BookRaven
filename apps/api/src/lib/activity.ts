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
  return query(
    `INSERT INTO user_activity (user_id, last_seen_at) VALUES ($1, now())
     ON CONFLICT (user_id) DO UPDATE SET last_seen_at = now()`,
    [userId],
  ).then(
    () => undefined,
    (err) => {
      recent.forget((_, key) => key === userId);
      log.warn({ err, userId }, "activity: could not note the account's last use");
    },
  );
}

/** Tests: forget which accounts were noted lately, so the next request writes again. */
export function forgetRecentActivity() {
  recent.forget(() => true);
}
