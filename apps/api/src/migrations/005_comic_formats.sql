-- Comic book archives besides CBZ: RAR (cbr), 7-Zip (cb7) and TAR (cbt).
ALTER TABLE book DROP CONSTRAINT book_format_check;
ALTER TABLE book ADD CONSTRAINT book_format_check
  CHECK (format IN ('pdf', 'epub', 'mobi', 'azw3', 'fb2', 'cbz', 'cbr', 'cb7', 'cbt'));
