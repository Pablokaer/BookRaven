import { query } from "../db.js";

/** Thrown when someone uploads or publishes a file an administrator took down. */
export class BlockedFileError extends Error {
  constructor() {
    super("blocked_content");
  }
}

export async function isFileBlocked(sha256: string) {
  return ((await query("SELECT 1 FROM blocked_file WHERE sha256 = $1", [sha256])).rowCount ?? 0) > 0;
}

export async function isAccountBlocked(userId: string) {
  const { rows } = await query<{ blocked: boolean }>("SELECT blocked FROM account_admin WHERE user_id = $1", [userId]);
  return rows[0]?.blocked === true;
}
