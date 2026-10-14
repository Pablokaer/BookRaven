/**
 * Fills the public library with public-domain books: popular ones from Project Gutenberg,
 * Standard Ebooks' editions and Portuguese works from Wikisource.
 *
 *   pnpm --filter api import:public-domain                 # all sources: 220 English + 220 Portuguese from Gutenberg, by theme, then the others
 *   pnpm --filter api import:public-domain -- --per-language 200 --languages pt --skip-topics engineering
 *   pnpm --filter api import:public-domain -- --sources wikisource --wikisource-limit 300
 *   STANDARD_EBOOKS_EMAIL=patron@example.com …              # Standard Ebooks' whole catalog (Patrons Circle)
 *   (production) docker compose run --rm --no-deps api node dist/scripts/import-public-domain.js --per-language 100
 */
import { runAuthMigrations } from "../auth.js";
import { pool, runAppMigrations } from "../db.js";
import { importPublicDomain } from "../lib/gutenbergImport.js";
import { gutenbergDeaths, importStandardEbooks, importWikisource } from "../lib/otherSources.js";
import { IMPORT_PLAN } from "../lib/themes.js";
import { ensureStorageDirs } from "../lib/storage.js";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};

const languages = arg("languages", "en,pt").split(",").map((l) => l.trim().toLowerCase()).filter(Boolean);
const perLanguage = Math.max(1, Number(arg("per-language", "220")) || 220);
const maxPages = Math.max(1, Number(arg("max-pages", "10")) || 10);
// e.g. --skip-topics engineering,computer: leave out some themed searches.
const skip = new Set(arg("skip-topics", "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean));
const plan = IMPORT_PLAN.filter((step) => !skip.has(step.topic));
const sources = new Set(arg("sources", "gutenberg,standardebooks,wikisource").split(",").map((s) => s.trim().toLowerCase()));
const seLimit = Math.max(0, Number(arg("se-limit", "200")) || 0);
const wikisourceLimit = Math.max(0, Number(arg("wikisource-limit", "200")) || 0);
const patronEmail = arg("se-email", process.env.STANDARD_EBOOKS_EMAIL ?? "") || undefined;

await ensureStorageDirs();
await runAuthMigrations();
await runAppMigrations((m) => console.log(m));
const log = (m: string) => console.log(m);
const report = (name: string, r: { imported: number; duplicates: number; skipped: number; failed: number }) =>
  console.log(`${name}: ${r.imported} imported, ${r.duplicates} already there (any source), ${r.skipped} not eligible, ${r.failed} failed.`);

if (sources.has("gutenberg")) {
  console.log(`Importing up to ${perLanguage} public-domain books per language from Gutenberg: ${languages.join(", ")}`);
  report("Gutenberg", await importPublicDomain({ languages, perLanguage, maxPages, plan, log }));
}
if (sources.has("standardebooks") && seLimit && languages.includes("en")) {
  log("Death years from Gutenberg's catalog…");
  const deaths = await gutenbergDeaths().catch(() => new Map<string, number | null>());
  report("Standard Ebooks", await importStandardEbooks({ limit: seLimit, patronEmail, deaths, log }));
}
if (sources.has("wikisource") && wikisourceLimit && languages.includes("pt")) {
  report("Wikisource", await importWikisource({ limit: wikisourceLimit, log }));
}
await pool.end();
