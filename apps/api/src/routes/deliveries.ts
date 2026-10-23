import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { query } from "../db.js";
import { publish } from "../lib/events.js";
import { obj, UUID_RE } from "../lib/http.js";

/**
 * "Send to Kindle": books queued for the account's e-readers. The BookRaven KOReader plugin
 * downloads them into a folder on each device (routes/koreader.ts) and the OPDS catalog lists
 * them under "Sent to this device". A book stays listed until it is removed here; each device
 * (app password) downloads it once.
 */

type DeliveryRow = {
  id: string;
  book_id: string;
  title: string;
  author: string | null;
  format: string;
  has_cover: boolean;
  created_at: Date;
  delivered_to: { name: string; at: string }[];
};

const SELECT_DELIVERY = `
  SELECT d.id, d.book_id, b.title, b.author, b.format, b.has_cover, d.created_at,
         COALESCE(
           (SELECT json_agg(json_build_object('name', p.name, 'at', r.delivered_at) ORDER BY r.delivered_at)
            FROM book_delivery_receipt r JOIN app_password p ON p.id = r.app_password_id
            WHERE r.delivery_id = d.id),
           '[]'::json
         ) AS delivered_to
  FROM book_delivery d JOIN book b ON b.id = d.book_id`;

const toDto = (r: DeliveryRow) => ({
  id: r.id,
  bookId: r.book_id,
  title: r.title,
  author: r.author,
  format: r.format,
  hasCover: r.has_cover,
  sentAt: r.created_at.toISOString(),
  /** The devices (app passwords) that downloaded it. */
  deliveredTo: r.delivered_to.map((d) => ({ name: d.name, at: new Date(d.at).toISOString() })),
});

export async function deliveryRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get("/api/deliveries", async (request) => {
    const { rows } = await query<DeliveryRow>(`${SELECT_DELIVERY} WHERE d.user_id = $1 ORDER BY d.created_at DESC`, [request.user.id]);
    return rows.map(toDto);
  });

  /** Sends a book to the account's e-readers. Sending it again sends it to every device again. */
  app.post<{ Body: { bookId: string } }>(
    "/api/deliveries",
    { schema: { body: obj({ bookId: { type: "string", pattern: UUID_RE.source.slice(1, -1) } }, ["bookId"]) } },
    async (request, reply) => {
      const own = await query("SELECT 1 FROM book WHERE id = $1 AND user_id = $2", [request.body.bookId, request.user.id]);
      if (!own.rows[0]) return reply.code(404).send({ error: "not_found" });
      const { rows } = await query<{ id: string }>(
        `INSERT INTO book_delivery (user_id, book_id) VALUES ($1, $2)
         ON CONFLICT (user_id, book_id) DO UPDATE SET created_at = now()
         RETURNING id`,
        [request.user.id, request.body.bookId],
      );
      const id = rows[0]!.id;
      await query("DELETE FROM book_delivery_receipt WHERE delivery_id = $1", [id]);
      const dto = toDto((await query<DeliveryRow>(`${SELECT_DELIVERY} WHERE d.id = $1`, [id])).rows[0]!);
      publish(request.user.id, "delivery.changed", { id });
      return reply.code(201).send(dto);
    },
  );

  app.delete<{ Params: { id: string } }>("/api/deliveries/:id", async (request, reply) => {
    if (!UUID_RE.test(request.params.id)) return reply.code(404).send({ error: "not_found" });
    const { rowCount } = await query("DELETE FROM book_delivery WHERE id = $1 AND user_id = $2", [request.params.id, request.user.id]);
    if (!rowCount) return reply.code(404).send({ error: "not_found" });
    publish(request.user.id, "delivery.changed", { id: request.params.id });
    return reply.code(204).send();
  });
}
