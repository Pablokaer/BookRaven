-- Share links for whole collections: anyone signed in with the token sees the collection's
-- current books and can add copies of all of them to a collection of the same name.
CREATE TABLE folder_share (
  token      text PRIMARY KEY,
  folder_id  uuid NOT NULL UNIQUE REFERENCES folder(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
