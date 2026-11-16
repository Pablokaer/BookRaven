-- When each account last used BookRaven (web, Android app, KOReader or OPDS), for Admin → Users.
-- Written at most every few minutes per account (apps/api/src/lib/activity.ts).
CREATE TABLE user_activity (
  user_id      text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL
);

-- Start from the best traces already kept: sessions, reading positions and app passwords.
INSERT INTO user_activity (user_id, last_seen_at)
SELECT x.user_id, LEAST(max(x.t), now())
FROM (
  SELECT "userId" AS user_id, "updatedAt" AS t FROM "session"
  UNION ALL SELECT user_id, updated_at FROM reading_progress
  UNION ALL SELECT user_id, last_used_at FROM app_password WHERE last_used_at IS NOT NULL
) x
JOIN "user" u ON u.id = x.user_id
GROUP BY x.user_id;
