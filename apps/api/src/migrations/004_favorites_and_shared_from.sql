-- Favorites, and where a book came from when it was added through a share link.
ALTER TABLE book
  ADD COLUMN favorite       boolean NOT NULL DEFAULT false,
  ADD COLUMN shared_by_name text,
  ADD COLUMN shared_at      timestamptz;
