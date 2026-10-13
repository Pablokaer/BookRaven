import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // The API runs on :3000 in development; Caddy does the same job in production.
      "/api": { target: "http://localhost:3000", changeOrigin: false },
    },
  },
  // foliate-js is plain ES modules with relative dynamic imports; let Vite bundle it as-is.
  optimizeDeps: { exclude: ["foliate-js"] },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
});
