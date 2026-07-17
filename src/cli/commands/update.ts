import { readFile, readdir, stat, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import { readManifest, writeManifest, addManagedFile } from "../../manifest/hatchJson.js";
import { writeProvenance, type PerAdapterOutputs, type ProvenanceCommand } from "../../manifest/provenance.js";
import { getApplicableCheckpoints } from "../../version/checkpoints.js";
import { getAdapter, getUnsupportedFeatureWarnings } from "../../adapters/index.js";
import { safeWriteFile, sweepOrphanTmpFiles, formatOrphanTmpSweepDiagnostic } from "../../merge/safeWrite.js";
import { withSnapshot, createSnapshot } from "../../pipeline/snapshot.js";
import { sweepOrphansForAdapter, formatOrphanCleanupDiagnostic, type OrphanCleanupEntry } from "../../merge/orphanCleanup.js";
import { HATCH3R_DIR, HatchError, WORKTREE_CAPABLE_TOOLS, WORKTREE_INCLUDE_FILE, type HatchManifest, type Platform } from "../../types.js";
import { resolveBundledContentRoot } from "../../content/contentRoot.js";
import { migrateAgentsToHatch3r } from "../../migration/agentsToHatch3r.js";
import { generateWorktreeInclude, extractManagedContent } from "../../worktree/index.js";
import { ensureEnvMcp, ensureGitignoreEntry, getSourceEnvMcpCommand } from "../../env/mcpEnv.js";
import { HATCH3R_VERSION } from "../../version.js";
import { writeFailureLog } from "../../pipeline/failureLog.js";
import { getRunId } from "../shared/runId.js";
import { generateWithTimeout } from "../../pipeline/adapterTimeout.js";
import {
  createCircuitBreaker,
  shouldAllowRequest,
  recordSuccess,
  recordFailure,
  classifyFailure,
  classifyDependency,
  getRecoveryGuidance,
  hydrateBreakersFromLog,
  serializeBreakerMap,
  BREAKER_STATE_FILE,
  type CircuitBreakerState,
} from "../../pipeline/circuitBreaker.js";
import { executeWithPhaseTimeout } from "../../pipeline/phaseTimeout.js";
import {
  runWithPipelineDeadman,
  PipelineTimeoutError,
  DEFAULT_PIPELINE_TIMEOUT_MS,
} from "../../pipeline/pipelineTimeout.js";
import {
  writeCheckpoint,
  workspaceDir,
  type CheckpointMeta,
  type CheckpointWorkspaceCommand,
} from "../../pipeline/checkpoint.js";
import { compactPhaseOutput } from "../../pipeline/phaseOutputSchema.js";
import { retryWithBackoff } from "../../pipeline/retryWithBackoff.js";
import {
  createSpinner,
  printBox,
  printNextSteps,
  printTimingSummary,
  error as logError,
  info,
  warn,
  step,
  label,
  verbose,
} from "../shared/ui.js";
import { emitJson, type CliOutputFormat } from "../shared/output.js";
import { beginCommand, finishCommand } from "../shared/commandOutput.js";
import {
  assertManifest,
  MISSING_MANIFEST_MESSAGE,
  MISSING_MANIFEST_HINT,
} from "../shared/requireManifest.js";
import { runSelfUpdate, pickReExecBin } from "../../install/selfUpdate.js";
import { pruneArchives } from "../../archive/index.js";
import { buildSelectionsFromDisk } from "../../content/index.js";
import { detectLanguages } from "../../detect/repoAnalyzer.js";
import { scanOrphanFiles, formatOrphanScanDiagnostic } from "../../content/orphanScan.js";
import { validateLearningsDirectory } from "../../content/learningsValidation.js";
import { validateHandoffsDirectory } from "../../content/handoffs/index.js";
import { isBack } from "../shared/initSteps.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Translate updateCommand options back into CLI args for the re-exec child.
 * `--skip-fetch` is added by the caller; `--offline` is its alias and is
 * intentionally omitted to keep one canonical flag in the child's argv.
 */
function buildReExecPassThroughArgs(opts?: {
  yes?: boolean;
  diff?: boolean;
  force?: boolean;
  dryRun?: boolean;
  skipAuditSignatures?: boolean;
  pinVersion?: string;
}): string[] {
  const args: string[] = [];
  if (opts?.yes) args.push("--yes");
  if (opts?.diff) args.push("--diff");
  if (opts?.force) args.push("--force");
  if (opts?.dryRun) args.push("--dry-run");
  // C9-H51 (D15-SA15.4-F01): propagate the audit-skip flag to the re-exec
  // child so a security override the user explicitly opted into is not
  // silently dropped when the parent self-updates and re-execs into the
  // freshly installed binary. The re-exec child's audit step is already
  // a no-op (audit ran in the parent), but propagating keeps the flag
  // semantically consistent and supports future inner runs.
  if (opts?.skipAuditSignatures) args.push("--skip-audit-signatures");
  // F15.4-H2: propagate the version-pin so the re-exec child writes the
  // manifest under the same pin (or clears it on `--pin-version latest`).
  if (opts?.pinVersion) args.push("--pin-version", opts.pinVersion);
  return args;
}

/**
 * Read a file's content, returning null if the file does not exist.
 */
async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    verbose(`update: readFileOrNull(${filePath}) → null — ${message}`);
    return null;
  }
}

/**
 * Append a failure entry to the persistent failure log in `.hatch3r/`.
 *
 * F8.4.5 (Cycle 10 Wave 4, D8, P5): delegates to the single-source writer in
 * `src/pipeline/failureLog.ts::writeFailureLog` (previously reimplemented here
 * and in `sync.ts`). A write failure is surfaced through the `warn()` UI
 * helper rather than dropped to a bare `console.error`, so a failing audit
 * trail (EACCES, ENOSPC, read-only mount) is visible in the command output.
 * Failure logging still never breaks the update.
 *
 * D12-7 (Cycle 11 Wave 2, D12, P1): threads the per-run `correlationId` so
 * every CLI-written entry carries the same `HATCH3R_RUN_ID` the error funnel
 * prints to stderr (`src/cli/shared/errors.ts`, `src/cli/index.ts`). Without
 * it the entry had no run id and the "grep the failure log by this run id"
 * guidance in those funnels resolved to a key that was never present.
 */
async function appendFailure(agentsDir: string, phase: string, error: unknown, tool?: string): Promise<void> {
  const result = await writeFailureLog(agentsDir, phase, error, {
    tool,
    correlationId: getRunId(),
    version: HATCH3R_VERSION,
  });
  if (result.warning) warn(`[hatch3r update] ${result.warning}`);
}

/**
 * SA12.1-F05 (Cycle 10 Wave 4, D12, P1): throw an exit-2 `HatchError` when some
 * — but not all — adapters failed during a regenerate, mirroring the
 * partial-failure contract `hatch3r sync` enforces (`sync.ts` terminal throw).
 *
 * Exit code 2 (usage-class, per POSIX/sysexits) lets a CI pipeline distinguish
 * an incomplete update from a clean run by exit code alone — sync already does
 * this, and the two commands sharing one convention prevents a partial update
 * from being scored as success. The all-adapters-failed case is handled earlier
 * (inside `runRegenerate`), so this only fires for a true partial failure. A
 * no-op when `failedTools` is 0 or equals `totalTools`.
 *
 * D1-3 (Cycle 11 Wave 2, D1, P1): exported so `hatch3r config` can apply the
 * identical partial-failure contract after its own `runRegenerate` call.
 * `config` previously rendered a green "Config updated" box and exited 0 even
 * when one of several adapters failed to regenerate, scoring a partial config
 * change as success and silently leaving a stale tool output behind.
 */
export function throwOnPartialAdapterFailure(failedTools: number, totalTools: number): void {
  if (failedTools <= 0 || failedTools >= totalTools) return;
  const guidance =
    "Re-run `hatch3r update` (or `hatch3r update --offline` to regenerate without the package fetch); " +
    "inspect the per-adapter messages above for any substantive failure before retrying.";
  throw new HatchError(
    `Update completed with ${failedTools} adapter failure(s). ${guidance}`,
    2,
    "ADAPTER_ERROR",
    guidance,
  );
}

/**
 * D15-SA15.4-03 (Cycle 12 Wave 4, D15, P6): validate a `--pin-version` value
 * before it is persisted to `.hatch3r/hatch.json::versionConstraint` and fed to
 * `npm install hatch3r@<spec>` (`selfUpdate.ts::buildInvocation`). Without this
 * guard a typo'd pin (`2.2.o`, `^2,2`, a stray surrounding space) is written
 * verbatim and re-read on every subsequent `hatch3r update`, which then runs
 * `npm install hatch3r@<garbage>` — a failure that recurs until the manifest is
 * hand-cleared and reads like a registry problem rather than a self-inflicted
 * typo. `latest` is the pin-clearing sentinel handled by the caller and is not
 * passed here.
 *
 * Accepts an exact semver version OR a semver RANGE (the forms
 * `npm install hatch3r@<spec>` resolves): an optional comparator operator
 * (`^ ~ > >= < <= =`) and optional leading `v`, a version core (`1` / `1.2` /
 * `1.2.3` or an `x`/`*` wildcard segment), optional `-prerelease` and `+build`,
 * composed into hyphen ranges (`1.2.3 - 2.3.4`), whitespace-joined comparator
 * sets (`>=1.0.0 <2.0.0`), and `||` unions. Validated inline rather than via
 * `node-semver`: that package is only a transitive dependency here (no
 * `@types/semver`, and `package.json` is release-owned), so importing it
 * directly would not type-check.
 */
export function isValidVersionPin(spec: string): boolean {
  if (typeof spec !== "string") return false;
  // Reject surrounding whitespace outright (`npm install hatch3r@ 2.2.0` cannot
  // resolve); internal whitespace between comparators stays legal below.
  if (spec.length === 0 || spec.trim() !== spec) return false;
  const seg = "(?:[0-9]+|[xX*])"; // numeric or x-range wildcard segment
  const core = `${seg}(?:\\.${seg})?(?:\\.${seg})?`; // 1 | 1.2 | 1.2.3 | 1.x
  const pre = "(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?"; // -beta.1
  const build = "(?:\\+[0-9A-Za-z][0-9A-Za-z.-]*)?"; // +build.5
  const comparator = new RegExp(`^(?:[<>]=?|[=~^])?v?${core}${pre}${build}$`);
  for (const orClause of spec.split("||")) {
    const clause = orClause.trim();
    if (clause.length === 0) return false;
    // Hyphen range `A - B` (spaces mandatory around the hyphen per the semver
    // grammar) → validate both endpoints; otherwise a whitespace-joined
    // comparator set where every token must parse.
    const hyphen = clause.split(/\s+-\s+/);
    const tokens =
      hyphen.length === 2
        ? hyphen.map((t) => t.trim())
        : clause.split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length === 0 || !tokens.every((t) => comparator.test(t))) return false;
  }
  return true;
}

