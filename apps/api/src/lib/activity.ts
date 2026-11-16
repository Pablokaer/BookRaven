import { query } from "../db.js";
import { TtlCache } from "./cache.js";
import { log } from "./log.js";

/** How often an account's "last seen" moves while it keeps using the app. */
const EVERY_MS = 5 * 60_000;
const recent = new TtlCache<true>(20_000);

/**
 * Notes that an account just used the app (any authenticated request: web, Android, KOReader,
 * OPDS). Writes at most once every 5 minutes per account; a failure never fails the request.
 */
export async function noteActivity(userId: string) {
  if (recent.get(userId)) return;
  recent.set(userId, true, EVERY_MS);
  try {
    await query(
      `INSERT INTO user_activity (user_id, last_seen_at) VALUES ($1, now())
       ON CONFLICT (user_id) DO UPDATE SET last_seen_at = now()`,
      [userId],
    );
  } catch (err) {
    log.warn({ err, userId }, "activity: could not note the account's last use");
  }
}
