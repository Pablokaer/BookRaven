import { query } from "../db.js";
import { TtlCache } from "./cache.js";
import { publish } from "./events.js";

/** Ids of a club's members (to notify them). */
export async function memberIds(clubId: string) {
  return (await query<{ user_id: string }>("SELECT user_id FROM club_member WHERE club_id = $1", [clubId])).rows.map((r) => r.user_id);
}

export async function notifyMembers(clubId: string, event: string, data: unknown) {
  for (const id of await memberIds(clubId)) publish(id, event, data);
}

/**
 * Whether an account belongs to any club. Most readers are in none, and every saved position
 * would otherwise ask. Joining, leaving and deleting a club forget it (forgetClubMembership).
 */
const inAnyClub = new TtlCache<boolean>(5000);
const MEMBERSHIP_TTL = 10 * 60_000;

export function forgetClubMembership(userIds: string[]) {
  inAnyClub.forget((_, userId) => userIds.includes(userId));
}

async function isInAnyClub(userId: string) {
  const cached = inAnyClub.get(userId);
  if (cached !== undefined) return cached;
  const version = inAnyClub.version;
  const member = ((await query("SELECT 1 FROM club_member WHERE user_id = $1 LIMIT 1", [userId])).rowCount ?? 0) > 0;
  inAnyClub.set(userId, member, MEMBERSHIP_TTL, version);
  return member;
}

/** Lets fellow club members know someone moved forward in the club's book. */
export async function notifyClubProgress(userId: string, bookId: string) {
  if (!(await isInAnyClub(userId))) return;
  // Every member of each of the user's clubs reading that book, in one query.
  const { rows } = await query<{ club_id: string; user_id: string }>(
    `SELECT x.club_id, x.user_id FROM club_member m JOIN club c ON c.id = m.club_id JOIN book b ON b.sha256 = c.sha256
     JOIN club_member x ON x.club_id = m.club_id
     WHERE m.user_id = $1 AND b.id = $2 AND b.user_id = $1`,
    [userId, bookId],
  );
  for (const r of rows) publish(r.user_id, "club.progress", { clubId: r.club_id });
}
