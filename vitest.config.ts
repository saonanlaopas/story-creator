import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["development"],
    alias: {
      sqlite: "node:sqlite"
    }
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**"],
    environment: "node",
    passWithNoTests: false
  }
});
