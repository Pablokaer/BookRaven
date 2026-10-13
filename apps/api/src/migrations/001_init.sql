-- App tables. Better Auth owns "user", "session", "account" and "verification".

CREATE TABLE book (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  title             text NOT NULL,
  author            text,
  format            text NOT NULL CHECK (format IN ('pdf', 'epub', 'mobi', 'azw3', 'fb2', 'cbz')),
  original_filename text NOT NULL,
  mime_type         text NOT NULL,
  size_bytes        bigint NOT NULL,
  sha256            text NOT NULL,
  has_cover         boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, sha256)
);
CREATE INDEX book_user_idx ON book (user_id);
CREATE INDEX book_sha_idx ON book (sha256);

-- One row per (user, book): the latest known reading position.
-- locator = EPUB CFI for reflowable books, "page:<n>" for PDFs.
CREATE TABLE reading_progress (
  user_id     text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  book_id     uuid NOT NULL REFERENCES book(id) ON DELETE CASCADE,
  locator     text NOT NULL,
  percentage  real NOT NULL DEFAULT 0 CHECK (percentage >= 0 AND percentage <= 1),
  label       text,
  device_id   text NOT NULL,
  device_name text,
  updated_at  timestamptz NOT NULL,
  PRIMARY KEY (user_id, book_id)
);

-- Reader preferences (font, size, theme...) shared across devices.
CREATE TABLE user_settings (
  user_id    text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  settings   jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
