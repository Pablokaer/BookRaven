-- Handwriting, one row per stroke: a change touches only its own strokes instead of rewriting the
-- page. Each page has a version, raised by every change, so devices apply live changes in order
-- and notice when they missed one. Existing handwriting (018's pdf_ink) is moved over.
CREATE TABLE pdf_ink_page (
  user_id    text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  book_id    uuid NOT NULL REFERENCES book(id) ON DELETE CASCADE,
  page       integer NOT NULL CHECK (page >= 1),
  version    integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, book_id, page)
);
CREATE INDEX pdf_ink_page_book_idx ON pdf_ink_page (book_id);

CREATE TABLE pdf_ink_stroke (
  user_id text NOT NULL,
  book_id uuid NOT NULL,
  page    integer NOT NULL,
  id      text NOT NULL,
  -- Drawing order: later strokes go over earlier ones.
  seq     bigint GENERATED ALWAYS AS IDENTITY,
  stroke  jsonb NOT NULL,
  PRIMARY KEY (user_id, book_id, page, id),
  FOREIGN KEY (user_id, book_id, page) REFERENCES pdf_ink_page ON DELETE CASCADE
);

INSERT INTO pdf_ink_page (user_id, book_id, page, version, updated_at)
SELECT user_id, book_id, page, 1, updated_at FROM pdf_ink;

-- In drawing order, so the new ids keep it.
INSERT INTO pdf_ink_stroke (user_id, book_id, page, id, stroke)
SELECT i.user_id, i.book_id, i.page, s.value ->> 'id', s.value
FROM pdf_ink i, jsonb_array_elements(i.strokes) WITH ORDINALITY AS s(value, n)
ORDER BY i.user_id, i.book_id, i.page, s.n
ON CONFLICT DO NOTHING;

DROP TABLE pdf_ink;
