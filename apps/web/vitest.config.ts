import { defineConfig } from "vitest/config";

// Unit tests for the web app's pure logic (no browser, no server).
export default defineConfig({
  define: { __NATIVE_VERSION__: '""', __BUNDLE_VERSION__: '""' },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
});
