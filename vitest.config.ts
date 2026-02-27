import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["src/__tests__/globalSetup.ts"],
    coverage: {
      provider: "v8",
      thresholds: {
        statements: 80,
        branches: 79,
        functions: 80,
        lines: 80,
      },
    },
  },
});
