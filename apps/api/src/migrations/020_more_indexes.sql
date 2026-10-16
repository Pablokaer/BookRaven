-- Indexes for foreign keys that delete or null out rows when a book is deleted: without them,
-- every book deletion scans these tables.
CREATE INDEX reading_activity_book_idx ON reading_activity (book_id) WHERE book_id IS NOT NULL;
CREATE INDEX reading_progress_book_idx ON reading_progress (book_id);
CREATE INDEX content_report_book_idx ON content_report (book_id);
CREATE INDEX book_request_fulfilled_book_idx ON book_request (fulfilled_book_id);
CREATE INDEX club_cover_book_idx ON club (cover_book_id);

-- App-password sign-in (OPDS, KOReader) looks accounts up by case-insensitive email.
CREATE INDEX user_email_lower_idx ON "user" (lower(email));

-- The public library lists each published file once (its earliest publication).
CREATE INDEX book_public_sha_idx ON book (sha256, published_at) INCLUDE (id) WHERE is_public;

-- Already covered by UNIQUE (book_id, cfi).
DROP INDEX IF EXISTS highlight_book_idx;

-- user_id alone is covered by UNIQUE (user_id, sha256); collections list books by (user_id, folder_id).
DROP INDEX IF EXISTS book_user_idx;
CREATE INDEX book_user_folder_idx ON book (user_id, folder_id);
