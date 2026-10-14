import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { allowedOrigins, config, googleEnabled } from "./config.js";
import { pool } from "./db.js";
import { mailEnabled } from "./lib/mailer.js";
import { connectionCount } from "./lib/events.js";
import { authRoutes } from "./routes/auth.js";
import { bookRoutes } from "./routes/books.js";
import { eventRoutes } from "./routes/events.js";
import { progressRoutes } from "./routes/progress.js";
import { statsRoutes } from "./routes/stats.js";
import { settingsRoutes } from "./routes/settings.js";
import { adminRoutes } from "./routes/admin.js";
import { clubRoutes } from "./routes/clubs.js";
import { deviceRoutes } from "./routes/devices.js";
import { folderRoutes } from "./routes/folders.js";
import { kosyncRoutes } from "./routes/kosync.js";
import { highlightRoutes } from "./routes/highlights.js";
import { meRoutes } from "./routes/me.js";
import { publicRoutes } from "./routes/public.js";
import { lookupRoutes } from "./routes/lookup.js";
import { opdsRoutes } from "./routes/opds.js";
import { requestRoutes } from "./routes/requests.js";
import { collectionShareRoutes } from "./routes/collectionShares.js";
import { shareRoutes } from "./routes/shares.js";

/** The Fastify app with every route registered (no listening, no migrations): used by index.ts and the tests. */
export async function buildServer() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? (config.isProd ? "info" : "debug") },
    trustProxy: true,
  });

  await app.register(cors, {
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Range", "If-None-Match"],
    exposedHeaders: ["set-auth-token", "Content-Range", "Accept-Ranges", "Content-Length", "ETag"],
  });
  await app.register(rateLimit, { max: 600, timeWindow: "1 minute" });
  await app.register(multipart, {
    // fieldSize fits a book description (4000 characters, up to 4 bytes each in UTF-8).
    limits: { fileSize: config.maxUploadBytes, files: 2, fields: 10, fieldSize: 16 * 1024 },
  });

  app.get("/api/health", async () => {
    await pool.query("SELECT 1");
    return { ok: true, sse: connectionCount() };
  });

  // Public, non-secret settings the login screen needs.
  app.get("/api/config", async () => ({
    googleEnabled,
    allowSignup: config.allowSignup,
    requireEmailVerification: config.requireEmailVerification,
    maxUploadMb: Math.round(config.maxUploadBytes / 1024 / 1024),
    // Without SMTP in production nobody would receive the link, so the option is hidden.
    passwordResetEnabled: mailEnabled || !config.isProd,
    dictionaryEnabled: config.dictionaryProvider !== "none",
    translateEnabled: config.translateProvider !== "none",
  }));

  await app.register(authRoutes);
  await app.register(bookRoutes);
  await app.register(progressRoutes);
  await app.register(statsRoutes);
  await app.register(settingsRoutes);
  await app.register(shareRoutes);
  await app.register(collectionShareRoutes);
  await app.register(folderRoutes);
  await app.register(highlightRoutes);
  await app.register(publicRoutes);
  await app.register(meRoutes);
  await app.register(adminRoutes);
  await app.register(requestRoutes);
  await app.register(lookupRoutes);
  await app.register(deviceRoutes);
  await app.register(clubRoutes);
  // Other reading apps: OPDS catalog and KOReader progress sync (app-password auth).
  await app.register(opdsRoutes);
  await app.register(kosyncRoutes);
  await app.register(eventRoutes);

  return app;
}
