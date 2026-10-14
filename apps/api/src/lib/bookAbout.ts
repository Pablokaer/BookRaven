import { query } from "../db.js";
import { LIBRARY_EMAIL } from "./gutenbergImport.js";
import { SOURCE_NAMES } from "./otherSources.js";

/**
 * What the server knows about a file beyond one copy of it, for the book pages: how many
 * other people have it, whether it is in the public library, and where an imported
 * public-domain book comes from. Only counts are shared, never who the other readers are.
 * `excludeUserId` leaves one account out of the count (the viewer, on their own book's page).
 */
export async function aboutFile(sha256: string, excludeUserId: string | null) {
  const [readers, pub, catalog] = await Promise.all([
    query<{ n: string }>(
      `SELECT count(DISTINCT b.user_id) AS n FROM book b JOIN "user" u ON u.id = b.user_id
       WHERE b.sha256 = $1 AND b.user_id IS DISTINCT FROM $2 AND u.email <> $3`,
      [sha256, excludeUserId, LIBRARY_EMAIL],
    ),
    query<{ id: string }>("SELECT id FROM book WHERE sha256 = $1 AND is_public ORDER BY published_at LIMIT 1", [sha256]),
    query<{ source: string; source_url: string; subjects: string[]; themes: string[] }>(
      `SELECT cb.source, cb.source_url, cb.subjects, cb.themes FROM catalog_book cb JOIN book b ON b.id = cb.book_id
       WHERE b.sha256 = $1 LIMIT 1`,
      [sha256],
    ),
  ]);
  const c = catalog.rows[0];
  return {
    /** Other accounts with this file in their library. */
    readers: Number(readers.rows[0]!.n),
    /** The public-library entry for this file, if it was published. */
    publicBookId: pub.rows[0]?.id ?? null,
    source: c ? { name: SOURCE_NAMES[c.source] ?? "Public domain", url: c.source_url } : null,
    subjects: c?.subjects ?? [],
  };
}
