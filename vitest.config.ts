import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
//
// D3-SA3.5-05 (Cycle 12 Wave 3): a SHARED coverage/ tree makes concurrent
// vitest runs mutually destructive — the first finisher's post-merge temp
// cleanup removes coverage/.tmp out from under an in-flight sibling (ENOENT,
// exit 1), observed twice when the audit fan-out ran D3 SAs in parallel in one
// checkout. Honor a HATCH3R_COVERAGE_DIR override so a concurrent run can point
// at its own isolated tree (e.g. HATCH3R_COVERAGE_DIR="$(mktemp -d)/coverage");
// a relative value resolves against the repo root, preserving the chdir-immunity
// above. Unset → the default coverage/ tree.
const coverageDir = process.env.HATCH3R_COVERAGE_DIR
  ? resolve(import.meta.dirname, process.env.HATCH3R_COVERAGE_DIR)
  : join(import.meta.dirname, "coverage");

// D3/D14-1 heavy-FS lane isolation (widened: D14 lane-fix-v2). A class of tests
// drive a real command/snapshot path — `initCommand()`, `syncCommand()`,
// `updateCommand()`, `createSnapshot()`/`withSnapshot()`, `rollbackCommand()` —
// over a fresh `os.tmpdir()` working tree, performing the suite's largest
// batches of tmp+rename atomic writes (root + per-package × per-adapter, plus
// the post-rename parent-dir datasync in src/merge/safeWrite.ts, D11-5). When
// these batches are scheduled into the default parallel `forks` pool alongside
// each other, concurrent fork-worker filesystem churn makes a just-created
// parent dir intermittently invisible to a subsequent `mkdir`/`rename`/`open`
// in the same batch — a flood of `ENOENT` plus 30s/60s timeouts that fails the
// tests under the full parallel load while ALL of them pass together in
// isolation (7 files / 240 tests green run alone; verified). Proven
// environmental: it reproduces identically whether the temp root is on the OS
// /tmp or the repo's own volume, so it is contention, not a /tmp-saturation or
// product bug (src/ write logic is unchanged).
//
// Fix (two parts):
//   1. Run exactly these files in a SEPARATE project ("heavy-fs") with a later
//      `sequence.groupOrder` (1) than the rest of the suite (0). Vitest runs
//      project groups from lowest groupOrder to highest, one group at a time
//      (vitest docs: "groups are run from lowest to highest"). So the "main"
//      group runs in full parallel first; only after it drains does "heavy-fs"
//      run — ALONE, with no concurrent main-group FS churn.
//   2. Give the heavy-fs project NO internal parallelism: `fileParallelism:
//      false` + `poolOptions.forks.singleFork: true` runs its files ONE AT A
//      TIME in a single fork. With at most one heavy FS batch in flight at any
//      instant, the parent-dir-visibility race has no concurrent writer to race
//      against — contention is removed at the source, not merely reduced.
// The "main" group keeps full parallelism (no global serialization); the only
// added wall-clock cost is the sequential tail of the heavy-fs files (~5-10
// min), appended after the existing parallel run. Acceptable per D14 lane-fix-v2.
//
// Membership rule: a file belongs here iff it runs a real (unmocked) command or
// snapshot path over os.tmpdir. Files that mock the snapshot/safeWrite/sync
// layer stay in "main". `src/__tests__/workspace/resolve.test.ts` was evaluated
// and kept in "main" — it is pure logic with no tmpdir/command FS work.
const HEAVY_FS_TEST_FILES = [
  // Originally isolated (D14-1).
  "src/__tests__/cli/status.test.ts",
  "src/__tests__/cli/verify.test.ts",
  // CLI commands that init/sync/update a real tmpdir tree.
  "src/__tests__/cli/init.test.ts",
  "src/__tests__/cli/sync.test.ts",
  "src/__tests__/cli/update.test.ts",
  "src/__tests__/cli/lifecycle.test.ts",
  "src/__tests__/cli/migration-checkpoints.test.ts",
  "src/__tests__/cli/config.test.ts",
  "src/__tests__/cli/rollback.test.ts",
  "src/__tests__/cli/commands/init.userPrompt.test.ts",
  "src/__tests__/cli/commands/init.cliToolsDisclaimer.test.ts",
  // End-to-end real init/create flow over tmpdir.
  "src/__tests__/e2e/createFlow.test.ts",
  // Workspace monorepo sync over a real tmpdir tree.
  "src/__tests__/workspace/sync.test.ts",
  // Snapshot/rollback engine: real createSnapshot tmp+rename batches.
  "src/__tests__/pipeline/snapshot.test.ts",
  "src/__tests__/pipeline/snapshot.errorPaths.test.ts",
  // D3-SA3.5-08 (Cycle 12 Wave 4): runs 3 unmocked createSnapshot() batches over
  // a real mkdtemp(os.tmpdir()) tree — belongs here per the iff membership rule
  // above; previously ran (undetected) in the fully-parallel main group.
  "src/__tests__/pipeline/bucket-2x-composition.test.ts",
];

