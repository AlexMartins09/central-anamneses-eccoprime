import { defineConfig } from "vitest/config";
import path from "node:path";

import { TEST_DB } from "./tests/db-url";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    env: {
      DATABASE_URL: TEST_DB,
      TEST_DATABASE_URL: TEST_DB,
      ENCRYPTION_KEY: "test-encryption-key-test-encryption-key-123",
      AUTH_SECRET: "test-secret-test-secret-test-secret-123456",
    },
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
