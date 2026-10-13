-- Passwords for other apps (OPDS readers, KOReader), one per device, revocable.
-- hash = sha256(md5(password)): KOReader only ever sends md5(password).
CREATE TABLE app_password (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name         text NOT NULL,
  hash         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX app_password_user_idx ON app_password (user_id);

-- KOReader identifies documents by a "partial MD5" of the file.
ALTER TABLE book ADD COLUMN koreader_md5 text;
CREATE INDEX book_koreader_md5_idx ON book (user_id, koreader_md5);

-- Positions reported by KOReader (kept as sent, so its devices can sync among themselves).
CREATE TABLE kosync_progress (
  user_id    text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  document   text NOT NULL,
  progress   text NOT NULL,
  percentage real NOT NULL,
  device     text NOT NULL,
  device_id  text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, document)
);
