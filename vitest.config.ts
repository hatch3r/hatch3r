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
      include: ["src/**"],
      exclude: [
        "src/cli/index.ts",
        "src/hooks/types.ts",
        "**/*.test.ts",
        "**/__tests__/**",
      ],
      thresholds: {
        statements: 78,
        branches: 65,
        functions: 80,
        lines: 80,
      },
    },
  },
});
