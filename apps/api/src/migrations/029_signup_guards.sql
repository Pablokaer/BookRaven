-- Against one person making many accounts (lib/signups.ts):

-- 1. The inbox an address reaches. Gmail ignores dots and anything after a "+" in the name
-- (f.ulano+2@gmail.com reaches fulano@gmail.com), and the big providers below ignore a "+tag":
-- a sign-up whose key matches an existing account's is refused. Other domains keep the address as
-- is (on a domain of its own, a "+" or a dot may be a different mailbox).
CREATE FUNCTION email_key(email text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
           WHEN d IN ('gmail.com', 'googlemail.com') THEN replace(split_part(l, '+', 1), '.', '') || '@gmail.com'
           WHEN d IN ('outlook.com', 'outlook.com.br', 'hotmail.com', 'hotmail.com.br', 'live.com', 'msn.com',
                      'icloud.com', 'me.com', 'mac.com', 'protonmail.com', 'proton.me', 'pm.me', 'fastmail.com')
             THEN split_part(l, '+', 1) || '@' || d
           ELSE l || '@' || d
         END
    FROM (SELECT regexp_replace(e, '@[^@]*$', '') AS l, regexp_replace(e, '^.*@', '') AS d
            FROM (SELECT rtrim(lower(trim(email)), '.') AS e) x) y
$$;

CREATE INDEX user_email_key_idx ON "user" (email_key(email));

-- 2. The network each account signed up from, to limit sign-ups per network and day
-- (SIGNUPS_PER_IP_PER_DAY) and to show administrators the accounts made from the same one.
-- An IPv6 address counts as its /64 (one home or phone gets a whole /64 and can change addresses
-- inside it). Rows go after 180 days.
CREATE FUNCTION signup_net(ip text) RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
BEGIN
  IF ip IS NULL OR ip = '' THEN RETURN NULL; END IF;
  IF family(ip::inet) = 6 THEN RETURN network(set_masklen(ip::inet, 64))::text; END IF;
  RETURN host(ip::inet);
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$$;

CREATE TABLE signup_ip (
  user_id    text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  net        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX signup_ip_net_idx ON signup_ip (net, created_at);

-- Existing accounts: the address of their first session still on record.
INSERT INTO signup_ip (user_id, net, created_at)
SELECT DISTINCT ON (s."userId") s."userId", signup_net(s."ipAddress"), u."createdAt"
  FROM session s JOIN "user" u ON u.id = s."userId"
 WHERE signup_net(s."ipAddress") IS NOT NULL AND u."createdAt" > now() - interval '180 days'
 ORDER BY s."userId", s."createdAt"
ON CONFLICT DO NOTHING;

-- 3. Accounts made while email confirmation was off and already in use count as confirmed, so
-- turning REQUIRE_EMAIL_VERIFICATION on doesn't ask every current reader to confirm at the next
-- sign-in. Unused ones still have to (and are deleted after UNVERIFIED_ACCOUNT_DAYS if they don't).
UPDATE "user" u SET "emailVerified" = true
 WHERE u."emailVerified" = false
   AND (EXISTS (SELECT 1 FROM user_activity a WHERE a.user_id = u.id)
        OR EXISTS (SELECT 1 FROM book b WHERE b.user_id = u.id));
