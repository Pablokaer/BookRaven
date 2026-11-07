import { createHmac, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { config } from "../config.js";
import { pool, query } from "../db.js";
import { log } from "./log.js";

/**
 * Paid storage plans, sold with Stripe subscriptions. Prices include VAT (Stripe prices with
 * tax_behavior "inclusive"). A plan sets the account's storage limit while its subscription is
 * active; the free limit (UPLOAD_QUOTA_MB) applies otherwise.
 *
 * The Stripe prices are created on first use, under a lookup key that names the plan, the
 * interval and the amount (bookraven_<plan>_<interval>_<cents>): no setup in Stripe's dashboard,
 * and a new price here makes a new Stripe price (existing subscribers keep theirs until they
 * change plan).
 */
export const PLANS = [
  { id: "shelf", name: "Shelf", gb: 2, month: 399, year: 3990 },
  { id: "reader", name: "Reader", gb: 5, month: 599, year: 5990 },
  { id: "library", name: "Library", gb: 10, month: 799, year: 7990 },
] as const;

export type PlanId = (typeof PLANS)[number]["id"];
export type Interval = "month" | "year";
export const CURRENCY = "eur";

export const billingEnabled = Boolean(config.stripe.secretKey && config.stripe.webhookSecret);

/** Statuses in which the plan's storage is given: paid, or a payment being retried. */
const ACTIVE = new Set(["active", "trialing", "past_due"]);

export const planById = (id: string | null | undefined) => PLANS.find((p) => p.id === id);
export const planBytes = (gb: number) => gb * 1024 * 1024 * 1024;

/** The storage a subscription gives, in bytes (0 when none or not active). */
export function subscriptionBytes(row: { plan: string | null; status: string | null } | null | undefined) {
  const plan = row && ACTIVE.has(row.status ?? "") ? planById(row.plan) : undefined;
  return plan ? planBytes(plan.gb) : 0;
}

export const lookupKey = (plan: PlanId, interval: Interval, cents: number) => `bookraven_${plan}_${interval}_${cents}`;

/** The plan and interval of a Stripe price, from its lookup key. */
export function fromLookupKey(key: string | null | undefined): { plan: PlanId; interval: Interval } | null {
  const m = /^bookraven_([a-z]+)_(month|year)_\d+$/.exec(key ?? "");
  const plan = m && planById(m[1]);
  return plan ? { plan: plan.id, interval: m![2] as Interval } : null;
}

export class StripeError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Stripe's form encoding: nested objects and arrays as a[b][0]=… */
function form(params: Record<string, unknown>, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}

/** A call to Stripe's API (https://api.stripe.com/v1). */
export async function stripe<T = Record<string, unknown>>(method: "GET" | "POST" | "DELETE", path: string, params: Record<string, unknown> = {}): Promise<T> {
  const body = form(params);
  const url = `https://api.stripe.com/v1${path}${method === "GET" && body.size ? `?${body}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${config.stripe.secretKey}`,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method === "POST" ? body : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) throw new StripeError(res.status, json.error?.message ?? `Stripe answered ${res.status}`);
  return json as T;
}

const priceIds = new Map<string, string>();

/** The id of the Stripe price for a plan and interval, created the first time it is needed. */
export async function priceFor(planId: PlanId, interval: Interval) {
  const plan = planById(planId)!;
  const cents = plan[interval];
  const key = lookupKey(plan.id, interval, cents);
  const known = priceIds.get(key);
  if (known) return known;
  const found = await stripe<{ data: { id: string }[] }>("GET", "/prices", { active: true, lookup_keys: [key] });
  const id =
    found.data[0]?.id ??
    (
      await stripe<{ id: string }>("POST", "/prices", {
        currency: CURRENCY,
        unit_amount: cents,
        recurring: { interval },
        tax_behavior: "inclusive",
        lookup_key: key,
        product_data: { name: `BookRaven ${plan.name} (${plan.gb} GB)` },
        metadata: { plan: plan.id },
      })
    ).id;
  priceIds.set(key, id);
  return id;
}

export type BillingRow = {
  user_id: string;
  stripe_customer_id: string;
  subscription_id: string | null;
  plan: string | null;
  billing_interval: Interval | null;
  status: string | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
};

export async function billingRow(userId: string, client: pg.PoolClient | pg.Pool = pool) {
  const { rows } = await client.query<BillingRow>("SELECT * FROM billing WHERE user_id = $1", [userId]);
  return rows[0] ?? null;
}

/** The account's Stripe customer, created on its first checkout. */
export async function customerFor(user: { id: string; email: string; name?: string | null }) {
  const row = await billingRow(user.id);
  if (row) return row.stripe_customer_id;
  const customer = await stripe<{ id: string }>("POST", "/customers", { email: user.email, name: user.name || undefined, metadata: { user_id: user.id } });
  const { rows } = await query<{ stripe_customer_id: string }>(
    `INSERT INTO billing (user_id, stripe_customer_id) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING stripe_customer_id`,
    [user.id, customer.id],
  );
  return rows[0]!.stripe_customer_id;
}

type StripeSubscription = {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items: { data: { current_period_end?: number; price: { lookup_key: string | null } }[] };
};

/**
 * Stores a subscription as Stripe has it now. Fetching it (instead of trusting the event's copy)
 * keeps the row right when Stripe's events arrive late or out of order. Returns the account it
 * belongs to, or null when no account has that customer.
 */
export async function syncSubscription(subscriptionId: string) {
  const sub = await stripe<StripeSubscription>("GET", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  const item = sub.items.data[0];
  const price = fromLookupKey(item?.price.lookup_key);
  const end = sub.current_period_end ?? item?.current_period_end;
  const ended = sub.status === "canceled" || sub.status === "incomplete_expired";
  const { rows } = await query<{ user_id: string }>(
    // A canceled subscription only clears the row if it is still the account's current one: a
    // customer who changed plans by subscribing again keeps the newer subscription.
    `UPDATE billing SET
       subscription_id = CASE WHEN $7 AND subscription_id IS DISTINCT FROM $2 THEN subscription_id ELSE $2 END,
       plan = CASE WHEN $7 AND subscription_id IS DISTINCT FROM $2 THEN plan ELSE $3 END,
       billing_interval = CASE WHEN $7 AND subscription_id IS DISTINCT FROM $2 THEN billing_interval ELSE $4 END,
       status = CASE WHEN $7 AND subscription_id IS DISTINCT FROM $2 THEN status ELSE $5 END,
       current_period_end = CASE WHEN $7 AND subscription_id IS DISTINCT FROM $2 THEN current_period_end ELSE $6 END,
       cancel_at_period_end = CASE WHEN $7 AND subscription_id IS DISTINCT FROM $2 THEN cancel_at_period_end ELSE $8 END,
       updated_at = now()
     WHERE stripe_customer_id = $1
     RETURNING user_id`,
    [sub.customer, sub.id, price?.plan ?? null, price?.interval ?? null, sub.status, end ? new Date(end * 1000) : null, ended, sub.cancel_at_period_end],
  );
  if (!rows[0]) log.warn({ customer: sub.customer, subscription: sub.id }, "billing: subscription of an unknown customer");
  return rows[0]?.user_id ?? null;
}

/** Ends an account's subscription right away (the account is being deleted). Never throws. */
export async function cancelBilling(userId: string) {
  if (!billingEnabled) return;
  const row = await billingRow(userId).catch(() => null);
  if (!row?.subscription_id || row.status === "canceled") return;
  await stripe("DELETE", `/subscriptions/${encodeURIComponent(row.subscription_id)}`).catch((err) =>
    log.error({ err, userId, subscription: row.subscription_id }, "billing: could not cancel the subscription of a deleted account"),
  );
}

/**
 * Checks a webhook's Stripe-Signature header (t=…,v1=…) against the raw body: HMAC-SHA256 of
 * "t.body" with the endpoint's secret, at most 5 minutes old.
 */
export function verifyWebhook(rawBody: string, header: string | undefined, secret = config.stripe.webhookSecret, now = Date.now()) {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  return parts.some(([k, v]) => {
    if (k !== "v1" || !v) return false;
    const got = Buffer.from(v, "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}