// Test-file glob for the "main" project. Must match the SAME file set vitest's
// built-in default include resolved before this split — the suite has tests in
// BOTH `src/__tests__/` and `scripts/__tests__/`. Restricting to `src/**` here
// would silently drop every `scripts/` gate test, so both roots are listed
// explicitly. `node_modules`/`dist` are covered by vitest's default excludes.
// (Count-free by policy — D3-SA3.5-10, Cycle 12 Wave 4: embedded file/test
// counts drift silently against the growing suite; the glob is behavior-gated.)
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
          // set: a project-level `exclude` REPLACES the defaults rather than
          // extending them, so omitting these would let the main project scan
          // node_modules/.git for specs. Spreading HEAVY_FS_TEST_FILES here also
          // keeps the {main, heavy-fs} partition mutually exclusive — each test
          // file runs in exactly one project. (The restrictive `include` above
          // already gates node_modules/.git out, so that part is
          // defense-in-depth — verified via `vitest list` parity.)
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
          // Heavy-fs tests materialize full content trees (many file writes); on
          // I/O-slow windows-latest CI runners the heaviest (full x 3-adapter
          // init + the GitHub/Azure/GitLab interactive single-repo flows)
          // intermittently exceed a flat 30s -> spurious "Test timed out in
          // 30000ms" (variance: same tests pass on faster runners). Give windows
          // headroom; keep the tight 30s hang-tripwire on the fast OSes
          // (Linux/macOS finish well under it). Per-test overrides still win.
          testTimeout: process.platform === "win32" ? 120000 : 30000,
          hookTimeout: 30000,
          // Later group → runs alone, after "main" fully drains.
          sequence: { groupOrder: 1 },
          // No internal parallelism: run heavy-fs files ONE AT A TIME in a
          // single worker so no two heavy FS batches are ever in flight at once
          // — the parent-dir visibility race (ENOENT under load) then has no
          // concurrent writer to race against. This, not the groupOrder split
          // alone, makes the lane deterministic: groupOrder only removes
          // main-group contention, `fileParallelism: false` removes the
          // contention BETWEEN these heavy files. In Vitest 4 the legacy
          // `poolOptions.forks.singleFork` was removed (pool rework); the
          // top-level levers below are the v4 equivalent. Per the v4 InlineConfig
          // JSDoc (node_modules/vitest/dist/chunks/reporters.d.*.d.ts), setting
          // `fileParallelism: false` "will override `maxWorkers` option to `1`",
          // i.e. one worker, one file at a time — exactly single-fork behavior.
          // `pool: "forks"` (the v4 default) and `maxWorkers: 1` are stated
          // explicitly to document the single-worker guarantee.
          pool: "forks",
          fileParallelism: false,
          maxWorkers: 1,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      // D3-SA3.5-02 (Cycle 12 Wave 2, D3): generate the coverage report and
      // evaluate thresholds even when the suite has failing tests. The default
      // (`false`) skips report generation on any test failure, so a
      // coverage regression that rides along during a red window stays dark
      // until the suite is green again — the threshold gate is blind exactly
      // when the tree is unhealthy. Cost: report generation on failed runs.
      reportOnFailure: true,
      reportsDirectory: coverageDir,
      // Do not wipe `reportsDirectory` at run start. The default `clean: true`
      // races with in-flight `forks` workers flushing into `coverage/.tmp/`
      // and removes the directory out from under them (D3-4). The dir is
      // .gitignore'd and overwritten per run, so a pre-run wipe buys nothing.
      clean: false,
      // `coverage.all` was removed in Vitest 4 (vitest.dev/guide/migration:
      // "we have removed coverage.all completely and defaulted to include only
      // covered files in the report"). It was dead config under vitest ^4 —
      // silently ignored — and a type error once `scripts/` + root configs are
      // type-checked (tsconfig.scripts.json). Removed D4-SA4.1-01 (Cycle 12);
      // the `include` glob below already scopes the report surface.
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
        // src/manifest/** (D3-SA3.3-04, Cycle 12 Wave 3, D3 Test Infrastructure).
        // The persistence boundary for all user state — hatch.json, provenance,
        // rehydration, MCP filtering. Before this row the family rode the global
        // 78/65/80/80 aggregate, the same masking the config was amended three
        // times to prevent (orphanScan F3.5-F2, pipelineContext D7-4, src/cli
        // D3-11): provenance.ts sits at 34.78% branch file-scoped while the
        // repo-wide aggregate stays green, so a manifest-module regression is
        // mergeable. Pinned to the measured slice floor (83.7/80.93/86.66/84.42,
        // src/__tests__/manifest+manifests+migration) minus a 1-2pt variance
        // buffer. Vitest still counts glob-matched files into the global
        // aggregate (vitest.dev/config/coverage), so this cannot weaken the
        // global gate. Lift to the content tier (85/70/85/85) after D3-SA3.3-03's
        // tests land; re-measure under the full CI coverage gate first (slice
        // figures are lower bounds).
        "src/manifest/**": {
          statements: 83,
          branches: 78,
          functions: 85,
          lines: 84,
        },
        // src/workspace/** (DD-E6, release/2.8.5). The multi-repo cascade —
        // manifest read/validate/migrate, layered-merge resolution, and the
        // parallel sub-repo sync whose exit-0-on-partial-failure defect DD-B
        // fixed — previously had NO scoped threshold (only the types.ts
        // exclusion) and rode the global 78/65/80/80 aggregate, so a
        // workspace-only regression was mergeable while over-covered dirs
        // carried the repo-wide gate. Pinned per the src/cli/** measured-floor
        // policy above: measured on the serialized slice run
        // (src/__tests__/workspace/** + cli/sync.test.ts, 2026-07-28) at
        // 87.29/76.59/97.22/89.63 (stmts/branch/func/lines, types.ts
        // excluded), minus a ~2pt cross-platform-variance buffer. Slice
        // figures are lower bounds — the full CI gate only adds coverage —
        // so the floor cannot false-fail there. Lift toward the content tier
        // (85/70/85/85 is already met; next stop 90/80/90/90) after the
        // remaining git.ts branch gaps get their own suites; re-measure
        // before raising any dimension.
        "src/workspace/**": {
          statements: 85,
          branches: 74,
          functions: 95,
          lines: 87,
        },
        // src/cli/** (D3-11, Cycle 11 Wave-3 Medium). Before this row the CLI —
        // 19 command files (one, src/cli/index.ts, is coverage-excluded above)
        // plus 20 shared modules under src/cli/shared/, the largest user-facing
        // surface in the repo — had NO scoped threshold and rode the global
        // 78/65/80/80 floor. The directory aggregate cleared that floor on the
        // back of over-covered modules elsewhere (src/merge, src/content, …), so
        // a CLI-only regression could drop CLI coverage well below 80 lines and
        // still merge as long as the repo-wide aggregate held — the exact gap
        // D3-3 surfaced (deps.ts at 1.35% / show.ts at 3.94% lines rode along
        // unguarded until D3-3 added their command-body tests). Pinning a
        // src/cli/** floor isolates the CLI: a CLI-scoped line/statement drop now
        // trips this key independently of the global aggregate. The post-D3-3
        // command-body tests (src/__tests__/cli/commands/{deps,show,provenance}.test.ts)
        // lift the aggregate clear of the values below; statements is set +2 over
        // the global (80 vs 78) as the added bar, branches/functions/lines match
        // the global tier so the protection comes from the per-directory scoping
        // rather than from raising every dimension on an aggregate that cannot be
        // re-measured inside a non-coverage work unit. These match the SA3.5-F3
        // recommended floor verbatim. Policy for this row (reconciled by
        // D3-SA3.2-03, Cycle 12 — the pre-authorization text below previously
        // read "Do not lower below the global 78/65/80/80", which contradicted
        // the applied sub-global pins and mis-led a top-down reader into
        // "correcting" them upward): a measured-floor pin BELOW the global
        // 78/65/80/80 tier is permitted ONLY when a serialized `--coverage`
        // measurement disproves the above-global premise — as the correction
        // below records. A sub-global pin still gates regression at its measured
        // level; its restoration to the global tier is tracked as a registered
        // finding (here D3-SA3.2-03), never silently raised. Hand-raising these
        // pins without the backing test work reds all 9 CI cells, so re-measure
        // first (a fresh `--coverage` run) before moving any dimension up.
        // Re-measure-and-pin is pre-authorized for this row only.
        // Measured-floor correction (Cycle 11 close-out, serialized --coverage gate):
        // D3-11's pins above ASSUMED src/cli rode ABOVE the global 78/65/80/80 on
        // the post-D3-3 command-body tests. The serialized `npm test -- --coverage`
        // gate disproved that premise — src/cli/** measures 74.03/59.85/75.56/75.82
        // (stmts/branch/func/lines), genuinely BELOW the global tier (it is the
        // repo's lowest-covered surface; the global aggregate passes only on
        // over-covered dirs elsewhere). The floor is pinned to the measured level
        // minus a ~1-2pt cross-platform-variance buffer, so it still trips on a
        // real src/cli regression. Lifting src/cli to the global tier is follow-up
        // test work tracked as Cycle-12 finding D3-SA3.2-03 (raise in <=2 waves:
        // land the missing prompt-layer / cancel-branch / error-path tests,
        // re-measure, then raise these pins to the new measured floor).
        "src/cli/**": {
          statements: 73,
          branches: 58,
          functions: 74,
          lines: 74,
        },
      },
    },
  },
});
