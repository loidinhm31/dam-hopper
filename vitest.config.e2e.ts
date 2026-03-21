import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "e2e",
    globals: true,
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    testTimeout: 60000,
  },
});
