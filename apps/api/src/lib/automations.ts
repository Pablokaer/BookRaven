import { config } from "../config.js";
import { pool, query } from "../db.js";
import { campaignRunning, sendTemplateTo, sharedData, TEMPLATES, type CampaignContent, type Recipient, type TemplateId } from "./campaigns.js";
import { audit, log } from "./log.js";
import { mailEnabled } from "./mailer.js";
import { FINISHED_AT } from "./progress.js";

/**
 * Automatic emails (Admin → Emails → Automations). Every hour, inside the sending hours
 * (EMAIL_AUTOMATION_HOURS), each automation that is on finds the readers its rule fits and sends
 * them its template. Guards, in this order of importance:
 * - at most one promotional email a week per account (automations and campaigns: email_send_log);
 * - one email per account per run, the first automation in AUTOMATION_IDS winning;
 * - an automation never sends the same thing twice (`ref`: the book, the absence, the week, the year);
 * - unsubscribed and blocked accounts (and, with REQUIRE_EMAIL_VERIFICATION, unconfirmed ones) never get one;
 * - nothing is sent while a campaign is going out, or in production without SMTP.
 * Every automation starts off: an administrator turns each one on.
 */

/** In priority order: when a reader fits several, the first one is sent. */
export const AUTOMATION_IDS = ["recap", "continue", "missyou", "comeback", "onboarding", "classics"] as const;
export type AutomationId = (typeof AUTOMATION_IDS)[number];

/** Days between two promotional emails to the same account. */
export const SPACING_DAYS = 7;
/** At most this many automatic emails an hour, so the SMTP provider's limits hold. */
const MAX_PER_RUN = 400;
const SEND_GAP_MS = config.isTest ? 0 : 250;

type Rule = {
  /** SELECT u.id, u.email, u.name, u."emailVerified" AS verified, <ref> AS ref FROM "user" u ... ($1 = days). */
  sql: string;
};

type Automation = {
  name: string;
  template: TemplateId;
  /** What starts it, for the admin page; {days} is replaced. */
  trigger: string;
  /** Default of the rule's days, or null when the rule has none. */
  days: number | null;
  daysChoices?: number[];
  rule: Rule;
};

/** When the reader last read (or, if they never did, signed up). */
const LAST_SEEN = `COALESCE((SELECT max(r.hour) FROM reading_activity r WHERE r.user_id = u.id), u."createdAt")`;

export const AUTOMATIONS: Record<AutomationId, Automation> = {
  recap: {
    name: "Your reading year",
    template: "recap",
    trigger: "Each December, to everyone who read this year. Once a year.",
    days: null,
    rule: {
      sql: `SELECT u.id, u.email, u.name, u."emailVerified" AS verified, to_char(now(), 'YYYY') AS ref FROM "user" u
             WHERE extract(month FROM now()) = 12
               AND EXISTS (SELECT 1 FROM reading_activity r WHERE r.user_id = u.id AND r.hour >= date_trunc('year', now()))
               AND $1::int IS NOT NULL`,
    },
  },
  continue: {
    name: "Continue reading",
    template: "continue",
    trigger: "A book left halfway with nothing read for {days} days. Once per book.",
    days: 14,
    daysChoices: [7, 14, 21, 30],
    rule: {
      // Only books opened in the last four months: no reminders about something from years ago.
      sql: `SELECT u.id, u.email, u.name, u."emailVerified" AS verified, p.book_id::text AS ref FROM "user" u
             JOIN LATERAL (SELECT book_id, percentage, updated_at FROM reading_progress
                            WHERE user_id = u.id AND percentage < ${FINISHED_AT} ORDER BY updated_at DESC LIMIT 1) p ON true
             WHERE p.percentage > 0.01
               AND p.updated_at < now() - make_interval(days => $1)
               AND p.updated_at > now() - interval '120 days'
               AND NOT EXISTS (SELECT 1 FROM reading_activity r WHERE r.user_id = u.id AND r.hour > now() - make_interval(days => $1))`,
    },
  },
  missyou: {
    name: "We miss you",
    template: "missyou",
    trigger: "{days} days without reading. Once per absence.",
    days: 75,
    daysChoices: [45, 60, 75, 90, 120],
    rule: {
      sql: `SELECT u.id, u.email, u.name, u."emailVerified" AS verified, to_char(s.last, 'YYYY-MM-DD') AS ref FROM "user" u
             CROSS JOIN LATERAL (SELECT ${LAST_SEEN} AS last) s
             WHERE s.last < now() - make_interval(days => $1)`,
    },
  },
  comeback: {
    name: "We kept your place",
    template: "comeback",
    trigger: "{days} days without reading, for readers who had started. Once per absence.",
    days: 30,
    daysChoices: [14, 21, 30, 45],
    rule: {
      // Only shortly after the absence starts; longer ones get "We miss you".
      sql: `SELECT u.id, u.email, u.name, u."emailVerified" AS verified, to_char(s.last, 'YYYY-MM-DD') AS ref FROM "user" u
             CROSS JOIN LATERAL (SELECT max(r.hour) AS last FROM reading_activity r WHERE r.user_id = u.id) s
             WHERE s.last < now() - make_interval(days => $1)
               AND s.last > now() - make_interval(days => $1 + 30)`,
    },
  },
  onboarding: {
    name: "Upload and share",
    template: "share",
    trigger: "{days} days after signing up, to accounts that haven't uploaded a book. Once per account.",
    days: 1,
    daysChoices: [1, 2, 3, 7],
    rule: {
      // Uploaded: books added from a share link or the Public Library (shared_at) don't count.
      sql: `SELECT u.id, u.email, u.name, u."emailVerified" AS verified, 'once' AS ref FROM "user" u
             WHERE u."createdAt" < now() - make_interval(days => $1)
               AND u."createdAt" > now() - make_interval(days => $1 + 14)
               AND NOT EXISTS (SELECT 1 FROM book b WHERE b.user_id = u.id AND b.shared_at IS NULL)`,
    },
  },
  classics: {
    name: "New on the shelves",
    template: "classics",
    trigger: "When classics with covers were added to the Public Library in the last 7 days, to everyone. At most once a week.",
    days: null,
    rule: {
      sql: `SELECT u.id, u.email, u.name, u."emailVerified" AS verified, to_char(now(), 'IYYY-IW') AS ref FROM "user" u
             WHERE EXISTS (SELECT 1 FROM catalog_book c JOIN book b ON b.id = c.book_id
                            WHERE b.is_public AND b.has_cover AND c.imported_at > now() - interval '7 days')
               AND $1::int IS NOT NULL`,
    },
  },
};

