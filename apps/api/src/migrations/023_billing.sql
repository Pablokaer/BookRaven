-- Paid storage plans (Stripe). One row per account that ever opened the checkout: its Stripe
-- customer, and its subscription as Stripe last reported it (webhook). The plan raises the
-- account's storage limit while the subscription is active (apps/api/src/lib/billing.ts).
CREATE TABLE billing (
  user_id              text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  stripe_customer_id   text NOT NULL UNIQUE,
  subscription_id      text UNIQUE,
  plan                 text,
  billing_interval     text CHECK (billing_interval IN ('month', 'year')),
  status               text,
  current_period_end   timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
