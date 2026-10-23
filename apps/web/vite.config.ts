import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";
import { PLUGIN_ZIP_PATH, pluginZip } from "./scripts/koreader-plugin.mjs";
import { nativeVersion } from "./scripts/native-version.mjs";
import { OFFLINE_COPIES_SCRIPT, offlineCopiesScript } from "./src/lib/offlineCopies.js";

export default defineConfig(({ mode }) => {
  // The Android build is tagged so the app knows which live updates it can take (src/lib/appUpdate.ts).
  const native = mode === "native";
  const bundleVersion = native
    ? (process.env.BUNDLE_VERSION ?? execFileSync("git", ["rev-parse", "--short=12", "HEAD"]).toString().trim())
    : "";

  return {
    define: {
      __NATIVE_VERSION__: JSON.stringify(native ? nativeVersion() : ""),
      __BUNDLE_VERSION__: JSON.stringify(bundleVersion),
    },
    plugins: [
      react(),
      tailwindcss(),
      // The service worker (public/sw.js, not bundled) loads the list of reads that keep an
      // offline copy from this file, so it and the Android app follow the same list.
      {
        name: "offline-copies",
        generateBundle() {
          this.emitFile({ type: "asset", fileName: OFFLINE_COPIES_SCRIPT, source: offlineCopiesScript() });
        },
      },
      // The BookRaven plugin for KOReader (koreader/bookraven.koplugin), zipped, for Profile → Other
      // apps to link to. Not in the Android app, which links to the server's copy.
      !native && {
        name: "koreader-plugin",
        generateBundle() {
          this.emitFile({ type: "asset", fileName: PLUGIN_ZIP_PATH, source: pluginZip() });
        },
        configureServer(server) {
          server.middlewares.use(`/${PLUGIN_ZIP_PATH}`, (_req, res) => {
            res.setHeader("Content-Type", "application/zip");
            res.end(pluginZip());
          });
        },
      },
      // The Android app never shows the link-preview image: keep it out of the APK and live
      // updates (App.tsx leaves out the landing page and its plates the same way).
      native && {
        name: "native-without-web-files",
        writeBundle: ({ dir }) => rmSync(join(dir!, "og-image.png"), { force: true }),
      },
    ],
    server: {
      port: 5173,
      proxy: {
        // The API runs on :3000 in development; Caddy does the same job in production.
        "/api": { target: "http://localhost:3000", changeOrigin: false },
        "/opds": { target: "http://localhost:3000", changeOrigin: false },
        "/kosync": { target: "http://localhost:3000", changeOrigin: false },
      },
    },
    // foliate-js is plain ES modules with relative dynamic imports; let Vite bundle it as-is.
    optimizeDeps: { exclude: ["foliate-js"] },
    build: {
      target: "es2022",
      chunkSizeWarningLimit: 2000,
      rolldownOptions: {
        // lib/accountData.ts loads every module that keeps the account's data before signing out,
        // most of them already loaded with the first screen: those imports are meant to change
        // nothing in the chunks.
        onLog(level, log, handler) {
          if (log.code === "INEFFECTIVE_DYNAMIC_IMPORT" && log.message.includes("src/lib/accountData.ts")) return;
          handler(level, log);
        },
        output: {
          codeSplitting: {
            groups: [
              // React and the router change far less often than the app: in a chunk of their own,
              // browsers keep them cached across deploys that only change the app's code.
              { name: "react", test: /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/, priority: 2 },
              // Everything the first screen needs in one file, instead of a dozen small ones shared
              // with the pages and the reader that load later.
              { name: "app", tags: ["$initial"], priority: 1 },
            ],
          },
        },
      },
    },
  };
});
