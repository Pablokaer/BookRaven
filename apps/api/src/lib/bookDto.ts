import { query } from "../db.js";

/** A book row as the app reads it (`SELECT_BOOK`): the book, its share state and its owner's progress. */
export type BookRow = {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  format: string;
  original_filename: string;
  mime_type: string;
  size_bytes: string;
  sha256: string;
  has_cover: boolean;
  folder_id: string | null;
  tags: string[];
  favorite: boolean;
  shared_by_name: string | null;
  shared_at: Date | null;
  is_shared: boolean;
  is_public: boolean;
  published_at: Date | null;
  language: string | null;
  description: string | null;
  series: string | null;
  series_index: number | null;
  publisher: string | null;
  /** Publication date as the file gives it: "1965", "1965-08" or "1965-08-01". */
  issued: string | null;
  created_at: Date;
  p_locator: string | null;
  p_percentage: number | null;
  p_label: string | null;
  p_device_id: string | null;
  p_device_name: string | null;
  p_updated_at: Date | null;
};

export const SELECT_BOOK = `
  SELECT b.*, EXISTS (SELECT 1 FROM book_share s WHERE s.book_id = b.id) AS is_shared,
         p.locator AS p_locator, p.percentage AS p_percentage, p.label AS p_label,
         p.device_id AS p_device_id, p.device_name AS p_device_name, p.updated_at AS p_updated_at
  FROM book b
  LEFT JOIN reading_progress p ON p.book_id = b.id AND p.user_id = b.user_id`;

/**
 * A book as lists and live events carry it. The description (up to 4000 characters) is left
 * out: only the book's page shows it, and it gets it from `/api/books/:id` or `/about`.
 */
export function toBookDto(r: BookRow) {
  return {
    id: r.id,
    title: r.title,
    author: r.author,
    format: r.format,
    filename: r.original_filename,
    sizeBytes: Number(r.size_bytes),
    hasCover: r.has_cover,
    folderId: r.folder_id,
    tags: r.tags,
    favorite: r.favorite,
    /** This book has an active share link. */
    isShared: r.is_shared,
    /** Set when the book was added from someone else's share link. */
    sharedBy: r.shared_by_name,
    sharedAt: r.shared_at?.toISOString() ?? null,
    /** Published in the public library. */
    isPublic: r.is_public,
    language: r.language,
    createdAt: r.created_at.toISOString(),
    progress: r.p_locator
      ? {
          locator: r.p_locator,
          percentage: r.p_percentage ?? 0,
          label: r.p_label,
          deviceId: r.p_device_id,
          deviceName: r.p_device_name,
          updatedAt: r.p_updated_at!.toISOString(),
        }
      : null,
  };
}

export type BookDto = ReturnType<typeof toBookDto>;

/** A book as the app sees it, read again (after a change). */
export async function bookDto(id: string) {
  const { rows } = await query<BookRow>(`${SELECT_BOOK} WHERE b.id = $1`, [id]);
  return toBookDto(rows[0]!);
}
