import { disposableEmailBlocklistSet } from "disposable-email-domains-js";
import { config } from "../config.js";
import { query } from "../db.js";
import { audit, log } from "./log.js";

/**
 * Defences against accounts made by bots, besides the captcha (auth.ts) and the rate limits
 * (routes/auth.ts): throwaway email addresses are refused, and accounts that never confirmed
 * their email are deleted after a while. Against one person making many accounts: an address that
 * reaches an existing account's inbox (dots, +tag) is refused, and so are sign-ups past
 * SIGNUPS_PER_IP_PER_DAY from one network (email_key and signup_net, migration 029).
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

/** The existing account whose inbox this address reaches (f.ulano+2@gmail.com → fulano@gmail.com), if any. */
export async function accountWithSameInbox(email: string) {
  const { rows } = await query<{ id: string }>(`SELECT id FROM "user" WHERE email_key(email) = email_key($1) LIMIT 1`, [email]);
  return rows[0]?.id ?? null;
}

/** Whether this network (an IPv4 address, or an IPv6 /64) already made SIGNUPS_PER_IP_PER_DAY accounts in 24 hours. */
export async function signupLimitReached(ip: string) {
  const max = config.signupsPerIpPerDay;
  if (max <= 0 || !ip) return false;
  const { rows } = await query<{ n: string }>(
    `SELECT count(*) AS n FROM signup_ip WHERE net = signup_net($1) AND created_at > now() - interval '24 hours'`,
    [ip],
  );
  return Number(rows[0]?.n ?? 0) >= max;
}

/** Notes the network a new account signed up from (for the limit above and Admin → the account's page). */
export async function noteSignup(userId: string, ip: string) {
  await query(
    `INSERT INTO signup_ip (user_id, net) SELECT $1, signup_net($2) WHERE signup_net($2) IS NOT NULL ON CONFLICT DO NOTHING`,
    [userId, ip],
  );
}

/** Forgets the networks accounts signed up from after 180 days. */
export async function pruneSignupNetworks() {
  await query(`DELETE FROM signup_ip WHERE created_at < now() - interval '180 days'`);
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

/** Runs the purge (and the sign-up networks' pruning) now and every six hours (not under test, where the tests call it). */
export function schedulePurge() {
  if (config.isTest) return;
  const run = () => {
    purgeUnverifiedAccounts().catch((err) => log.error({ err }, "purging unverified accounts failed"));
    pruneSignupNetworks().catch((err) => log.error({ err }, "pruning sign-up networks failed"));
  };
  void run();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}
