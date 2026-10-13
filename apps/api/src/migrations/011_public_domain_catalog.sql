-- Language of a book (ISO 639-1), when known; used to filter the public library.
ALTER TABLE book ADD COLUMN language text;

-- Public-domain books imported into the public library, with where they came from.
CREATE TABLE catalog_book (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source         text NOT NULL,             -- e.g. 'gutenberg'
  source_id      text NOT NULL,             -- the book's id at the source
  title          text NOT NULL,
  authors        jsonb NOT NULL DEFAULT '[]',  -- [{ name, birth_year, death_year }]
  translators    jsonb NOT NULL DEFAULT '[]',
  language       text NOT NULL,
  subjects       text[] NOT NULL DEFAULT '{}',
  download_count integer NOT NULL DEFAULT 0,
  source_url     text NOT NULL,
  book_id        uuid REFERENCES book(id) ON DELETE SET NULL,
  imported_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_id)
);
CREATE INDEX catalog_book_book_idx ON catalog_book (book_id);
