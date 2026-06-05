import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8")) as {
  version: string;
};

// D3-4 (Cycle 11 Wave-2 High): pin the v8 coverage temp/output tree to an
// absolute path anchored at this config file's directory (the repo root).
// `import.meta.dirname` is fixed at module-load time and is immune to any
// later `process.chdir()` a test performs. The default `reportsDirectory`
// (`./coverage`) is resolved cwd-relative at flush time; under the `forks`
// pool a fork worker is reused across files, so a chdir-into-temp-dir test
// (e.g. src/__tests__/pipeline/snapshot.test.ts "paths defaults") could
// relocate where the provider looked for `coverage/.tmp/coverage-N.json`.
// Combined with `clean: false` below this removes the "Something removed the
// coverage directory" / ENOENT coverage/.tmp/coverage-0.json race that made
// two consecutive `--coverage` runs both exit 1 (vitest v8 provider, #5903
// / #4943 / #5521). Verify: `npm test -- --coverage` exits 0 with a summary
// table printed.
const coverageDir = join(import.meta.dirname, "coverage");

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
      reportsDirectory: coverageDir,
      // Do not wipe `reportsDirectory` at run start. The default `clean: true`
      // races with in-flight `forks` workers flushing into `coverage/.tmp/`
      // and removes the directory out from under them (D3-4). The dir is
      // .gitignore'd and overwritten per run, so a pre-run wipe buys nothing.
      clean: false,
      all: true,
      include: ["src/**/*.ts"],
      exclude: [
        "src/hooks/types.ts",
        "src/worktree/types.ts",
        "src/workspace/types.ts",
        // D3-M3 (Cycle 10 Wave-3 Medium rollover): exclude the CLI bootstrap
        // entry point. `src/cli/index.ts` is top-level executed code (process
        // signal handlers, argv parsing, program.parseAsync) — running it
        // under vitest invokes the actual CLI flow. The natural test for it
        // (`src/__tests__/cli/entrypoint.test.ts`) spawns a built binary via
        // `execFileSync(node, dist/cli/index.js)`, which v8 coverage cannot
        // attribute back to the source file. The result was a persistent 0%
        // line on the coverage report that misrepresented overall coverage
        // health. Exclude is the right move — the dist subprocess test still
        // exercises every documented branch end-to-end.
        "src/cli/index.ts",
        "**/*.test.ts",
        "**/__tests__/**",
      ],
      thresholds: {
        statements: 78,
        branches: 65,
        functions: 80,
        lines: 80,

        // Per-directory thresholds for critical modules (#41).
        // `src/integrity/**` was removed in Cycle 10 F19.2.1 (D19): the
        // directory no longer exists — SHA-256 manifest integrity was replaced
        // by adapter-output drift detection (`hatch3r status` / `hatch3r
        // verify` regenerate from bundled content and diff against on-disk).
        // A threshold key for a non-existent directory is dead config.
        "src/merge/**": {
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
        // Bucket 2.x safety-critical pipeline modules (F3.5-F1, Cycle 10 Wave 2,
        // D3 Test Infrastructure). checkpoint.ts/snapshot.ts mutate resumability
        // state on the critical path; the global tier (78/65/80/80) lets a new
        // uncaught branch drop coverage to 65 and still merge. Per-file gate
        // pins them at the merge/integrity tier (90/80/90/90) for statements,
        // functions, and lines. checkpoint.ts clears branch 80 (measured 83.92).
        // snapshot.ts branch threshold is pinned to its measured floor (77.65 at
        // SHA 7367d92) rather than 80: lifting it would require new
        // snapshot.test.ts cases, which fall outside this work unit's file locks
        // (vitest.config.ts, src/content/orphanScan.ts). 77 still gates
        // regression — the finding's intent — and is a +12-point lift over the
        // global 65 baseline. Raising to 80 is queued as a Cycle 11 follow-up.
        "src/pipeline/checkpoint.ts": {
          statements: 90,
          branches: 80,
          functions: 90,
          lines: 90,
        },
        "src/pipeline/snapshot.ts": {
          statements: 90,
          branches: 77,
          functions: 90,
          lines: 90,
        },
        "src/content/**": {
          statements: 85,
          branches: 70,
          functions: 85,
          lines: 85,
        },
        // orphanScan.ts (F3.5-F2, Cycle 10 Wave 2, D3 Test Infrastructure).
        // The directory aggregate above cleared the bar on the back of other
        // content modules while orphanScan.ts sat near 0% (import-time only).
        // Pin it at the content tier so its dedicated tests cannot silently
        // regress the orphan-detection / --clean-orphans cleanup path.
        "src/content/orphanScan.ts": {
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
