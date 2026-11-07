import { verifyPassword } from "better-auth/crypto";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { isAdmin } from "../config.js";
import { query } from "../db.js";
import { deleteAccount } from "../lib/accounts.js";
import { obj } from "../lib/http.js";
import { audit } from "../lib/log.js";
import { billingRow, subscriptionBytes } from "../lib/billing.js";
import { quotaFor, storageUsed } from "../lib/quota.js";

export async function meRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  /**
   * The signed-in account's role, storage use and paid plan. `quotaBytes` is null when unlimited;
   * `plan` is the storage plan whose subscription is active (null on the free storage).
   */
  app.get("/api/me", async (request) => {
    const [usedBytes, quotaBytes, billing] = await Promise.all([storageUsed(request.user.id), quotaFor(request.user), billingRow(request.user.id)]);
    return { isAdmin: isAdmin(request.user), usedBytes, quotaBytes, plan: subscriptionBytes(billing) ? billing!.plan : null };
  });

  /**
   * Deletes the signed-in account and everything in it (Profile → Delete account; app stores ask
   * for it). An account with a password confirms with it; one that only signs in with Google
   * types its email. Administrators (ADMIN_EMAILS) are refused: take the address out first.
   */
  app.delete<{ Body: { password?: string; confirm?: string } }>(
    "/api/me",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: { body: obj({ password: { type: "string", maxLength: 1000 }, confirm: { type: "string", maxLength: 320 } }) },
    },
    async (request, reply) => {
      const user = request.user;
      if (isAdmin(user)) return reply.code(400).send({ error: "cannot_delete_admin" });
      const { password, confirm } = request.body ?? {};
      const { rows } = await query<{ password: string }>(
        `SELECT password FROM account WHERE "userId" = $1 AND "providerId" = 'credential' AND password IS NOT NULL`,
        [user.id],
      );
      if (rows[0]) {
        if (!password || !(await verifyPassword({ hash: rows[0].password, password }))) {
          audit("account.delete_failed", { userId: user.id, ip: request.ip }, "warn");
          return reply.code(403).send({ error: "wrong_password" });
        }
      } else if ((confirm ?? "").trim().toLowerCase() !== user.email.toLowerCase()) {
        return reply.code(400).send({ error: "confirm_email" });
      }
      const books = await deleteAccount(user.id);
      // With the email: once the account is gone, its id leads nowhere.
      audit("account.deleted", { userId: user.id, email: user.email, books, ip: request.ip });
      return reply.code(204).send();
    },
  );
}
