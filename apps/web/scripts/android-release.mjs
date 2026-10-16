// Collects an Android release into OUT_DIR for the Deploy workflow, after `vite build --mode
// native` and `gradlew assembleRelease`:
//   bookraven-<versionName>.apk   the signed APK
//   bundles/<bundle id>.zip       the web bundle, for live updates of installed apps
//   android.json                  what the app and the download page read (src/lib/appUpdate.ts)
//
//   node scripts/android-release.mjs OUT_DIR   (needs VERSION_CODE, VERSION_NAME, BUNDLE_VERSION;
//                                               ANDROID_INPUTS is optional)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeVersion } from "./native-version.mjs";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] ?? "android-release");
const { VERSION_CODE, VERSION_NAME, BUNDLE_VERSION, ANDROID_INPUTS } = process.env;
if (!VERSION_CODE || !VERSION_NAME || !BUNDLE_VERSION) throw new Error("VERSION_CODE, VERSION_NAME and BUNDLE_VERSION are required");

mkdirSync(join(out, "bundles"), { recursive: true });

const apkName = `bookraven-${VERSION_NAME}.apk`;
copyFileSync(join(webDir, "android/app/build/outputs/apk/release/app-release.apk"), join(out, apkName));

// index.html at the root of the zip, as the live-update plugin expects.
const zipName = `${BUNDLE_VERSION}.zip`;
execFileSync("zip", ["-qr", join(out, "bundles", zipName), "."], { cwd: join(webDir, "dist") });

const release = {
  versionCode: Number(VERSION_CODE),
  versionName: VERSION_NAME,
  nativeVersion: nativeVersion(),
  apk: `/downloads/${apkName}`,
  apkSize: statSync(join(out, apkName)).size,
  bundle: {
    id: BUNDLE_VERSION,
    url: `/downloads/bundles/${zipName}`,
    sha256: createHash("sha256").update(readFileSync(join(out, "bundles", zipName))).digest("hex"),
  },
  publishedAt: new Date().toISOString(),
  // Fingerprint of what the release was built from; the Deploy workflow skips the next build when it matches.
  ...(ANDROID_INPUTS ? { inputs: ANDROID_INPUTS } : {}),
};
writeFileSync(join(out, "android.json"), `${JSON.stringify(release, null, 2)}\n`);
console.log(release);
