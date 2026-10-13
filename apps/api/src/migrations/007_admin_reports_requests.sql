-- Per-account settings managed by administrators.
CREATE TABLE account_admin (
  user_id        text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  -- Overrides the default UPLOAD_QUOTA_MB for this account (NULL = default).
  quota_bytes    bigint CHECK (quota_bytes IS NULL OR quota_bytes >= 0),
  blocked        boolean NOT NULL DEFAULT false,
  blocked_reason text,
  blocked_at     timestamptz
);

-- Reports about books in the public library.
CREATE TABLE content_report (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The reported publication; kept as a snapshot because the book may be deleted.
  book_id     uuid REFERENCES book(id) ON DELETE SET NULL,
  sha256      text NOT NULL,
  title       text NOT NULL,
  reporter_id text REFERENCES "user"(id) ON DELETE SET NULL,
  reason      text NOT NULL CHECK (reason IN ('copyright', 'illegal', 'offensive', 'spam', 'other')),
  details     text,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'actioned')),
  resolution  text,
  resolved_by text REFERENCES "user"(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX content_report_open_idx ON content_report (created_at) WHERE status = 'open';
-- One open report per person per file.
CREATE UNIQUE INDEX content_report_once_idx ON content_report (reporter_id, sha256) WHERE status = 'open';

-- Files taken down by an administrator: they cannot be uploaded or published again.
CREATE TABLE blocked_file (
  sha256     text PRIMARY KEY,
  title      text NOT NULL,
  reason     text NOT NULL,
  blocked_by text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- "Please add this book" requests in the public library.
CREATE TABLE book_request (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  title             text NOT NULL,
  author            text,
  note              text,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fulfilled', 'closed')),
  fulfilled_book_id uuid REFERENCES book(id) ON DELETE SET NULL,
  fulfilled_by      text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE book_request_vote (
  request_id uuid NOT NULL REFERENCES book_request(id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  PRIMARY KEY (request_id, user_id)
);
