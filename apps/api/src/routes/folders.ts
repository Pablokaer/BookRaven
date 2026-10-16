import type { FastifyInstance, FastifyReply } from "fastify";
import { requireUser } from "../auth.js";
import { query } from "../db.js";
import { publish } from "../lib/events.js";
import { obj, UUID_RE } from "../lib/http.js";

type FolderRow = { id: string; name: string; created_at: Date };

const toDto = (r: FolderRow) => ({ id: r.id, name: r.name, createdAt: r.created_at.toISOString() });

const nameSchema = obj({ name: { type: "string", minLength: 1, maxLength: 80 } }, ["name"]);

/** Runs `fn`, answering 409 when the user already has a folder with that name. */
async function unlessDuplicate<T>(reply: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") return reply.code(409).send({ error: "duplicate" });
    throw err;
  }
}

export async function folderRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get("/api/folders", async (request) => {
    const { rows } = await query<FolderRow>("SELECT * FROM folder WHERE user_id = $1 ORDER BY lower(name)", [
      request.user.id,
    ]);
    return rows.map(toDto);
  });

  app.post<{ Body: { name: string } }>("/api/folders", { schema: { body: nameSchema } }, async (request, reply) => {
    const name = request.body.name.trim();
    if (!name) return reply.code(400).send({ error: "invalid_name" });
    return unlessDuplicate(reply, async () => {
      const { rows } = await query<FolderRow>("INSERT INTO folder (user_id, name) VALUES ($1, $2) RETURNING *", [
        request.user.id,
        name,
      ]);
      const dto = toDto(rows[0]!);
      publish(request.user.id, "folder.created", dto);
      return reply.code(201).send(dto);
    });
  });

  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/api/folders/:id",
    { schema: { body: nameSchema } },
    async (request, reply) => {
      const name = request.body.name.trim();
      if (!UUID_RE.test(request.params.id)) return reply.code(404).send({ error: "not_found" });
      if (!name) return reply.code(400).send({ error: "invalid_name" });
      return unlessDuplicate(reply, async () => {
        const { rows } = await query<FolderRow>(
          "UPDATE folder SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING *",
          [name, request.params.id, request.user.id],
        );
        if (!rows[0]) return reply.code(404).send({ error: "not_found" });
        const dto = toDto(rows[0]);
        publish(request.user.id, "folder.updated", dto);
        return dto;
      });
    },
  );

  /** Deletes the folder only; its books move back to "no folder". */
  app.delete<{ Params: { id: string } }>("/api/folders/:id", async (request, reply) => {
    if (!UUID_RE.test(request.params.id)) return reply.code(404).send({ error: "not_found" });
    const res = await query("DELETE FROM folder WHERE id = $1 AND user_id = $2", [request.params.id, request.user.id]);
    if (res.rowCount === 0) return reply.code(404).send({ error: "not_found" });
    publish(request.user.id, "folder.deleted", { id: request.params.id });
    return reply.code(204).send();
  });
}
