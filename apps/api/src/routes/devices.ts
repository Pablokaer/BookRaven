import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { query } from "../db.js";
import { createAppPassword } from "../lib/devices.js";
import { obj, UUID_RE } from "../lib/http.js";
import { audit } from "../lib/log.js";

/** App passwords for OPDS readers and KOReader (managed from the profile page). */
export async function deviceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get("/api/app-passwords", async (request) => {
    const { rows } = await query<{ id: string; name: string; created_at: Date; last_used_at: Date | null }>(
      "SELECT id, name, created_at, last_used_at FROM app_password WHERE user_id = $1 ORDER BY created_at DESC",
      [request.user.id],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at.toISOString(), lastUsedAt: r.last_used_at?.toISOString() ?? null }));
  });

  /** The password is returned only here, once. */
  app.post<{ Body: { name: string } }>(
    "/api/app-passwords",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: { body: obj({ name: { type: "string", minLength: 1, maxLength: 60 } }, ["name"]) },
    },
    async (request, reply) => {
      const count = await query("SELECT 1 FROM app_password WHERE user_id = $1", [request.user.id]);
      if ((count.rowCount ?? 0) >= 20) return reply.code(400).send({ error: "too_many" });
      const created = await createAppPassword(request.user.id, request.body.name.trim());
      audit("app_password.created", { userId: request.user.id, appPasswordId: created.id, ip: request.ip });
      return reply.code(201).send(created);
    },
  );

  app.delete<{ Params: { id: string } }>("/api/app-passwords/:id", async (request, reply) => {
    if (!UUID_RE.test(request.params.id)) return reply.code(404).send({ error: "not_found" });
    const { rowCount } = await query("DELETE FROM app_password WHERE id = $1 AND user_id = $2", [request.params.id, request.user.id]);
    if (rowCount) audit("app_password.revoked", { userId: request.user.id, appPasswordId: request.params.id, ip: request.ip });
    return reply.code(204).send();
  });
}
