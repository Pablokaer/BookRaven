/**
 * Fills the public library with popular public-domain books from Project Gutenberg.
 *
 *   pnpm --filter api import:public-domain                 # 220 English + 220 Portuguese, by theme
 *   pnpm --filter api import:public-domain -- --per-language 200 --languages pt
 *   (production) docker compose exec api node dist/scripts/import-public-domain.js --per-language 100
 */
import { runAuthMigrations } from "../auth.js";
import { pool, runAppMigrations } from "../db.js";
import { importPublicDomain } from "../lib/gutenbergImport.js";
import { ensureStorageDirs } from "../lib/storage.js";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};

const languages = arg("languages", "en,pt").split(",").map((l) => l.trim().toLowerCase()).filter(Boolean);
const perLanguage = Math.max(1, Number(arg("per-language", "220")) || 220);
const maxPages = Math.max(1, Number(arg("max-pages", "10")) || 10);

await ensureStorageDirs();
await runAuthMigrations();
await runAppMigrations((m) => console.log(m));
console.log(`Importing up to ${perLanguage} public-domain books per language: ${languages.join(", ")}`);
const summary = await importPublicDomain({ languages, perLanguage, maxPages, log: (m) => console.log(m) });
console.log(`Done: ${summary.imported} imported, ${summary.skipped} not public domain everywhere, ${summary.failed} failed.`);
await pool.end();
