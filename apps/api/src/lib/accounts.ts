import { forgetSessions } from "../auth.js";
import { query } from "../db.js";
import { forgetAppPasswords } from "./devices.js";
import { publish } from "./events.js";
import { log } from "./log.js";
import { catalogChanged } from "./publicCatalog.js";
import { removeBookFile, removeCover } from "./storage.js";

/** Deletes the given books and any stored file no other book uses any more. */
export async function deleteBooks(books: { id: string; user_id: string; sha256: string }[]) {
  if (!books.length) return;
  await query("DELETE FROM book WHERE id = ANY($1)", [books.map((b) => b.id)]);
  await Promise.all(books.map((b) => removeCover(b.id).catch((err) => log.warn({ err, bookId: b.id }, "could not remove a deleted book's cover"))));
  for (const b of books) publish(b.user_id, "book.deleted", { id: b.id });
  const shas = [...new Set(books.map((b) => b.sha256))];
  const { rows } = await query<{ sha256: string }>("SELECT DISTINCT sha256 FROM book WHERE sha256 = ANY($1)", [shas]);
  const still = new Set(rows.map((r) => r.sha256));
  await Promise.all(
    shas.filter((sha) => !still.has(sha)).map((sha) => removeBookFile(sha).catch((err) => log.warn({ err, sha256: sha }, "could not remove a deleted book's file"))),
  );
}

/**
 * Deletes an account: its books (and every file nobody else has), then the account, whose
 * progress, highlights, sessions, app passwords and the rest go with it (ON DELETE CASCADE).
 * Returns how many books it had.
 */
export async function deleteAccount(userId: string) {
  const { rows: books } = await query<{ id: string; user_id: string; sha256: string; is_public: boolean }>(
    "SELECT id, user_id, sha256, is_public FROM book WHERE user_id = $1",
    [userId],
  );
  await deleteBooks(books);
  await query(`DELETE FROM "user" WHERE id = $1`, [userId]);
  forgetSessions(userId);
  forgetAppPasswords(userId);
  if (books.some((b) => b.is_public)) catalogChanged({});
  return books.length;
}
