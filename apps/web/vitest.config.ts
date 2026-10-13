import { defineConfig } from "vitest/config";

// Unit tests for the web app's pure logic (no browser, no server).
export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
});
