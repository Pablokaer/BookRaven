import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { defineConfig } from "vite";
import { nativeVersion } from "./scripts/native-version.mjs";

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
    plugins: [react(), tailwindcss()],
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
    build: { target: "es2022", chunkSizeWarningLimit: 2000 },
  };
});
