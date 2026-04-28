import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8")) as {
  version: string;
};

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      all: true,
      include: ["src/**/*.ts"],
      exclude: [
        "src/hooks/types.ts",
        "src/worktree/types.ts",
        "src/workspace/types.ts",
        "**/*.test.ts",
        "**/__tests__/**",
      ],
      thresholds: {
        statements: 78,
        branches: 65,
        functions: 80,
        lines: 80,

        // Per-directory thresholds for critical modules (#41)
        "src/merge/**": {
          statements: 90,
          branches: 80,
          functions: 90,
          lines: 90,
        },
        "src/integrity/**": {
          statements: 90,
          branches: 80,
          functions: 90,
          lines: 90,
        },
        "src/install/**": {
          statements: 85,
          branches: 75,
          functions: 85,
          lines: 85,
        },
        "src/adapters/customization.ts": {
          statements: 85,
          branches: 75,
          functions: 85,
          lines: 85,
        },
        "src/content/**": {
          statements: 85,
          branches: 70,
          functions: 85,
          lines: 85,
        },
        "src/audit/**": {
          statements: 85,
          branches: 75,
          functions: 85,
          lines: 85,
        },
      },
    },
  },
});
