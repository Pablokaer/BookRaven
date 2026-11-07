import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { config, isAdmin } from "../config.js";
import {
  billingEnabled,
  billingRow,
  CURRENCY,
  customerFor,
  type Interval,
  PLANS,
  type PlanId,
  priceFor,
  StripeError,
  stripe,
  subscriptionBytes,
  syncSubscription,
  verifyWebhook,
} from "../lib/billing.js";
import { audit, log } from "../lib/log.js";
import { quotaFor } from "../lib/quota.js";

const planIds = PLANS.map((p) => p.id);
const choice = {
  type: "object",
  additionalProperties: false,
  required: ["plan", "interval"],
  properties: { plan: { type: "string", enum: planIds }, interval: { type: "string", enum: ["month", "year"] } },
} as const;

/** Where Stripe's pages send the reader back: the profile, in the web app. */
const profileUrl = (result?: string) => `${config.publicUrl}/profile${result ? `?billing=${result}` : ""}#plans`;

export async function billingRoutes(app: FastifyInstance) {
  // Stripe's webhook, in a context of its own that keeps the raw body for the signature check.
  await app.register(async (hook) => {
    hook.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));
    hook.post("/api/billing/webhook", async (request, reply) => {
      if (!billingEnabled) return reply.code(404).send({ error: "not_found" });
      const raw = String(request.body ?? "");
      if (!verifyWebhook(raw, request.headers["stripe-signature"] as string | undefined)) {
        audit("billing.webhook_refused", { ip: request.ip }, "warn");
        return reply.code(400).send({ error: "bad_signature" });
      }
      const event = JSON.parse(raw) as { id: string; type: string; data: { object: { id?: string; subscription?: string | null; mode?: string } } };
      const obj = event.data.object;
      const subscriptionId =
        event.type.startsWith("customer.subscription.") ? obj.id : event.type === "checkout.session.completed" && obj.mode === "subscription" ? obj.subscription : null;
      if (subscriptionId) {
        // A failure answers 500, and Stripe sends the event again later.
        const userId = await syncSubscription(subscriptionId);
        if (userId) audit("billing.subscription_synced", { userId, event: event.type, eventId: event.id });
      }
      return { received: true };
    });
  });

  await app.register(async (user) => {
    user.addHook("preHandler", requireUser);

    /** The plans on sale and the account's own subscription. */
    user.get("/api/billing", async (request) => {
      const row = billingEnabled ? await billingRow(request.user.id) : null;
      const active = subscriptionBytes(row) > 0;
      return {
        enabled: billingEnabled && !isAdmin(request.user),
        currency: CURRENCY,
        freeBytes: config.quotaBytes,
        quotaBytes: await quotaFor(request.user),
        plans: PLANS.map((p) => ({ id: p.id, name: p.name, bytes: p.gb * 1024 ** 3, month: p.month, year: p.year })),
        subscription:
          row?.subscription_id && row.status && row.status !== "canceled" && row.status !== "incomplete_expired"
            ? {
                plan: row.plan,
                interval: row.billing_interval,
                status: row.status,
                active,
                renewsAt: row.current_period_end?.toISOString() ?? null,
                cancelAtPeriodEnd: row.cancel_at_period_end,
              }
            : null,
      };
    });

    /** Stripe Checkout for a new subscription: answers the page to open. */
    user.post<{ Body: { plan: PlanId; interval: Interval } }>(
      "/api/billing/checkout",
      { schema: { body: choice }, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
      async (request, reply) => {
        if (!billingEnabled || isAdmin(request.user)) return reply.code(404).send({ error: "not_found" });
        const row = await billingRow(request.user.id);
        if (subscriptionBytes(row) > 0 || row?.status === "incomplete") return reply.code(409).send({ error: "already_subscribed" });
        try {
          const customer = await customerFor(request.user);
          const session = await stripe<{ url: string }>("POST", "/checkout/sessions", {
            mode: "subscription",
            customer,
            client_reference_id: request.user.id,
            line_items: [{ price: await priceFor(request.body.plan, request.body.interval), quantity: 1 }],
            subscription_data: { metadata: { user_id: request.user.id } },
            success_url: profileUrl("success"),
            cancel_url: profileUrl("canceled"),
            ...(config.stripe.automaticTax ? { automatic_tax: { enabled: true }, customer_update: { address: "auto" } } : {}),
          });
          audit("billing.checkout_started", { userId: request.user.id, plan: request.body.plan, interval: request.body.interval, ip: request.ip });
          return { url: session.url };
        } catch (err) {
          log.error({ err, userId: request.user.id }, "billing: could not open the checkout");
          return reply.code(502).send({ error: "billing_unavailable" });
        }
      },
    );

    /** Moves the subscription to another plan or interval, prorated (upgrades are charged now). */
    user.post<{ Body: { plan: PlanId; interval: Interval } }>(
      "/api/billing/change",
      { schema: { body: choice }, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
      async (request, reply) => {
        if (!billingEnabled || isAdmin(request.user)) return reply.code(404).send({ error: "not_found" });
        const row = await billingRow(request.user.id);
        if (!row?.subscription_id || subscriptionBytes(row) === 0) return reply.code(409).send({ error: "no_subscription" });
        if (row.plan === request.body.plan && row.billing_interval === request.body.interval) return reply.code(204).send();
        try {
          const sub = await stripe<{ items: { data: { id: string }[] } }>("GET", `/subscriptions/${encodeURIComponent(row.subscription_id)}`);
          await stripe("POST", `/subscriptions/${encodeURIComponent(row.subscription_id)}`, {
            items: [{ id: sub.items.data[0]!.id, price: await priceFor(request.body.plan, request.body.interval) }],
            proration_behavior: "always_invoice",
            cancel_at_period_end: false,
          });
          await syncSubscription(row.subscription_id);
          audit("billing.plan_changed", { userId: request.user.id, from: row.plan, plan: request.body.plan, interval: request.body.interval, ip: request.ip });
          return reply.code(204).send();
        } catch (err) {
          log.error({ err, userId: request.user.id }, "billing: could not change the plan");
          return reply.code(err instanceof StripeError && err.status === 402 ? 402 : 502).send({ error: err instanceof StripeError && err.status === 402 ? "payment_failed" : "billing_unavailable" });
        }
      },
    );

    /** Stripe's customer portal (payment method, invoices, cancelling): answers the page to open. */
    user.post("/api/billing/portal", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
      if (!billingEnabled) return reply.code(404).send({ error: "not_found" });
      const row = await billingRow(request.user.id);
      if (!row) return reply.code(409).send({ error: "no_subscription" });
      try {
        const session = await stripe<{ url: string }>("POST", "/billing_portal/sessions", { customer: row.stripe_customer_id, return_url: profileUrl() });
        return { url: session.url };
      } catch (err) {
        log.error({ err, userId: request.user.id }, "billing: could not open the customer portal");
        return reply.code(502).send({ error: "billing_unavailable" });
      }
    });
  });
}