/** The rule's readers who may receive it now: not unsubscribed, blocked, recently emailed or already sent this. */
function candidatesSql(id: AutomationId, limit: number | null) {
  return `SELECT c.id, c.email, c.name, c.ref FROM (${AUTOMATIONS[id].rule.sql}) c
           WHERE NOT EXISTS (SELECT 1 FROM account_admin ad WHERE ad.user_id = c.id AND ad.blocked)
             AND NOT EXISTS (SELECT 1 FROM email_opt_out o WHERE o.user_id = c.id)
             AND ($2::boolean = false OR c.verified)
             AND NOT EXISTS (SELECT 1 FROM email_send_log l WHERE l.user_id = c.id AND l.sent_at > now() - interval '${SPACING_DAYS} days')
             AND NOT EXISTS (SELECT 1 FROM email_send_log l WHERE l.user_id = c.id AND l.kind = $3 AND l.ref = c.ref)
           ${limit ? `LIMIT ${limit}` : ""}`;
}

type Settings = { enabled: boolean; days: number | null; content: CampaignContent | null; updatedAt: Date | null };

async function loadSettings() {
  const { rows } = await query<{ id: string; enabled: boolean; days: number | null; content: CampaignContent | null; updated_at: Date }>(
    `SELECT id, enabled, days, content, updated_at FROM email_automation`,
  );
  const map = new Map(rows.map((r) => [r.id, { enabled: r.enabled, days: r.days, content: r.content, updatedAt: r.updated_at }]));
  return (id: AutomationId): Settings => map.get(id) ?? { enabled: false, days: null, content: null, updatedAt: null };
}

const effectiveDays = (id: AutomationId, s: Settings) => s.days ?? AUTOMATIONS[id].days ?? 0;
const effectiveContent = (id: AutomationId, s: Settings) => s.content ?? TEMPLATES[AUTOMATIONS[id].template].defaults;

/** Whether the current hour (UTC) is inside EMAIL_AUTOMATION_HOURS. */
export function inSendingHours(now = new Date()) {
  const { from, to } = config.automationHours;
  const h = now.getUTCHours();
  return from < to ? h >= from && h < to : h >= from || h < to;
}

