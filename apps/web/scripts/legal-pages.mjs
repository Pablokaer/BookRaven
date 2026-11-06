// Writes DIST_DIR/privacy.html and DIST_DIR/delete-account.html from apps/web/legal: the privacy
// policy and how to delete an account, which Caddy serves at /privacy and /delete-account
// (infra/Caddyfile) and app stores link to. Plain pages, readable without signing in or running
// scripts. Run after `vite build` (package.json "build", apps/web/Dockerfile).
//
//   [PUBLIC_URL=https://…] [CONTACT_EMAIL=privacy@…] node scripts/legal-pages.mjs DIST_DIR
//
// PUBLIC_URL names the service; CONTACT_EMAIL is where people write about their data (without
// it, the pages send them to the server's administrator).
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dist = process.argv[2] && resolve(process.argv[2]);
if (!dist) throw new Error("usage: node scripts/legal-pages.mjs DIST_DIR");

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const site = (process.env.PUBLIC_URL ?? "").trim().replace(/\/$/, "");
const email = (process.env.CONTACT_EMAIL ?? "").trim();
if (email && !/^[^\s@<>"]+@[^\s@<>"]+$/.test(email)) throw new Error(`legal-pages: CONTACT_EMAIL is not an email address: ${email}`);

const mail = (subject) => `<a href="mailto:${escape(email)}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}">${escape(email)}</a>`;
const values = {
  SITE: site ? `<a href="${escape(site)}/">${escape(new URL(site).host)}</a>` : "this site",
  UPDATED: "November 6, 2026",
  CONTACT: email ? mail("") : "through the administrator of this server",
  CONTACT_SENTENCE: email ? `Questions about your data or this policy: ${mail("")}.` : "Questions about your data or this policy: write to the administrator of this server.",
  CONTACT_REQUEST: email ? `write to ${mail("Delete my BookRaven account")}` : "write to the administrator of this server",
};

const legal = join(fileURLToPath(new URL("..", import.meta.url)), "legal");
for (const page of ["privacy.html", "delete-account.html"]) {
  const html = (await readFile(join(legal, page), "utf8")).replace(/\{\{(\w+)\}\}/g, (all, key) => {
    if (!(key in values)) throw new Error(`legal-pages: unknown placeholder ${all} in ${page}`);
    return values[key];
  });
  await writeFile(join(dist, page), html);
}
console.log(`legal-pages: privacy.html and delete-account.html written${email ? "" : " (no CONTACT_EMAIL)"}`);
