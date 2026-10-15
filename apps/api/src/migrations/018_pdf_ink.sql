-- Handwritten annotations on PDF pages: pen and highlighter strokes, one row per annotated page.
-- Each stroke is {id, tool, color, width, points}; coordinates are fractions of the page, so the
-- ink fits any screen, zoom or margin setting. The PDF file itself is never changed.
CREATE TABLE pdf_ink (
  user_id    text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  book_id    uuid NOT NULL REFERENCES book(id) ON DELETE CASCADE,
  page       integer NOT NULL CHECK (page >= 1),
  strokes    jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, book_id, page)
);
CREATE INDEX pdf_ink_book_idx ON pdf_ink (book_id);
