import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SessionUser } from "../auth.js";
import { query } from "../db.js";
import { isAccountBlocked } from "./moderation.js";

const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Stored form of an app password. KOReader sends md5(password), so we hash that. */
export const hashFromMd5 = (md5hex: string) => sha256(md5hex.toLowerCase());

/** A readable random password like "kq3m-x8fp-2nwd-rv7a". */
export function generateAppPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(16);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  return chars.match(/.{4}/g)!.join("-");
}

export async function createAppPassword(userId: string, name: string) {
  const password = generateAppPassword();
  const { rows } = await query<{ id: string; created_at: Date }>(
    "INSERT INTO app_password (user_id, name, hash) VALUES ($1, $2, $3) RETURNING id, created_at",
    [userId, name, hashFromMd5(md5(password))],
  );
  return { id: rows[0]!.id, name, password, createdAt: rows[0]!.created_at.toISOString() };
}

/**
 * Checks an email + app password. `secret` is the password itself (HTTP Basic, OPDS)
 * or its md5 (KOReader). Blocked accounts are refused.
 */
export async function verifyAppPassword(email: string, secret: { password?: string; md5?: string }): Promise<SessionUser | null> {
  const key = secret.md5 ?? (secret.password !== undefined ? md5(secret.password) : null);
  if (!key || !/^[0-9a-f]{32}$/i.test(key)) return null;
  const want = Buffer.from(hashFromMd5(key), "hex");
  const { rows } = await query<{ id: string; hash: string; user_id: string; email: string; name: string }>(
    `SELECT p.id, p.hash, u.id AS user_id, u.email, u.name
     FROM app_password p JOIN "user" u ON u.id = p.user_id
     WHERE lower(u.email) = lower($1)`,
    [email.trim()],
  );
  const match = rows.find((r) => timingSafeEqual(Buffer.from(r.hash, "hex"), want));
  if (!match || (await isAccountBlocked(match.user_id))) return null;
  await query("UPDATE app_password SET last_used_at = now() WHERE id = $1", [match.id]);
  return { id: match.user_id, email: match.email, name: match.name };
}
