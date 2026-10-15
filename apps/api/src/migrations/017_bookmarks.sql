-- Bookmarked pages ("save this page", like a Kindle bookmark), in every format.
-- `locator` is the page's position: "page:N" for PDFs, the page start's CFI for ebooks and comics.
CREATE TABLE bookmark (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  book_id    uuid NOT NULL REFERENCES book(id) ON DELETE CASCADE,
  locator    text NOT NULL,
  percentage real NOT NULL DEFAULT 0 CHECK (percentage >= 0 AND percentage <= 1),
  -- Where it is ("Page 3 of 120", or the chapter), and the reader's own name for it.
  label      text,
  title      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, book_id, locator)
);
CREATE INDEX bookmark_book_idx ON bookmark (book_id);
