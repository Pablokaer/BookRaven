import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Paid plans on, for this file only (config.ts reads the keys once, when it is first imported).
vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
});

const { adminSession, api, getApp, ORIGIN, signUp } = await import("./helpers.js");
const { verifyWebhook } = await import("../src/lib/billing.js");

const GB = 1024 ** 3;

/** A small Stripe: customers, prices by lookup key, subscriptions, and every call made. */
const stripe = {
  calls: [] as { method: string; path: string; body: URLSearchParams }[],
  prices: new Map<string, { id: string; lookup_key: string }>(),
  subs: new Map<string, { id: string; customer: string; status: string; cancel_at_period_end: boolean; price: string }>(),
  n: 0,
};
const priceById = (id: string) => [...stripe.prices.values()].find((p) => p.id === id)!;
const subJson = (s: { id: string; customer: string; status: string; cancel_at_period_end: boolean; price: string }) => ({
  id: s.id,
  customer: s.customer,
  status: s.status,
  cancel_at_period_end: s.cancel_at_period_end,
  items: { data: [{ id: `si_${s.id}`, current_period_end: 1_900_000_000, price: { lookup_key: priceById(s.price).lookup_key } }] },
});

const realFetch = globalThis.fetch;
beforeAll(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.host !== "api.stripe.com") return realFetch(input, init);
    const method = init?.method ?? "GET";
    const path = url.pathname.replace("/v1", "");
    const body = method === "GET" ? url.searchParams : new URLSearchParams(String(init?.body ?? ""));
    stripe.calls.push({ method, path, body });
    const id = (p: string) => `${p}_${++stripe.n}`;
    if (method === "POST" && path === "/customers") return Response.json({ id: id("cus") });
    if (method === "GET" && path === "/prices") {
      const p = stripe.prices.get(body.get("lookup_keys[0]")!);
      return Response.json({ data: p ? [p] : [] });
    }
    if (method === "POST" && path === "/prices") {
      const p = { id: id("price"), lookup_key: body.get("lookup_key")! };
      stripe.prices.set(p.lookup_key, p);
      return Response.json(p);
    }
    if (method === "POST" && path === "/checkout/sessions") return Response.json({ id: id("cs"), url: "https://checkout.stripe.com/c/pay/test" });
    if (method === "GET" && path === "/billing_portal/configurations") return Response.json({ data: [] });
    if (method === "POST" && path === "/billing_portal/configurations") return Response.json({ id: "bpc_1" });
    if (method === "POST" && path === "/billing_portal/sessions") return Response.json({ url: "https://billing.stripe.com/p/session/test" });
    const sub = /^\/subscriptions\/(.+)$/.exec(path);
    const s = sub && stripe.subs.get(decodeURIComponent(sub[1]!));
    if (s && method === "GET") return Response.json(subJson(s));
    if (s && method === "POST") {
      s.price = body.get("items[0][price]") ?? s.price;
      return Response.json(subJson(s));
    }
    if (s && method === "DELETE") {
      s.status = "canceled";
      return Response.json(subJson(s));
    }
    return Response.json({ error: { message: `no mock for ${method} ${path}` } }, { status: 404 });
  });
});
afterAll(() => vi.restoreAllMocks());

/** Sends a signed Stripe event to the webhook. */
async function webhook(event: unknown, secret = "whsec_test") {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return (await getApp()).inject({
    method: "POST",
    url: "/api/billing/webhook",
    headers: { "content-type": "application/json; charset=utf-8", "stripe-signature": `t=${t},v1=${v1}` },
    payload,
  });
}

/** Stripe's side of a finished checkout: a subscription for the customer the app created. */
function subscribe(customer: string, lookupKey: string) {
  const s = { id: `sub_${++stripe.n}`, customer, status: "active", cancel_at_period_end: false, price: stripe.prices.get(lookupKey)!.id };
  stripe.subs.set(s.id, s);
  return s;
}

