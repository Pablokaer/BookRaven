import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireUser } from "../auth.js";
import { config, isAdmin } from "../config.js";
import { query } from "../db.js";
import { broadcast, publish } from "../lib/events.js";
import { quotaFor } from "../lib/quota.js";
import { removeBookFile, removeCover } from "../lib/storage.js";
import { SELECT_BOOK, toBookDto, type BookRow } from "./books.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!isAdmin(request.user)) return reply.code(403).send({ error: "forbidden" });
}

/** User ids of the administrator accounts (to notify them). */
export async function adminUserIds() {
  if (!config.adminEmails.length) return [];
  const { rows } = await query<{ id: string }>(`SELECT id FROM "user" WHERE lower(email) = ANY($1)`, [config.adminEmails]);
  return rows.map((r) => r.id);
}

/** Takes every publication of a file out of the public library and tells the owners. */
export async function unpublishFile(sha256: string) {
  const { rows } = await query<{ id: string; user_id: string }>(
    "UPDATE book SET is_public = false, published_at = NULL WHERE sha256 = $1 AND is_public RETURNING id, user_id",
    [sha256],
  );
  for (const r of rows) {
    const book = await query<BookRow>(`${SELECT_BOOK} WHERE b.id = $1`, [r.id]);
    if (book.rows[0]) publish(r.user_id, "book.updated", toBookDto(book.rows[0]));
  }
  if (rows.length) broadcast("public.changed", { sha256 });
  return rows.length;
}

/** Deletes the given books and any stored file no other book uses any more. */
async function deleteBooks(books: { id: string; user_id: string; sha256: string }[]) {
  if (!books.length) return;
  await query("DELETE FROM book WHERE id = ANY($1)", [books.map((b) => b.id)]);
  for (const b of books) {
    await removeCover(b.id).catch(() => {});
    publish(b.user_id, "book.deleted", { id: b.id });
  }
  for (const sha of new Set(books.map((b) => b.sha256))) {
    const still = await query("SELECT 1 FROM book WHERE sha256 = $1 LIMIT 1", [sha]);
    if (!still.rowCount) await removeBookFile(sha).catch(() => {});
  }
}

