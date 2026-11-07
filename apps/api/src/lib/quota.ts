import type pg from "pg";
import { config, isAdmin } from "../config.js";
import { pool, withTransaction } from "../db.js";
import { subscriptionBytes } from "./billing.js";

export class QuotaExceededError extends Error {
  constructor(
    public usedBytes: number,
    public quotaBytes: number,
  ) {
    super("quota_exceeded");
  }
}

/** The 413 response body for a full account. */
export const quotaBody = (q: { usedBytes: number; quotaBytes: number }) => ({ error: "quota_exceeded", usedBytes: q.usedBytes, quotaBytes: q.quotaBytes });

/**
 * Storage limit of an account in bytes, or null when unlimited (administrators).
 * An administrator can set a different limit per account (account_admin.quota_bytes), and a paid
 * plan (billing) raises it while its subscription is active: the larger of the two applies.
 */
export async function quotaFor(user: { id: string; email: string }, client: pg.PoolClient | pg.Pool = pool) {
  if (isAdmin(user)) return null;
  const { rows } = await client.query<{ quota_bytes: string | null; plan: string | null; status: string | null }>(
    `SELECT a.quota_bytes, b.plan, b.status
     FROM (SELECT $1::text AS id) u
     LEFT JOIN account_admin a ON a.user_id = u.id
     LEFT JOIN billing b ON b.user_id = u.id`,
    [user.id],
  );
  return quotaOf(user, rows[0]?.quota_bytes ?? null, rows[0]);
}

/** quotaFor, when account_admin.quota_bytes and the billing row are already at hand. */
export function quotaOf(user: { email: string }, quotaBytes: string | number | null, billing?: { plan: string | null; status: string | null } | null) {
  if (isAdmin(user)) return null;
  const base = quotaBytes != null ? Number(quotaBytes) : config.quotaBytes;
  return Math.max(base, subscriptionBytes(billing));
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
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`quota:${user.id}`]);
    const quota = await quotaFor(user, client);
    if (quota !== null) {
      const used = await storageUsed(user.id, client);
      if (used + addBytes > quota) throw new QuotaExceededError(used, quota);
    }
    return fn(client);
  });
}