describe("paid storage plans", () => {
  it("lists the plans, with the free limit, and says they are on sale", async () => {
    expect((await api(null, "GET", "/api/config")).json().billingEnabled).toBe(true);
    const u = await signUp();
    const res = await api(u, "GET", "/api/billing");
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.enabled).toBe(true);
    expect(b.currency).toBe("eur");
    expect(b.freeBytes).toBe(1024 * 1024);
    expect(b.subscription).toBeNull();
    expect(b.plans.map((p: { id: string; bytes: number; month: number; year: number }) => [p.id, p.bytes / GB, p.month, p.year])).toEqual([
      ["shelf", 2, 399, 3990],
      ["reader", 5, 599, 5990],
      ["library", 10, 799, 7990],
    ]);
  });

  it("opens Stripe Checkout, then raises the storage limit when Stripe reports the subscription", async () => {
    const u = await signUp();
    stripe.calls.length = 0;
    const res = await api(u, "POST", "/api/billing/checkout", { plan: "shelf", interval: "month" });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toBe("https://checkout.stripe.com/c/pay/test");

    // The customer carries the account's id; the price is made once, VAT included.
    const customer = stripe.calls.find((c) => c.path === "/customers")!;
    expect(customer.body.get("metadata[user_id]")).toBe(u.id);
    const price = stripe.calls.find((c) => c.method === "POST" && c.path === "/prices")!;
    expect(Object.fromEntries(price.body)).toMatchObject({
      currency: "eur",
      unit_amount: "399",
      "recurring[interval]": "month",
      tax_behavior: "inclusive",
      lookup_key: "bookraven_shelf_month_399",
    });
    const session = stripe.calls.find((c) => c.path === "/checkout/sessions")!;
    expect(session.body.get("mode")).toBe("subscription");
    expect(session.body.get("client_reference_id")).toBe(u.id);
    expect(session.body.get("success_url")).toBe("http://localhost:5173/profile?billing=success#plans");

    // A second checkout reuses the price and the customer.
    stripe.calls.length = 0;
    await api(u, "POST", "/api/billing/checkout", { plan: "shelf", interval: "month" });
    expect(stripe.calls.filter((c) => c.method === "POST" && (c.path === "/prices" || c.path === "/customers"))).toEqual([]);
    const customerId = session.body.get("customer")!;

    // Not paid yet: still the free limit.
    expect((await api(u, "GET", "/api/me")).json().quotaBytes).toBe(1024 * 1024);

    const s = subscribe(customerId, "bookraven_shelf_month_399");
    expect((await webhook({ id: "evt_1", type: "checkout.session.completed", data: { object: { mode: "subscription", subscription: s.id } } })).statusCode).toBe(200);
    expect((await api(u, "GET", "/api/me")).json().quotaBytes).toBe(2 * GB);
    const b = (await api(u, "GET", "/api/billing")).json();
    expect(b.subscription).toMatchObject({ plan: "shelf", interval: "month", status: "active", active: true, cancelAtPeriodEnd: false });
    expect(b.subscription.renewsAt).toBe(new Date(1_900_000_000 * 1000).toISOString());

    // Subscribed: no second subscription, but the plan can change (prorated).
    expect((await api(u, "POST", "/api/billing/checkout", { plan: "library", interval: "year" })).statusCode).toBe(409);
    stripe.calls.length = 0;
    expect((await api(u, "POST", "/api/billing/change", { plan: "library", interval: "year" })).statusCode).toBe(204);
    const update = stripe.calls.find((c) => c.method === "POST" && c.path === `/subscriptions/${s.id}`)!;
    expect(update.body.get("items[0][id]")).toBe(`si_${s.id}`);
    expect(update.body.get("items[0][price]")).toBe(stripe.prices.get("bookraven_library_year_7990")!.id);
    expect(update.body.get("proration_behavior")).toBe("always_invoice");
    expect((await api(u, "GET", "/api/me")).json().quotaBytes).toBe(10 * GB);

    // The customer portal opens on Stripe.
    const portal = await api(u, "POST", "/api/billing/portal");
    expect(portal.json().url).toBe("https://billing.stripe.com/p/session/test");
    // Without a saved configuration in Stripe, the API makes one (cancelling at the period's end).
    const made = stripe.calls.find((c) => c.method === "POST" && c.path === "/billing_portal/configurations")!;
    expect(made.body.get("features[subscription_cancel][mode]")).toBe("at_period_end");
    expect(stripe.calls.find((c) => c.path === "/billing_portal/sessions")!.body.get("configuration")).toBe("bpc_1");

    // Cancelled (from the portal): back to the free limit; the books stay.
    s.status = "canceled";
    await webhook({ id: "evt_2", type: "customer.subscription.deleted", data: { object: { id: s.id } } });
    expect((await api(u, "GET", "/api/me")).json().quotaBytes).toBe(1024 * 1024);
    expect((await api(u, "GET", "/api/billing")).json().subscription).toBeNull();
  });

  it("keeps the storage while a failed payment is retried, and drops it once unpaid", async () => {
    const u = await signUp();
    stripe.calls.length = 0;
    await api(u, "POST", "/api/billing/checkout", { plan: "reader", interval: "year" });
    const customerId = stripe.calls.find((c) => c.path === "/checkout/sessions")!.body.get("customer")!;
    const s = subscribe(customerId, "bookraven_reader_year_5990");
    s.status = "past_due";
    await webhook({ id: "evt_3", type: "customer.subscription.updated", data: { object: { id: s.id } } });
    expect((await api(u, "GET", "/api/me")).json().quotaBytes).toBe(5 * GB);
    s.status = "unpaid";
    await webhook({ id: "evt_4", type: "customer.subscription.updated", data: { object: { id: s.id } } });
    expect((await api(u, "GET", "/api/me")).json().quotaBytes).toBe(1024 * 1024);
  });

  it("refuses webhooks without Stripe's signature", async () => {
    const forged = await webhook({ id: "evt_x", type: "customer.subscription.updated", data: { object: { id: "sub_x" } } }, "whsec_wrong");
    expect(forged.statusCode).toBe(400);
    const unsigned = await (await getApp()).inject({
      method: "POST",
      url: "/api/billing/webhook",
      headers: { "content-type": "application/json", origin: ORIGIN },
      payload: "{}",
    });
    expect(unsigned.statusCode).toBe(400);
    // A signature older than 5 minutes is a replay.
    const t = Math.floor(Date.now() / 1000) - 600;
    const v1 = createHmac("sha256", "whsec_test").update(`${t}.{}`).digest("hex");
    expect(verifyWebhook("{}", `t=${t},v1=${v1}`)).toBe(false);
    expect(verifyWebhook("{}", `t=${t + 600},v1=${createHmac("sha256", "whsec_test").update(`${t + 600}.{}`).digest("hex")}`)).toBe(true);
  });

  it("cancels the subscription of an account an administrator deletes", async () => {
    const u = await signUp();
    stripe.calls.length = 0;
    await api(u, "POST", "/api/billing/checkout", { plan: "shelf", interval: "month" });
    const customerId = stripe.calls.find((c) => c.path === "/checkout/sessions")!.body.get("customer")!;
    const s = subscribe(customerId, "bookraven_shelf_month_399");
    await webhook({ id: "evt_5", type: "customer.subscription.created", data: { object: { id: s.id } } });
    const admin = await adminSession();
    expect((await api(admin, "GET", `/api/admin/users?q=${encodeURIComponent(u.email)}`)).json()[0].plan).toBe("shelf");
    expect((await api(admin, "DELETE", `/api/admin/users/${u.id}`)).statusCode).toBe(204);
    expect(s.status).toBe("canceled");
  });

  it("cancels the subscription of an account its owner deletes", async () => {
    const u = await signUp();
    stripe.calls.length = 0;
    await api(u, "POST", "/api/billing/checkout", { plan: "reader", interval: "month" });
    const customerId = stripe.calls.find((c) => c.path === "/checkout/sessions")!.body.get("customer")!;
    const s = subscribe(customerId, "bookraven_reader_month_599");
    await webhook({ id: "evt_6", type: "customer.subscription.created", data: { object: { id: s.id } } });
    expect((await api(u, "DELETE", "/api/me", { password: "password123" })).statusCode).toBe(204);
    expect(s.status).toBe("canceled");
  });

  it("has nothing to sell to administrators", async () => {
    const admin = await adminSession();
    expect((await api(admin, "GET", "/api/billing")).json().enabled).toBe(false);
    expect((await api(admin, "POST", "/api/billing/checkout", { plan: "shelf", interval: "month" })).statusCode).toBe(404);
  });
});