type UserRow = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  books: string;
  used: string;
  quota_bytes: string | null;
  blocked: boolean | null;
  blocked_reason: string | null;
};

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);
  app.addHook("preHandler", requireAdmin);

  app.get("/api/admin/stats", async () => {
    const { rows } = await query<Record<string, string>>(`
      SELECT (SELECT count(*) FROM "user") AS users,
             (SELECT count(*) FROM book) AS books,
             (SELECT count(DISTINCT sha256) FROM book) AS files,
             (SELECT COALESCE(SUM(size_bytes), 0) FROM (SELECT DISTINCT ON (sha256) size_bytes FROM book) f) AS stored_bytes,
             (SELECT count(DISTINCT sha256) FROM book WHERE is_public) AS public_books,
             (SELECT count(*) FROM content_report WHERE status = 'open') AS open_reports,
             (SELECT count(*) FROM book_request WHERE status = 'open') AS open_requests,
             (SELECT count(*) FROM account_admin WHERE blocked) AS blocked_users`);
    const r = rows[0]!;
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/_(\w)/g, (_, c: string) => c.toUpperCase()), Number(v)]));
  });

  app.get<{ Querystring: { q?: string } }>("/api/admin/users", async (request) => {
    const q = `%${(request.query.q ?? "").trim().toLowerCase()}%`;
    const { rows } = await query<UserRow>(
      `SELECT u.id, u.name, u.email, u."createdAt",
              (SELECT count(*) FROM book b WHERE b.user_id = u.id) AS books,
              (SELECT COALESCE(SUM(size_bytes), 0) FROM book b WHERE b.user_id = u.id) AS used,
              a.quota_bytes, a.blocked, a.blocked_reason
       FROM "user" u LEFT JOIN account_admin a ON a.user_id = u.id
       WHERE lower(u.email) LIKE $1 OR lower(u.name) LIKE $1
       ORDER BY u."createdAt" DESC
       LIMIT 500`,
      [q],
    );
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        createdAt: new Date(r.createdAt).toISOString(),
        books: Number(r.books),
        usedBytes: Number(r.used),
        isAdmin: isAdmin(r),
        quotaBytes: await quotaFor(r),
        quotaOverride: r.quota_bytes != null ? Number(r.quota_bytes) : null,
        blocked: r.blocked === true,
        blockedReason: r.blocked_reason,
      })),
    );
  });

  async function loadTarget(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { rows } = await query<{ id: string; email: string }>(`SELECT id, email FROM "user" WHERE id = $1`, [request.params.id]);
    if (!rows[0]) {
      reply.code(404).send({ error: "not_found" });
      return null;
    }
    return rows[0];
  }

  /** Per-account storage limit (MB, null = default) and blocking. */
  app.patch<{ Params: { id: string }; Body: { quotaMb?: number | null; blocked?: boolean; blockedReason?: string | null } }>(
    "/api/admin/users/:id",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            quotaMb: { type: ["number", "null"], minimum: 0, maximum: 10_000_000 },
            blocked: { type: "boolean" },
            blockedReason: { type: ["string", "null"], maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const target = await loadTarget(request, reply);
      if (!target) return;
      const { quotaMb, blocked, blockedReason } = request.body;
      if (blocked && (isAdmin(target) || target.id === request.user.id)) {
        return reply.code(400).send({ error: "cannot_block_admin" });
      }
      await query(
        `INSERT INTO account_admin (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
        [target.id],
      );
      if (quotaMb !== undefined) {
        await query("UPDATE account_admin SET quota_bytes = $2 WHERE user_id = $1", [
          target.id,
          quotaMb === null ? null : Math.round(quotaMb * 1024 * 1024),
        ]);
      }
      if (blocked !== undefined) {
        await query(
          `UPDATE account_admin SET blocked = $2, blocked_reason = CASE WHEN $2 THEN $3 ELSE NULL END,
                                    blocked_at = CASE WHEN $2 THEN now() ELSE NULL END
           WHERE user_id = $1`,
          [target.id, blocked, blockedReason ?? null],
        );
        // Signing them out everywhere makes the block immediate.
        if (blocked) await query(`DELETE FROM session WHERE "userId" = $1`, [target.id]);
      }
      return reply.code(204).send();
    },
  );

  /** Sets a random temporary password (for when the person cannot use email reset). */
  app.post<{ Params: { id: string } }>("/api/admin/users/:id/reset-password", async (request, reply) => {
    const target = await loadTarget(request, reply);
    if (!target) return;
    const password = randomBytes(9).toString("base64url");
    const res = await query(`UPDATE account SET password = $2, "updatedAt" = now() WHERE "userId" = $1 AND "providerId" = 'credential'`, [
      target.id,
      await hashPassword(password),
    ]);
    if (!res.rowCount) return reply.code(400).send({ error: "no_password_account" });
    await query(`DELETE FROM session WHERE "userId" = $1`, [target.id]);
    return { password };
  });

  /** Deletes an account, its books and every file nobody else has. */
  app.delete<{ Params: { id: string } }>("/api/admin/users/:id", async (request, reply) => {
    const target = await loadTarget(request, reply);
    if (!target) return;
    if (isAdmin(target) || target.id === request.user.id) return reply.code(400).send({ error: "cannot_delete_admin" });
    const { rows: books } = await query<{ id: string; user_id: string; sha256: string; is_public: boolean }>(
      "SELECT id, user_id, sha256, is_public FROM book WHERE user_id = $1",
      [target.id],
    );
    await deleteBooks(books);
    await query(`DELETE FROM "user" WHERE id = $1`, [target.id]);
    if (books.some((b) => b.is_public)) broadcast("public.changed", {});
    return reply.code(204).send();
  });

  // ---- Reports ----

  app.get<{ Querystring: { status?: string } }>("/api/admin/reports", async (request) => {
    const all = request.query.status === "all";
    const { rows } = await query<{
      id: string;
      book_id: string | null;
      sha256: string;
      title: string;
      reason: string;
      details: string | null;
      status: string;
      resolution: string | null;
      created_at: Date;
      resolved_at: Date | null;
      reporter: string | null;
      publisher: string | null;
      still_public: boolean;
      blocked: boolean;
    }>(
      `SELECT r.*, ru.email AS reporter,
              (SELECT pu.email FROM book b JOIN "user" pu ON pu.id = b.user_id WHERE b.id = r.book_id) AS publisher,
              EXISTS (SELECT 1 FROM book b WHERE b.sha256 = r.sha256 AND b.is_public) AS still_public,
              EXISTS (SELECT 1 FROM blocked_file f WHERE f.sha256 = r.sha256) AS blocked
       FROM content_report r LEFT JOIN "user" ru ON ru.id = r.reporter_id
       ${all ? "" : "WHERE r.status = 'open'"}
       ORDER BY r.created_at DESC LIMIT 500`,
    );
    return rows.map((r) => ({
      id: r.id,
      bookId: r.book_id,
      sha256: r.sha256,
      title: r.title,
      reason: r.reason,
      details: r.details,
      status: r.status,
      resolution: r.resolution,
      reporter: r.reporter,
      publisher: r.publisher,
      stillPublic: r.still_public,
      blocked: r.blocked,
      createdAt: r.created_at.toISOString(),
      resolvedAt: r.resolved_at?.toISOString() ?? null,
    }));
  });

  /**
   * dismiss: nothing wrong. unpublish: out of the public library.
   * block: unpublish + the file can never be uploaded or published again.
   * purge: block + delete it from every library on the server.
   */
  app.post<{ Params: { id: string }; Body: { action: "dismiss" | "unpublish" | "block" | "purge"; note?: string } }>(
    "/api/admin/reports/:id/resolve",
    {
      schema: {
        body: {
          type: "object",
          required: ["action"],
          additionalProperties: false,
          properties: {
            action: { type: "string", enum: ["dismiss", "unpublish", "block", "purge"] },
            note: { type: "string", maxLength: 1000 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!UUID_RE.test(request.params.id)) return reply.code(404).send({ error: "not_found" });
      const { rows } = await query<{ sha256: string; title: string; reason: string }>("SELECT sha256, title, reason FROM content_report WHERE id = $1", [
        request.params.id,
      ]);
      const report = rows[0];
      if (!report) return reply.code(404).send({ error: "not_found" });
      const { action, note } = request.body;

      let removed = 0;
      if (action !== "dismiss") await unpublishFile(report.sha256);
      if (action === "block" || action === "purge") {
        await query(
          `INSERT INTO blocked_file (sha256, title, reason, blocked_by) VALUES ($1, $2, $3, $4) ON CONFLICT (sha256) DO NOTHING`,
          [report.sha256, report.title, note?.trim() || report.reason, request.user.id],
        );
      }
      if (action === "purge") {
        const { rows: books } = await query<{ id: string; user_id: string; sha256: string }>("SELECT id, user_id, sha256 FROM book WHERE sha256 = $1", [
          report.sha256,
        ]);
        await deleteBooks(books);
        removed = books.length;
      }

      // Every open report about the same file is settled by the same decision.
      await query(
        `UPDATE content_report SET status = $2, resolution = $3, resolved_by = $4, resolved_at = now()
         WHERE sha256 = $1 AND status = 'open'`,
        [report.sha256, action === "dismiss" ? "dismissed" : "actioned", note?.trim() || action, request.user.id],
      );
      return { action, removedCopies: removed };
    },
  );

  app.get("/api/admin/blocked-files", async () => {
    const { rows } = await query<{ sha256: string; title: string; reason: string; created_at: Date; blocked_by: string | null }>(
      `SELECT f.*, u.email AS blocked_by FROM blocked_file f LEFT JOIN "user" u ON u.id = f.blocked_by ORDER BY f.created_at DESC`,
    );
    return rows.map((r) => ({ sha256: r.sha256, title: r.title, reason: r.reason, blockedBy: r.blocked_by, createdAt: r.created_at.toISOString() }));
  });

  app.delete<{ Params: { sha: string } }>("/api/admin/blocked-files/:sha", async (request, reply) => {
    await query("DELETE FROM blocked_file WHERE sha256 = $1", [request.params.sha]);
    return reply.code(204).send();
  });
}

