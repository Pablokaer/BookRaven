-- Promotional emails sent by administrators (Admin → Emails), and the accounts that said no to them.

-- One row per send: what was sent, to whom (the audience rule, not the list) and how it went.
CREATE TABLE email_campaign (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template    text NOT NULL,
  subject     text NOT NULL,
  -- The edited fields (headline, message, button...) and the picture, as sent.
  content     jsonb NOT NULL,
  -- { segment, days }: who it was for (see apps/api/src/lib/campaigns.ts).
  audience    jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'interrupted')),
  recipients  integer NOT NULL DEFAULT 0,
  sent        integer NOT NULL DEFAULT 0,
  failed      integer NOT NULL DEFAULT 0,
  created_by  text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX email_campaign_created_idx ON email_campaign (created_at DESC);

-- Accounts that unsubscribed from promotional emails (the link in every one of them, or Profile).
-- Account emails (password reset, verification) are still sent.
CREATE TABLE email_opt_out (
  user_id    text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
