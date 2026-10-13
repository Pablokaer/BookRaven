-- Themes (sections) of the public library: philosophy, politics, economics, ...
ALTER TABLE catalog_book
  ADD COLUMN bookshelves text[] NOT NULL DEFAULT '{}',
  ADD COLUMN themes      text[] NOT NULL DEFAULT '{}';
ALTER TABLE book ADD COLUMN themes text[] NOT NULL DEFAULT '{}';
CREATE INDEX book_themes_idx ON book USING gin (themes);
