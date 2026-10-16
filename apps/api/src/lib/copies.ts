import type { FastifyReply } from "fastify";
import type { SessionUser } from "../auth.js";
import { query } from "../db.js";
import { bookDto } from "../routes/books.js";
import { publish } from "./events.js";
import { BlockedFileError, isFileBlocked } from "./moderation.js";
import { QuotaExceededError, quotaBody, withQuota } from "./quota.js";
import { copyCover } from "./storage.js";

type SourceBook = {
  id: string;
  title: string;
  author: string | null;
  format: string;
  original_filename: string;
  mime_type: string;
  size_bytes: string | number;
  sha256: string;
  has_cover: boolean;
  koreader_md5?: string | null;
  language?: string | null;
  description?: string | null;
};

/**
 * Adds a copy of someone else's book to `user`'s library (share links, public library).
 * The copy is its own row pointing at the same content-addressed file, so no bytes are
 * duplicated on disk, but it counts toward the user's quota. Idempotent per file.
 */
export async function copyBookToUser(src: SourceBook, user: SessionUser, sharedByName: string | null) {
  const existing = await query<{ id: string }>("SELECT id FROM book WHERE user_id = $1 AND sha256 = $2", [user.id, src.sha256]);
  if (existing.rows[0]) return { id: existing.rows[0].id, created: false };
  if (await isFileBlocked(src.sha256)) throw new BlockedFileError();

  const id = await withQuota(user, Number(src.size_bytes), async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO book (user_id, title, author, format, original_filename, mime_type, size_bytes, sha256, has_cover,
                         shared_by_name, shared_at, koreader_md5, language, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, now(), $10, $11, $12)
       ON CONFLICT (user_id, sha256) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING id`,
      [user.id, src.title, src.author, src.format, src.original_filename, src.mime_type, src.size_bytes, src.sha256, sharedByName, src.koreader_md5 ?? null, src.language ?? null, src.description ?? null],
    );
    return rows[0]!.id;
  });

  if (src.has_cover) {
    try {
      await copyCover(src.id, id);
      await query("UPDATE book SET has_cover = true WHERE id = $1", [id]);
    } catch {
      /* the copy still works without a cover */
    }
  }
  return { id, created: true };
}

/** copyBookToUser for a route: a blocked file answers 451 and a full account 413 (null then). */
export async function copyOrReply(reply: FastifyReply, src: SourceBook, user: SessionUser, sharedByName: string | null) {
  try {
    return await copyBookToUser(src, user, sharedByName);
  } catch (err) {
    if (err instanceof BlockedFileError) reply.code(451).send({ error: "blocked_content" });
    else if (err instanceof QuotaExceededError) reply.code(413).send(quotaBody(err));
    else throw err;
    return null;
  }
}

/** Adds the copy and answers with it: 201 when new (and the user's devices hear of it), 200 when they had it. */
export async function addCopyAndReply(reply: FastifyReply, src: SourceBook, user: SessionUser, sharedByName: string | null) {
  const result = await copyOrReply(reply, src, user, sharedByName);
  if (!result) return;
  const dto = await bookDto(result.id);
  if (result.created) publish(user.id, "book.created", dto);
  return reply.code(result.created ? 201 : 200).send(dto);
}
