// Points Stripe at a BookRaven site: creates the webhook endpoint the paid storage plans need
// (README → Paid storage plans) and prints its signing secret, for STRIPE_WEBHOOK_SECRET.
// An endpoint already there for the same address is replaced (Stripe only shows a signing secret
// when the endpoint is created). Products, prices and the customer portal need no setup: the API
// creates them on first use.
//
//   STRIPE_SECRET_KEY=sk_... node infra/stripe-setup.mjs https://books.example.com [SECRET_FILE]
//
// With SECRET_FILE the signing secret is written there instead of printed.
import { writeFileSync } from "node:fs";

const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
const site = (process.argv[2] ?? "").replace(/\/$/, "");
const out = process.argv[3];
if (!key || !/^https:\/\//.test(site)) {
  console.error("usage: STRIPE_SECRET_KEY=sk_... node infra/stripe-setup.mjs https://your.site [SECRET_FILE]");
  process.exit(2);
}

const EVENTS = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"];
const url = `${site}/api/billing/webhook`;

async function stripe(method, path, params = []) {
  const body = new URLSearchParams(params);
  const res = await fetch(`https://api.stripe.com/v1${path}${method === "GET" && body.size ? `?${body}` : ""}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: method === "POST" ? body : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Stripe ${method} ${path}: ${json.error?.message ?? res.status}`);
  return json;
}

// A restricted key may not read the account: its name is only shown when it can.
const account = await stripe("GET", "/account").catch(() => null);
const mode = key.startsWith("sk_live") || key.startsWith("rk_live") ? "live" : "test";
console.log(`stripe-setup: ${account ? `account ${account.settings?.dashboard?.display_name ?? account.id}, ` : ""}${mode} mode`);

const { data } = await stripe("GET", "/webhook_endpoints", [["limit", "100"]]);
for (const old of data.filter((e) => e.url === url)) {
  await stripe("DELETE", `/webhook_endpoints/${old.id}`);
  console.log(`stripe-setup: removed the old endpoint ${old.id}`);
}
const endpoint = await stripe("POST", "/webhook_endpoints", [
  ["url", url],
  ["description", "BookRaven storage plans"],
  ...EVENTS.map((e) => ["enabled_events[]", e]),
]);
console.log(`stripe-setup: webhook ${endpoint.id} → ${url}`);
if (out) {
  writeFileSync(out, endpoint.secret, { mode: 0o600 });
  console.log(`stripe-setup: signing secret written to ${out}`);
} else {
  console.log(`STRIPE_WEBHOOK_SECRET=${endpoint.secret}`);
}