export interface UpdateResult {
  /**
   * D1-19 (Cycle 11 Wave 3, D1, P1): count of adapter-output files actually
   * written to disk this run (sum of every successful adapter's emitted paths).
   * Field name kept for back-compat (`config` + tests consume it), but the
   * value no longer means "canonical files copied" — Wave 3 removed user-side
   * canonical copying, so the old `copied[]` source was permanently empty and
   * rendered a factually false "0 canonical files updated". This counts the
   * files the regenerate genuinely produced.
   */
  copiedFiles: number;
  /**
   * D10-SA10.4-02 (Cycle 12, D10, P1): per-write disposition tally for the
   * regenerate's adapter writes — `created` / `merged` (managed-block merge,
   * user edits outside the markers preserved) / `regenerated` (full-file
   * rewrite) / `unchanged` / `skipped`. The five counters sum to
   * {@link copiedFiles}. Lets `update`'s and `config`'s summaries answer
   * "did it keep my edits?" the way sync's D10-M11 tally does, instead of a
   * bare file count. Always populated by `runRegenerate`; optional so
   * callers that stub an UpdateResult (test fixtures) stay source-compatible
   * — consumers must guard for absence.
   */
  writeActions?: {
    created: number;
    merged: number;
    regenerated: number;
    unchanged: number;
    skipped: number;
  };
  syncedTools: number;
  failedTools: number;
  version: string;
  /** Diff data: before/after snapshots for each generated file (only populated when --diff is used). */
  diffBefore?: Map<string, string | null>;
  diffAfter?: Map<string, string | null>;
  /**
   * Decision 27 (Bucket 2.2): session id of the pre-mutation snapshot
   * captured at the start of this run. `null` when no snapshot was taken
   * (e.g. test stub or future skip flag). Surfaced to the operator in the
   * success summary so `hatch3r rollback --session=<id>` is one keypress
   * away after a regret.
   */
  snapshotSessionId?: string | null;
}

/**
 * Fetch the latest hatch3r package via the project's package manager.
 *
 * C7-H9 (D1): Extracted from `runUpdate` so callers that only need to
 * regenerate output from already-installed canonical content (config,
 * verify --fix) can skip the 30s network step.
 *
 * Now a thin wrapper around `runSelfUpdate` (`src/install/selfUpdate.ts`)
 * which extends the original single-target behavior to refresh every
 * reachable hatch3r install (project-local + global) in one pass while
 * preserving the same step numbering and error semantics. Kept as an
 * exported function for back-compat with existing callers (`runUpdate`,
 * tests, mocks).
 */
export async function runPackageUpdate(
  rootDir: string,
  options: { stepOffset?: number; totalSteps?: number } = {},
): Promise<void> {
  await runSelfUpdate(rootDir, options);
}

/**
 * Regenerate canonical content, adapter outputs, and the integrity manifest
 * from the currently-installed hatch3r package — without fetching a new
 * package version.
 *
 * C7-H9 (D1): Extracted from `runUpdate` so config/verify --fix can skip
 * the network fetch. Callers that need to also pull a new package version
 * should call `runPackageUpdate` first (or use the combined `runUpdate`).
 *
 * Step numbering: this function emits 3 spinners starting at
 * `stepOffset + 1` of `totalSteps`. When called via `runUpdate` the offset
 * is 1 (after the package-update step) and total is 4.
 */
