-- Public library: books their owners published for every account on this server.
ALTER TABLE book
  ADD COLUMN is_public    boolean NOT NULL DEFAULT false,
  ADD COLUMN published_at timestamptz;
CREATE INDEX book_public_idx ON book (published_at DESC) WHERE is_public;
