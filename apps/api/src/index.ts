import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { runAuthMigrations } from "./auth.js";
import { allowedOrigins, config, googleEnabled } from "./config.js";
import { pool, runAppMigrations } from "./db.js";
import { connectionCount } from "./lib/events.js";
import { ensureStorageDirs } from "./lib/storage.js";
import { authRoutes } from "./routes/auth.js";
import { bookRoutes } from "./routes/books.js";
import { eventRoutes } from "./routes/events.js";
import { progressRoutes } from "./routes/progress.js";
import { settingsRoutes } from "./routes/settings.js";
import { folderRoutes } from "./routes/folders.js";
import { highlightRoutes } from "./routes/highlights.js";
import { meRoutes } from "./routes/me.js";
import { publicRoutes } from "./routes/public.js";
import { shareRoutes } from "./routes/shares.js";

export async function buildServer() {
  const app = Fastify({
    logger: { level: config.isProd ? "info" : "debug" },
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
    limits: { fileSize: config.maxUploadBytes, files: 2, fields: 10, fieldSize: 2000 },
  });

  app.get("/api/health", async () => {
    await pool.query("SELECT 1");
    return { ok: true, sse: connectionCount() };
  });

  // Public, non-secret settings the login screen needs.
  app.get("/api/config", async () => ({
    googleEnabled,
    allowSignup: config.allowSignup,
    maxUploadMb: Math.round(config.maxUploadBytes / 1024 / 1024),
  }));

  await app.register(authRoutes);
  await app.register(bookRoutes);
  await app.register(progressRoutes);
  await app.register(settingsRoutes);
  await app.register(shareRoutes);
  await app.register(folderRoutes);
  await app.register(highlightRoutes);
  await app.register(publicRoutes);
  await app.register(meRoutes);
  await app.register(eventRoutes);

  return app;
}

async function main() {
  await ensureStorageDirs();
  const app = await buildServer();
  await runAuthMigrations();
  await runAppMigrations((m) => app.log.info(m));
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Google sign-in ${googleEnabled ? "enabled" : "disabled"}; sign-up ${config.allowSignup ? "open" : "closed"}`);

  const shutdown = async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
