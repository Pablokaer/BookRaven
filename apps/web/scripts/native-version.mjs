// Fingerprint of the native layer of the Android app: the committed android/ project,
// capacitor.config.ts and the installed versions of the Capacitor plugins. A web bundle can
// be sent to installed apps as a live update only when its fingerprint matches theirs;
// otherwise the app asks for a new APK.
//
//   node scripts/native-version.mjs   prints it
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");

export function nativeVersion() {
  const hash = createHash("sha256");
  // Blob ids from the git index, so generated or uncommitted files don't change it.
  hash.update(execFileSync("git", ["ls-files", "-s", "android", "capacitor.config.ts"], { cwd: webDir }));
  const pkg = JSON.parse(readFileSync(join(webDir, "package.json"), "utf8"));
  for (const name of Object.keys(pkg.dependencies).sort()) {
    if (!/^@(capacitor|capawesome)\//.test(name)) continue;
    const installed = JSON.parse(readFileSync(join(webDir, "node_modules", name, "package.json"), "utf8"));
    hash.update(`${name}@${installed.version}\n`);
  }
  return hash.digest("hex").slice(0, 12);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(nativeVersion());
