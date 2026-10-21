// Writes dist/landing.html: index.html with the landing page already rendered in #root, which
// Caddy serves at "/" to visitors without a session cookie (infra/Caddyfile). Search engines then
// read the page without running scripts, and it shows before the app's code has loaded. Run after
// `vite build` (package.json "build", apps/web/Dockerfile); the Android build has no landing page.
//
//   node scripts/prerender.mjs DIST_DIR
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";

const dist = process.argv[2] && resolve(process.argv[2]);
if (!dist) throw new Error("usage: node scripts/prerender.mjs DIST_DIR");

const web = fileURLToPath(new URL("..", import.meta.url));
const out = join(web, "node_modules", ".prerender");
await build({
  root: web,
  logLevel: "warn",
  build: { ssr: "src/prerender.tsx", outDir: out, emptyOutDir: true, copyPublicDir: false },
});
const { renderLanding } = await import(pathToFileURL(join(out, "prerender.js")).href);
const rendered = renderLanding();
await rm(out, { recursive: true, force: true });
// React writes the preloads of the images it renders (the plates above the fold) at the start:
// they go in <head>, and #root keeps only the page, as the browser will hydrate it.
const preloads = rendered.match(/^(?:<link [^>]*\/>)*/)[0];
const html = rendered.slice(preloads.length);

// The page's own code, fetched with the app's instead of after it.
const chunks = (await readdir(join(dist, "assets"))).filter((f) => /^LandingPage-[\w-]+\.js$/.test(f));
if (chunks.length !== 1) throw new Error(`prerender: expected one LandingPage chunk, found ${chunks.length}`);

// Server and browser builds name images by their content: the plates the HTML points at must exist.
for (const [, path] of html.matchAll(/(?:src|srcSet)="(\/assets\/[^" ,]+)/g)) {
  await readFile(join(dist, path)).catch(() => {
    throw new Error(`prerender: ${path} is not in the build`);
  });
}

const index = await readFile(join(dist, "index.html"), "utf8");
if (!index.includes('<div id="root"></div>')) throw new Error("prerender: no empty #root in index.html");
const page = index
  .replace(
    "</head>",
    // Without scripts, the sections that fade in on scroll would stay hidden.
    () => `  ${preloads}\n    <link rel="modulepreload" crossorigin href="/assets/${chunks[0]}">\n    <noscript><style>.lit-reveal{opacity:1;transform:none}</style></noscript>\n  </head>`,
  )
  .replace('<div id="root"></div>', () => `<div id="root" data-landing>${html}</div>`);
await writeFile(join(dist, "landing.html"), page);
console.log(`prerender: landing.html (${(page.length / 1e3).toFixed(0)} kB)`);
