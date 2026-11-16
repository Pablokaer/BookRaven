-- Automatic emails (Admin → Emails → Automations): each automation sends one template to readers
-- when something happens (a book left halfway, a long absence...), checked every hour.

-- One row per automation an administrator touched; missing rows are automations still off with
-- their defaults (apps/api/src/lib/automations.ts).
CREATE TABLE email_automation (
  id         text PRIMARY KEY,
  enabled    boolean NOT NULL DEFAULT false,
  -- Days of the automation's rule (quiet period...); NULL = its default.
  days       integer CHECK (days IS NULL OR days BETWEEN 1 AND 3650),
  -- The edited texts and picture; NULL = the template's own.
  content    jsonb,
  updated_by text REFERENCES "user"(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Every promotional email sent to an account (automations and campaigns): keeps an automation
-- from sending the same thing twice (`ref`: the book, the absence, the week, the year...) and
-- spaces promotional emails out (at most one a week per account).
CREATE TABLE email_send_log (
  id      bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind    text NOT NULL,
  ref     text NOT NULL DEFAULT '',
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX email_send_log_once ON email_send_log (user_id, kind, ref);
CREATE INDEX email_send_log_user_sent ON email_send_log (user_id, sent_at DESC);
CREATE INDEX email_send_log_kind_sent ON email_send_log (kind, sent_at DESC);
