-- A book's blurb: read from the file's metadata on upload (EPUB description, PDF subject),
-- or from the catalog's summary for imported public-domain books. Shown on the book's page.
ALTER TABLE book ADD COLUMN description text;
