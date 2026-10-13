-- Book clubs: a group reading one book together, with a discussion.
CREATE TABLE club (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  description  text,
  owner_id     text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  -- The book, by file: each member reads their own copy of it.
  sha256       text NOT NULL,
  book_title   text NOT NULL,
  book_author  text,
  -- The creator's copy, used for the cover.
  cover_book_id uuid REFERENCES book(id) ON DELETE SET NULL,
  invite_token text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE club_member (
  club_id   uuid NOT NULL REFERENCES club(id) ON DELETE CASCADE,
  user_id   text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, user_id)
);
CREATE INDEX club_member_user_idx ON club_member (user_id);

CREATE TABLE club_message (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id    uuid NOT NULL REFERENCES club(id) ON DELETE CASCADE,
  user_id    text REFERENCES "user"(id) ON DELETE SET NULL,
  text       text NOT NULL,
  -- Optional quoted passage and where it is in the book.
  quote      text,
  locator    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX club_message_club_idx ON club_message (club_id, created_at);
