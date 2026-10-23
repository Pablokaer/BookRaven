-- More of an ebook's metadata, read from the file on upload (EPUB) and listed by the OPDS
-- catalog: the series it belongs to and its position in it, its publisher and publication date.
ALTER TABLE book
  ADD COLUMN series       text,
  ADD COLUMN series_index real,
  ADD COLUMN publisher    text,
  ADD COLUMN issued       text;  -- the date as the file gives it: "1965", "1965-08" or "1965-08-01"
