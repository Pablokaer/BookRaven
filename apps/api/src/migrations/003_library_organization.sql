-- Folders group books (a book is in at most one folder); tags are free-form labels.
CREATE TABLE folder (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name),
  UNIQUE (id, user_id)
);

ALTER TABLE book
  ADD COLUMN folder_id uuid,
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}',
  -- Composite key: a book can only be put in a folder of the same user.
  -- Deleting a folder moves its books back to "no folder".
  ADD CONSTRAINT book_folder_fk FOREIGN KEY (folder_id, user_id)
    REFERENCES folder (id, user_id) ON DELETE SET NULL (folder_id);
CREATE INDEX book_tags_idx ON book USING gin (tags);

-- Highlighted passages in reflowable books. cfi is an EPUB CFI range.
CREATE TABLE highlight (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  book_id    uuid NOT NULL REFERENCES book(id) ON DELETE CASCADE,
  cfi        text NOT NULL,
  text       text NOT NULL,
  color      text NOT NULL,
  label      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, cfi)
);
CREATE INDEX highlight_book_idx ON highlight (book_id);
