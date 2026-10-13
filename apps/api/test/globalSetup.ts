import fs from "node:fs/promises";
import pg from "pg";

/** Fresh schema and storage for every test run, then the real migrations. */
export async function setup() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await client.end();
  await fs.rm(process.env.STORAGE_DIR!, { recursive: true, force: true });

  const { runAuthMigrations } = await import("../src/auth.js");
  const { pool, runAppMigrations } = await import("../src/db.js");
  await runAuthMigrations();
  await runAppMigrations(() => {});
  await pool.end();
}

export async function teardown() {
  await fs.rm(process.env.STORAGE_DIR!, { recursive: true, force: true });
}
