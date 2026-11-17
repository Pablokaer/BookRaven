-- The hours in which each account used the app (web, Android, KOReader, OPDS), for the account's
-- page in Admin → Accounts (when in the day and the week they use BookRaven). Noted together with
-- user_activity.last_seen_at; rows older than a year are deleted (lib/activity.ts).
CREATE TABLE user_activity_hour (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  hour    timestamptz NOT NULL,
  PRIMARY KEY (user_id, hour)
);

-- Start from the reading history of the last year: an hour with reading in it is an hour of use.
INSERT INTO user_activity_hour (user_id, hour)
SELECT DISTINCT user_id, date_trunc('hour', hour) FROM reading_activity
 WHERE hour > now() - interval '365 days' AND hour <= now()
ON CONFLICT DO NOTHING;
