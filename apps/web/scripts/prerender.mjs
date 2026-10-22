// Writes dist/landing.html: index.html with the landing page already rendered in #root, which
// Caddy serves at "/" to visitors without a session cookie (infra/Caddyfile). Search engines then
// read the page without running scripts, and it shows before the app's code has loaded. Run after
// `vite build` (package.json "build", apps/web/Dockerfile); the Android build has no landing page.
//
//   [PUBLIC_URL=https://…] [ALLOW_SIGNUP=false] node scripts/prerender.mjs DIST_DIR
//
// PUBLIC_URL adds the canonical address, og:url, absolute preview images and the structured data
// (without it, as in CI, the page adds the structured data itself). ALLOW_SIGNUP=false draws the
// page without its sign-up buttons, as the server will answer.
import { access, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";

const dist = process.argv[2] && resolve(process.argv[2]);
if (!dist) throw new Error("usage: node scripts/prerender.mjs DIST_DIR");
const site = (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");
const signupOpen = (process.env.ALLOW_SIGNUP || "true").toLowerCase() !== "false";

const web = fileURLToPath(new URL("..", import.meta.url));
const out = join(web, "node_modules", ".prerender");
await build({
  root: web,
  logLevel: "warn",
  build: { ssr: "src/prerender.tsx", outDir: out, emptyOutDir: true, copyPublicDir: false },
});
const { renderLanding, structuredDataJson } = await import(pathToFileURL(join(out, "prerender.js")).href);
const { preloads, page } = renderLanding({ signupOpen });
await rm(out, { recursive: true, force: true });

// The page's own code, fetched with the app's instead of after it.
const chunks = (await readdir(join(dist, "assets"))).filter((f) => /^LandingPage-[\w-]+\.js$/.test(f));
if (chunks.length !== 1) throw new Error(`prerender: expected one LandingPage chunk, found ${chunks.length}`);

// Server and browser builds name images by their content: every file the HTML points at (each
// size of a srcset included) must be in the build.
const assets = new Set();
for (const [, value] of `${preloads}${page}`.matchAll(/\s(?:src|srcSet|imageSrcSet|href)="([^"]*)"/gi)) {
  for (const candidate of value.split(",")) {
    const path = candidate.trim().split(/\s+/)[0];
    if (path?.startsWith("/assets/")) assets.add(path);
  }
}
await Promise.all(
  [...assets].map((path) =>
    access(join(dist, path)).catch(() => {
      throw new Error(`prerender: ${path} is not in the build`);
    }),
  ),
);

const head = [
  preloads,
  `<link rel="modulepreload" crossorigin href="/assets/${chunks[0]}">`,
  // Without scripts, the sections that fade in on scroll would stay hidden.
  "<noscript><style>.lit-reveal{opacity:1;transform:none}</style></noscript>",
  ...(site
    ? [
        `<link rel="canonical" href="${site}/">`,
        `<meta property="og:url" content="${site}/">`,
        `<script type="application/ld+json" data-landing-ld>${structuredDataJson(site)}</script>`,
      ]
    : []),
];

let html = await readFile(join(dist, "index.html"), "utf8");
if (!html.includes('<div id="root"></div>')) throw new Error("prerender: no empty #root in index.html");
// Link previews (Facebook, LinkedIn…) want the image's full address.
if (site) html = html.replaceAll('content="/og-image.png"', () => `content="${site}/og-image.png"`);
html = html
  .replace("</head>", () => `  ${head.join("\n    ")}\n  </head>`)
  .replace('<div id="root"></div>', () => `<div id="root" data-landing${signupOpen ? "" : '="signup-closed"'}>${page}</div>`);
await writeFile(join(dist, "landing.html"), html);
console.log(`prerender: landing.html (${(html.length / 1e3).toFixed(0)} kB${site ? `, ${site}` : ""}${signupOpen ? "" : ", sign-up closed"})`);
