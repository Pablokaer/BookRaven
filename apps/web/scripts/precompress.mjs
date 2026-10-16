// Writes a brotli (.br, quality 11) and a gzip (.gz, level 9) copy next to every text file of
// the built web app, which Caddy serves to browsers that accept them (`precompressed` in
// infra/Caddyfile) instead of compressing on each request. Run by apps/web/Dockerfile; the
// Android bundle doesn't need them.
//
//   node scripts/precompress.mjs DIST_DIR
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

const dir = process.argv[2];
if (!dir) throw new Error("usage: node scripts/precompress.mjs DIST_DIR");

const TEXT = /\.(js|mjs|css|html|svg|json|webmanifest|wasm|txt|xml)$/;
const br = promisify(brotliCompress);
const gz = promisify(gzip);

async function compress(file) {
  const data = await readFile(file);
  const [b, g] = await Promise.all([
    br(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }),
    gz(data, { level: 9 }),
  ]);
  // A copy that isn't smaller is left out; Caddy then serves the file itself.
  if (b.length < data.length) await writeFile(`${file}.br`, b);
  if (g.length < data.length) await writeFile(`${file}.gz`, g);
  return [data.length, b.length];
}

const files = (await readdir(dir, { recursive: true })).filter((f) => TEXT.test(f)).map((f) => join(dir, f));
const sizes = await Promise.all(files.map(compress));
const total = sizes.reduce((a, [raw]) => a + raw, 0);
const brotli = sizes.reduce((a, [raw, b]) => a + Math.min(raw, b), 0);
console.log(`precompress: ${files.length} files, ${(total / 1e6).toFixed(1)} MB → ${(brotli / 1e6).toFixed(1)} MB brotli`);
