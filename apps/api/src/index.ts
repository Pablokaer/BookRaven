import { buildServer } from "./app.js";
import { runAuthMigrations } from "./auth.js";
import { config, googleEnabled } from "./config.js";
import { pool, runAppMigrations } from "./db.js";
import { backfillKoreaderHashes } from "./lib/koreader.js";
import { ensureStorageDirs } from "./lib/storage.js";

async function main() {
  await ensureStorageDirs();
  const app = await buildServer();
  await runAuthMigrations();
  await runAppMigrations((m) => app.log.info(m));
  await app.listen({ port: config.port, host: config.host });
  void backfillKoreaderHashes((m) => app.log.info(m));
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
