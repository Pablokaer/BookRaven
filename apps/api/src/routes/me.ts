import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { isAdmin } from "../config.js";
import { quotaFor, storageUsed } from "../lib/quota.js";

export async function meRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  /** The signed-in account's role and storage use. `quotaBytes` is null when unlimited. */
  app.get("/api/me", async (request) => ({
    isAdmin: isAdmin(request.user),
    usedBytes: await storageUsed(request.user.id),
    quotaBytes: await quotaFor(request.user),
  }));
}
