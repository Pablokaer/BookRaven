// Removes from a `pnpm deploy --prod` folder the packages that are only there as optional peer
// dependencies. pnpm links an optional peer whenever the workspace has it, so better-auth (which
// lists vitest, react and react-dom as optional peers for its test and React helpers) drags
// vitest, vite, esbuild, happy-dom and React into the API image although the API never loads
// them. Run by apps/api/Dockerfile, which then imports the app to check nothing it needs is gone.
//
//   node scripts/prune-optional-peers.mjs DEPLOY_DIR
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = process.argv[2];
if (!root) throw new Error("usage: node scripts/prune-optional-peers.mjs DEPLOY_DIR");
const store = join(root, "node_modules/.pnpm");

/** Package names linked in a node_modules folder (scoped ones as "@scope/name"). */
function linked(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => !n.startsWith("."))
    .flatMap((n) => (n.startsWith("@") ? readdirSync(join(dir, n)).map((m) => `${n}/${m}`) : [n]));
}
const manifest = (dir) => JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));

// Walk the dependency graph from the app's own dependencies, following everything except
// optional peers. In the store a package's dependencies are its siblings in
// .pnpm/<entry>/node_modules.
const kept = new Set();
const seen = new Set();
const queue = Object.keys(manifest(root).dependencies ?? {}).map((n) => realpathSync(join(root, "node_modules", n)));
while (queue.length) {
  const dir = queue.pop();
  if (seen.has(dir)) continue;
  seen.add(dir);
  const entry = relative(store, dir).split(sep)[0];
  kept.add(entry);
  const pkg = manifest(dir);
  const optionalPeer = (n) => pkg.peerDependenciesMeta?.[n]?.optional && !pkg.dependencies?.[n] && !pkg.optionalDependencies?.[n];
  const siblings = join(store, entry, "node_modules");
  for (const name of linked(siblings)) {
    if (name !== pkg.name && !optionalPeer(name)) queue.push(realpathSync(join(siblings, name)));
  }
}

const removed = readdirSync(store).filter((e) => e !== "node_modules" && statSync(join(store, e)).isDirectory() && !kept.has(e));
for (const entry of removed) rmSync(join(store, entry), { recursive: true });

// Drop the links that now point nowhere (the optional peers' and pnpm's hoisted ones).
for (const dir of [join(root, "node_modules"), join(store, "node_modules"), ...[...kept].map((e) => join(store, e, "node_modules"))]) {
  for (const name of linked(dir)) {
    const link = join(dir, name);
    if (lstatSync(link).isSymbolicLink() && !existsSync(link)) rmSync(link);
  }
}
console.log(`prune-optional-peers: removed ${removed.length} packages: ${removed.join(" ")}`);
