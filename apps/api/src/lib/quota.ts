import type pg from "pg";
import { config, isAdmin } from "../config.js";
import { pool } from "../db.js";

export class QuotaExceededError extends Error {
  constructor(
    public usedBytes: number,
    public quotaBytes: number,
  ) {
    super("quota_exceeded");
  }
}

/** Storage limit of an account in bytes, or null when unlimited (administrators). */
export function quotaFor(user: { email: string }) {
  return isAdmin(user) ? null : config.quotaBytes;
}

export async function storageUsed(userId: string, client: pg.PoolClient | pg.Pool = pool) {
  const { rows } = await client.query<{ used: string }>(
    "SELECT COALESCE(SUM(size_bytes), 0) AS used FROM book WHERE user_id = $1",
    [userId],
  );
  return Number(rows[0]!.used);
}

/**
 * Runs `fn` in a transaction after checking that `addBytes` more still fits in the
 * user's quota. A per-user advisory lock makes concurrent uploads check one at a time.
 */
export async function withQuota<T>(
  user: { id: string; email: string },
  addBytes: number,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`quota:${user.id}`]);
    const quota = quotaFor(user);
    if (quota !== null) {
      const used = await storageUsed(user.id, client);
      if (used + addBytes > quota) throw new QuotaExceededError(used, quota);
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
