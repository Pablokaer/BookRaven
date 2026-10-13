-- Share links: anyone signed in who has the token can add a copy of the book to
-- their own library. The copy is a separate book row pointing at the same
-- content-addressed file, so it survives the owner deleting theirs.
CREATE TABLE book_share (
  token      text PRIMARY KEY,
  book_id    uuid NOT NULL UNIQUE REFERENCES book(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
