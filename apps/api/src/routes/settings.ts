import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { query } from "../db.js";
import { publish } from "../lib/events.js";

/**
 * Reader preferences are a free-form JSON object owned by the client
 * (font, fontSize, theme, lineHeight, ...). The server only stores and syncs it.
 */
export async function settingsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get("/api/settings", async (request) => {
    const { rows } = await query<{ settings: object; updated_at: Date }>(
      "SELECT settings, updated_at FROM user_settings WHERE user_id = $1",
      [request.user.id],
    );
    return rows[0]
      ? { settings: rows[0].settings, updatedAt: rows[0].updated_at.toISOString() }
      : { settings: {}, updatedAt: null };
  });

  app.put<{ Body: { settings: Record<string, unknown>; deviceId?: string } }>(
    "/api/settings",
    {
      bodyLimit: 16 * 1024,
      schema: {
        body: {
          type: "object",
          required: ["settings"],
          properties: {
            settings: { type: "object", maxProperties: 50 },
            deviceId: { type: "string", maxLength: 100 },
          },
        },
      },
    },
    async (request) => {
      const { rows } = await query<{ updated_at: Date }>(
        `INSERT INTO user_settings (user_id, settings, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (user_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()
         RETURNING updated_at`,
        [request.user.id, JSON.stringify(request.body.settings)],
      );
      const dto = {
        settings: request.body.settings,
        updatedAt: rows[0]!.updated_at.toISOString(),
        deviceId: request.body.deviceId ?? null,
      };
      publish(request.user.id, "settings.updated", dto);
      return dto;
    },
  );
}