export async function runRegenerate(
  rootDir: string,
  manifest: HatchManifest,
  options: { stepOffset?: number; totalSteps?: number; diff?: boolean; snapshotCommandName?: CheckpointWorkspaceCommand; reuseSessionId?: string; force?: boolean } = {},
): Promise<UpdateResult> {
  const offset = options.stepOffset ?? 0;
  const total = options.totalSteps ?? 3;
  // Wave 6: idempotent migration shim. `updateCommand` already runs this,
  // but `runRegenerate` is also called directly (e.g. from tests, batch
  // pipelines) so re-run here to keep every entry point covered.
  await migrateAgentsToHatch3r(rootDir);
  // Wave 7: failure log writes target `.hatch3r/.failure-log.jsonl` (FAILURE_LOG_FILE).
  const hatch3rDir = join(rootDir, HATCH3R_DIR);

  // Decision 27 (Bucket 2.2) wiring: snapshot every file `runRegenerate`
  // is about to overwrite before any adapter writes. The caller passes a
  // `snapshotCommandName` so the session id namespaces correctly (e.g.
  // `update-...`, `config-...`). `runRegenerate` is also exported and
  // exercised from tests / batch tooling — when the caller omits the
  // name we default to "update" to match the historical entry point.
  const snapshotCommandName = options.snapshotCommandName ?? "update";
  const regenSnapshotPaths: string[] = [join(rootDir, HATCH3R_DIR, "hatch.json")];
  if (manifest.worktree?.enabled) {
    regenSnapshotPaths.push(join(rootDir, WORKTREE_INCLUDE_FILE));
  }
  for (const rel of manifest.managedFiles) {
    regenSnapshotPaths.push(join(rootDir, rel));
  }
  if (manifest.managedFilesByAdapter) {
    for (const paths of Object.values(manifest.managedFilesByAdapter)) {
      for (const rel of paths) regenSnapshotPaths.push(join(rootDir, rel));
    }
  }
  // D1-4 (Cycle 11 Wave 2, D1, P1/CQ4): pre-enumerate the output paths the
  // about-to-run adapters WILL produce and add them to the snapshot set BEFORE
  // capture, so a `hatch3r rollback --session=<id>` after this run also deletes
  // files this run newly CREATES — not just the ones it overwrites. The prior
  // list covered only `manifest.managedFiles`/`managedFilesByAdapter`, i.e. paths
  // an earlier run already recorded. When a `config`/`update` run enables a NEW
  // adapter (e.g. adds cursor), that adapter's outputs are absent from the
  // manifest at capture time, so no tombstone was recorded and rollback left the
  // freshly-created `.cursor/...` files on disk — contradicting the all-or-nothing
  // revert the success summary points the operator at. `createSnapshot` records a
  // `.tombstone` for any enumerated path that does not yet exist (snapshot.ts), so
  // adding these makes rollback remove them. `getOutputPaths` renders in memory
  // (no disk writes); a render failure for one adapter is non-fatal — that
  // adapter's paths simply miss the tombstone (prior behavior) while the rest are
  // still covered. Resolve the bundled root here (cheap, idempotent; re-resolved
  // for the generate loop below).
  const snapshotContentRoot = resolveBundledContentRoot();
  for (const tool of manifest.tools) {
    try {
      const wouldBePaths = await getAdapter(tool).getOutputPaths(snapshotContentRoot, manifest);
      for (const rel of wouldBePaths) regenSnapshotPaths.push(join(rootDir, rel));
    } catch (err) {
      verbose(`${snapshotCommandName}: snapshot path pre-enumeration for ${tool} skipped — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // D2-7 (Cycle 11 Wave 2, D2, P2): when the caller (config tool-removal path)
  // has already opened a snapshot session and captured the about-to-be-deleted
  // tool outputs into it BEFORE deletion, accumulate this regenerate's paths
  // into that SAME session id rather than minting a fresh one. `createSnapshot`
  // unions paths per session id (snapshot.ts), so the single session the caller
  // advertises (`hatch3r rollback --session=<id>`) restores both the removed
  // tool's files (captured pre-deletion by the caller) AND everything this run
  // overwrites/creates. Without this, config deleted the removed-tool outputs,
  // shrank `manifest.managedFiles`, and the regenerate snapshot — built from the
  // already-shrunken manifest — never captured the dropped paths, so the
  // advertised rollback could not restore them. A capture failure here downgrades
  // to a warning (Silent Failure Contract) but keeps the reused id, because the
  // caller's pre-deletion capture of the removed-tool bytes already succeeded.
  const dedupedSnapshotPaths = Array.from(new Set(regenSnapshotPaths));
  let snapshotSessionId: string | null;
  if (options.reuseSessionId) {
    snapshotSessionId = options.reuseSessionId;
    try {
      await createSnapshot(options.reuseSessionId, dedupedSnapshotPaths, {
        projectRoot: rootDir,
        onWarn: warn,
      });
    } catch (err) {
      warn(
        `${snapshotCommandName}: extending snapshot session ${options.reuseSessionId} failed — ` +
          `${err instanceof Error ? err.message : String(err)}. ` +
          `Removed-tool files captured before deletion remain restorable via ` +
          `\`hatch3r rollback --session=${options.reuseSessionId}\`.`,
      );
    }
  } else {
    const regenSnapshot = await withSnapshot(
      snapshotCommandName,
      dedupedSnapshotPaths,
      async (_sessionId) => undefined,
      { projectRoot: rootDir, onWarn: warn },
    );
    snapshotSessionId = regenSnapshot.sessionId;
  }

  // F16.1-C1 (Decision 27 / Bucket 2.2): record a checkpoint after each
  // mutation phase under `.<command>-workspace/checkpoint.json` (namespaced by
  // `snapshotCommandName`, so `update`, `config`, etc. don't collide). This
  // makes the resumability substrate functional even though `update`/`config`
  // run single-pass — the checkpoint records "this phase completed at this
  // hatch3r version" so a future resume read (or an operator inspecting state)
  // sees an authoritative progress marker. Best-effort: a checkpoint-write
  // failure routes through verbose() and never aborts the regenerate.
  const regenWorkspace = workspaceDir(rootDir, snapshotCommandName);
  const recordPhase = async (
    wave: number,
    status: "in-progress" | "passed" | "failed",
  ): Promise<void> => {
    const meta: CheckpointMeta = {
      baselineSha: HATCH3R_VERSION,
      lastPassedGateN: status === "passed" ? wave : Math.max(0, wave - 1),
      registrySha: "",
      timestamp: new Date().toISOString(),
    };
    try {
      await writeCheckpoint(regenWorkspace, snapshotCommandName, wave, status, meta);
    } catch (err) {
      verbose(`${snapshotCommandName}: checkpoint write (wave ${wave}, ${status}) skipped — ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // F6.4-H1 (D6, OWASP ASI06): materialization-time learnings + handoffs gate.
  // D15-13 (Cycle 11 Wave 3, D15, ASI06): accuracy correction (parity with
  // `hatch3r sync`). No CLI adapter reads the `learning` type; `.hatch3r/
  // learnings/` is loaded into a session by the runtime `hatch3r-learnings-
  // loader` agent, not a deterministic adapter sink. The passes below are a
  // defense-in-depth pre-flight at the CLI-write boundary that hard-fails the
  // run before a poisoned learning can be loaded by that runtime agent, NOT the
  // primary guard of a non-existent materialization sink. `.hatch3r/handoffs/`
  // ARE user-tier state consumed by resuming agents; the same pass refuses a
  // poisoned handoff before the next agent reads it. Run the deterministic
  // validators before any adapter writes output. D6-7 (Cycle 11 Wave 2, D6,
  // ASI06): a learnings
  // injection-pattern hit BLOCKS the regenerate (override with `--force`),
  // matching the handoffs validator which already treats P-LEARN matches as
  // hard errors; structural errors still block; benign advisories stay
  // warnings. ENOENT on either dir = clean state.
  try {
    const learnings = await validateLearningsDirectory(
      join(rootDir, HATCH3R_DIR, "learnings"),
      { maxCount: manifest.learnings?.maxCount },
    );
    const benignWarnings = learnings.warnings.filter((w) => !learnings.injectionHits.includes(w));
    if (benignWarnings.length > 0) {
      warn(`Learnings content scan: ${benignWarnings.length} advisory(ies):`);
      for (const w of benignWarnings) warn(`  ${w}`);
    }
    if (learnings.injectionHits.length > 0) {
      logError(`Learnings injection scan: ${learnings.injectionHits.length} prompt-injection / context-poisoning hit(s) detected (ASI06):`);
      for (const h of learnings.injectionHits) logError(`  ${h}`);
    }
    if (!learnings.valid || learnings.injectionHits.length > 0) {
      if (!learnings.valid) {
        warn(`Learnings validation: ${learnings.errors.length} structural error(s) detected`);
        for (const e of learnings.errors) warn(`  ${e}`);
      }
      if (!options.force) {
        logError(
          "Refusing to materialize tool context files with invalid or poisoned learnings. " +
          "Fix the offending file(s) under .hatch3r/learnings/, or re-run with --force.",
        );
        throw new HatchError(
          "Learnings pre-flight scan failed (use --force to override)",
          undefined,
          "VALIDATION_ERROR",
          "Fix the offending learning file(s) listed above (oversized, binary, invalid name, or matching an injection pattern), or re-run with `--force` to materialize them as-is.",
        );
      }
      warn("Continuing with --force: invalid/poisoned learnings will be materialized into tool context.");
    }

    // D6-7: auto-run the handoffs validator on the regenerate path too. The
    // handoffs validator classifies injection-pattern hits + integrity
    // mismatches + malformed frontmatter as blocking `errors`; drift advisories
    // stay warnings. `--force` overrides, mirroring the learnings gate.
    const handoffs = await validateHandoffsDirectory(
      join(rootDir, HATCH3R_DIR, "handoffs", "active"),
      { archivedDir: join(rootDir, HATCH3R_DIR, "handoffs", "archived") },
    );
    if (handoffs.warnings.length > 0) {
      warn(`Handoffs content scan: ${handoffs.warnings.length} advisory(ies):`);
      for (const w of handoffs.warnings) warn(`  ${w}`);
    }
    if (!handoffs.valid) {
      logError(`Handoffs validation: ${handoffs.errors.length} blocking error(s) detected (injection / integrity / schema):`);
      for (const e of handoffs.errors) logError(`  ${e}`);
      if (!options.force) {
        throw new HatchError(
          "Handoffs pre-flight scan failed (use --force to override)",
          undefined,
          "VALIDATION_ERROR",
          "Fix the offending handoff file(s) under .hatch3r/handoffs/active/ (injection pattern, integrity mismatch, or malformed frontmatter), or re-run with `--force`.",
        );
      }
      warn("Continuing with --force: invalid/poisoned handoffs remain on disk for resuming agents.");
    }
  } catch (err) {
    if (err instanceof HatchError) throw err;
    verbose(`Learnings/handoffs pre-flight scan skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  const s1 = createSpinner(step(offset + 1, total, "Resolving canonical content..."));
  s1.start();

  // Wave 3: canonical content lives inside the freshly installed hatch3r
  // package. No more `.agents/` materialization; adapters source from
  // resolveBundledContentRoot. No canonical or root AGENTS.md emission
  // (per blueprint v2 decisions #3 and #8).
  const canonicalContentRoot = resolveBundledContentRoot();
  s1.succeed(step(offset + 1, total, "Canonical content resolved"));

  // --diff: track file snapshots before and after generation
  const diffBefore = new Map<string, string | null>();
  const diffAfter = new Map<string, string | null>();

  const s2 = createSpinner(step(offset + 2, total, "Re-syncing adapter output..."));
  s2.start();
  const adapterFailures: { tool: string; error: string }[] = [];
  // Task #11 orphan-cleanup: snapshot the prior `managedFilesByAdapter` so
  // we can diff against the new outputs and unlink orphans.
  const previousManagedByAdapter: Record<string, string[]> = manifest.managedFilesByAdapter
    ? { ...manifest.managedFilesByAdapter }
    : {};
  const newManagedByAdapter: Record<string, string[]> = {};
  // D10-SA10.4-02 (Cycle 12, D10, P1): tally each write's user-visible
  // disposition (same merged/regenerated split sync's D10-M11 summary uses)
  // so update/config can render "M merged (your edits preserved) · K
  // regenerated (full overwrite)" instead of a bare file count. The prior
  // loop discarded safeWriteFile's return entirely.
  const writeActions: NonNullable<UpdateResult["writeActions"]> = {
    created: 0,
    merged: 0,
    regenerated: 0,
    unchanged: 0,
    skipped: 0,
  };
  const orphanEntries: OrphanCleanupEntry[] = [];
  // D12-4 (Cycle 11 Wave 2, D12, P2): collect each successful adapter's
  // outputs so `writeProvenance` can refresh `.hatch3r/provenance.json` after
  // the manifest write below. Captured on success only (a failed adapter
  // leaves its prior provenance rows untouched via the D11-M2 carry-forward),
  // so the rows always carry the live `sourceFiles[]` populated by
  // `BaseAdapter.generate()`.
  const perAdapterOutputs: PerAdapterOutputs[] = [];
  // Per-adapter circuit breakers and a phase-level timeout protect the
  // re-sync loop the same way they protect `hatch3r sync`.
  //
  // D8-M4: hydrate from the on-disk JSONL log so a recurring transient
  // failure surface (e.g. flaky MCP endpoint) is recognised as already-open
  // on the next invocation. Entries older than BREAKER_STATE_TTL_MS (24h)
  // are dropped on read; hydrate failures degrade to an empty map silently
  // since persistence is best-effort.
  const breakerStatePath = join(hatch3rDir, BREAKER_STATE_FILE);
  let breakers = new Map<string, CircuitBreakerState>();
  try {
    const breakerLog = await readFile(breakerStatePath, "utf-8");
    // Silent-writes sweep (release/2.7.1): hydrateBreakersFromLog keys the map
    // by serviceId (`adapter:<tool>`) while the regenerate loop keys by bare
    // tool name, so hydrated entries were never found by `breakers.get(tool)`
    // — every run re-counted failures from zero even when the persist
    // succeeded. Re-key into the loop's tool vocabulary at this seam; each
    // state keeps its full serviceId in `config`, so the serialized file
    // stays serviceId-keyed (parity with sync.ts).
    breakers = new Map(
      [...hydrateBreakersFromLog(breakerLog)].map(([serviceId, state]) => [
        serviceId.replace(/^adapter:/, ""),
        state,
      ]),
    );
    if (breakers.size > 0) {
      verbose(`Hydrated ${breakers.size} circuit breaker(s) from ${BREAKER_STATE_FILE}`);
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      const message = err instanceof Error ? err.message : String(err);
      verbose(`Breaker-state hydrate skipped: ${message}`);
    }
  }
  // F16.1-C1: generation phase begins.
  await recordPhase(1, "in-progress");
  // F8.3.4 (D8): wrap the adapter regenerate phase in a wall-clock deadman —
  // parity with `hatch3r sync`. The deadman aborts the in-flight phase on a
  // budget breach (threaded as `executeWithPhaseTimeout`'s parentSignal),
  // replacing the prior post-loop advisory `isPipelineTimedOut` check that
  // could never fire on a true hang.
  const adapterPhaseResult = await runWithPipelineDeadman(
    (deadmanSignal) =>
      executeWithPhaseTimeout(
        "adapter",
        // D8-10 (Cycle 11 Wave 3, D8, P-CQ4): parity with `hatch3r sync` — the
        // phase fn receives the phase AbortSignal (aborted on the phase-timeout
        // timer OR the chained `deadmanSignal` parentSignal below) and threads
        // it into `generateWithTimeout`'s parentSignal slot so a wall-clock
        // breach reaches the in-flight adapter via
        // `BaseAdapter.throwIfSignalAborted`. The prior no-argument fn passed
        // `undefined` there, severing the C9-H20 deadman→phase→adapter chain.
        async (phaseSignal) => {
          for (const tool of manifest.tools) {
      let breaker = breakers.get(tool) ?? createCircuitBreaker({ serviceId: `adapter:${tool}` });
      const allowResult = shouldAllowRequest(breaker);
      breaker = allowResult.state;
      if (!allowResult.allowed) {
        adapterFailures.push({
          tool,
          error: allowResult.reason ?? `Circuit open for adapter:${tool}`,
        });
        breakers.set(tool, breaker);
        continue;
      }
      const adapter = getAdapter(tool);
      try {
        // Run adapter generation with per-adapter timeout and retry-with-backoff
        // for transient failures. Substantive failures propagate immediately.
        // Wave 3: pass canonicalContentRoot (bundled-package path), not the
        // user-repo `.agents/` dir.
        const generationResult = await retryWithBackoff(
          // Wave 5: pass rootDir as userRepoRoot so D20 overrides at
          // <rootDir>/.hatch3r/overrides/ are layered onto bundled canonical.
          () =>
            generateWithTimeout(
              tool,
              adapter,
              canonicalContentRoot,
              manifest,
              "standard",
              undefined,
              // D8-10: parentSignal — phase signal carries the deadman abort so
              // a wall-clock breach surfaces as an AbortError on the adapter's
              // next await (deadman → phase controller → adapter).
              phaseSignal,
              rootDir,
            ),
          // D8-SA8.4-F8.4.6 (Cycle 10 Wave 4, D8, P-CQ4): deliberate fast-fail
          // override of retryWithBackoff's module default (DEFAULT_MAX_ATTEMPTS
          // = 3) to 2 (1 initial + 1 retry). `update` is interactive; a 3rd
          // attempt adds up to maxDelayMs (5s) of wall time on a failing run
          // for marginal added resilience. The per-adapter circuit breaker
          // already short-circuits recurring transient failures across
          // invocations, and the operator can re-run `update` cheaply.
          { maxAttempts: 2 },
        );
        if (!generationResult.completed) {
          const errMessage = generationResult.error ?? `Adapter ${tool} did not complete`;
          for (const w of generationResult.warnings) { warn(w); }
          breaker = recordFailure(breaker, classifyFailure(new Error(errMessage)));
          breakers.set(tool, breaker);
          throw new HatchError(
            errMessage,
            undefined,
            "ADAPTER_ERROR",
            `Re-run with --verbose for ${tool} detail, or run \`npx hatch3r validate\` to check canonical content.`,
          );
        }
        const outputs = generationResult.outputs ?? [];
        for (const w of generationResult.warnings) { warn(w); }
        const toolPaths: string[] = [];
        for (const out of outputs) {
          if (options.diff) {
            diffBefore.set(out.path, await readFileOrNull(join(rootDir, out.path)));
          }
          const fullPath = join(rootDir, out.path);
          // D11-H-1 (D11): thread `--force` into the write so update's flag
          // means the same thing sync's does — overwrite a hatch3r-prefixed
          // managed file even if the user stripped its HATCH3R:BEGIN/END
          // markers. Without `--force`, the safeWrite filename-prefix guard
          // still protects unmarked files.
          const writeResult = out.managedContent
            ? await safeWriteFile(fullPath, out.content, {
                managedContent: out.managedContent,
                // D10-SA10.4-01 (Cycle 12, D10, P1): splice the managed block
                // back into a file whose HATCH3R:BEGIN/END markers were
                // stripped, matching sync.ts's D11-H-3 write. Without this,
                // update/config/verify --fix (which all regenerate through
                // this loop) hit safeWrite's no-marker branch and returned
                // action "skipped" on every run — the managed block silently
                // stayed at the OLD canonical version after a version bump,
                // and only `hatch3r sync` could recover the file.
                appendIfNoBlock: true,
                force: options.force,
              })
            : await safeWriteFile(fullPath, out.content, { force: options.force });
          // Surface per-write warnings (marker recovery, managed-block
          // auto-repair, forced overwrite) exactly like sync does — dropping
          // them violates the Silent Failure Contract (CONSTITUTION §2 P5).
          if (writeResult.warning) warn(writeResult.warning);
          // D10-SA10.4-02: record the disposition. `updated` splits into
          // merged (managed-block merge, user edits preserved) vs regenerated
          // (full-file rewrite) via out.managedContent — the same
          // classification sync.ts::renderAction applies.
          switch (writeResult.action) {
            case "created":
              writeActions.created += 1;
              break;
            case "updated":
              if (out.managedContent) writeActions.merged += 1;
              else writeActions.regenerated += 1;
              break;
            case "unchanged":
              writeActions.unchanged += 1;
              break;
            case "skipped":
              writeActions.skipped += 1;
              break;
          }
          addManagedFile(manifest, out.path);
          toolPaths.push(out.path);
          if (options.diff) {
            diffAfter.set(out.path, await readFileOrNull(join(rootDir, out.path)));
          }
        }
        newManagedByAdapter[tool] = toolPaths;
        // D12-4: record this adapter's outputs for the provenance refresh.
        perAdapterOutputs.push({ adapter: tool, outputs });
        // Task #11 orphan-cleanup: sweep paths the prior run recorded that
        // this run did NOT re-emit. Skipped when no prior history exists.
        const priorPaths = previousManagedByAdapter[tool];
        if (priorPaths && priorPaths.length > 0) {
          const entries = await sweepOrphansForAdapter(tool, rootDir, priorPaths, toolPaths);
          orphanEntries.push(...entries);
        }
        breaker = recordSuccess(breaker);
        breakers.set(tool, breaker);
      } catch (err) {
        breaker = recordFailure(breaker, classifyFailure(err));
        breakers.set(tool, breaker);
        adapterFailures.push({
          tool,
          error: err instanceof Error ? err.message : String(err),
        });
        // Record to persistent failure log for post-hoc debugging
        await appendFailure(hatch3rDir, "update:adapter-generate", err, tool);
      }
    }
        },
        undefined,
        deadmanSignal,
      ),
    DEFAULT_PIPELINE_TIMEOUT_MS,
  ).catch(async (err: unknown) => {
    // F8.3.4: wall-clock breach — the in-flight adapter phase was signalled
    // to abort. Surface a usage-actionable timeout (exit 2) instead of a
    // silent partial regenerate.
    if (err instanceof PipelineTimeoutError) {
      // D8-M5: reconcile partial writes into the manifest before re-throw so
      // a post-timeout `hatch3r status` does not report drift on files the
      // aborted adapter loop already wrote. Mirrors the same handling in
      // `hatch3r sync`.
      try {
        const mergedByAdapter: Record<string, string[]> = { ...previousManagedByAdapter };
        for (const [tool, paths] of Object.entries(newManagedByAdapter)) {
          mergedByAdapter[tool] = [...paths];
        }
        if (Object.keys(mergedByAdapter).length > 0) {
          manifest.managedFilesByAdapter = mergedByAdapter;
          await writeManifest(rootDir, manifest);
          verbose(
            `Update deadman fired: reconciled ${Object.keys(mergedByAdapter).length} adapter entry(ies) ` +
              `into manifest before re-throw.`,
          );
        }
      } catch (reconcileErr) {
        const message = reconcileErr instanceof Error ? reconcileErr.message : String(reconcileErr);
        warn(`Manifest reconciliation after pipeline timeout failed: ${message}`);
      }
      logError(err.message);
      throw new HatchError(
        `Update exceeded its ${Math.round(err.timeoutMs / 1000)}s pipeline budget and was aborted.`,
        2,
        "ADAPTER_ERROR",
        "A hanging adapter or filesystem call exceeded the wall-clock budget. Re-run `hatch3r update --offline` to regenerate without the package fetch, or check for an unresponsive network mount under the project root.",
      );
    }
    throw err;
  });
  // F16.1-C1: generation/adapter phase completed.
  await recordPhase(1, "passed");
  if (!adapterPhaseResult.completed && adapterPhaseResult.error) {
    warn(adapterPhaseResult.error);
  }
  // D8-M4: persist the final breaker state so the next update/sync invocation
  // recognises an already-open circuit instead of burning the failure
  // threshold from zero again. Best-effort: write failures are logged but do
  // not abort the run since breaker state is an optimisation, not correctness.
  if (breakers.size > 0) {
    try {
      await mkdir(hatch3rDir, { recursive: true });
      // Silent-writes sweep (release/2.7.1): `.breaker-state.jsonl` is not a
      // hatch3r-managed filename, so once the file existed the un-forced write
      // was silently skipped and breaker state never persisted past the first
      // run. hatch3r-owned, machine-local, gitignored state: force, no `.bak`.
      await safeWriteFile(breakerStatePath, serializeBreakerMap(breakers), { force: true, backup: false });
      verbose(`Persisted ${breakers.size} circuit breaker(s) to ${BREAKER_STATE_FILE}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      verbose(`Breaker-state persist failed (continuing): ${message}`);
    }
  }
  // Task #11: emit aggregated orphan diagnostic (unlinked + safety skips +
  // failures) per the Silent Failure Contract.
  const orphanDiag = formatOrphanCleanupDiagnostic(orphanEntries);
  if (orphanDiag) warn(orphanDiag);
  // Task #11: persist updated `managedFilesByAdapter` — preserve entries
  // for failed adapters (we cannot verify their output changed) and
  // overwrite with fresh paths for successful ones.
  const mergedByAdapter: Record<string, string[]> = { ...previousManagedByAdapter };
  for (const [tool, paths] of Object.entries(newManagedByAdapter)) {
    mergedByAdapter[tool] = [...paths];
  }
  manifest.managedFilesByAdapter = mergedByAdapter;
  if (adapterFailures.length > 0) {
    // C8-D8-M1 (D8): classify each adapter failure by transient/substantive
    // and dependency class. Per-tool guidance is logged inline; the terminal
    // HatchError message carries an aggregated recovery hint so callers that
    // only see the thrown error (not the preceding log lines) still receive
    // an actionable next step.
    const classifiedFailures: { tool: string; depClass: ReturnType<typeof classifyDependency>; failType: ReturnType<typeof classifyFailure> }[] = [];
    for (const f of adapterFailures) {
      const reconstructed = new Error(f.error);
      const depClass = classifyDependency(reconstructed);
      const failType = classifyFailure(reconstructed);
      classifiedFailures.push({ tool: f.tool, depClass, failType });
      const guidance = getRecoveryGuidance(depClass, failType);
      logError(`Failed to generate ${f.tool}: ${f.error}`);
      info(`  ${guidance}`);
    }
    if (adapterFailures.length === manifest.tools.length) {
      s2.fail(step(offset + 2, total, "All adapters failed"));
      const allTransient = classifiedFailures.length > 0 && classifiedFailures.every((c) => c.failType === "transient");
      const aggregateGuidance = allTransient
        ? "All failures appear transient. Retry `hatch3r update`, or run with --offline to regenerate without the package fetch."
        : "One or more failures are substantive. Inspect the per-adapter messages above and resolve before retrying.";

      // SA12.1-F-D12-M12 (D12, P1): structured replay guidance integration.
      // Format guidance via createReplayGuidance/formatReplayGuidance so the
      // failure block carries reproduction steps + env snapshot inline.
      try {
        const { createReplayGuidance, formatReplayGuidance } = await import("../../pipeline/observability.js");
        const guidance = createReplayGuidance(
          getRunId(),
          "adapter",
          `All adapters failed: ${adapterFailures.map((f) => f.tool).join(", ")}`,
          {
            relevantFiles: adapterFailures.map((f) => f.tool),
            environmentSnapshot: {
              HATCH3R_VERSION,
              NODE_VERSION: process.version,
            },
          },
        );
        const formatted = formatReplayGuidance(guidance);
        console.error();
        for (const line of formatted.split("\n")) console.error(`  ${line}`);
        console.error();
      } catch (err) {
        verbose(`update: replay guidance emission skipped — ${err instanceof Error ? err.message : String(err)}`);
      }
      throw new HatchError(`All adapters failed. ${aggregateGuidance}`, undefined, "ADAPTER_ERROR", aggregateGuidance);
    }
  }
  s2.succeed(step(offset + 2, total, adapterFailures.length > 0
    ? `Re-synced ${manifest.tools.length - adapterFailures.length}/${manifest.tools.length} tool(s)`
    : `Re-synced ${manifest.tools.length} tool(s)`));

  // #107: Show unsupported feature warnings (parity with sync command)
  for (const tool of manifest.tools) {
    const warnings = getUnsupportedFeatureWarnings(tool, manifest);
    for (const w of warnings) { warn(w); }
  }

  // ── Reconciliation: .worktreeinclude & .env.mcp (parity with sync) ──
  if (manifest.worktree?.enabled) {
    const wtContent = await generateWorktreeInclude(manifest, rootDir);
    const wtManaged = extractManagedContent(wtContent);
    // Silent-writes sweep (release/2.7.1): appendIfNoBlock restores the
    // managed block when a user stripped the markers, matching sync.ts's
    // D11-H-3 worktree write — without it this write silently returned
    // "skipped" (and the warning was discarded) so update never healed the
    // file. Surface the MergeResult warning like sync does (Silent Failure
    // Contract, CONSTITUTION §2 P5).
    const wtResult = await safeWriteFile(
      join(rootDir, WORKTREE_INCLUDE_FILE),
      wtContent,
      { managedContent: wtManaged, appendIfNoBlock: true, force: options.force },
    );
    if (wtResult.warning) warn(wtResult.warning);
  }

  if (manifest.features.mcp && manifest.mcp.servers.length > 0) {
    const envResult = await ensureEnvMcp(rootDir, manifest.mcp.servers);
    await ensureGitignoreEntry(rootDir);
    if (envResult.newVars.length > 0) {
      warn(
        `New secrets needed in .env.mcp: ${envResult.newVars.join(", ")}`,
      );
      info(`Run this, then start or restart your editor: ${getSourceEnvMcpCommand()}`);
    }
  }

  const s3 = createSpinner(step(offset + 3, total, "Writing manifest..."));
  s3.start();
  manifest.hatch3rVersion = HATCH3R_VERSION;
  await writeManifest(rootDir, manifest);

  // D12-3 (D12, P6): `writeProvenance` below writes `.hatch3r/provenance.json`
  // unconditionally, but the only `ensureGitignoreEntry` call above is gated
  // behind `features.mcp`. A no-MCP update would leave the machine-local
  // provenance manifest stageable by the next `git add .`. Register the
  // gitignore carve-out unconditionally before writing it (idempotent — the
  // MCP-gated call above is a harmless redundant cover), mirroring the same
  // decoupling init.ts applies for snapshots/handoffs.
  await ensureGitignoreEntry(rootDir);

  // D12-4 (Cycle 11 Wave 2, D12, P2): refresh `.hatch3r/provenance.json` via
  // the shared `writeProvenance` helper so `hatch3r status` drift attribution
  // and `hatch3r explain --source` reflect the regenerated outputs after an
  // `update` — previously only `sync` rewrote the baseline, so post-update the
  // provenance manifest was stale (its `lastCommand` was even hard-coded
  // "sync"). `failedAdapters` drives the D11-M2 carry-forward so a partially-
  // failed update keeps the failed adapters' prior rows. Write failures surface
  // via `warn()` and never abort the regenerate (Silent Failure Contract, P5).
  //
  // D12-SA12.2-02 (Cycle 12 Wave 4, D12, P5): attribute `lastCommand` to the
  // ORIGINATING command, not the shared regeneration mechanism. `runRegenerate`
  // backs three entrypoints (`update`, `config <k>=<v>`, `verify --fix`) and
  // already receives their distinct identity as `snapshotCommandName`; thread
  // it into the provenance command so a `config` run stamps `"config"` instead
  // of masquerading as `"update"`. `verify-fix` deliberately maps to `"update"`
  // (a repair-regeneration is mechanically an update); every other name is
  // identity — and, being a `ProvenanceCommand` member, type-checks directly.
  const provenanceCommand: ProvenanceCommand =
    snapshotCommandName === "verify-fix" ? "update" : snapshotCommandName;
  await writeProvenance(rootDir, perAdapterOutputs, provenanceCommand, {
    failedAdapters: adapterFailures.map((f) => f.tool),
    onWarn: warn,
  });

  // F16.1-C1: merge phase (worktree + mcp env + manifest) committed.
  await recordPhase(2, "passed");

  // Wave 3: integrity manifest writes removed; Wave 7 will reintroduce a
  // bundled-content integrity model. Adapter outputs are no longer covered
  // by the legacy `.agents/`-scoped integrity manifest.

  // Prune stale archive entries
  await pruneArchives(rootDir);

  s3.succeed(step(offset + 3, total, "Manifest updated"));

  // D1-19 (Cycle 11 Wave 3, D1, P1): count the files this regenerate actually
  // wrote — the union of every successful adapter's emitted output paths
  // (`newManagedByAdapter`). The legacy `copied[]` source was dead after Wave 3
  // removed user-side canonical copying, so it always reported 0.
  const filesWritten = Object.values(newManagedByAdapter).reduce(
    (sum, paths) => sum + paths.length,
    0,
  );

  return {
    copiedFiles: filesWritten,
    writeActions,
    syncedTools: manifest.tools.length - adapterFailures.length,
    failedTools: adapterFailures.length,
    version: HATCH3R_VERSION,
    snapshotSessionId,
    ...(options.diff ? { diffBefore, diffAfter } : {}),
  };
}

/**
 * C8-D12-M2 (D12): Read-only preview of `runUpdate`.
 *
 * Enumerates the canonical files that would be copied and the adapter outputs
 * that would be written — without invoking `runPackageUpdate`, without
 * overwriting canonical content, and without mutating the integrity or
 * hatch.json manifests. Safe to run against a drifted working tree.
 *
 * Per-adapter grouping:
 *   + added      — adapter would create a new file at that path
 *   ~ modified   — adapter would overwrite an existing file whose content
 *                  differs from the generated output
 *   = unchanged  — adapter would write the same bytes already on disk
 *
 * Adapter outputs are produced in-memory via the same `generateWithTimeout`
 * pipeline used by sync/update.
 */
export async function runUpdateDryRun(
  rootDir: string,
  manifest: HatchManifest,
  options: { offline?: boolean } = {},
): Promise<{
  adapterChanges: Map<string, { added: string[]; modified: string[]; unchanged: string[]; error?: string }>;
}> {
  // D1-SA1.3-F1.3.9 (Cycle 10 Wave 4, D1, P1): the dry-run previously carried
  // a `canonicalCandidates: string[]` column that was hardcoded empty after
  // Wave 3 removed user-repo `.agents/` materialization (the enumerator helper
  // was deleted in a later wave). The "Canonical candidate files: 0" line was
  // misleading — canonical content is now bundled with the npm package and
  // immutable, so there is nothing to enumerate. Drop the dead column from the
  // output and return type rather than print a permanently-zero count.
  const canonicalContentRoot = resolveBundledContentRoot();

  const adapterChanges = new Map<
    string,
    { added: string[]; modified: string[]; unchanged: string[]; error?: string }
  >();

  for (const tool of manifest.tools) {
    const bucket = { added: [] as string[], modified: [] as string[], unchanged: [] as string[] };
    try {
      const adapter = getAdapter(tool);
      // Wave 5: dry-run also threads rootDir as userRepoRoot so the candidate
      // output set reflects D20 overrides under <rootDir>/.hatch3r/overrides/.
      const generationResult = await generateWithTimeout(
        tool,
        adapter,
        canonicalContentRoot,
        manifest,
        "standard",
        undefined,
        undefined,
        rootDir,
      );
      if (!generationResult.completed) {
        adapterChanges.set(tool, { ...bucket, error: generationResult.error ?? `Adapter ${tool} did not complete` });
        continue;
      }
      const outputs = generationResult.outputs ?? [];
      for (const out of outputs) {
        const existing = await readFileOrNull(join(rootDir, out.path));
        if (existing === null) bucket.added.push(out.path);
        else if (existing !== out.content) bucket.modified.push(out.path);
        else bucket.unchanged.push(out.path);
      }
      adapterChanges.set(tool, bucket);
    } catch (err) {
      adapterChanges.set(tool, { ...bucket, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const summaryLines: string[] = [];
  summaryLines.push(chalk.dim(`Offline: ${options.offline ? "yes" : "no"}`));
  for (const [tool, bucket] of adapterChanges) {
    if (bucket.error) {
      summaryLines.push(`${chalk.red("x")} ${tool}: ${bucket.error}`);
      continue;
    }
    const lines = [
      ...bucket.added.map((p) => `${chalk.green("+ added")}    ${p}`),
      ...bucket.modified.map((p) => `${chalk.yellow("~ modified")} ${p}`),
      ...bucket.unchanged.map((p) => `${chalk.dim("= unchanged")} ${p}`),
    ];
    summaryLines.push(chalk.bold(tool));
    summaryLines.push(...lines.map((l) => `  ${l}`));
  }
  console.log();
  printBox("Update dry run (no writes)", summaryLines.length > 0 ? summaryLines : [chalk.dim("No adapters configured.")], "info");
  return { adapterChanges };
}

/**
 * Combined package fetch + regenerate, preserving the legacy `runUpdate`
 * behavior used by `updateCommand`. Splits step numbering across both phases:
 * step 1 fetches the package, steps 2-4 regenerate.
 *
 * C7-H9 (D1): Callers that don't need the network fetch should call
 * `runRegenerate` directly to avoid the 30s package-update timeout.
 */
export async function runUpdate(
  rootDir: string,
  manifest: HatchManifest,
  options: { stepOffset?: number; totalSteps?: number; diff?: boolean; snapshotCommandName?: CheckpointWorkspaceCommand; force?: boolean } = {},
): Promise<UpdateResult> {
  const offset = options.stepOffset ?? 0;
  const total = options.totalSteps ?? 4;
  // Wave 6: top-level entry point; relocate pre-1.9 `.agents/` state up front.
  await migrateAgentsToHatch3r(rootDir);
  await runPackageUpdate(rootDir, { stepOffset: offset, totalSteps: total });
  return runRegenerate(rootDir, manifest, {
    stepOffset: offset + 1,
    totalSteps: total,
    diff: options.diff,
    snapshotCommandName: options.snapshotCommandName ?? "update",
    force: options.force,
  });
}

interface MigrationCheckpoint {
  id: string;
  condition: (manifest: HatchManifest, rootDir: string) => Promise<boolean>;
  // D1-SA1.3-02 (Cycle 12, D1, P2): `dryRun` lets a checkpoint suppress its
  // disk write during a `--dry-run` preview while still returning the
  // in-memory manifest mutation + a preview notice. Only the worktree
  // checkpoint (the sole disk-writing checkpoint) reads it; the others accept
  // the argument via structural typing and ignore it.
  execute: (manifest: HatchManifest, rootDir: string, headless: boolean, dryRun: boolean) => Promise<{ manifest: HatchManifest; notices: string[] }>;
}

const MIGRATION_CHECKPOINTS: MigrationCheckpoint[] = [
  {
    id: "content-selections-init",
    condition: async (manifest) => manifest.content === undefined,
    execute: async (manifest, rootDir, headless) => {
      // Wave 7: legacy `.agents/` probe — surviving for migration scans
      // that detect pre-1.9 layouts. New installs never write here.
      const agentsDir = join(rootDir, ".agents");
      const content = await buildSelectionsFromDisk(agentsDir);

      if (headless) {
        // Use safe defaults in headless/CI mode
        content.projectType = "brownfield";
        content.teamSize = "team";
      } else {
        // Ask user for context since we can't infer it from legacy installs
        const { projectType } = await inquirer.prompt<{ projectType: "greenfield" | "brownfield" }>([
          {
            type: "select",
            name: "projectType",
            message: "For content tracking — is this a greenfield or brownfield project?",
            choices: [
              { name: "Greenfield — new project", value: "greenfield" as const },
              { name: "Brownfield — existing codebase", value: "brownfield" as const },
            ],
            default: "brownfield",
          },
        ]);
        if (isBack(projectType)) {
          info("Update cancelled (Shift+Tab).");
          throw new HatchError("Update cancelled.", 0);
        }
        const { teamSize } = await inquirer.prompt<{ teamSize: "solo" | "team" }>([
          {
            type: "select",
            name: "teamSize",
            message: "Solo developer or team?",
            choices: [
              { name: "Solo", value: "solo" as const },
              { name: "Team", value: "team" as const },
            ],
            default: "team",
          },
        ]);
        if (isBack(teamSize)) {
          info("Update cancelled (Shift+Tab).");
          throw new HatchError("Update cancelled.", 0);
        }
        content.projectType = projectType;
        content.teamSize = teamSize;
      }

      return {
        manifest: { ...manifest, content },
        notices: ["Migrated to explicit content tracking (all existing items preserved)"],
      };
    },
  },
  {
    id: "platform-selection",
    condition: async (manifest) => !manifest.platform,
    execute: async (manifest, _rootDir, headless) => {
      let platform: Platform;

      if (headless) {
        // Default to github in headless/CI mode
        platform = "github";
      } else {
        const answer = await inquirer.prompt<{ platform: Platform }>([
          {
            type: "select",
            name: "platform",
            message: "hatch3r now supports multiple platforms. Select your platform:",
            choices: [
              { name: "GitHub", value: "github" as Platform },
              { name: "Azure DevOps", value: "azure-devops" as Platform },
              { name: "GitLab", value: "gitlab" as Platform },
            ],
            default: "github",
          },
        ]);
        // D3-SA3.2-01 (Cycle 12, D3/D1, CQ5): `update` is in BACKABLE_COMMANDS
        // (src/cli/index.ts), so Shift+Tab resolves this select to the BACK
        // sentinel. Without this guard the sentinel is assigned to `platform`,
        // routing the user into the GitLab/ADO identity branch and ultimately
        // failing manifest validation with a CONFIG_ERROR — mirror the
        // content-selections-init guard above and cancel cleanly instead.
        if (isBack(answer.platform)) {
          info("Update cancelled (Shift+Tab).");
          throw new HatchError("Update cancelled.", 0);
        }
        platform = answer.platform;
      }

      const updated = { ...manifest, platform };
      const notices: string[] = [];

      if (platform === "github") {
        updated.namespace = updated.namespace || updated.owner;
        updated.project = updated.project || updated.repo;
        notices.push("Migrated to GitHub platform (auto-detected from existing config)");
      } else {
        const answers = await inquirer.prompt<{ namespace: string; project: string; repo: string }>([
          { type: "input", name: "namespace", message: platform === "azure-devops" ? "Azure DevOps organization:" : "GitLab namespace (group or username):", default: updated.owner || undefined },
          { type: "input", name: "project", message: platform === "azure-devops" ? "Azure DevOps project:" : "Project name:", default: updated.repo || undefined },
          { type: "input", name: "repo", message: "Repository name:", default: updated.repo || undefined },
        ]);
        // D3-SA3.2-01 (Cycle 12, D3/D1, CQ5): guard every identity input for the
        // Shift+Tab BACK sentinel before assigning. Without this, a BACK symbol
        // is written to owner/repo/namespace/project and then silently dropped
        // by JSON.stringify at manifest-write time (symbols do not serialize) —
        // fail-silent identity loss, a Silent Failure Contract violation.
        // Cancel cleanly instead.
        if (isBack(answers.namespace) || isBack(answers.project) || isBack(answers.repo)) {
          info("Update cancelled (Shift+Tab).");
          throw new HatchError("Update cancelled.", 0);
        }
        updated.owner = answers.namespace;
        updated.repo = answers.repo;
        updated.namespace = answers.namespace;
        updated.project = answers.project;
        notices.push(`Migrated to ${platform === "azure-devops" ? "Azure DevOps" : "GitLab"} platform`);
      }

      if (updated.version === "1.0.0") {
        updated.version = "2.0.0";
      }

      return { manifest: updated, notices };
    },
  },
  {
    id: "customize-yaml-size",
    condition: async (_manifest, rootDir) => {
      // Customization snapshots live at `.hatch3r/{type}/{id}.customize.yaml`
      // (Wave 6). Legacy `.agents/` layouts are also scanned so the size
      // notice fires before migration relocates the files.
      const scanRoots = [join(rootDir, ".hatch3r"), join(rootDir, ".agents")];
      for (const root of scanRoots) {
        try {
          const entries = await readdir(root, { recursive: true });
          for (const entry of entries) {
            if (typeof entry === "string" && entry.endsWith(".customize.yaml")) {
              const s = await stat(join(root, entry));
              if (s.size > 10240) return true;
            }
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
      }
      return false;
    },
    execute: async (manifest, rootDir, _headless) => {
      const notices: string[] = [];
      const scanRoots = [join(rootDir, ".hatch3r"), join(rootDir, ".agents")];
      for (const root of scanRoots) {
        try {
          const entries = await readdir(root, { recursive: true });
          for (const entry of entries) {
            if (typeof entry === "string" && entry.endsWith(".customize.yaml")) {
              const s = await stat(join(root, entry));
              if (s.size > 10240) {
                notices.push(`Large customize file detected: ${entry} (${Math.round(s.size / 1024)}KB) — consider splitting`);
              }
            }
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
      }
      return { manifest, notices };
    },
  },
  {
    id: "worktree-config-init",
    condition: async (manifest) => {
      if (manifest.worktree !== undefined) return false;
      return manifest.tools.some(t => WORKTREE_CAPABLE_TOOLS.has(t));
    },
    execute: async (manifest, rootDir, _headless, dryRun) => {
      const enabled = true;
      const updated = { ...manifest, worktree: { enabled } };
      // D1-SA1.3-02 (Cycle 12, D1, P2): this checkpoint runs BEFORE the dry-run
      // fork in updateCommand, so a `--dry-run` upgrade of a pre-worktree
      // manifest would write `.worktreeinclude` into the working tree despite
      // the command's printed "without writing files" contract. Preview-only
      // under dry-run: return the enabled manifest (so the dry-run adapter
      // enumeration reflects it) but skip the disk write and report the
      // would-be action.
      if (dryRun) {
        return {
          manifest: updated,
          notices: ["Worktree isolation would be enabled — .worktreeinclude would be generated (dry-run: not written)"],
        };
      }
      const wtContent = await generateWorktreeInclude(updated, rootDir);
      // Silent-writes sweep (release/2.7.1): `appendIfNoBlock` only takes
      // effect on the managedContent branch — without `managedContent` this
      // write silently returned "skipped" whenever a `.worktreeinclude`
      // already existed (the option was dead). Pass the managed body so an
      // existing user file gets the block spliced in, matching init.ts's
      // worktree write.
      await safeWriteFile(join(rootDir, WORKTREE_INCLUDE_FILE), wtContent, {
        managedContent: extractManagedContent(wtContent),
        appendIfNoBlock: true,
      });
      return { manifest: updated, notices: ["Worktree isolation enabled — .worktreeinclude generated"] };
    },
  },
];

async function runMigrationCheckpoints(manifest: HatchManifest, rootDir: string, headless = false, dryRun = false): Promise<{ manifest: HatchManifest; allNotices: string[] }> {
  let current = manifest;
  const allNotices: string[] = [];

  for (const checkpoint of MIGRATION_CHECKPOINTS) {
    if (await checkpoint.condition(current, rootDir)) {
      const { manifest: updated, notices } = await checkpoint.execute(current, rootDir, headless, dryRun);
      current = updated;
      allNotices.push(...notices);
    }
  }

  return { manifest: current, allNotices };
}

/**
 * D14-16 (Cycle 11 Wave 3, D14, P3): the project language set is detected once
 * at `init` and frozen on the manifest as `manifest.languages`. `update`
 * previously never re-ran detection, so a polyglot repo that ADDED a language
 * after init (e.g. a TypeScript service that grows a `pyproject.toml`) kept the
 * stale init-time set — and `manifest.languages` is read at generate time by
 * `repoSubstitution.ts::verificationGatesFromManifest` to render the
 * `${HATCH3R:VERIFY_GATE_*}` tokens (test / lint / typecheck command strings).
 * A stale set there meant the regenerated agents still emitted the original
 * language's verification commands (e.g. `npm run test`) for a repo that had
 * since become polyglot. This is the explicit behavior chosen for the finding's
 * option (a): re-detect on every `update`, refresh `manifest.languages`, and
 * let the immediately-following regenerate re-render the gate tokens from the
 * live set. Bypassed with `--no-redetect`.
 *
 * Scope note (Decision 16, "dial not gate"): the per-item tracked selection
 * (`manifest.content.items`) is NOT a generate-time content filter — every
 * preset already admits the full corpus, so adapters emit every `lang:*`-tagged
 * rule to every repo regardless of detected languages (see
 * `src/adapters/base.ts::readTrackedCanonicalFiles`, which filters only by
 * adapter-scope / user-facing rules). The load-bearing staleness is therefore
 * the manifest's `languages` field, not the item selection — so this refreshes
 * exactly that field and does not mutate `content.items`.
 *
 * Why a focused {@link detectLanguages} probe and not {@link analyzeRepo}:
 * `analyzeRepo` runs ~12 detection probes in parallel; `update` only needs the
 * language set, so the single probe keeps the added cost to a handful of
 * `access()` calls on a clean (no-drift) update — the common case.
 *
 * Mutates `manifest.languages` in place and returns notices for the caller to
 * surface. No-op (empty notices) when the detected set equals the stored set.
 */
export async function redetectLanguages(
  manifest: HatchManifest,
  rootDir: string,
): Promise<{ notices: string[] }> {
  const notices: string[] = [];
  // Manifest-shaped set: drop the "unknown" sentinel so a repo with no language
  // indicator compares equal to a manifest that omits `languages` (init writes
  // no field for an all-"unknown" detection — `createManifest`).
  const detected = (await detectLanguages(rootDir)).filter((l) => l !== "unknown");
  const previous = manifest.languages ?? [];
  const detectedSet = new Set(detected);
  const previousSet = new Set(previous);
  const unchanged =
    detectedSet.size === previousSet.size &&
    [...detectedSet].every((l) => previousSet.has(l));
  if (unchanged) return { notices };

  const added = detected.filter((l) => !previousSet.has(l));
  const removed = previous.filter((l) => !detectedSet.has(l));
  manifest.languages = detected.length > 0 ? detected : undefined;

  const changeSummary =
    "Languages changed since init" +
    (added.length > 0 ? ` (added: ${added.join(", ")})` : "") +
    (removed.length > 0 ? ` (removed: ${removed.join(", ")})` : "");
  notices.push(
    `${changeSummary}. Refreshed the stored language set — verification-gate ` +
      "commands in the regenerated agents now reflect the current languages. " +
      "Run `hatch3r config` to re-pick language-gated content if needed.",
  );
  return { notices };
}

export async function updateCommand(
  _opts?: Record<string, unknown> & {
    yes?: boolean;
    diff?: boolean;
    force?: boolean;
    offline?: boolean;
    skipFetch?: boolean;
    dryRun?: boolean;
    /**
     * C9-H51 (D15-SA15.4-F01): emergency override for the `npm audit
     * signatures` gate. Skips Sigstore signature verification on the
     * freshly-installed package. Used only when audit is broken upstream
     * (e.g. transient Rekor outage) and the user has verified the
     * package out-of-band. Emits a visible warning every time.
     */
    skipAuditSignatures?: boolean;
    /**
     * C9-M26 (D11-SA11.4-01): When true, the orphan-file scan unlinks every
     * file it flags in `.agents/<canonical-subdir>/` that does not match the
     * canonical-inventory naming convention. Default is informational
     * reporting only (no removal). User-tier (`.agents/user/`) and
     * project-only (`policy`, `learnings`) subtrees are never visited.
     */
    cleanOrphans?: boolean;
    /**
     * F15.4-H2 (Cycle 10 D15-SA15.4, Pillar P6): explicit semver pin for the
     * `npm install hatch3r@<spec>` invocation. When supplied via
     * `--pin-version <semver>`, the manifest's `versionConstraint` field
     * is updated so subsequent `hatch3r update` runs continue to honor
     * the pin until the user passes `--pin-version latest` to clear it.
     */
    pinVersion?: string;
    /**
     * D14-16 (Cycle 11 Wave 3, D14): default-true re-detection toggle.
     * Commander maps the `--no-redetect` flag to `redetect: false`. When false,
     * `update` skips post-init language re-detection and keeps the init-pinned
     * language set verbatim. When unset/true, `update` re-detects languages and
     * refreshes `manifest.languages` so the regenerated agents render
     * verification-gate commands for the current set (see {@link redetectLanguages}).
     */
    redetect?: boolean;
    /**
     * SA12.1-F-D12-M2 (D12, P1): output format for CI consumers. `"json"`
     * emits a one-shot structured payload in place of the decorated summary
     * box. `"human"` (default) keeps the legacy chrome.
     */
    format?: string;
    /**
     * W5-bigfour (P1): suppress stdout chrome (banner, spinner text, summary
     * box, next-steps, timing). Diagnostics (warn/error) stay on stderr per
     * POSIX. Wired through `beginCommand` → `setQuiet`.
     */
    quiet?: boolean;
  },
): Promise<void> {
  // SA12.1-F-D12-M2: branch on `--format json` BEFORE banner so CI consumers
  // see exactly one JSON document on stdout.
  // W5-bigfour (P1): flag wiring flows through the standardized beginCommand
  // chokepoint — `--format` parsing, `--quiet` → setQuiet, compact banner in
  // human mode. JSON mode additionally engages chrome suppression (`setJson`
  // implies quiet) so info()/box chrome cannot interleave with the single
  // JSON document on stdout. `--verbose` is intentionally NOT registered on
  // `update` (program.ts), so beginCommand's verbose wiring stays inert here.
  // D1-SA1.3-04 (Cycle 12, D1, P1): declare interactivity so beginCommand rejects
  // `--format json` without `--yes` (exit 2) BEFORE a migration-checkpoint prompt can
  // interleave with the single JSON document / hang non-TTY CI. `update` prompts via
  // the `content-selections-init` and `platform-selection` checkpoints whenever the
  // run is NOT headless and the manifest predates content-tracking / multi-platform
  // (manifest.content === undefined || !manifest.platform). Those checkpoints gate
  // ONLY on `headless` (= !--yes) and ignore the dryRun arg (see MIGRATION_CHECKPOINTS
  // + runMigrationCheckpoints), so — unlike rollback/clean, whose dry-run never
  // prompts — the discriminator here is `--yes`, not `--dry-run`: a `--format json
  // --dry-run` run on a legacy manifest would still reach a prompt. The manifest is
  // read only after this call, so the declaration is command-level (mirrors setup.ts's
  // `!headless`); `--format json --yes` is the headless CI escape.
  const format: CliOutputFormat = beginCommand(_opts ?? {}, {
    banner: "compact",
    interactive: _opts?.yes !== true,
  });
  const jsonMode = format === "json";

  // F8.3.4 (D8): the pipeline wall-clock deadman now lives inside
  // `runRegenerate` (which wraps the adapter phase in
  // `runWithPipelineDeadman`), so the command-level advisory
  // `isPipelineTimedOut`/`terminatePipeline` state that used to be tracked
  // here — and only checked after all disk writes completed — is removed. A
  // true hang now aborts in-flight rather than being reported after the fact.

  const rootDir = process.cwd();
  // D10-SA10.2-F6 (Cycle 10 Wave 4, D10, P1): capture wall-clock at command
  // entry so the success path emits a `Completed in Xs` line via
  // `printTimingSummary` (parity with init + sync). `update` fetches a package
  // and regenerates every adapter, routinely exceeding the 1s threshold CLI
  // Guidelines (clig.dev#output) cite for showing elapsed time.
  const updateStartMs = Date.now();
  // Wave 6: relocate pre-1.9 `.agents/` state before reading the manifest.
  // D1-SA1.3-02 (Cycle 12, D1, P2): this relocation runs unconditionally,
  // including under `--dry-run` — a deliberate, graded exception to the
  // "without writing files" contract. It is load-bearing: a pre-1.9 manifest
  // physically cannot be read from its new `.hatch3r/` location without first
  // relocating it (the `readManifest` on the next line depends on it), and the
  // shim is a no-op on an already-migrated tree. The two NON-load-bearing
  // writes that also once fired before the dry-run fork — the `--pin-version`
  // manifest persist and the worktree-config-init `.worktreeinclude` write —
  // ARE now gated on `!dryRun`. A read-only legacy-location fallback in
  // `readManifest` would remove even this write, but that is a manifest-reader
  // design change outside this fix's file scope.
  await migrateAgentsToHatch3r(rootDir);
  const manifest = await readManifest(rootDir);

  if (!manifest) {
    // D8-SA8.1-F8.1.8 (Cycle 10 Wave 4, P1): JSON payload first, then the
    // shared `assertManifest` helper handles the human stderr + CONFIG_ERROR
    // throw so the missing-manifest contract is identical across commands.
    if (jsonMode) {
      emitJson({
        status: "failed",
        error: MISSING_MANIFEST_MESSAGE,
        errorCode: "CONFIG_ERROR",
        recoveryHint: MISSING_MANIFEST_HINT,
        hatch3rVersion: HATCH3R_VERSION,
        timestamp: new Date().toISOString(),
      });
    }
    assertManifest(manifest, { jsonMode });
  }

  // D11-SA11.2-F13 (Cycle 10 Wave 4, D11, P6): sweep orphan `.tmp.<hex>` files
  // left under the project root by a prior SIGKILL'd run before the regenerate
  // writes begin — `update` writes through `atomicWriteFile`/`safeWriteFile`
  // (temp+rename), so an interrupted update can strand temp files that the
  // command had no entry-point sweep to reclaim. Best-effort: the sweep only
  // removes files older than the in-flight-write floor, surfaces removals +
  // any unlink failures via warn() per the Silent Failure Contract (P5), and
  // never aborts the update. Skipped under --dry-run (which promises no writes).
  if (!_opts?.dryRun) {
    try {
      const sweptTmp = await sweepOrphanTmpFiles(rootDir, { recursive: true });
      const tmpDiag = formatOrphanTmpSweepDiagnostic(sweptTmp);
      if (tmpDiag) warn(tmpDiag);
    } catch (err) {
      verbose(`update: orphan-tmp sweep skipped — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const headless = !!(_opts?.yes);
  // D1-SA1.3-02 (Cycle 12, D1, P2): thread the dry-run flag so the
  // disk-writing worktree checkpoint previews instead of writing. This call
  // precedes the `dryRun` const below, so read `_opts?.dryRun` directly.
  const { manifest: migrated, allNotices } = await runMigrationCheckpoints(manifest, rootDir, headless, !!_opts?.dryRun);
  const m = migrated;

  for (const notice of allNotices) {
    warn(notice);
  }

  // D14-16 (Cycle 11 Wave 3, D14, P3): re-detect project languages and refresh
  // `m.languages` BEFORE the dry-run preview and the regenerate so a repo that
  // added a language post-init re-renders its verification-gate tokens from the
  // current set (the field is consumed at generate time by
  // `repoSubstitution.ts::verificationGatesFromManifest`). `runRegenerate`
  // persists `m` via `writeManifest`, so the refreshed set is written on the
  // real-run path; the dry-run path reflects it in-memory without writing.
  // Default-on; `--no-redetect` (Commander → `redetect: false`) keeps the
  // init-pinned set. Best-effort: a detection probe failure routes through
  // verbose() and never aborts the update (Silent Failure Contract, P5).
  if (_opts?.redetect !== false) {
    try {
      const { notices: langNotices } = await redetectLanguages(m, rootDir);
      for (const n of langNotices) info(n);
    } catch (err) {
      verbose(`update: language re-detection skipped — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Wave 7: the canonical-content integrity preflight is gone — canonical
  // content lives in the bundled package (read-only, verified by npm tarball
  // signature). `hatch3r update` no longer gates on `.agents/` drift because
  // there is no user-side canonical tree to drift from.
  //
  // D11-H-1 (D11): `--force` is now threaded into the regenerate write path
  // (below) so it carries the same contract `hatch3r sync --force` does —
  // overwrite a hatch3r-prefixed managed file even when the user stripped its
  // HATCH3R:BEGIN/END markers. The flag is no longer a dead no-op.
  const force = !!_opts?.force;

  const isUpToDate = m.hatch3rVersion === HATCH3R_VERSION;
  // Commander stores `--offline, --skip-fetch` under the last long name
  // (`skipFetch`), so we accept both keys for compatibility with
  // programmatic callers that still pass `offline`.
  const offlineMode = !!(_opts?.offline || _opts?.skipFetch);
  const dryRun = !!_opts?.dryRun;
  // C9-H51 (D15-SA15.4-F01): visible warning every time the user opts out
  // of signature verification. The flag is an emergency override, not a
  // performance knob — surface it loudly so a CI run or a teammate
  // skimming logs sees the security implication.
  const skipAuditSignatures = !!_opts?.skipAuditSignatures;
  if (skipAuditSignatures) {
    warn(
      "--skip-audit-signatures: npm audit signatures will be SKIPPED for the freshly fetched hatch3r package. " +
      "You are accepting responsibility for verifying package provenance out-of-band. " +
      "Remove this flag once the upstream audit-signatures issue is resolved.",
    );
  }
  // F15.4-H2 (Cycle 10 D15-SA15.4, Pillar P6): resolve the effective
  // version pin. The `--pin-version <semver>` CLI flag takes precedence
  // over the manifest's `versionConstraint` field; both default to
  // `undefined` which preserves the legacy `hatch3r@latest` install spec.
  // When the flag is supplied, persist it back to the manifest so
  // subsequent runs honor the pin without re-passing the flag.
  let versionConstraint: string | undefined = _opts?.pinVersion ?? m.versionConstraint;
  if (_opts?.pinVersion) {
    // D15-SA15.4-03 (Cycle 12 Wave 4, D15, P6): reject a malformed pin at accept
    // time — before the dry-run fork, before `writeManifest`, before any install
    // — so a typo cannot be persisted and silently re-break every future
    // `update`. `latest` is the valid pin-clearing sentinel and skips the check.
    if (_opts.pinVersion !== "latest" && !isValidVersionPin(_opts.pinVersion)) {
      throw new HatchError(
        `Invalid --pin-version value '${_opts.pinVersion}'. Expected a semver version or range (e.g. '2.2.0', '^2.2.0', '>=2.0.0 <3.0.0'), or 'latest' to clear the pin.`,
        undefined,
        "VALIDATION_ERROR",
        "Pass a valid npm version spec, or `--pin-version latest` to remove the pin.",
      );
    }
    if (_opts.pinVersion === "latest") {
      versionConstraint = undefined;
      info(
        dryRun
          ? "Dry-run: would clear the version pin — future `hatch3r update` runs would install hatch3r@latest. No manifest write."
          : "Cleared version pin: future `hatch3r update` runs will install hatch3r@latest.",
      );
    } else {
      info(
        dryRun
          ? `Dry-run: would pin hatch3r to '${_opts.pinVersion}' (.hatch3r/hatch.json::versionConstraint). No manifest write.`
          : `Pinning hatch3r to '${_opts.pinVersion}' (persisted to .hatch3r/hatch.json::versionConstraint).`,
      );
    }
    // D1-SA1.3-02 (Cycle 12, D1, P2): persist the pin only on a real run. A
    // `--dry-run --pin-version` preview must not durably change the install
    // spec of every FUTURE `update` — that is the opposite of a no-op preview
    // and contradicts the "without writing files" contract printed at the
    // dry-run banner. The info() line above previews the pin either way.
    if (!dryRun) {
      const persisted: HatchManifest = { ...m, versionConstraint };
      await writeManifest(rootDir, persisted);
      m.versionConstraint = versionConstraint;
    }
  } else if (versionConstraint) {
    info(`Using pinned version '${versionConstraint}' from .hatch3r/hatch.json. Pass --pin-version latest to remove the pin.`);
  }
  if (isUpToDate) {
    info(`Already at hatch3r v${HATCH3R_VERSION}`);
  } else if (offlineMode) {
    info(`Regenerating from installed hatch3r v${HATCH3R_VERSION} (offline; manifest version v${m.hatch3rVersion})`);
  } else {
    info(`Updating from v${m.hatch3rVersion} to v${HATCH3R_VERSION}`);
  }
  if (offlineMode) {
    info("Offline mode: skipping package fetch, regenerating from installed canonical content only.");
  }
  if (dryRun) {
    info("Dry-run mode: enumerating changes without writing files.");
  }
  console.log();

  // C8-D12-M2: --dry-run branch. Enumerate the changes each adapter would
  // produce without invoking the destructive runUpdate / runRegenerate
  // pipeline. No network, no writes.
  if (dryRun) {
    await runUpdateDryRun(rootDir, m, { offline: offlineMode });
    return;
  }

  // HATCH3R_RE_EXEC: set by a parent hatch3r process that just self-updated
  // the package on disk. The parent re-execs us with --skip-fetch (which
  // implies offlineMode here) so the regenerate phase uses freshly installed
  // code instead of the stale module cache the parent had already loaded.
  const isReExec = process.env.HATCH3R_RE_EXEC === "1";
  if (isReExec) {
    info(`Continuing with freshly installed hatch3r v${HATCH3R_VERSION} for regenerate.`);
  }

  let result: UpdateResult;
  if (offlineMode) {
    // C8-D1-M6: --offline / --skip-fetch skips the network + self-update
    // and invokes runRegenerate directly, so update can still repair
    // drifted output without network access (e.g. air-gapped CI, slow/offline
    // networks). Re-exec children also take this branch.
    result = await runRegenerate(rootDir, m, { diff: !!_opts?.diff, force });
  } else {
    // Multi-install self-update: refreshes the running install plus any
    // other hatch3r install reachable on the system (project-local +
    // global). On success, re-exec into the newly installed binary so
    // the regenerate phase runs with the latest code — running it
    // in-process would use the stale module cache the current process
    // loaded before the package got replaced on disk.
    const selfUpdate = await runSelfUpdate(rootDir, {
      stepOffset: 0,
      totalSteps: 4,
      skipAuditSignatures,
      // F15.4-H2: thread the resolved version pin into the npm install
      // invocation. Undefined preserves `hatch3r@latest`.
      versionConstraint,
    });
    const reExecBin = !isReExec ? pickReExecBin(selfUpdate) : null;
    if (reExecBin) {
      const childArgs = ["update", "--skip-fetch", ...buildReExecPassThroughArgs(_opts)];
      info(`Re-running with freshly installed hatch3r (${reExecBin})`);
      const child = spawnSync(reExecBin, childArgs, {
        stdio: "inherit",
        env: { ...process.env, HATCH3R_RE_EXEC: "1" },
      });
      // D8-SA8.1-F8.1.9 (Cycle 10 Wave 4, D8, P1): when the re-exec'd child is
      // terminated by a signal (e.g. the user hits Ctrl-C mid-regenerate),
      // `child.status` is null and the signal name lives in `child.signal`.
      // Propagate the POSIX 128+signal exit code (SIGINT → 130, SIGTERM → 143)
      // instead of collapsing every signal death into a generic exit 1, so CI
      // scripts can distinguish a user cancel from a real failure — matching
      // the mainline handler in `src/cli/index.ts`.
      if (child.signal) {
        process.exit(child.signal === "SIGINT" ? 130 : child.signal === "SIGTERM" ? 143 : 1);
      }
      process.exit(child.status ?? 1);
    }
    result = await runRegenerate(rootDir, m, {
      stepOffset: 1,
      totalSteps: 4,
      diff: !!_opts?.diff,
      force,
    });
  }

  // C9-M26 (D11-SA11.4-01): Orphan-file scan across the canonical
  // Wave 7: orphan-file scan retired in user repos — no project-side
  // canonical tree remains after Wave 3+4. The helper functions
  // (`scanOrphanFiles`, `formatOrphanScanDiagnostic`) are still exercised
  // by the `npx hatch3r validate` bundled-content gate.
  //
  // D1-SA1.3-F1.3.10 / D11-SA11.4-10 (Cycle 10 Wave 4, D1+D11, P1): the
  // `--clean-orphans` flag is still accepted at the commander surface for
  // backward compatibility with legacy CI scripts, but it is a no-op since the
  // user-side canonical scan was retired. Silently discarding it violated the
  // Silent Failure Contract (CONSTITUTION §2 P5) — surface a one-line warning
  // when the operator explicitly opts in so they can drop it from their script.
  if (_opts?.cleanOrphans) {
    warn(
      "--clean-orphans is now a no-op; orphan cleanup runs automatically per adapter. " +
      "Remove it from your invocation.",
    );
  }
  void scanOrphanFiles;
  void formatOrphanScanDiagnostic;

  // Version checkpoint advisory: detect if a clean reinit is recommended
  const versionCheckpoints = getApplicableCheckpoints(m.hatch3rVersion, HATCH3R_VERSION);
  const reinitAdvisories = versionCheckpoints.filter(cp => cp.action === "reinit-advisory");

  if (reinitAdvisories.length > 0) {
    console.log();
    warn("A clean reinit is recommended for this version update:");
    for (const advisory of reinitAdvisories) {
      console.log(chalk.dim(`  - ${advisory.reason}`));
      for (const change of advisory.changes ?? []) {
        console.log(chalk.dim(`    • ${change}`));
      }
    }
    console.log();
    info(`Run ${chalk.bold("hatch3r clean")} and choose to reinitialize when prompted.`);
    console.log(chalk.dim("  Your customizations and learnings will be preserved.\n"));
  }

  // --diff: show file change summary
  if (_opts?.diff && result.diffBefore && result.diffAfter) {
    const diffLines: string[] = [];
    for (const [filePath] of result.diffBefore) {
      const before = result.diffBefore.get(filePath) ?? null;
      const after = result.diffAfter.get(filePath) ?? null;
      if (before === null && after !== null) {
        diffLines.push(`${chalk.green("+ added")}    ${filePath}`);
      } else if (before !== null && after !== null && before !== after) {
        diffLines.push(`${chalk.yellow("~ modified")} ${filePath}`);
      } else if (before !== null && after !== null && before === after) {
        diffLines.push(`${chalk.dim("= unchanged")} ${filePath}`);
      }
    }
    if (diffLines.length > 0) {
      console.log();
      printBox("Diff summary", diffLines, "info");
    }
  }

  console.log();
  // Phase output schema: compact the structured update result before
  // formatting so a high-fanout update (many adapters) keeps the summary
  // bounded.
  const compactedResult = compactPhaseOutput({
    copiedFiles: result.copiedFiles,
    syncedTools: result.syncedTools,
    failedTools: result.failedTools,
    version: result.version,
  });
  const updateSummaryLines = [
    label("Files", `${compactedResult.copiedFiles} file(s) written`),
    label("Tools", `${compactedResult.syncedTools} tool(s) re-synced`),
    label("Version", `v${compactedResult.version}`),
  ];
  // D10-SA10.4-02 (Cycle 12, D10, P1): render the same preserved-vs-overwritten
  // tally sync's D10-M11 summary shows, so the upgrader — the user most afraid
  // a version bump wiped their hand edits — reads "did it keep my edits?"
  // directly instead of a bare file count (clig.dev: "if you change state,
  // tell the user"; NN/g visibility-of-system-status).
  const wa = result.writeActions;
  const changeParts: string[] = [];
  if (wa) {
    if (wa.created) changeParts.push(chalk.green(`${wa.created} created`));
    if (wa.merged) changeParts.push(chalk.cyan(`${wa.merged} merged (your edits preserved)`));
    if (wa.regenerated) changeParts.push(chalk.yellow(`${wa.regenerated} regenerated (full overwrite)`));
    if (wa.unchanged) changeParts.push(chalk.dim(`${wa.unchanged} unchanged`));
    if (wa.skipped) changeParts.push(chalk.dim(`${wa.skipped} skipped`));
  }
  if (changeParts.length > 0) {
    updateSummaryLines.splice(1, 0, label("Changes", changeParts.join(chalk.dim(" · "))));
  }
  if (result.snapshotSessionId) {
    updateSummaryLines.push(
      label(
        "Snapshot",
        `${result.snapshotSessionId} (revert: hatch3r rollback --session=${result.snapshotSessionId})`,
      ),
    );
  }

  // SA12.1-F-D12-M2 (D12, P1): in JSON mode, emit a single structured
  // document in place of the decorated success box. The schema lets CI
  // consumers branch on `status`, `failedTools`, and per-tool counts.
  // W5-bigfour (P1): box-vs-JSON emission flows through the standardized
  // finishCommand chokepoint. Payload field names unchanged; the envelope
  // adds the standard `command` identity field. The post-box CLI-tooling
  // nudge + next-steps ladder stay on ui.ts primitives because finishCommand
  // cannot interleave an info() line between the box and the next-steps.
  finishCommand(format, {
    command: "update",
    title: "Update complete",
    lines: updateSummaryLines,
    style: "success",
    json: {
      status: result.failedTools > 0 ? "partial" : "passed",
      copiedFiles: result.copiedFiles,
      // D10-SA10.4-02: additive field — CI consumers can branch on the
      // preserved-vs-overwritten split without parsing the human tally line.
      // Explicit null when a stubbed result omitted the tally.
      writeActions: result.writeActions ?? null,
      syncedTools: result.syncedTools,
      failedTools: result.failedTools,
      version: result.version,
      snapshotSessionId: result.snapshotSessionId ?? null,
    },
  });
  if (jsonMode) {
    // SA12.1-F05 (D12, P1): the JSON document carries `status: "partial"`, but
    // a CI script gating on the exit code still needs the non-zero signal.
    // Emit the structured payload first (CI consumers parse it from stdout),
    // then throw the same partial-failure exit-2 sync uses — the top-level
    // handler routes the error to stderr, keeping stdout a single JSON doc.
    throwOnPartialAdapterFailure(result.failedTools, m.tools.length);
    return;
  }

  // CLI-tooling pivot (plan §4.7 update touchpoint): nudge users who
  // upgraded without ever opting in to the CLI tooling surface. Repeats
  // across runs intentionally — there is no manifest flag to dampen it,
  // and the info() output is one line.
  if (!m.cliTools || m.cliTools.selected.length === 0) {
    info("CLI tooling available as a token-efficient alternative to MCP — run `npx hatch3r cli-tools` to opt in.");
  }

  // D10-SA10.2-F5 + F6 (Cycle 10 Wave 4, D10, P1/P4): on a clean update, emit a
  // next-steps ladder (routing the previously-dead `printNextSteps` helper) and
  // an elapsed-time read-out (parity with init + sync). Suppressed on partial
  // failure. Both helpers are no-ops under quiet/json mode.
  if (result.failedTools === 0) {
    printNextSteps([
      "Run `hatch3r status` to confirm your generated files match the new version.",
      "Run `hatch3r validate` to check canonical content + customizations.",
    ]);
    printTimingSummary(updateStartMs);
  }

  // F8.3.4: the pipeline-timeout advisory previously emitted here is now
  // enforced (not just reported) by the `runWithPipelineDeadman` wrapper
  // inside `runRegenerate`.

  // SA12.1-F05 (Cycle 10 Wave 4, D12, P1): exit non-zero on a partial adapter
  // failure (some-but-not-all adapters failed) so CI pipelines can detect an
  // incomplete update the same way `hatch3r sync` does. The summary box above
  // already rendered (parity with sync, which prints its box then throws).
  // The all-adapters-failed case throws inside `runRegenerate` before reaching
  // this point, so `failedTools > 0` here always denotes a partial failure.
  throwOnPartialAdapterFailure(result.failedTools, m.tools.length);
}
