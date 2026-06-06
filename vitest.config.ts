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

// D3/D14-1 heavy-FS lane isolation. The two heaviest filesystem tests run a real
// `syncCommand()` over a 2-package × 2-adapter monorepo — the largest batch of
// tmp+rename atomic writes in the suite (root + per-package × per-adapter, plus
// the post-rename parent-dir datasync in src/merge/safeWrite.ts, D11-5). When
// that batch is scheduled into the default parallel `forks` pool alongside the
// rest of the FS-heavy suite, the concurrent fork-worker filesystem churn makes
// a just-created parent dir intermittently invisible to a subsequent
// `mkdir`/`rename`/`open` in the same batch — a flood of `ENOENT` that fails
// these two tests under load while they pass 22/22 in isolation. Proven
// environmental: it reproduces identically whether the temp root is on the OS
// /tmp or the repo's own volume, so it is contention, not a /tmp-saturation or
// product bug (src/ write logic is unchanged).
//
// Fix: run exactly these two files in a SEPARATE project ("heavy-fs") with a
// later `sequence.groupOrder` than the rest of the suite. Vitest runs project
// groups from lowest groupOrder to highest, one group at a time (vitest docs:
// "groups are run from lowest to highest"). So the "main" group runs the whole
// suite in full parallel first; only after it drains does "heavy-fs" run — and
// it runs ALONE, with no concurrent FS churn, removing the contention at the
// source. The two heavy files still run in parallel WITHIN their own group
// (that is the same shape that passes 22/22 in isolation), so the only added
// wall-clock cost is the short serial tail of these two files (~60-90s),
// appended after the existing parallel run. The rest of the suite keeps its
// existing parallelism — no global serialization.
const HEAVY_FS_TEST_FILES = [
  "src/__tests__/cli/status.test.ts",
  "src/__tests__/cli/verify.test.ts",
];

// Test-file glob for the "main" project. Must match the SAME file set vitest's
// built-in default include resolved before this split — the suite has tests in
// BOTH `src/__tests__/` (186 files) and `scripts/__tests__/` (18 files), 204
// total. Restricting to `src/**` here would silently drop the 18 script tests,
// so both roots are listed explicitly. `node_modules`/`dist` are covered by
// vitest's default excludes.
const DEFAULT_TEST_GLOB = [
  "src/**/*.{test,spec}.?(c|m)[jt]s?(x)",
  "scripts/**/*.{test,spec}.?(c|m)[jt]s?(x)",
];

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    testTimeout: 30000,
    hookTimeout: 30000,
    // Two-group project split (see HEAVY_FS_TEST_FILES note above). `coverage`,
    // `define`, and the timeouts stay at the root: `coverage` is a vitest
    // non-project option that aggregates across every project, so the global +
    // per-directory thresholds below still gate the full run. Each project
    // re-declares `testTimeout`/`hookTimeout` because, unlike `coverage`, those
    // are per-project options that do NOT inherit the root value once `projects`
    // is set.
    projects: [
      {
        define: { __VERSION__: JSON.stringify(pkg.version) },
        test: {
          name: "main",
          include: DEFAULT_TEST_GLOB,
          // Re-state vitest's built-in default excludes alongside the heavy-FS
          // pair: a project-level `exclude` REPLACES the defaults rather than
          // extending them, so omitting these would let the main project scan
          // node_modules/.git for specs. (The restrictive `include` above
          // already gates those out, so this is defense-in-depth, not a
          // behavior change — verified via `vitest list` parity.)
          exclude: ["**/node_modules/**", "**/.git/**", ...HEAVY_FS_TEST_FILES],
          testTimeout: 30000,
          hookTimeout: 30000,
          sequence: { groupOrder: 0 },
        },
      },
      {
        define: { __VERSION__: JSON.stringify(pkg.version) },
        test: {
          name: "heavy-fs",
          include: HEAVY_FS_TEST_FILES,
          testTimeout: 30000,
          hookTimeout: 30000,
          // Later group → runs alone, after "main" fully drains.
          sequence: { groupOrder: 1 },
        },
      },
    ],
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
        // pipelineContext.ts (D7-4, Cycle 11 Wave 2, D7 Phase 4 completion /
        // test infra). The module is `@library_export_only` (the CLI never
        // instantiates a PipelineContext — runtime is the host coding tool), so
        // the directory aggregate above masked the file at 59.85% stmts and
        // evaluatePhase4Completion (the Phase 4 fail-closed gate) sat at 0 hits
        // while npm test exited 0. The D7-4 describe block lifted it to 75.91
        // stmts / 78.26 branch / 70 func / 76.51 line (SHA-local measurement).
        // Pinned to the measured floor — like snapshot.ts above — so the Phase 4
        // completion-contract coverage cannot silently regress. Floors are below
        // the 85 critical tier because the remaining gap is untested sibling
        // type/constant exports outside this finding's scope; raising the floor
        // to 85 is a Cycle 11 follow-up (cover the residual library exports).
        "src/pipeline/pipelineContext.ts": {
          statements: 75,
          branches: 78,
          functions: 70,
          lines: 76,
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
