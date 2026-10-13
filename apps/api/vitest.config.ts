import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Set before any app module is imported (config.ts reads them once). Tests run against
// their own database and storage folder, never the development ones.
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.DATABASE_URL ??= "postgres://readsync:readsync@localhost:5432/readsync_test";
process.env.STORAGE_DIR ??= path.join(os.tmpdir(), `readsync-test-${process.pid}`);
process.env.PUBLIC_URL ??= "http://localhost:5173";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-00";
process.env.ADMIN_EMAILS = "admin@test.local";
process.env.UPLOAD_QUOTA_MB = "1"; // small, so the quota is easy to hit

export default defineConfig({
  test: {
    globalSetup: ["./test/globalSetup.ts"],
    fileParallelism: false, // one shared database
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
