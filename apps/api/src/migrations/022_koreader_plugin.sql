-- The BookRaven KOReader plugin (koreader/bookraven.koplugin): highlights and bookmarks synced
-- both ways, and books sent to e-readers.

-- When a highlight or bookmark last changed, so the plugin gets only what changed since its last sync.
ALTER TABLE highlight ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE bookmark ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- KOReader's side of each synced highlight or bookmark. `client_id` is the plugin's id for it
-- (BookRaven makes one, "br-<uuid>", for those made here). `ko` keeps KOReader's own fields as
-- it last sent them (positions, drawer, color, chapter, PDF boxes), so its other devices draw it
-- exactly. A row with neither highlight_id nor bookmark_id is one BookRaven can't show (a
-- position it couldn't convert): it still syncs between KOReader devices. The ids are not
-- foreign keys: when BookRaven deletes the highlight, the row stays, with deleted_at, so the
-- deletion reaches KOReader.
CREATE TABLE koreader_annotation (
  user_id      text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  book_id      uuid NOT NULL REFERENCES book(id) ON DELETE CASCADE,
  client_id    text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('highlight', 'bookmark')),
  highlight_id uuid,
  bookmark_id  uuid,
  ko           jsonb NOT NULL DEFAULT '{}',
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  PRIMARY KEY (user_id, book_id, client_id)
);
CREATE INDEX koreader_annotation_highlight_idx ON koreader_annotation (highlight_id) WHERE highlight_id IS NOT NULL;
CREATE INDEX koreader_annotation_bookmark_idx ON koreader_annotation (bookmark_id) WHERE bookmark_id IS NOT NULL;
CREATE INDEX koreader_annotation_book_idx ON koreader_annotation (book_id);

-- "Send to Kindle": books queued for the account's e-readers. Each device (app password)
-- downloads a book once and says so (book_delivery_receipt).
CREATE TABLE book_delivery (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  book_id    uuid NOT NULL REFERENCES book(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, book_id)
);
CREATE INDEX book_delivery_book_idx ON book_delivery (book_id);

CREATE TABLE book_delivery_receipt (
  delivery_id     uuid NOT NULL REFERENCES book_delivery(id) ON DELETE CASCADE,
  app_password_id uuid NOT NULL REFERENCES app_password(id) ON DELETE CASCADE,
  delivered_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (delivery_id, app_password_id)
);
CREATE INDEX book_delivery_receipt_password_idx ON book_delivery_receipt (app_password_id);
