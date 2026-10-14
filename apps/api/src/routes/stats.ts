import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { query } from "../db.js";

/** How far back the stats page looks (a little over a year, for "this year" and the heatmap). */
const MAX_DAYS = 400;

export async function statsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  /**
   * Reading history by hour (UTC), for the stats page; the app groups it into local days.
   * `bookId` is null for books deleted since.
   */
  app.get("/api/stats", async (request) => {
    const { rows } = await query<{ hour: Date; book_id: string | null; seconds: number; finished: boolean }>(
      `SELECT hour, book_id, seconds, finished FROM reading_activity
       WHERE user_id = $1 AND hour >= now() - make_interval(days => $2)
       ORDER BY hour`,
      [request.user.id, MAX_DAYS],
    );
    return {
      activity: rows.map((r) => ({ hour: r.hour.toISOString(), bookId: r.book_id, seconds: r.seconds, finished: r.finished })),
    };
  });
}
