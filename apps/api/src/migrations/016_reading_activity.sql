-- Reading history for the stats page: one row per user, book and hour in which their position
-- moved. `seconds` adds up the time between consecutive position saves (gaps over 10 minutes
-- count as a break, not reading); `finished` marks the hour a book crossed the finished mark.
-- Hours are UTC; the app groups them into the reader's local days.
CREATE TABLE reading_activity (
  user_id   text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  -- Kept when the book is deleted, so the history (time read, books finished) stays.
  book_id   uuid REFERENCES book(id) ON DELETE SET NULL,
  hour      timestamptz NOT NULL,
  seconds   integer NOT NULL DEFAULT 0,
  finished  boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX reading_activity_key ON reading_activity (user_id, book_id, hour);
CREATE INDEX reading_activity_user_hour ON reading_activity (user_id, hour);
