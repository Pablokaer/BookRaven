import { query } from "../db.js";
import { publish } from "./events.js";

/** Ids of a club's members (to notify them). */
export async function memberIds(clubId: string) {
  return (await query<{ user_id: string }>("SELECT user_id FROM club_member WHERE club_id = $1", [clubId])).rows.map((r) => r.user_id);
}

export async function notifyMembers(clubId: string, event: string, data: unknown) {
  for (const id of await memberIds(clubId)) publish(id, event, data);
}

/** Lets fellow club members know someone moved forward in the club's book. */
export async function notifyClubProgress(userId: string, bookId: string) {
  const { rows } = await query<{ club_id: string }>(
    `SELECT m.club_id FROM club_member m JOIN club c ON c.id = m.club_id JOIN book b ON b.sha256 = c.sha256
     WHERE m.user_id = $1 AND b.id = $2 AND b.user_id = $1`,
    [userId, bookId],
  );
  for (const r of rows) await notifyMembers(r.club_id, "club.progress", { clubId: r.club_id });
}
