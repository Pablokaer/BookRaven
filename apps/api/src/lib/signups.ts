import { disposableEmailBlocklistSet } from "disposable-email-domains-js";
import { config } from "../config.js";
import { query } from "../db.js";
import { audit, log } from "./log.js";

/**
 * Defences against accounts made by bots, besides the captcha (auth.ts) and the rate limits
 * (routes/auth.ts): throwaway email addresses are refused, and accounts that never confirmed
 * their email are deleted after a while.
 */

let disposable: Set<string> | null = null;

/** Whether the address belongs to a throwaway email service (or a subdomain of one). */
export function isDisposableEmail(email: string) {
  disposable ??= disposableEmailBlocklistSet();
  const domain = email.slice(email.lastIndexOf("@") + 1).trim().toLowerCase().replace(/\.$/, "");
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    if (disposable.has(parts.slice(i).join("."))) return true;
  }
  return false;
}

/**
 * Deletes the accounts that never confirmed their email within UNVERIFIED_ACCOUNT_DAYS. Only
 * with REQUIRE_EMAIL_VERIFICATION on, and only accounts that never signed in and have no books:
 * one made before verification was turned on, and used, is kept. Returns how many went.
 */
export async function purgeUnverifiedAccounts(now = new Date()) {
  const days = config.unverifiedAccountDays;
  if (!config.requireEmailVerification || days <= 0) return 0;
  const { rows } = await query<{ id: string; email: string }>(
    `DELETE FROM "user" u
      WHERE u."emailVerified" = false
        AND u."createdAt" < $1::timestamptz - make_interval(days => $2)
        AND lower(u.email) <> ALL($3::text[])
        AND NOT EXISTS (SELECT 1 FROM session s WHERE s."userId" = u.id)
        AND NOT EXISTS (SELECT 1 FROM book b WHERE b.user_id = u.id)
      RETURNING u.id, u.email`,
    [now, days, config.adminEmails],
  );
  for (const u of rows) audit("auth.unverified_account_deleted", { userId: u.id, email: u.email });
  return rows.length;
}

/** Runs the purge now and every six hours (not under test, where the tests call it). */
export function schedulePurge() {
  if (config.isTest) return;
  const run = () => purgeUnverifiedAccounts().catch((err) => log.error({ err }, "purging unverified accounts failed"));
  void run();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}