/** The automations with their settings, how many readers each would reach now, and how they did in the last 30 days. */
export async function listAutomations() {
  const settings = await loadSettings();
  const { rows: stats } = await query<{ kind: string; sent: string; returned: string; last: Date | null }>(
    `SELECT l.kind,
            count(*) AS sent,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM reading_activity r WHERE r.user_id = l.user_id
                                           AND r.hour > l.sent_at AND r.hour < l.sent_at + interval '7 days')) AS returned,
            max(l.sent_at) AS last
       FROM email_send_log l
      WHERE l.kind = ANY($1) AND l.sent_at > now() - interval '30 days'
      GROUP BY l.kind`,
    [[...AUTOMATION_IDS]],
  );
  const byKind = new Map(stats.map((s) => [s.kind, s]));
  return Promise.all(
    AUTOMATION_IDS.map(async (id) => {
      const a = AUTOMATIONS[id];
      const s = settings(id);
      const days = effectiveDays(id, s);
      const { rows } = await query<{ n: string }>(`SELECT count(*) AS n FROM (${candidatesSql(id, null)}) x`, [days, config.requireEmailVerification, id]);
      const st = byKind.get(id);
      return {
        id,
        name: a.name,
        template: a.template,
        trigger: a.trigger,
        enabled: s.enabled,
        days: a.days === null ? null : days,
        daysChoices: a.daysChoices ?? [],
        content: effectiveContent(id, s),
        customized: s.content !== null,
        waiting: Number(rows[0]!.n),
        sent30: Number(st?.sent ?? 0),
        returned30: Number(st?.returned ?? 0),
        lastSentAt: st?.last ?? null,
      };
    }),
  );
}

export async function updateAutomation(id: AutomationId, change: { enabled?: boolean; days?: number | null; content?: CampaignContent | null }, adminId: string) {
  await query(
    `INSERT INTO email_automation (id, enabled, days, content, updated_by, updated_at)
     VALUES ($1, COALESCE($2, false), $3, $4, $5, now())
     ON CONFLICT (id) DO UPDATE SET
       enabled = COALESCE($2, email_automation.enabled),
       days = CASE WHEN $6 THEN $3 ELSE email_automation.days END,
       content = CASE WHEN $7 THEN $4::jsonb ELSE email_automation.content END,
       updated_by = $5, updated_at = now()`,
    [
      id,
      change.enabled ?? null,
      change.days ?? null,
      change.content === undefined || change.content === null ? null : JSON.stringify(change.content),
      adminId,
      change.days !== undefined,
      change.content !== undefined,
    ],
  );
  audit("email_automation_updated", { automation: id, by: adminId, enabled: change.enabled, days: change.days, content: change.content !== undefined });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One pass: sends what is due. `anyHour` skips the sending-hours check (tests). Returns how many
 * emails went out, per automation.
 */
export async function runAutomations({ anyHour = false } = {}) {
  const result: Partial<Record<AutomationId, number>> = {};
  if (config.isProd && !mailEnabled) return result;
  if (!anyHour && !inSendingHours()) return result;
  if (campaignRunning()) return result;

  // One server at a time (a second API instance, or an overlapping run, skips this hour).
  const lock = await pool.connect();
  try {
    const { rows } = await lock.query<{ ok: boolean }>("SELECT pg_try_advisory_lock(727275) AS ok");
    if (!rows[0]!.ok) return result;
    try {
      const settings = await loadSettings();
      const picked = new Set<string>();
      let total = 0;
      for (const id of AUTOMATION_IDS) {
        const s = settings(id);
        if (!s.enabled || total >= MAX_PER_RUN) continue;
        const a = AUTOMATIONS[id];
        const content = effectiveContent(id, s);
        const { rows: due } = await query<Recipient & { ref: string }>(candidatesSql(id, MAX_PER_RUN - total), [
          effectiveDays(id, s),
          config.requireEmailVerification,
          id,
        ]);
        if (!due.length) continue;
        const shared = await sharedData(a.template);
        for (const r of due) {
          if (picked.has(r.id)) continue;
          picked.add(r.id);
          // Claimed before sending: a crash mid-way never sends it twice.
          const claim = await query<{ id: string }>(
            `INSERT INTO email_send_log (user_id, kind, ref) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id`,
            [r.id, id, r.ref],
          );
          const logId = claim.rows[0]?.id;
          if (!logId) continue;
          try {
            if (await sendTemplateTo(a.template, content, r, shared)) {
              result[id] = (result[id] ?? 0) + 1;
              total++;
            } else {
              await query(`DELETE FROM email_send_log WHERE id = $1`, [logId]);
            }
          } catch (err) {
            // Tried again next hour.
            await query(`DELETE FROM email_send_log WHERE id = $1`, [logId]);
            log.warn({ err, automation: id }, "automatic email could not be sent");
          }
          if (SEND_GAP_MS) await sleep(SEND_GAP_MS);
        }
      }
      if (total) audit("email_automations_sent", { ...result, total });
    } finally {
      await lock.query("SELECT pg_advisory_unlock(727275)");
    }
  } finally {
    lock.release();
  }
  return result;
}

/** Started with the server: a pass every hour (the first a couple of minutes after startup). */
export function scheduleAutomations() {
  if (config.isTest) return;
  const run = () => runAutomations().catch((err) => log.error({ err }, "automatic emails failed"));
  setTimeout(run, 2 * 60 * 1000).unref();
  setInterval(run, 60 * 60 * 1000).unref();
}
