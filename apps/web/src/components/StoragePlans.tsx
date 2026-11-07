import { Check, CreditCard, HardDrive } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { API_BASE, ApiError, apiJson, apiOk, isNative } from "../lib/api";
import { fileSize } from "../lib/format";
import { useLibrary } from "../lib/libraryStore";
import { plansHidden as playStore } from "../lib/upgrade";

type Interval = "month" | "year";
type Plan = { id: string; name: string; bytes: number; month: number; year: number };
export type Billing = {
  enabled: boolean;
  currency: string;
  freeBytes: number;
  quotaBytes: number | null;
  plans: Plan[];
  subscription: {
    plan: string | null;
    interval: Interval | null;
    status: string;
    active: boolean;
    renewsAt: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
};


const money = (cents: number, currency: string) => new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

const ERRORS: Record<string, string> = {
  already_subscribed: "You already have a plan: change it below.",
  no_subscription: "You have no plan to change.",
  payment_failed: "The payment didn't go through. Check your card in “Manage billing”.",
};

/**
 * Paid storage plans (Profile → Storage plans): the plans on sale, monthly or yearly, Stripe
 * Checkout for a first plan, a prorated change between plans, and Stripe's portal for the card,
 * invoices and cancelling. Shown when the server sells plans (STRIPE_* set).
 */
export function StoragePlans() {
  const { refreshMe } = useLibrary();
  const [billing, setBilling] = useState<Billing | null>(null);
  const [interval, setPeriod] = useState<Interval>("month");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => apiJson<Billing>("/api/billing").then((b) => {
    setBilling(b);
    if (b.subscription?.interval) setPeriod(b.subscription.interval);
    return b;
  });

  useEffect(() => {
    if (playStore) return;
    const result = new URLSearchParams(window.location.search).get("billing");
    if (result === "canceled") setMessage({ ok: false, text: "Checkout cancelled: nothing was charged." });
    load()
      .then(async (b) => {
        if (result !== "success") return;
        setMessage({ ok: true, text: "Thank you! Your plan is being activated…" });
        // Stripe tells the server in a few seconds: look again until the plan shows up.
        for (let i = 0; i < 10 && !b.subscription?.active; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          b = await load();
        }
        refreshMe();
        setMessage(b.subscription?.active ? { ok: true, text: "Thank you! Your plan is active: enjoy the extra space." } : { ok: true, text: "Thank you! Your plan will be active in a moment." });
      })
      .catch(() => {});
    if (result) window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  }, []);

  // Opened from an Upgrade button (/profile#plans), also when already on the profile: bring the
  // plans into view once drawn.
  const { hash, key } = useLocation();
  const drawn = Boolean(billing?.enabled);
  useEffect(() => {
    if (drawn && hash === "#plans") requestAnimationFrame(() => document.getElementById("plans")?.scrollIntoView({ behavior: "smooth" }));
  }, [drawn, hash, key]);

  if (playStore || !billing?.enabled) return null;

  if (isNative) {
    return (
      <section id="plans" className="surface p-6">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <HardDrive className="h-4 w-4 text-accent" /> Need more space?
        </h2>
        <p className="mt-1 text-xs text-muted">
          Storage plans from {money(billing.plans[0]!.month, billing.currency)} a month are available on{" "}
          <a className="text-accent hover:underline" href={`${API_BASE}/profile#plans`} target="_blank" rel="noreferrer">
            BookRaven's website
          </a>
          .
        </p>
      </section>
    );
  }

  const sub = billing.subscription;
  const current = sub?.active ? sub : null;

  const go = async (path: string, body?: unknown, key = path) => {
    setBusy(key);
    setMessage(null);
    try {
      if (path === "/api/billing/change") {
        await apiOk(path, { method: "POST", body: JSON.stringify(body) });
        await load();
        refreshMe();
        setMessage({ ok: true, text: "Plan changed." });
      } else {
        const { url } = await apiJson<{ url: string }>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
        window.location.assign(url);
        return; // leaving for Stripe's page
      }
    } catch (err) {
      const code = err instanceof ApiError ? err.body?.error : null;
      setMessage({ ok: false, text: ERRORS[code] ?? "Payments are not available right now. Try again in a moment." });
    }
    setBusy(null);
  };

  const choose = (plan: Plan) => {
    const body = { plan: plan.id, interval };
    if (!current) return go("/api/billing/checkout", body, plan.id);
    const now = billing.plans.find((p) => p.id === current.plan);
    const verb = now && plan.bytes < now.bytes ? "Move down" : "Move up";
    if (!window.confirm(`${verb} to ${plan.name} (${fileSize(plan.bytes)}) for ${money(plan[interval], billing.currency)} a ${interval}? The difference is prorated on your card.`)) return;
    return go("/api/billing/change", body, plan.id);
  };

  return (
    <section id="plans" className="surface p-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="mr-auto">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <HardDrive className="h-4 w-4 text-accent" /> Storage plans
          </h2>
          <p className="mt-1 text-xs text-muted">
            {current
              ? `Your ${billing.plans.find((p) => p.id === current.plan)?.name ?? ""} plan: ${current.cancelAtPeriodEnd ? "ends" : "renews"} on ${current.renewsAt ? day(current.renewsAt) : "–"}.`
              : `Free accounts keep up to ${fileSize(billing.freeBytes)} of books. Need more room? Prices include VAT; cancel any time.`}
            {sub?.status === "past_due" && " Your last payment failed: update your card to keep the plan."}
          </p>
        </div>
        <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-md border border-line p-0.5 text-xs">
          {(["month", "year"] as const).map((i) => (
            <button
              key={i}
              role="radio"
              aria-checked={interval === i}
              className={`rounded px-3 py-1.5 transition ${interval === i ? "bg-gold/15 text-fg" : "text-muted hover:text-fg"}`}
              onClick={() => setPeriod(i)}
            >
              {i === "month" ? "Monthly" : "Yearly · 2 months free"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {billing.plans.map((plan) => {
          const mine = current?.plan === plan.id && current.interval === interval;
          return (
            <div key={plan.id} className={`flex flex-col rounded-lg border p-4 ${mine ? "border-gold/60 bg-gold/5" : "border-line"}`}>
              <div className="text-sm font-medium">{plan.name}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{fileSize(plan.bytes)}</div>
              <div className="mt-1 text-sm text-muted">
                <span className="text-fg">{money(plan[interval], billing.currency)}</span> / {interval}
                {interval === "year" && <span className="block text-xs">{money(Math.round(plan.year / 12), billing.currency)} a month</span>}
              </div>
              <button
                className={`mt-4 ${mine ? "btn-outline" : "btn"} w-full`}
                disabled={mine || busy !== null}
                onClick={() => void choose(plan)}
              >
                {mine ? (
                  <>
                    <Check className="h-4 w-4" /> Your plan
                  </>
                ) : busy === plan.id ? (
                  "Please wait…"
                ) : current ? (
                  "Switch"
                ) : (
                  "Choose"
                )}
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {sub && (
          <button className="btn-outline" disabled={busy !== null} onClick={() => void go("/api/billing/portal")}>
            <CreditCard className="h-4 w-4" /> {busy === "/api/billing/portal" ? "Opening…" : "Manage billing"}
          </button>
        )}
        {message && <p className={`text-sm ${message.ok ? "text-accent" : "text-rose-300"}`}>{message.text}</p>}
      </div>
      <p className="mt-3 text-xs text-muted">Payments are handled by Stripe. Cancelling keeps your books; you just can't add more while you're over the free limit.</p>
    </section>
  );
}
