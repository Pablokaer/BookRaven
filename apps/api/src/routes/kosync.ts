import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { query } from "../db.js";
import { verifyAppPassword } from "../lib/devices.js";
import { saveReadingProgress } from "../lib/progress.js";

/**
 * KOReader progress sync ("kosync" protocol), so KOReader on e-ink readers (Kobo,
 * PocketBook, Kindle…) shares reading positions with BookRaven.
 *
 * In KOReader: Tools → Progress sync → Custom sync server: https://<your server>/kosync,
 * then Login with your email and an app password. Use "Binary" document matching.
 *
 * Positions are matched to books by KOReader's partial MD5. PDFs and comics sync both
 * ways by page; for ebooks KOReader positions (XPointers) can't be translated into our
 * CFIs, so BookRaven offers to jump to the same percentage, and KOReader devices keep
 * syncing exact positions among themselves.
 */

type KosyncRow = { progress: string; percentage: number; device: string; device_id: string; updated_at: Date };

const COMIC = new Set(["cbz", "cbr", "cb7", "cbt"]);

async function kosyncAuth(request: FastifyRequest, reply: FastifyReply) {
  const userHeader = request.headers["x-auth-user"];
  const keyHeader = request.headers["x-auth-key"];
  const user = typeof userHeader === "string" && typeof keyHeader === "string" ? await verifyAppPassword(userHeader, { md5: keyHeader }) : null;
  if (!user) return reply.code(401).send({ code: 2001, message: "Unauthorized" });
  request.user = user;
}

export async function kosyncRoutes(app: FastifyInstance) {
  // KOReader sends "application/vnd.koreader.v1+json" bodies.
  app.addContentTypeParser(/^application\/vnd\.koreader\.v1\+json/, { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // Accounts are created in BookRaven, not from KOReader.
  app.post("/kosync/users/create", async (_request, reply) =>
    reply.code(403).send({ code: 2005, message: "Create your account in BookRaven, then use an app password from your profile." }),
  );

  app.register(async (authed) => {
    authed.addHook("preHandler", kosyncAuth);

    authed.get("/kosync/users/auth", async () => ({ authorized: "OK" }));

    authed.put<{ Body: { document: string; progress: string; percentage: number; device: string; device_id: string } }>(
      "/kosync/syncs/progress",
      {
        schema: {
          body: {
            type: "object",
            required: ["document", "progress", "percentage"],
            properties: {
              document: { type: "string", minLength: 1, maxLength: 64 },
              progress: { type: "string", maxLength: 2000 },
              percentage: { type: "number", minimum: 0, maximum: 1 },
              device: { type: "string", maxLength: 100 },
              device_id: { type: "string", maxLength: 100 },
            },
          },
        },
      },
      async (request) => {
        const b = request.body;
        const device = b.device || "KOReader";
        const { rows } = await query<{ updated_at: Date }>(
          `INSERT INTO kosync_progress (user_id, document, progress, percentage, device, device_id, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, now())
           ON CONFLICT (user_id, document) DO UPDATE SET progress = EXCLUDED.progress, percentage = EXCLUDED.percentage,
             device = EXCLUDED.device, device_id = EXCLUDED.device_id, updated_at = now()
           RETURNING updated_at`,
          [request.user.id, b.document, b.progress, b.percentage, device, b.device_id || ""],
        );

        // Mirror it into BookRaven's own progress for the matching book.
        const book = await query<{ id: string; format: string }>("SELECT id, format FROM book WHERE user_id = $1 AND koreader_md5 = $2", [
          request.user.id,
          b.document,
        ]);
        if (book.rows[0]) {
          const { id, format } = book.rows[0];
          const page = /^\d+$/.test(b.progress) ? Number(b.progress) : null;
          const locator =
            format === "pdf" && page ? `page:${page}` : COMIC.has(format) && page ? `epubcfi(/6/${page * 2})` : `fraction:${b.percentage}`;
          await saveReadingProgress(request.user.id, id, {
            locator,
            percentage: b.percentage,
            label: page ? `Page ${page}` : null,
            deviceId: `koreader:${b.device_id || device}`,
            deviceName: `KOReader (${device})`,
            at: rows[0]!.updated_at,
          });
        }
        return { document: b.document, timestamp: Math.floor(rows[0]!.updated_at.getTime() / 1000) };
      },
    );

    authed.get<{ Params: { document: string } }>("/kosync/syncs/progress/:document", async (request) => {
      const { document } = request.params;
      const { rows } = await query<KosyncRow>("SELECT * FROM kosync_progress WHERE user_id = $1 AND document = $2", [request.user.id, document]);
      const ko = rows[0];

      // A newer position read in BookRaven is offered back when KOReader can use it (pages).
      const ours = await query<{ format: string; locator: string; percentage: number; updated_at: Date; device_name: string | null }>(
        `SELECT b.format, p.locator, p.percentage, p.updated_at, p.device_name
         FROM book b JOIN reading_progress p ON p.book_id = b.id AND p.user_id = b.user_id
         WHERE b.user_id = $1 AND b.koreader_md5 = $2 AND p.device_id NOT LIKE 'koreader:%'`,
        [request.user.id, document],
      );
      const r = ours.rows[0];
      if (r && (!ko || r.updated_at > ko.updated_at)) {
        const page =
          r.format === "pdf" ? /^page:(\d+)$/.exec(r.locator)?.[1] : COMIC.has(r.format) ? String(Number(/^epubcfi\(\/6\/(\d+)/.exec(r.locator)?.[1]) / 2) : null;
        if (page && page !== "NaN") {
          return { document, progress: page, percentage: r.percentage, device: r.device_name ?? "BookRaven", device_id: "readsync", timestamp: Math.floor(r.updated_at.getTime() / 1000) };
        }
      }
      if (!ko) return {};
      return { document, progress: ko.progress, percentage: ko.percentage, device: ko.device, device_id: ko.device_id, timestamp: Math.floor(ko.updated_at.getTime() / 1000) };
    });
  });
}
