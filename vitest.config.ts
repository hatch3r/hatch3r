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
