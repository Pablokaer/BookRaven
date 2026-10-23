import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { SessionUser } from "../auth.js";
import { query } from "../db.js";
import { APP_PASSWORD_WORDS } from "./appPasswordWords.js";
import { TtlCache } from "./cache.js";
import { isAccountBlocked } from "./moderation.js";

const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Stored form of an app password. KOReader sends md5(password), so we hash that. */
const hashFromMd5 = (md5hex: string) => sha256(md5hex.toLowerCase());

/**
 * A random password of six short words, like "otter-pecan-quilt-lunar-robin-tulip", easy to type
 * on an e-ink keyboard: lowercase letters and dashes, no capitals or digits to switch the
 * keyboard for, and words are quicker to type right than random letters.
 *
 * Six words from 1276 give 6 × log2(1276) ≈ 61.9 bits. That much matters because the stored hash
 * is sha256(md5(password)), unsalted and fast (KOReader only ever sends the md5), so a leaked
 * database must not be brute-forceable: 2^62 guesses is out of reach. `randomInt` draws from the
 * OS's secure RNG without modulo bias.
 *
 * Older passwords were 4 × 4 letters and digits ("kq3m-x8fp-2nwd-rv7a"): they are stored and
 * checked the same way, so they keep working.
 */
function generateAppPassword() {
  return Array.from({ length: 6 }, () => APP_PASSWORD_WORDS[randomInt(APP_PASSWORD_WORDS.length)]!).join("-");
}

/**
 * Every app password, old or new, is lowercase with no spaces, so a password typed in full
 * (OPDS sends it as is) can be lowercased and trimmed before it is hashed: an e-ink keyboard's
 * stray capital or space still signs in. KOReader's sync login hashes the password itself before
 * sending it, so there it has to be typed exactly.
 */
const normalize = (password: string) => password.trim().toLowerCase();

export async function createAppPassword(userId: string, name: string) {
  const password = generateAppPassword();
  const { rows } = await query<{ id: string; created_at: Date }>(
    "INSERT INTO app_password (user_id, name, hash) VALUES ($1, $2, $3) RETURNING id, created_at",
    [userId, name, hashFromMd5(md5(password))],
  );
  return { id: rows[0]!.id, name, password, createdAt: rows[0]!.created_at.toISOString() };
}

/**
 * Accepted app passwords, for a minute: every OPDS/KOReader request signs in, and a catalog page
 * fetches dozens of covers. Revoking the password, blocking or deleting the account forgets the
 * account's entries at once (forgetAppPasswords).
 */
const verified = new TtlCache<{ user: SessionUser; appPasswordId: string }>(1000);
const VERIFIED_TTL = 60_000;

/** Drops an account's cached app-password sign-ins. */
export function forgetAppPasswords(userId: string) {
  verified.forget((v) => v.user.id === userId);
}

/**
 * Checks an email + app password. `secret` is the password itself (HTTP Basic, OPDS)
 * or its md5 (KOReader). Null when it is wrong; a blocked account's right password comes
 * back with `blocked`, and must be refused too. `appPasswordId` tells devices apart (books
 * sent to e-readers are delivered once to each).
 */
export async function verifyAppPassword(
  email: string,
  secret: { password?: string; md5?: string },
): Promise<{ user: SessionUser; appPasswordId: string; blocked: boolean } | null> {
  const key = secret.md5 ?? (secret.password !== undefined ? md5(normalize(secret.password)) : null);
  if (!key || !/^[0-9a-f]{32}$/i.test(key)) return null;
  const cacheKey = sha256(`${email.trim().toLowerCase()}:${key.toLowerCase()}`);
  const cached = verified.get(cacheKey);
  if (cached) return { ...cached, blocked: false };

  const version = verified.version;
  const want = Buffer.from(hashFromMd5(key), "hex");
  const { rows } = await query<{ id: string; hash: string; user_id: string; email: string; name: string }>(
    `SELECT p.id, p.hash, u.id AS user_id, u.email, u.name
     FROM app_password p JOIN "user" u ON u.id = p.user_id
     WHERE lower(u.email) = lower($1)`,
    [email.trim()],
  );
  const match = rows.find((r) => timingSafeEqual(Buffer.from(r.hash, "hex"), want));
  if (!match) return null;
  const user = { id: match.user_id, email: match.email, name: match.name };
  if (await isAccountBlocked(match.user_id)) return { user, appPasswordId: match.id, blocked: true };
  // Only sign-ins that aren't cached get here, so "last used" moves about once a minute of use.
  await query(
    "UPDATE app_password SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')",
    [match.id],
  );
  verified.set(cacheKey, { user, appPasswordId: match.id }, VERIFIED_TTL, version);
  return { user, appPasswordId: match.id, blocked: false };
}
