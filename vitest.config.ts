import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Fail the suite if any test/describe is marked `.only` so focused tests
    // can never accidentally mask skipped/regressed tests in CI.
    allowOnly: false
  }
});
