import { readFile, stat, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
// D10-M12 (Cycle 10): surface `.customize.yaml` syntax errors during sync so
// users do not silently lose customization. The full validator lives in
// `validate.ts::validateCustomizeYaml`; this sync-time pass runs only the
// parse + size checks (the cheap, high-signal half) and emits warnings.
import { parse as parseYaml } from "yaml";
// SA12.4-F1 / F2.7-F5 (D12/D2): the provenance writer records an emit-time
// content hash per output so `hatch3r status` can later attribute drift
// direction (user edit vs outdated canonical). D12-4 (Cycle 11 Wave 2): the
// writer body now lives in `src/manifest/provenance.ts::writeProvenance`
// (single source of truth — `init`/`update` call the same helper so they
// populate the first-run trace + refresh the baseline). `hashEmittedContent`
// is the single normalization both the writer and the reader (status.ts)
// share, so the hash computed at emit time matches the hash status.ts derives
// from the on-disk managed block.
import { writeProvenance } from "../../manifest/provenance.js";
import { readManifest, writeManifest, addManagedFile } from "../../manifest/hatchJson.js";
import { rehydrateCustomization } from "../../manifest/rehydrate.js";
import { getAdapter, getUnsupportedFeatureWarnings } from "../../adapters/index.js";
import { checkContextBudget, formatBudgetWarning } from "../../adapters/contextBudget.js";
import { safeWriteFile, predictMergeAction, enableDefaultCrossProcessLocking, sweepOrphanTmpFiles, formatOrphanTmpSweepDiagnostic, detectConcurrentWriteRisk } from "../../merge/safeWrite.js";
import { withSnapshot } from "../../pipeline/snapshot.js";
import { sweepOrphansForAdapter, formatOrphanCleanupDiagnostic, type OrphanCleanupEntry } from "../../merge/orphanCleanup.js";
import { extractManagedBlock } from "../../merge/managedBlocks.js";
import { generateWorktreeInclude, extractManagedContent } from "../../worktree/index.js";
import { HATCH3R_DIR, HatchError, WORKTREE_INCLUDE_FILE, type AdapterOutput, type GenerationMode } from "../../types.js";
import { assertManifest } from "../shared/requireManifest.js";
import { migrateAgentsToHatch3r } from "../../migration/agentsToHatch3r.js";
import { ensureEnvMcp, ensureGitignoreEntry, getSourceEnvMcpCommand } from "../../env/mcpEnv.js";
import { readWorkspaceManifest } from "../../workspace/manifest.js";
import { detectWorkspaceContext } from "../../workspace/detect.js";
import { syncWorkspaceRepos } from "../../workspace/sync.js";
import { resolveBundledContentRoot } from "../../content/contentRoot.js";
import { planPerPackageOutputs } from "../../content/monorepoEmission.js";
import { pruneArchives } from "../../archive/index.js";
import { HATCH3R_VERSION } from "../../version.js";
import {
  writeFailureLog,
  FAILURE_LOG_FILE,
} from "../../pipeline/failureLog.js";
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
  readCheckpoint,
  workspaceDir,
  type CheckpointMeta,
} from "../../pipeline/checkpoint.js";
import { compactPhaseOutput } from "../../pipeline/phaseOutputSchema.js";
import { retryWithBackoff } from "../../pipeline/retryWithBackoff.js";
import { discoverUserContent, validateContentBody } from "../../content/userContent.js";
import { scanOrphanFiles, formatOrphanScanDiagnostic } from "../../content/orphanScan.js";
import { validateLearningsDirectory } from "../../content/learningsValidation.js";
import { validateHandoffsDirectory, pruneHandoffs } from "../../content/handoffs/index.js";
import { loadValidatedLearnings } from "../../content/learningsLoader.js";
import {
  createSpinner,
  printBox,
  printNextSteps,
  printTimingSummary,
  error as logError,
  info,
  step,
  warn,
  setVerbose,
  verbose,
} from "../shared/ui.js";
import { type CliOutputFormat } from "../shared/output.js";
import { beginCommand, finishCommand } from "../shared/commandOutput.js";
import { getRunId } from "../shared/runId.js";
import { buildCustomizationSummary, selectionSetFromManifest } from "../../adapters/customizationSummary.js";

/**
 * Check if docs/specs/ exists and whether spec files are older than
 * the most recent git commit, indicating they may be stale.
 */
async function checkSpecFreshness(rootDir: string): Promise<void> {
  const specsDir = join(rootDir, "docs", "specs");
  try {
    await stat(specsDir);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    verbose(`sync: checkSpecFreshness skipped — no ${specsDir} (${message})`);
    return; // No specs directory — nothing to check
  }

  // Find the oldest spec file mtime
  let oldestSpecMtime = Date.now();
  try {
    const entries = await readdir(specsDir, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const parentPath = entry.parentPath ?? (entry as unknown as { path?: string }).path ?? specsDir;
      const fileStat = await stat(join(parentPath, entry.name));
      if (fileStat.mtimeMs < oldestSpecMtime) {
        oldestSpecMtime = fileStat.mtimeMs;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    verbose(`sync: checkSpecFreshness readdir/stat failed — ${message}`);
    return;
  }

  // Get the latest commit timestamp
  try {
    // D1-SA1.3-F1.3.7 (Cycle 10 Wave 4, D1, P-CQ4): bound the synchronous git
    // call with a 5s timeout. execFileSync defaults `timeout` to undefined,
    // so without it a hung git (index-lock contention, slow git-LFS network,
    // SIGSTOP'd child) blocks the event loop for the full pipeline budget
    // (~120s) after all adapter work is done. Spec-freshness is a soft
    // advisory (the warn() below is informational, not gating), so a timeout
    // throw routes to the catch as a skip — the correct fallback.
    const commitDate = execFileSync("git", ["log", "-1", "--format=%ct"], { stdio: "pipe", timeout: 5000 })
      .toString()
      .trim();
    const latestCommitMs = parseInt(commitDate, 10) * 1000;

    if (latestCommitMs > oldestSpecMtime) {
      const daysSinceSpecUpdate = Math.floor((Date.now() - oldestSpecMtime) / (1000 * 60 * 60 * 24));
      if (daysSinceSpecUpdate > 7) {
        warn(
          `Project specs in docs/specs/ may be stale (oldest spec last modified ${daysSinceSpecUpdate} days ago). ` +
          `Consider running /project-spec to refresh.`,
        );
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    verbose(`sync: checkSpecFreshness git log failed — ${message}`);
  }
}

/**
 * Append a failure entry to the persistent failure log in `.hatch3r/`.
 *
 * F8.4.5 (Cycle 10 Wave 4, D8, P5): the writer body now lives in
 * `src/pipeline/failureLog.ts::writeFailureLog` (single source of truth — it
 * was previously reimplemented here and in `update.ts`). Per the Silent
 * Failure Contract, a write failure is no longer dropped to a bare
 * `console.error`: `writeFailureLog` returns `{ written, warning? }` and this
 * wrapper routes the warning through the `warn()` UI helper so a failing audit
 * trail (EACCES, ENOSPC, read-only mount) is visible in the command output,
 * not silently swallowed. Failure logging still never breaks the sync.
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
  if (result.warning) warn(`[hatch3r sync] ${result.warning}`);
}

/**
 * F10.4-1: classify a {@link MergeResult.action} into the user-visible
 * disposition we render in the sync summary. `safeWriteFile` returns
 * action ∈ {created, updated, unchanged, skipped} without distinguishing
 * managed-block merges from full-file rewrites. We resolve the
 * distinction at the sync.ts call-site using `out.managedContent`:
 * - `updated` + managed-block merge → `merged` (user content preserved)
 * - `updated` + full-file rewrite   → `regenerated`
 * Everything else passes through verbatim.
 */
function renderAction(action: string, isManagedMerge: boolean): string {
  if (action !== "updated") return action;
  return isManagedMerge ? "merged" : "regenerated";
}

/**
 * Read a file's content, returning null if the file does not exist.
 */
async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch (err) {
    // Caller treats missing files as null; expose under --verbose to surface
    // permission errors or other unexpected read failures.
    const message = err instanceof Error ? err.message : String(err);
    verbose(`sync: readFileOrNull(${filePath}) → null — ${message}`);
    return null;
  }
}

/**
 * D8-SA8.4-03: extract a Node errno (`.code`) from an unknown error, or
 * undefined when absent. Preserved on `adapterFailures` so the aggregate
 * recovery-guidance path can reconstruct an errno-bearing Error and let
 * `classifyDependency` resolve filesystem/network dependency classes instead
 * of downgrading disk/permission failures to generic "unknown" guidance.
 */
function extractErrorCode(err: unknown): string | undefined {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/**
 * D12-SA12.2-05: render the managed-block content delta between the on-disk
 * `before` and the would-be/after `after` content for a `--diff --verbose`
 * run. Bounds output to the HATCH3R:BEGIN/END managed block (the only region a
 * sync overwrites) via {@link extractManagedBlock}, falling back to the full
 * file for marker-less (full-regenerate) outputs. Trims the common leading and
 * trailing lines so only the changed region shows, and caps removed/added line
 * counts so a large regenerated block stays a short preview rather than dumping
 * the whole file. Returns [] when the bounded content is identical (e.g. only
 * out-of-block user text differs).
 */
function renderManagedBlockDelta(
  before: string,
  after: string,
  filePath: string,
): string[] {
  const oldBlock = extractManagedBlock(before, filePath) ?? before;
  const newBlock = extractManagedBlock(after, filePath) ?? after;
  if (oldBlock === newBlock) return [];

  const oldLines = oldBlock.split("\n");
  const newLines = newBlock.split("\n");

  // Trim the common prefix, then the common suffix (not overlapping the prefix)
  // so only the changed region is rendered.
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const removed = oldLines.slice(prefix, oldLines.length - suffix);
  const added = newLines.slice(prefix, newLines.length - suffix);

  const CAP = 20;
  const lines: string[] = [
    chalk.dim(`    managed-block Δ (${prefix} line(s) unchanged above, ${suffix} below):`),
  ];
  for (const l of removed.slice(0, CAP)) lines.push(chalk.red(`    - ${l}`));
  if (removed.length > CAP) {
    lines.push(chalk.dim(`    - … ${removed.length - CAP} more removed line(s)`));
  }
  for (const l of added.slice(0, CAP)) lines.push(chalk.green(`    + ${l}`));
  if (added.length > CAP) {
    lines.push(chalk.dim(`    + … ${added.length - CAP} more added line(s)`));
  }
  return lines;
}

export async function syncCommand(
  opts: {
    repos?: string[] | true;
    dryRun?: boolean;
    diff?: boolean;
    force?: boolean;
    minimal?: boolean;
    verbose?: boolean;
    strictBudget?: boolean;
    /**
     * C9-M26 (D11-SA11.4-01): When true, the orphan-file scan unlinks every
     * file it flags in `.agents/<canonical-subdir>/` that does not match the
     * canonical-inventory naming convention. Default is informational
     * reporting only (no removal). User-tier (`.agents/user/`) and
     * project-only (`policy`, `learnings`) subtrees are never visited.
     */
    cleanOrphans?: boolean;
    /**
     * Decision 27 (Bucket 2.2): resume the orchestrator from the last
     * checkpoint recorded under `.sync-workspace/checkpoint.json`. The
     * flag is accepted at the CLI surface today; resume semantics will
     * be wired into the body when sync gains multi-wave decomposition.
     * Pass-through ensures the option is not rejected as unknown by
     * commander and downstream tooling can detect resume intent.
     */
    resume?: boolean;
    /**
     * SA12.1-F-D12-M2 (D12, P1): output format for CI consumers. `"json"`
     * emits a one-shot structured payload to stdout right before the
     * decorated summary box (or before the terminal HatchError throw).
     * `"human"` (default) keeps the legacy chrome.
     */
    format?: string;
    /**
     * W5-bigfour (P1): suppress stdout chrome (banner, spinner text, summary
     * box, next-steps, timing). Diagnostics (warn/error) stay on stderr per
     * POSIX. Wired through `beginCommand` → `setQuiet`.
     */
    quiet?: boolean;
    /**
     * SA12.1-F-D12-M8 (D12, P1): under `--dry-run`, print the FULL content
     * body that the named adapter would write so the operator can verify
     * the bytes before any write happens. Without this flag, `--dry-run`
     * only records `{path, action}` rows, leaving the actual content unseen.
     * Accepts a single adapter id (cursor | claude | copilot). Implied to
     * `--dry-run`; passing without `--dry-run` is rejected as a usage error.
     */
    previewTool?: string;
    /**
     * D14-SA14.2-F4 (Low, CQ6): override the parallel workspace sub-repo sync
     * limit. Surfaces the existing `WorkspaceSyncOptions.concurrency` override
     * (previously test/programmatic-only) at the CLI so operators on SSD-bound
     * runners that sustain more parallel small-file writes can raise the
     * disk-bound default of `min(cpus, 8)` (see `defaultSyncConcurrency` for
     * the cap rationale). Commander parses `--concurrency <n>` as a string;
     * the body coerces it to a positive integer and ignores non-positive /
     * non-numeric input (falls back to the default).
     */
    concurrency?: string;
  } = {},
): Promise<void> {
  // SA12.1-F-D12-M2: branch on `--format json` BEFORE banner/spinner so
  // CI consumers see exactly one JSON document on stdout.
  // W5-bigfour (P1): flag wiring flows through the standardized beginCommand
  // chokepoint — `--format` parsing, `--quiet` → setQuiet, `--verbose` →
  // setVerbose, compact banner in human mode. JSON mode now additionally
  // engages chrome suppression (`setJson` implies quiet) so interleaved
  // info()/printBox chrome can never corrupt the single-document contract.
  const format: CliOutputFormat = beginCommand(opts, { banner: "compact" });
  const jsonMode = format === "json";
  // Pre-adoption contract preserved: verbose diagnostics stay OFF in JSON
  // mode even when `--verbose` is passed (the legacy block forced it false).
  if (jsonMode) setVerbose(false);

  // SA12.1-F-D12-M8 (D12, P1): `--preview-tool <name>` only makes sense
  // alongside `--dry-run` — without it, the bytes are written immediately
  // and a "preview" is moot. Reject the combination loudly so the operator
  // does not run a destructive sync expecting a preview.
  if (opts.previewTool && !opts.dryRun) {
    throw new HatchError(
      `--preview-tool requires --dry-run`,
      2,
      "VALIDATION_ERROR",
      "Re-run with both flags: `hatch3r sync --dry-run --preview-tool=<adapter-id>`.",
    );
  }

  const rootDir = process.cwd();

  // D1-SA1.5-F10 (Cycle 10 Wave 4, D1, P6): sweep orphan `.tmp.<8-hex>` files
  // left under the project root by a prior SIGKILL'd run before the regenerate
  // writes begin. `sync` writes through `safeWriteFile`/`atomicWriteFile`
  // (temp+rename), so an interrupted sync can strand temp files; without an
  // entry-point sweep an operator who never re-runs a sweeping command leaves
  // the orphan on disk indefinitely. Best-effort: the sweep only removes files
  // older than the 60s in-flight-write floor ({@link ORPHAN_MIN_AGE_MS}),
  // surfaces removals + any unlink failures via `warn()` per the Silent Failure
  // Contract (P5), and never aborts the sync. Skipped under --dry-run (which
  // promises no writes). Mirrors the `update` entry-point sweep.
  if (!opts.dryRun) {
    try {
      const sweptTmp = await sweepOrphanTmpFiles(rootDir, { recursive: true });
      const tmpDiag = formatOrphanTmpSweepDiagnostic(sweptTmp);
      if (tmpDiag) warn(tmpDiag);
    } catch (err) {
      verbose(`sync: orphan-tmp sweep skipped — ${err instanceof Error ? err.message : String(err)}`);
    }
    // D11-14 (Cycle 11 Wave 3, P6): after the aged-orphan sweep (which removes
    // crash leftovers), check for a YOUNG `.tmp.<8hex>` — the signal of another
    // hatch3r write in flight RIGHT NOW. The single-repo default takes no lock,
    // so two concurrent `hatch3r sync` runs clobber managed files
    // last-writer-wins; warn the operator to pass HATCH3R_LOCK=1 on both runs.
    // Returns null (no warning) when locking is already active. Best-effort,
    // never aborts the sync.
    try {
      const concurrencyWarning = await detectConcurrentWriteRisk(rootDir, { recursive: true });
      if (concurrencyWarning) warn(concurrencyWarning);
    } catch (err) {
      verbose(`sync: concurrency-risk check skipped — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // D10-SA10.2-F6 (Cycle 10 Wave 4, D10, P1): capture wall-clock at command
  // entry so the success path can emit a `Completed in Xs` line via
  // `printTimingSummary` — sync routinely exceeds the 1s threshold CLI
  // Guidelines (clig.dev#output) cite for showing elapsed time. The helper is
  // a no-op under quiet/json mode, so CI paths are unaffected.
  const syncStartMs = Date.now();

  // F16.1-C1 (Decision 27 / Bucket 2.2): sync writes a checkpoint after each
  // mutation phase under `.sync-workspace/checkpoint.json` so `--resume` can
  // detect a previously-completed run and short-circuit instead of redoing
  // every adapter write. The baseline is the bundled hatch3r version: a
  // checkpoint left by a different hatch3r version is correctly flagged as
  // drift and re-run from scratch. `readCheckpoint` throws on a corrupt file
  // (with a preserved-backup recovery hint), so resume fails loud.
  const syncWorkspace = workspaceDir(rootDir, "sync");
  const checkpointMeta = (): CheckpointMeta => ({
    baselineSha: HATCH3R_VERSION,
    lastPassedGateN: 0,
    registrySha: "",
    timestamp: new Date().toISOString(),
  });
  // Numbered mutation phases for checkpoint replay: 1=generation/adapter,
  // 2=merge (worktree+mcp+manifest writes). `recordPhase` is best-effort —
  // a checkpoint-write failure is surfaced via verbose() and never aborts a
  // sync that is otherwise succeeding (Silent Failure Contract, P5).
  const recordPhase = async (
    wave: number,
    status: "in-progress" | "passed" | "failed",
  ): Promise<void> => {
    try {
      await writeCheckpoint(syncWorkspace, "sync", wave, status, {
        ...checkpointMeta(),
        lastPassedGateN: status === "passed" ? wave : Math.max(0, wave - 1),
      });
    } catch (err) {
      verbose(`sync: checkpoint write (wave ${wave}, ${status}) skipped — ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  // F16.1-C1: on `--resume`, read the recorded checkpoint. A `passed`
  // checkpoint at the current baseline means the prior sync finished — report
  // it and exit early (rerunning would re-emit identical output). A baseline
  // mismatch or `failed`/`in-progress` checkpoint falls through to a full
  // sync (the snapshot below still makes the run rollback-revertable).
  if (opts.resume) {
    const checkpoint = await readCheckpoint(syncWorkspace);
    if (checkpoint === null) {
      warn(
        `\`hatch3r sync --resume\` requested but no checkpoint found at ` +
        `${join(syncWorkspace, "checkpoint.json")}. Continuing as a fresh sync.`,
      );
    } else if (checkpoint.meta.baselineSha === HATCH3R_VERSION && checkpoint.status === "passed") {
      info(
        `Resume: the last sync at this hatch3r version (v${HATCH3R_VERSION}) completed ` +
        `(phase=${checkpoint.phase} wave=${checkpoint.wave}). Nothing to resume — re-run ` +
        `\`hatch3r sync\` without --resume to force a fresh regeneration.`,
      );
      return;
    } else if (checkpoint.meta.baselineSha !== HATCH3R_VERSION) {
      warn(
        `Resume: checkpoint baseline (v${checkpoint.meta.baselineSha}) differs from the ` +
        `installed hatch3r (v${HATCH3R_VERSION}). Running a full fresh sync.`,
      );
    } else {
      info(
        `Resume: prior sync left a ${checkpoint.status} checkpoint at phase=${checkpoint.phase} ` +
        `wave=${checkpoint.wave}. Re-running from the start (sync is idempotent).`,
      );
    }
  }

  const wsContext = await detectWorkspaceContext(rootDir);
  if (wsContext.type === "workspace-member") {
    warn(
      `This repository appears to be managed by a workspace at ${wsContext.workspaceRoot ?? ".."}. ` +
      `Run ${chalk.cyan("hatch3r sync")} from the workspace root to sync all repos.`,
    );
  }
  // D8-M3: workspace sync runs N parallel repo writes against a shared
  // `.hatch3r/workspace.json` + per-repo manifests. Default-on cross-process
  // locking serializes the read-modify-write window so two concurrent
  // operators (or CI matrix runners) on the same workspace cannot silently
  // clobber each other's `lastSync` timestamps. Set `HATCH3R_LOCK=0` to opt
  // out. Single-repo sync invocations still inherit the prior default
  // (no lock unless `HATCH3R_LOCK=1`) so the existing standalone flow is
  // unchanged.
  if (wsContext.type === "workspace-root" || wsContext.type === "workspace-member") {
    enableDefaultCrossProcessLocking();
  }

  // Wave 6: relocate any pre-1.9 `.agents/` state before reading the manifest
  // so legacy installs sync without manual `init` first.
  await migrateAgentsToHatch3r(rootDir);
  // Wave 7: legacy state lives under `.hatch3r/`; the failure log + orphan
  // sweeper write into that directory.
  const hatch3rDir = join(rootDir, HATCH3R_DIR);
  const manifest = await readManifest(rootDir);

  // D8-SA8.1-F8.1.8 (Cycle 10 Wave 4, P1): shared missing-manifest preflight —
  // identical message + CONFIG_ERROR exit across every manifest-required command.
  assertManifest(manifest);

  const m = manifest;

  verbose(`Manifest loaded: ${m.tools.length} tool(s), ${Object.keys(m.features).filter(k => m.features[k as keyof typeof m.features]).length} feature(s)`);

  // D1-SA1.3-F1.3.10 (Cycle 10 Wave 4, D1, P1): `--clean-orphans` is still
  // accepted at the commander surface for backward compatibility with legacy
  // CI scripts, but it is a no-op since the user-side canonical orphan scan was
  // retired (Wave 7) — orphan cleanup now runs automatically per adapter via
  // `sweepOrphansForAdapter`. Silently discarding the flag violated the Silent
  // Failure Contract (CONSTITUTION §2 P5); warn when the operator opts in so
  // they can drop it from their invocation.
  if (opts.cleanOrphans) {
    warn(
      "--clean-orphans is now a no-op; orphan cleanup runs automatically per adapter. " +
      "Remove it from your invocation.",
    );
  }

  // D20: user-content discovery is informational here — adapters already
  // pick up `.agents/user/` items via readCanonicalFiles. Surface the count
  // so operators know whether their user artifacts are part of the run.
  try {
    const userArtifacts = await discoverUserContent(rootDir);
    if (userArtifacts.length > 0) {
      verbose(`User content: ${userArtifacts.length} artifact(s) discovered under .hatch3r/overrides/`);
    }
  } catch (err) {
    // Discovery failure must not break sync; log via verbose so the
    // diagnostic is available without polluting the default summary.
    verbose(`User content discovery skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  // C9-H84 (D20-F20.2.2 cross-linked with D15-SA15.1-F04): pre-flight body
  // scan of `.agents/user/` artifacts via validateContentBody. Stops a
  // prompt-injected or tampered user artifact from being propagated into
  // every adapter output. `--force` is required to override, mirroring the
  // integrity-drift gate below.
  try {
    const bodyViolations = await validateContentBody(rootDir);
    const bodyErrors = bodyViolations.filter((v) => v.severity === "error");
    if (bodyErrors.length > 0) {
      warn(`User-content pre-flight: ${bodyErrors.length} violation(s) detected`);
      for (const v of bodyErrors) {
        warn(`  ${v.relativePath}: ${v.message}`);
      }
      if (!opts.force) {
        logError(
          "Refusing to sync with denied patterns in user content. Edit the offending file(s), " +
          "delete via `rm`, or re-run with --force to propagate the content as-is.",
        );
        throw new HatchError(
          "User-content pre-flight scan failed (use --force to override)",
          undefined,
          "VALIDATION_ERROR",
          "Edit the offending file(s) listed above, delete via `rm`, or re-run with `--force` to propagate as-is.",
        );
      }
      warn("Continuing with --force: denied patterns in user content will be propagated.");
      console.log();
    }
  } catch (err) {
    if (err instanceof HatchError) throw err;
    // Scan failure must not break sync; log via verbose so the diagnostic is
    // available without polluting the default summary.
    verbose(`User-content pre-flight scan skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  // F6.4-H1 (D6, OWASP ASI06 Memory & Context Poisoning): materialization-time
  // learnings + handoffs gate.
  //
  // D15-13 (Cycle 11 Wave 3, D15, ASI06): accuracy correction. No CLI adapter
  // (claude/cursor/copilot) reads the `learning` type into a context file —
  // `src/adapters/canonical.ts` registers `learnings` in `canonicalReadMap` but
  // no `doGenerate` consumes it. `.hatch3r/learnings/` is materialized into a
  // session by the RUNTIME `hatch3r-learnings-loader` agent (Claude SessionStart
  // hook, see `src/adapters/claude.ts`), not by a deterministic adapter sink. So
  // the ASI06 attack surface for learnings is the loader LLM — which has no JS
  // runtime, making its "invoke sanitizeUserContent" prose unenforceable at run
  // time. The two deterministic passes below are therefore a DEFENSE-IN-DEPTH
  // pre-flight (CLI-write boundary), NOT the primary enforcement of a non-
  // existent adapter materialization sink: they hard-fail the run before a
  // poisoned learning can be loaded by that runtime agent on the next session.
  // `.hatch3r/handoffs/` ARE user-tier state consumed by resuming agents; the
  // same deterministic pass refuses a poisoned handoff before the next agent
  // reads it. `validate.ts` runs these at `validate` time; this is the auto-run
  // that closes the runtime-load gap (D6-7 — the deterministic gate was opt-in,
  // never on the write path).
  //
  // D6-7 (Cycle 11 Wave 2, D6, ASI06): a learnings injection-pattern hit now
  // BLOCKS the sync (override with `--force`), matching the handoffs validator
  // which already treats P-LEARN-01..05 matches as hard errors. Previously such
  // hits were non-blocking warnings, so a poisoned learning was poured into
  // every adapter context file behind an advisory. Structural errors
  // (oversized / binary / malformed-name) still block; benign advisories
  // (non-.md files) stay warnings. Missing dirs are a valid clean state (both
  // validators return valid+empty on ENOENT).
  try {
    const learnings = await validateLearningsDirectory(
      join(rootDir, HATCH3R_DIR, "learnings"),
      { maxCount: m.learnings?.maxCount },
    );
    // Surface every advisory; inject-pattern hits are also listed in
    // `injectionHits` and gated below.
    const benignWarnings = learnings.warnings.filter((w) => !learnings.injectionHits.includes(w));
    if (benignWarnings.length > 0) {
      warn(`Learnings content scan: ${benignWarnings.length} advisory(ies):`);
      for (const w of benignWarnings) warn(`  ${w}`);
    }
    if (learnings.injectionHits.length > 0) {
      logError(`Learnings injection scan: ${learnings.injectionHits.length} prompt-injection / context-poisoning hit(s) detected (ASI06):`);
      for (const h of learnings.injectionHits) logError(`  ${h}`);
    }
    // D6-7: block on either structural errors OR injection hits.
    if (!learnings.valid || learnings.injectionHits.length > 0) {
      if (!learnings.valid) {
        warn(`Learnings validation: ${learnings.errors.length} structural error(s) detected`);
        for (const e of learnings.errors) warn(`  ${e}`);
      }
      if (!opts.force) {
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
      console.log();
    }

    // D6-26 (Cycle 11 Wave 3, D6, ASI06): auto-quarantine past-expiry handoffs
    // BEFORE the validation gate. Expiry was advisory-only — an expired handoff
    // stayed in `active/` and a resuming agent read stale, possibly long-
    // superseded state. `pruneHandoffs` atomically moves each past-expiry active
    // handoff to `archived/` (write-new + rename, tagged `archived:expired`), so
    // the active read path holds only unexpired entries. This runs on every sync
    // including `--force` (quarantine is non-destructive — the file survives in
    // `archived/`, it is just off the resume path). Failures stay warnings; a
    // handoff that cannot be moved is still caught by the validator below.
    const pruned = await pruneHandoffs(join(rootDir, HATCH3R_DIR));
    if (pruned.archived.length > 0) {
      warn(
        `Handoffs: quarantined ${pruned.archived.length} past-expiry handoff(s) to ` +
          `${HATCH3R_DIR}/handoffs/archived/ (off the resume read path): ` +
          `${pruned.archived.join(", ")}`,
      );
    }
    for (const w of pruned.warnings) warn(`  ${w}`);

    // D6-7: auto-run the handoffs validator on the materialization path. The
    // handoffs validator already classifies injection-pattern hits + integrity
    // mismatches + malformed frontmatter as blocking `errors`; running it here
    // refuses a sync that would otherwise leave a poisoned handoff readable by
    // the next resuming agent. Drift advisories (expiry / git_ref) stay
    // warnings. `--force` overrides, mirroring the learnings gate.
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
      if (!opts.force) {
        throw new HatchError(
          "Handoffs pre-flight scan failed (use --force to override)",
          undefined,
          "VALIDATION_ERROR",
          "Fix the offending handoff file(s) under .hatch3r/handoffs/active/ (injection pattern, integrity mismatch, or malformed frontmatter), or re-run with `--force`.",
        );
      }
      warn("Continuing with --force: invalid/poisoned handoffs remain on disk for resuming agents.");
      console.log();
    }
  } catch (err) {
    if (err instanceof HatchError) throw err;
    verbose(`Learnings/handoffs pre-flight scan skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  // F6.4-H1 (D6, OWASP ASI06): per-file learnings loader gate. The directory-
  // level scan above is the hard pre-flight that refuses the run; this is the
  // defense-in-depth per-file gate that runs even under `--force` — invalid
  // individual files are skipped from the loadable set, with the skip routed
  // through the `.failure-log.jsonl` channel (Silent Failure Contract —
  // CONSTITUTION §2 P5).
  //
  // D15-13 (Cycle 11 Wave 3, D15, ASI06): the loader is a read-only enumeration
  // that mirrors the same gates the runtime `hatch3r-learnings-loader` agent is
  // instructed to apply when it loads `.hatch3r/learnings/` into a session (no
  // CLI adapter reads the `learning` type — see the directory-gate comment
  // above). It acts as an audit-visible counter over BOTH dispositions:
  // `skipped` (fail-closed) AND `loaded` (the files that survive every gate and
  // will be available to that runtime agent). The prior code discarded
  // `loaded`, so the count of learnings actually cleared for runtime load was
  // never observable — surface it under --verbose. Skipping a single bad file
  // does not poison the rest of the sync.
  try {
    const loaderResult = await loadValidatedLearnings(rootDir, {
      onWarn: (msg) => warn(msg),
      source: "sync:learnings-loader",
    });
    if (loaderResult.skipped.length > 0) {
      warn(
        `Learnings loader skipped ${loaderResult.skipped.length} file(s) — ` +
          `fail-closed, not available for runtime load; audit detail in ` +
          `${HATCH3R_DIR}/${FAILURE_LOG_FILE}`,
      );
    }
    if (loaderResult.loaded.length > 0) {
      verbose(
        `Learnings loader: ${loaderResult.loaded.length} file(s) passed every gate and ` +
          `are available to the runtime hatch3r-learnings-loader agent ` +
          `(${loaderResult.loaded.reduce((n, l) => n + l.byteLength, 0)} bytes total).`,
      );
    }
  } catch (err) {
    // The loader is contracted never to throw; any escape is unexpected
    // and routes through verbose() rather than aborting the sync.
    verbose(`Learnings loader hook skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Wave 7: the canonical-content integrity preflight is gone — adapters now
  // source content directly from the bundled package (`resolveBundledContentRoot`),
  // which is read-only and verified by npm's tarball signature. Drift is
  // detected per-output by `hatch3r status` / `hatch3r verify`, not per
  // canonical-input by a sha256 manifest.
  //
  // D11-H-1: `--force` now serves two contracts at the sync surface:
  //   1. Pre-flight denied-pattern bypass (handled above at the user-content
  //      pre-flight gate).
  //   2. Per-write `safeWriteFile.options.force` pass-through so a
  //      hatch3r-prefixed filename rule does not silently skip a file the
  //      user has stripped of managed-block markers but still wants
  //      overwritten. Threaded into every `safeWriteFile` call below.

  // F2.3-H1 (Cycle 10 Phase B Wave 1A): materialize Layer-4 manifest
  // customization payload into Layer-2 `.customize.yaml` files when YAML
  // is absent. Mirrors the init.ts step. Skipped under `--dry-run` to keep
  // the no-write contract; the rehydration would otherwise create files
  // even when sync is supposed to be read-only.
  if (!opts.dryRun) {
    const rehydration = await rehydrateCustomization(rootDir, m.customization);
    for (const w of rehydration.warnings) { warn(w); }
  }

  const results: { path: string; action: string }[] = [];
  // Wave 3: no AGENTS.md bridge step; one step per adapter.
  const totalSteps = m.tools.length;
  let currentStep = 0;

  // --diff: track file snapshots before and after generation
  const diffBefore = new Map<string, string | null>();
  const diffAfter = new Map<string, string | null>();

  // Wave 3: AGENTS.md sync step removed (no canonical or root AGENTS.md
  // emission, per blueprint v2 decision #3). Adapters source canonical
  // content from the bundled package via resolveBundledContentRoot.
  const canonicalContentRoot = resolveBundledContentRoot();

  // Decision 27 (Bucket 2.2) wiring: snapshot every file `sync` is about
  // to overwrite before the adapter loop runs. Captures the manifest plus
  // every path the prior run recorded in managedFiles +
  // managedFilesByAdapter so a single `hatch3r rollback --session=<id>`
  // reverts the whole sync. `--dry-run` skips capture since nothing
  // mutates. Worktree include is included whenever worktree is enabled;
  // tombstones handle the "did not exist before" case for first-run
  // adapter additions.
  const syncSnapshotPaths: string[] = [join(rootDir, HATCH3R_DIR, "hatch.json")];
  if (m.worktree?.enabled) {
    syncSnapshotPaths.push(join(rootDir, WORKTREE_INCLUDE_FILE));
  }
  for (const rel of m.managedFiles) {
    syncSnapshotPaths.push(join(rootDir, rel));
  }
  if (m.managedFilesByAdapter) {
    for (const paths of Object.values(m.managedFilesByAdapter)) {
      for (const rel of paths) syncSnapshotPaths.push(join(rootDir, rel));
    }
  }
  // F14.2-H1 (D14): manifest.packages already participate via the
  // `managedFiles` + `managedFilesByAdapter` entries written by the prior
  // sync. A first-time sync against a freshly-detected monorepo where the
  // per-package paths are not yet in either bucket still snapshots them
  // correctly because the snapshot writer records absent files as
  // tombstones — `rollback` then deletes the per-package outputs that the
  // current run is about to create.
  const syncSnapshot = await withSnapshot(
    "sync",
    Array.from(new Set(syncSnapshotPaths)),
    async (_sessionId) => undefined,
    { projectRoot: rootDir, dryRun: !!opts.dryRun, onWarn: warn },
  );
  const syncSessionId = syncSnapshot.sessionId;

  const generationMode: GenerationMode = opts.minimal ? "minimal" : "standard";
  if (opts.minimal) {
    info("Minimal generation mode: output will be stripped-down to reduce token usage.");
  }

  // #260 (D11-11.7): Track output paths across adapters to detect collisions.
  // Wave 3: no sync-bridge outputs; collision detection now strictly across
  // adapters.
  const outputPathOwners = new Map<string, string>();

  const adapterFailures: { tool: string; error: string; code?: string }[] = [];
  // C8-D12-M3: Per-adapter output collector for `.agents/.provenance.json`
  // persistence after the adapter loop completes. Entries are captured only
  // on successful generation so failed adapters leave no stale provenance
  // behind. Contains the `sourceFiles` populated by BaseAdapter tracking.
  const perAdapterOutputs: Array<{ adapter: string; outputs: AdapterOutput[] }> = [];
  // Task #11 orphan-cleanup: snapshot the prior-run `managedFilesByAdapter`
  // before the adapter loop so we can diff against the new output paths
  // and unlink files previously written by hatch3r but not re-emitted by
  // the current adapter set (e.g. pre-B3 `hatch3r-*.mdc` still on disk
  // after an upgrade to `NN-hatch3r-*.mdc`).
  const previousManagedByAdapter: Record<string, string[]> = m.managedFilesByAdapter
    ? { ...m.managedFilesByAdapter }
    : {};
  // New managedFilesByAdapter assembled as adapters succeed. Persisted to
  // hatch.json at end-of-run so the next sync has an up-to-date history.
  const newManagedByAdapter: Record<string, string[]> = {};
  // Aggregate orphan-cleanup diagnostics across adapters so we can emit
  // one summary warning.
  const orphanEntries: OrphanCleanupEntry[] = [];
  // C7.5-W2B2-H22 (D6-SA6.1-2): Track budget-gate failures separately so the
  // terminal error carries exit code 2 (usage error, per finding spec), even
  // when the gate fires on a single-adapter project where the general
  // "all adapters failed" branch would otherwise exit with 1.
  let budgetGateFailed = false;
  // Per-adapter circuit breakers: an adapter that fails repeatedly with
  // transient errors trips and is short-circuited until the cooldown
  // elapses. Maintained across the loop so a tool seen multiple times
  // (e.g., during retry) accumulates state correctly.
  //
  // D8-M4: hydrate from the on-disk JSONL log so a recurring transient
  // failure (e.g. a flaky MCP endpoint) is recognised as already-open
  // across invocations. Entries older than BREAKER_STATE_TTL_MS (24h) are
  // dropped on read; hydrate failures degrade to an empty map silently
  // since persistence is best-effort.
  const breakerStatePath = join(hatch3rDir, BREAKER_STATE_FILE);
  let breakers = new Map<string, CircuitBreakerState>();
  try {
    const breakerLog = await readFile(breakerStatePath, "utf-8");
    // Silent-writes sweep (release/2.7.1): hydrateBreakersFromLog keys the map
    // by serviceId (`adapter:<tool>`) while the adapter loop below keys by
    // bare tool name, so hydrated entries were never found by
    // `breakers.get(tool)` — every run re-counted failures from zero even
    // when the persist succeeded. Re-key into the loop's tool vocabulary at
    // this seam; each state keeps its full serviceId in `config`, so the
    // serialized file stays serviceId-keyed.
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
    // ENOENT on first run is expected; any other failure is logged under
    // --verbose per the Silent Failure Contract (no functional impact —
    // we just start from a fresh map).
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      const message = err instanceof Error ? err.message : String(err);
      verbose(`Breaker-state hydrate skipped: ${message}`);
    }
  }

  // SA12.1-F-D12-M6 (D12, P1): the partial-failure callout is now built
  // inside the post-loop block and emitted AFTER the main summary box as a
  // dedicated boxed warning, so the half-state warning is visually distinct
  // and impossible to miss. Declared at this scope so both the inner adapter
  // loop and the post-summary block can refer to the same list.
  const partialFailureLines: string[] = [];

  // F16.1-C1: generation phase begins — record an in-progress checkpoint so a
  // `--resume` after a crash mid-generation knows the run did not complete.
  await recordPhase(1, "in-progress");

  // F8.3.4 (D8): wrap the adapter generation phase in a top-level wall-clock
  // deadman. The prior post-loop `isPipelineTimedOut`/`terminatePipeline`
  // check was advisory only — it ran AFTER the loop, so a single adapter that
  // hangs without yielding (e.g. a stat on a dead network mount inside
  // generation) never tripped it. `runWithPipelineDeadman` races the work
  // against a wall-clock timer and aborts its AbortController when the budget
  // elapses; we thread that signal into `executeWithPhaseTimeout` as the
  // parentSignal (C9-H20) so the abort actually propagates into the in-flight
  // adapter phase instead of being observed only after the fact.
  const phaseResult = await runWithPipelineDeadman(
    (deadmanSignal) =>
      // Wrap the entire per-adapter generation loop in a phase timeout so a
      // hanging adapter cohort surfaces as a phase-level timeout in addition
      // to the per-adapter timeout. The deadman signal is chained in so a
      // wall-clock breach aborts the phase controller too.
      executeWithPhaseTimeout(
        "adapter",
        // D8-10 (Cycle 11 Wave 3, D8, P-CQ4): the phase fn receives the phase
        // AbortSignal — `executeWithPhaseTimeout` aborts it on either the
        // phase-timeout timer OR the chained `deadmanSignal` (parentSignal,
        // below). Threading it into `generateWithTimeout`'s parentSignal slot
        // is what makes the abort reach the in-flight adapter:
        // `BaseAdapter.throwIfSignalAborted(signal)` then fires on the next
        // await. Before this fix the fn took no argument and passed `undefined`
        // in that slot, so the C9-H20 deadman→phase→adapter chain was severed
        // at the phase→adapter hop — a hang inside `adapter.generate` never saw
        // the abort and `runWithPipelineDeadman` could only reject AFTER the
        // adapter eventually returned (defeating the wall-clock budget).
        async (phaseSignal) => {
          for (const tool of m.tools) {
    const s = createSpinner(step(++currentStep, totalSteps, `Generating ${tool} output...`));
    s.start();

    let breaker = breakers.get(tool) ?? createCircuitBreaker({ serviceId: `adapter:${tool}` });
    const allowResult = shouldAllowRequest(breaker);
    breaker = allowResult.state;
    if (!allowResult.allowed) {
      s.fail(step(currentStep, totalSteps, `Skipped ${tool} (circuit open)`));
      adapterFailures.push({
        tool,
        error: allowResult.reason ?? `Circuit open for adapter:${tool}`,
      });
      breakers.set(tool, breaker);
      continue;
    }

    try {
      const adapter = getAdapter(tool);
      // Run adapter generation with a per-adapter timeout, and retry
      // transient failures with exponential backoff. Substantive failures
      // (auth, 404, malformed config) propagate on the first attempt.
      // Wave 3: pass canonicalContentRoot (bundled-package path), not the
      // user-repo `.agents/` dir. Adapters source canonical content from the
      // bundled package.
      const generationResult = await retryWithBackoff(
        // Wave 5: thread rootDir as userRepoRoot so D20 overrides at
        // <rootDir>/.hatch3r/overrides/ feed adapter generation.
        () =>
          generateWithTimeout(
            tool,
            adapter,
            canonicalContentRoot,
            m,
            generationMode,
            undefined,
            // D8-10: parentSignal — the phase signal carries the deadman abort
            // (deadman → phase controller → adapter). `generateWithTimeout`
            // chains it into its own per-adapter controller, so a wall-clock
            // breach surfaces as an AbortError on the adapter's next await.
            phaseSignal,
            rootDir,
          ),
        // D8-SA8.4-F8.4.6 (Cycle 10 Wave 4, D8, P-CQ4): the call-site walks
        // back retryWithBackoff's module default (DEFAULT_MAX_ATTEMPTS = 3) to
        // 2 — i.e. 1 initial attempt + 1 retry — deliberately. `sync` is
        // interactive; a 3rd attempt would add up to maxDelayMs (5s) of extra
        // wall time on a failing run for marginal added resilience, while the
        // per-adapter circuit breaker (recordFailure/shouldAllowRequest above)
        // already absorbs recurring transient failures across invocations and
        // the operator can re-run a failed sync cheaply. The fast-fail bias is
        // intentional here, not a copy-paste of the module default.
        { maxAttempts: 2 },
      );
      if (!generationResult.completed) {
        // D8-SA8.4-02 / D1-SA1.9-02 (Cycle 12, D8/D1): single-count this
        // adapter-incomplete/timeout failure. The prior shape called
        // `recordFailure` here AND threw a synthetic HatchError that the
        // enclosing per-tool catch (below) caught and passed to `recordFailure`
        // a SECOND time on the same failure event. An AdapterTimeoutError
        // message classifies `transient` (circuitBreaker.ts classifyFailure
        // `/timeout|timed out/i`), so one timed-out adapter advanced
        // `consecutiveFailures` by 2 — the breaker reached OPEN after 2 failing
        // invocations instead of the configured `failureThreshold` (default 3),
        // and `totalFailures` telemetry over-reported. Mirror the
        // `--strict-budget` branch above (record once → set → push → append →
        // continue): this path now owns its own single count and no longer
        // round-trips through the catch, which is left to own only
        // genuinely-thrown generic errors. The prior synthetic HatchError's
        // recovery hint was already discarded by that catch (it stored only
        // `err.message`), so removing the throw loses no surfaced guidance —
        // the aggregate `getRecoveryGuidance` block still reconstructs
        // actionable guidance from the recorded error string.
        const errMessage = generationResult.error ?? `Adapter ${tool} did not complete`;
        for (const w of generationResult.warnings) { warn(w); }
        s.fail(step(currentStep, totalSteps, `Failed to generate ${tool} output`));
        breaker = recordFailure(breaker, classifyFailure(new Error(errMessage)));
        breakers.set(tool, breaker);
        adapterFailures.push({ tool, error: errMessage });
        await appendFailure(hatch3rDir, "sync:adapter-generate", new Error(errMessage), tool);
        continue;
      }
      const outputs = generationResult.outputs ?? [];
      for (const w of generationResult.warnings) { warn(w); }

      // #260 (D11-11.7): Detect output path collisions across adapters
      for (const out of outputs) {
        const existingOwner = outputPathOwners.get(out.path);
        if (existingOwner && existingOwner !== tool) {
          warn(`Output path collision: "${out.path}" written by both "${existingOwner}" and "${tool}". Last writer wins.`);
        }
        outputPathOwners.set(out.path, tool);
      }

      verbose(`${tool}: ${outputs.length} file(s) generated`);

      // C7.5-W2B2-H22 (D6-SA6.1-2): Pre-write context budget gate.
      // The prior implementation checked the budget AFTER safeWriteFile
      // completed, which meant an over-budget adapter silently wrote oversized
      // files to disk and only then printed a warning. We now measure
      // utilization before any write, so (a) the warning precedes the write
      // (P1 actionable errors), and (b) `--strict-budget` can abort the write
      // and surface the finding as a usage error (exit code 2).
      const budgetResult = checkContextBudget(tool, outputs);
      const budgetWarning = formatBudgetWarning(budgetResult);
      if (budgetWarning) {
        if (opts.strictBudget) {
          s.fail(step(currentStep, totalSteps, `${tool} output exceeds context budget (--strict-budget)`));
          warn(budgetWarning);
          const errMessage = `${tool}: context budget exceeded (${budgetResult.utilizationPercent}% of ${Math.round(budgetResult.budgetTokens / 1000)}K tokens)`;
          breaker = recordFailure(breaker, classifyFailure(new Error(errMessage)));
          breakers.set(tool, breaker);
          adapterFailures.push({ tool, error: errMessage });
          budgetGateFailed = true;
          await appendFailure(hatch3rDir, "sync:budget-gate", new Error(errMessage), tool);
          continue;
        }
        warn(budgetWarning);
      }

      if (opts.dryRun) {
        // --dry-run: show what adapter would generate without writing files
        // SA12.1-F-D12-M8 (D12, P1): when `--preview-tool <name>` matches this
        // adapter, ALSO write the full content body to stderr so the operator
        // can verify the bytes before re-running without --dry-run. Stderr
        // (not stdout) so the preview does not pollute a piped JSON consumer
        // (`hatch3r sync --dry-run --format=json` keeps a clean stdout).
        const previewActive = !!opts.previewTool && opts.previewTool === tool;
        for (const out of outputs) {
          // D11-SA11.2-F9 (Cycle 10 Wave 4, D11, P1): predict the marker-aware
          // action the live write would produce instead of a generic
          // "dry-run" row, so a missing-marker file surfaces as a would-be
          // `skipped` / `merged` here rather than diverging from the real
          // sync. Uses the SAME options the live branch below passes
          // (appendIfNoBlock + force for managed content; force otherwise) and
          // is run through `renderAction` so the summary icon/tally match a
          // live run exactly. `predictMergeAction` is pure (no disk write).
          const isManagedMerge = Boolean(out.managedContent);
          const existing = await readFileOrNull(join(rootDir, out.path));
          const predicted = predictMergeAction(existing, out.content, join(rootDir, out.path), {
            managedContent: out.managedContent,
            appendIfNoBlock: out.managedContent ? true : undefined,
            force: opts.force,
          });
          results.push({ path: out.path, action: renderAction(predicted, isManagedMerge) });
          if (opts.diff) {
            diffBefore.set(out.path, existing);
            diffAfter.set(out.path, out.content);
          }
          if (previewActive) {
            const banner = `\n${chalk.dim("───")} ${chalk.bold(out.path)} ${chalk.dim("─".repeat(40))}`;
            console.error(banner);
            console.error(out.content);
            console.error(chalk.dim("─".repeat(60)));
          }
        }
      } else {
        // D11-SA11.1-04: build the per-adapter path list incrementally, in
        // lockstep with the flat-list `addManagedFile` below, so a mid-loop
        // `safeWriteFile` throw leaves BOTH inventories reflecting the same
        // partial reality. Seed from the PRIOR run's paths (not []): the flat
        // `m.managedFiles` is cumulative across runs, so on a first-output
        // throw it retains the prior paths — seeding this list from prior keeps
        // the two consistent in that case too. On full loop completion the
        // post-loop `newManagedByAdapter[tool] = [...currentPaths]` overwrites
        // this with the fresh current set (needed for orphan detection); this
        // seed only survives when the loop throws before reaching that line.
        const managedPathsForTool: string[] = previousManagedByAdapter[tool]
          ? [...previousManagedByAdapter[tool]]
          : [];
        newManagedByAdapter[tool] = managedPathsForTool;
        for (const out of outputs) {
          if (opts.diff) {
            diffBefore.set(out.path, await readFileOrNull(join(rootDir, out.path)));
          }
          const fullPath = join(rootDir, out.path);
          // D11-H-1 + F10.4-1: thread opts.force per-write and classify the
          // user-visible disposition (merged vs regenerated).
          const isManagedMerge = Boolean(out.managedContent);
          if (out.managedContent) {
            const result = await safeWriteFile(fullPath, out.content, {
              managedContent: out.managedContent,
              // D11-H-3: splice the managed block back into a user file whose
              // markers were stripped, matching init.ts:614-617,
              // update.ts:845, and workspace/sync.ts:493. Without this the
              // managedContent + no-marker branch in safeWrite.ts:432-437
              // returns action: "skipped" and a re-sync never restores the
              // block — `hatch3r verify` then reports permanent drift.
              appendIfNoBlock: true,
              force: opts.force,
            });
            if (result.warning) warn(result.warning);
            verbose(`${out.path}: ${result.action}`);
            results.push({
              path: out.path,
              action: renderAction(result.action, isManagedMerge),
            });
          } else {
            const result = await safeWriteFile(fullPath, out.content, {
              force: opts.force,
            });
            if (result.warning) warn(result.warning);
            verbose(`${out.path}: ${result.action}`);
            results.push({
              path: out.path,
              action: renderAction(result.action, isManagedMerge),
            });
          }
          // D11-H-2: record every emitted output in manifest.managedFiles so
          // a sync-only adoption path populates the flat list. Mirrors
          // init.ts:598 and update.ts:386. addManagedFile is idempotent.
          addManagedFile(m, out.path);
          // D11-SA11.1-04: mirror the flat-list add into the per-adapter list
          // in the same iteration so the two inventories never diverge on a
          // mid-loop write failure (dedup keeps a re-emitted prior path single).
          if (!managedPathsForTool.includes(out.path)) managedPathsForTool.push(out.path);
          if (opts.diff) {
            diffAfter.set(out.path, await readFileOrNull(join(rootDir, out.path)));
          }
        }
      }

      // D14-4 (Cycle 11 Wave 2, D14, CQ6): seed `newManagedByAdapter[tool]`
      // with the root output paths BEFORE the per-package block so the
      // per-package append below extends this list instead of being clobbered.
      // Previously the `= currentPaths` assignment ran AFTER the per-package
      // block (which appended per-package paths), discarding every per-package
      // entry — the persisted manifest then omitted them and
      // `sweepOrphansForAdapter` could never reclaim a removed package's
      // outputs. A COPY is stored (not the `currentPaths` reference) so the
      // per-package `arr.push` does not also mutate the root-only `currentPaths`
      // the orphan sweep below compares against.
      const currentPaths = outputs.map((o) => o.path);
      newManagedByAdapter[tool] = [...currentPaths];

      // F14.2-H1 (D14): per-package emission for monorepo roots. When
      // `m.packages` is non-empty we additionally write each adapter's
      // output into every `<package>/.hatch3r/<rel>`. The root emission
      // above remains the primary surface; per-package copies are
      // additive. Skipped under `--dry-run` (recorded as dry-run rows
      // instead). Per-write failures route through `warn` so a single
      // permissions issue does not abort the sync (Silent Failure
      // Contract — CONSTITUTION §2 P5).
      if (m.packages && m.packages.length > 0) {
        // D14-6: planPerPackageOutputs re-targets only for tools whose load
        // model reads per-directory files (cursor); claude/copilot get [] so a
        // sync never writes copies they would not read.
        const perPackage = planPerPackageOutputs(tool, m.packages, outputs);
        for (const p of perPackage) {
          if (opts.dryRun) {
            // D11-SA11.2-F9: marker-aware would-be action for per-package
            // outputs too, matching the root dry-run path above.
            const isManagedMerge = Boolean(p.output.managedContent);
            const existing = await readFileOrNull(join(rootDir, p.output.path));
            const predicted = predictMergeAction(existing, p.output.content, join(rootDir, p.output.path), {
              managedContent: p.output.managedContent,
              appendIfNoBlock: p.output.managedContent ? true : undefined,
              force: opts.force,
            });
            results.push({ path: p.output.path, action: renderAction(predicted, isManagedMerge) });
            if (opts.diff) {
              diffBefore.set(p.output.path, existing);
              diffAfter.set(p.output.path, p.output.content);
            }
            continue;
          }
          const fullPath = join(rootDir, p.output.path);
          if (opts.diff) {
            diffBefore.set(p.output.path, await readFileOrNull(fullPath));
          }
          try {
            const isManagedMerge = Boolean(p.output.managedContent);
            const result = p.output.managedContent
              ? await safeWriteFile(fullPath, p.output.content, {
                  managedContent: p.output.managedContent,
                  appendIfNoBlock: true,
                  force: opts.force,
                })
              : await safeWriteFile(fullPath, p.output.content, { force: opts.force });
            if (result.warning) warn(result.warning);
            verbose(`${p.output.path}: ${result.action} (package ${p.packageName})`);
            results.push({
              path: p.output.path,
              action: renderAction(result.action, isManagedMerge),
            });
            addManagedFile(m, p.output.path);
            // D14-4: extend the seeded managed-by-adapter list (root paths,
            // assigned before this block) with each per-package path so a
            // future sync can orphan-cleanup stale per-package files when
            // packages are removed from the workspace globs. The `??` keeps a
            // defensive fallback in case the seeding ever regresses.
            const arr = newManagedByAdapter[tool] ?? (newManagedByAdapter[tool] = []);
            if (!arr.includes(p.output.path)) arr.push(p.output.path);
            if (opts.diff) {
              diffAfter.set(p.output.path, await readFileOrNull(fullPath));
            }
          } catch (err) {
            warn(
              `sync: per-package emission failed for ${tool} -> ${p.output.path} ` +
                `(package ${p.packageName}): ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }

      breaker = recordSuccess(breaker);
      breakers.set(tool, breaker);
      // C8-D12-M3: Record adapter outputs for .provenance.json persistence
      // below. We capture on success so a failed or timed-out adapter does
      // not contribute stale attribution; the outputs already carry their
      // BaseAdapter-populated `sourceFiles`.
      perAdapterOutputs.push({ adapter: tool, outputs });
      // Task #11 orphan-cleanup: sweep paths the prior run wrote but this run
      // did not re-emit. Skipped entirely on dry-run and when no prior history
      // exists for the adapter (first-run).
      //
      // D14-5: the diff baseline is the FULL current set
      // (`newManagedByAdapter[tool]` = root paths seeded above + per-package
      // paths appended in the block above), NOT root-only `currentPaths`. With
      // root-only the diff would flag every still-emitted per-package file as an
      // orphan; per-package roots are now accepted by the containment check, so
      // those false candidates would be deleted on every sync. Comparing against
      // the full set leaves live per-package files out of the candidate list and
      // surfaces only the paths a removed package no longer re-emits. The
      // `m.packages` paths are passed as `packageRoots` so a removed package's
      // `<pkg>/<adapter-root>/…` orphan passes containment and is reclaimed.
      if (!opts.dryRun) {
        const priorPaths = previousManagedByAdapter[tool];
        if (priorPaths && priorPaths.length > 0) {
          const currentForDiff = newManagedByAdapter[tool] ?? currentPaths;
          const packageRoots = m.packages?.map((p) => p.path);
          const entries = await sweepOrphansForAdapter(
            tool,
            rootDir,
            priorPaths,
            currentForDiff,
            packageRoots,
          );
          orphanEntries.push(...entries);
        }
      }
      s.succeed(step(currentStep, totalSteps, opts.dryRun
        ? `${tool} output (dry run: ${outputs.length} file(s))`
        : `${tool} output generated`));
    } catch (err) {
      s.fail(step(currentStep, totalSteps, `Failed to generate ${tool} output`));
      breaker = recordFailure(breaker, classifyFailure(err));
      breakers.set(tool, breaker);
      adapterFailures.push({
        tool,
        error: err instanceof Error ? err.message : String(err),
        // D8-SA8.4-03: preserve the Node errno so the aggregate recovery-
        // guidance path below resolves EACCES/ENOSPC (and network errnos) to
        // filesystem/network-specific guidance instead of downgrading to a
        // generic "unknown" hint — reconstructing a bare Error from the message
        // string alone drops `.code`, the field `classifyDependency` matches first.
        code: extractErrorCode(err),
      });
      // Record to persistent failure log for post-hoc debugging
      await appendFailure(hatch3rDir, "sync:adapter-generate", err, tool);
    }
    }
        },
        undefined,
        deadmanSignal,
      ),
    DEFAULT_PIPELINE_TIMEOUT_MS,
  ).catch(async (err: unknown) => {
    // F8.3.4: a wall-clock breach rejects the deadman with PipelineTimeoutError.
    // Unlike the old advisory check, the in-flight adapter phase has already
    // been signalled to abort. Surface it as a usage-actionable timeout (exit
    // 2 — the run did not complete within budget) rather than a silent partial.
    if (err instanceof PipelineTimeoutError) {
      // D8-M5: before re-throwing, reconcile any partial writes into the
      // manifest so the next `hatch3r status` / `hatch3r verify` sees the
      // half-state instead of treating already-written files as drift. The
      // adapter loop populates `newManagedByAdapter` incrementally; merge the
      // partial entries with prior history and persist so the post-crash
      // inventory matches reality.
      try {
        const mergedByAdapter: Record<string, string[]> = { ...previousManagedByAdapter };
        for (const [tool, paths] of Object.entries(newManagedByAdapter)) {
          mergedByAdapter[tool] = [...paths];
        }
        if (Object.keys(mergedByAdapter).length > 0) {
          m.managedFilesByAdapter = mergedByAdapter;
          await writeManifest(rootDir, m);
          verbose(
            `Sync deadman fired: reconciled ${Object.keys(mergedByAdapter).length} adapter entry(ies) ` +
              `into manifest before re-throw.`,
          );
        }
      } catch (reconcileErr) {
        // Reconciliation is best-effort — if it fails we still throw the
        // timeout error, but the operator sees the partial inconsistency.
        const message = reconcileErr instanceof Error ? reconcileErr.message : String(reconcileErr);
        warn(`Manifest reconciliation after pipeline timeout failed: ${message}`);
      }
      logError(err.message);
      throw new HatchError(
        `Sync exceeded its ${Math.round(err.timeoutMs / 1000)}s pipeline budget and was aborted.`,
        2,
        "ADAPTER_ERROR",
        "A hanging adapter or filesystem call exceeded the wall-clock budget. Re-run `hatch3r sync --verbose` to see which adapter stalled, or check for an unresponsive network mount under the project root.",
      );
    }
    throw err;
  });
  if (!phaseResult.completed && phaseResult.error) {
    warn(phaseResult.error);
  }
  // F16.1-C1: generation/adapter phase completed (with or without per-adapter
  // failures — those are handled below). Record wave 1 passed so resume can
  // skip a fully-regenerated run.
  await recordPhase(1, "passed");

  // D8-M4: persist the final breaker state to `.hatch3r/.breaker-state.jsonl`
  // so a recurring transient failure surface is recognised as already-open on
  // the next sync invocation. Best-effort: a write failure is logged but does
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
  // C8-D8-M1 (D8): classify each adapter failure and aggregate transience
  // across tools so the thrown HatchError carries actionable guidance in
  // addition to the per-tool log lines. classifiedFailures persists past
  // this block so the partial-failure terminal throw can reuse it.
  const classifiedFailures: { tool: string; depClass: ReturnType<typeof classifyDependency>; failType: ReturnType<typeof classifyFailure> }[] = [];
  if (adapterFailures.length > 0) {
    for (const f of adapterFailures) {
      const reconstructed = new Error(f.error);
      // D8-SA8.4-03: restore the captured errno onto the reconstructed Error so
      // classifyDependency's code-first branch (EACCES/ENOSPC/ECONNREFUSED/…)
      // resolves the filesystem/network class instead of falling through to
      // "unknown" on a message that carries no bare errno token.
      if (f.code) (reconstructed as NodeJS.ErrnoException).code = f.code;
      const depClass = classifyDependency(reconstructed);
      const failType = classifyFailure(reconstructed);
      classifiedFailures.push({ tool: f.tool, depClass, failType });
      const guidance = getRecoveryGuidance(depClass, failType);
      logError(`Failed to generate ${f.tool}: ${f.error}`);
      info(`  ${guidance}`);
    }
    if (adapterFailures.length === m.tools.length) {
      // C7.5-W2B2-H22: when --strict-budget tripped the only adapter(s) in
      // this run, surface a usage-error exit code (2) instead of the central
      // sysexits-mapped ADAPTER_ERROR (69). --strict-budget is a caller-driven
      // gate, not an internal fault. C8-D1-M5 migration: when the budget gate
      // did NOT trip, pass `undefined` so the central map provides the
      // sysexits-aligned ADAPTER_ERROR code (69, EX_UNAVAILABLE).
      const exitCode = budgetGateFailed ? 2 : undefined;
      const allTransient = classifiedFailures.every((c) => c.failType === "transient");
      const aggregateGuidance = budgetGateFailed
        ? "Re-run without --strict-budget, or shrink the always-on slice: disable the largest rules via `.hatch3r/rules/<id>.customize.yaml` (`enabled: false`) or deselect content with `hatch3r config`. (`--minimal` only strips formatting from the same corpus and will not clear the gate.)"
        : allTransient
          ? "All failures appear transient. Retry `hatch3r sync`, or run `hatch3r update --offline` to refresh from canonical content."
          : "One or more failures are substantive. Inspect the per-adapter messages above and resolve before retrying.";
      throw new HatchError(
        `All adapters failed. ${aggregateGuidance}`,
        exitCode,
        "ADAPTER_ERROR",
        aggregateGuidance,
      );
    }
    // #253 (D8-8.20): Partial adapter failures should not silently report success.
    // We continue to generate a summary but track that partial failure occurred.
    warn(`${adapterFailures.length} of ${m.tools.length} adapter(s) failed. Output may be incomplete.`);
  }

  for (const tool of m.tools) {
    const warnings = getUnsupportedFeatureWarnings(tool, m);
    for (const w of warnings) {
      warn(w);
    }
  }

  if (!opts.dryRun) {
    // Regenerate .worktreeinclude
    if (m.worktree?.enabled) {
      const wtContent = await generateWorktreeInclude(m, rootDir);
      const wtManaged = extractManagedContent(wtContent);
      // D11-H-1: thread opts.force into the worktree write.
      // D11-H-3: appendIfNoBlock restores the managed block when a user has
      // stripped the .worktreeinclude markers, matching init.ts:640-643 so
      // sync and init share one marker-recovery contract.
      const wtResult = await safeWriteFile(
        join(rootDir, WORKTREE_INCLUDE_FILE),
        wtContent,
        { managedContent: wtManaged, appendIfNoBlock: true, force: opts.force },
      );
      if (wtResult.warning) warn(wtResult.warning);
      results.push({
        path: WORKTREE_INCLUDE_FILE,
        action: renderAction(wtResult.action, true),
      });
      // D11-H-2: mirror init.ts:624 — register the worktree include in
      // managedFiles so a sync-only adoption path populates the flat list.
      addManagedFile(m, WORKTREE_INCLUDE_FILE);
    }

    if (m.features.mcp && m.mcp.servers.length > 0) {
      const envResult = await ensureEnvMcp(rootDir, m.mcp.servers);
      await ensureGitignoreEntry(rootDir);
      if (envResult.action !== "skipped") {
        results.push({ path: envResult.path, action: envResult.action });
      }
      if (envResult.newVars.length > 0) {
        warn(
          `New secrets needed in .env.mcp: ${envResult.newVars.join(", ")}`,
        );
        info(`Run this, then start or restart your editor: ${getSourceEnvMcpCommand()}`);
      }
    }

    // D1-SA1.3.2 (High): Always regenerate the integrity manifest after sync.
    // The manifest records canonical content hashes in `.agents/` — those files
    // are READ, not written, by adapters, so the hash set is stable regardless
    // of adapter outcome. We also record `expectedAdapters` (all configured
    // tools) and `successfulAdapters` (tools whose generation completed) so
    // that `hatch3r status`, `hatch3r verify`, and CI consumers can detect a
    // partial-failure sync without re-reading hatch.json.
    //
    // Historical context: pre-C7-H13, the manifest was regenerated on every
    // sync; C7-H13 (Cycle 7) then skipped regeneration on partial failure out
    // of concern that "fresh + stale" adapter outputs would be certified.
    // That concern was based on the incorrect premise that adapter outputs
    // are in the manifest — they are not. The manifest only covers canonical
    // `.agents/` content, which is unaffected by adapter success/failure.
    // Wave 3: integrity manifest writes removed; Wave 7 will reintroduce a
    // bundled-content integrity model. Partial-adapter outcomes are surfaced
    // via the per-adapter warnings emitted above.
    const successfulAdapters = m.tools.filter(
      (t) => !adapterFailures.some((f) => f.tool === t),
    );
    // SA12.1-F-D12-M6 (D12, P1): build the partial-failure callout into the
    // outer-scope `partialFailureLines` array so the post-summary block can
    // emit it as a dedicated boxed warning AFTER the main summary box. The
    // prior inline `warn()` lines got buried mid-scroll among per-file
    // warnings and users routinely missed them.
    if (adapterFailures.length > 0) {
      // D11-H-4: the adapter loop is non-transactional — successful adapters
      // already wrote new bytes to disk while failed adapters left their
      // prior outputs in place. Emit a per-adapter disposition so the
      // operator has the actionable half-state list (which files are new
      // vs stale), then point at the pre-sync snapshot (captured by
      // withSnapshot above, D11-C-3) as the all-or-nothing recovery.
      const failedTools = adapterFailures.map((f) => f.tool);
      partialFailureLines.push(
        `${successfulAdapters.length}/${m.tools.length} adapter(s) successful — repo is in a partial state.`,
      );
      if (successfulAdapters.length > 0) {
        partialFailureLines.push(`Updated on disk (new output): ${successfulAdapters.join(", ")}`);
      }
      partialFailureLines.push(`Unchanged (prior output retained): ${failedTools.join(", ")}`);
      if (syncSessionId) {
        partialFailureLines.push(
          `Revert to pre-sync state: hatch3r rollback --session=${syncSessionId}`,
        );
      }
      partialFailureLines.push(`Otherwise: resolve the failed adapter(s) and re-run hatch3r sync.`);
    }

    // D12-3 (D12, P6): the `writeProvenance` call below writes
    // `.hatch3r/provenance.json` unconditionally, but the only
    // `ensureGitignoreEntry` call earlier in sync is gated behind
    // `features.mcp`. A no-MCP sync would leave the machine-local provenance
    // manifest stageable by the next `git add .`. Register the gitignore
    // carve-out unconditionally before writing it (idempotent — the MCP-gated
    // call above is a harmless redundant cover), mirroring the same decoupling
    // init.ts applies for snapshots/handoffs.
    await ensureGitignoreEntry(rootDir);

    // SA12.4-F1 (D12) / D12-4 (Cycle 11 Wave 2, D12, P2): persist the on-disk
    // provenance manifest at `.hatch3r/provenance.json` via the shared
    // `writeProvenance` helper so `hatch3r explain --source` can trace a
    // generated adapter file back to the canonical content that shaped it, and
    // `hatch3r status` has the emit-time hash baseline for drift attribution.
    // The same helper is called from `init` and `update` (D12-4) so the
    // first-run trace is populated at init and the baseline is refreshed at
    // update — the writer is no longer sync-only. `lastCommand: "sync"` records
    // the originating command; `failedAdapters` drives the D11-M2 split-brain
    // carry-forward (failed adapters keep their prior provenance rows so the
    // half-state on disk stays attributable). A write failure is surfaced via
    // `warn()` and never breaks the sync (Silent Failure Contract, P5).
    await writeProvenance(rootDir, perAdapterOutputs, "sync", {
      failedAdapters: adapterFailures.map((f) => f.tool),
      onWarn: warn,
    });

    // Task #11 orphan-cleanup: emit an aggregated diagnostic for every
    // orphan candidate we inspected this run. `unlinked` entries are
    // informational; `user-wrapped` / `outside-adapter-root` skips and
    // `unlink-failed` entries surface via warn() per the Silent Failure
    // Contract so operators see what was refused and why.
    const orphanDiag = formatOrphanCleanupDiagnostic(orphanEntries);
    if (orphanDiag) warn(orphanDiag);

    // Task #11: persist the updated `managedFilesByAdapter` so the next
    // sync has a history to diff against. We merge — adapters that failed
    // this run keep their previously recorded paths (we did not verify
    // those outputs changed), and successful adapters overwrite their
    // entry with the fresh path list.
    const mergedByAdapter: Record<string, string[]> = { ...previousManagedByAdapter };
    for (const [tool, paths] of Object.entries(newManagedByAdapter)) {
      mergedByAdapter[tool] = [...paths];
    }
    m.managedFilesByAdapter = mergedByAdapter;
    await writeManifest(rootDir, m);

    // F16.1-C1: merge phase (worktree + mcp env + manifest) committed to disk.
    // Record wave 2 passed — this is the resumable "done" marker for a
    // non-dry-run sync.
    await recordPhase(2, "passed");

    // Prune stale archive entries
    await pruneArchives(rootDir);

    // Check spec freshness
    await checkSpecFreshness(rootDir);

    // #267 (D11-11.14): Detect orphaned .customize.md files at sync time.
    // When content is removed from the manifest, customization files become
    // orphaned and should be flagged so users can clean them up.
    if (m.content) {
      const allContentIds = new Set<string>();
      for (const ids of Object.values(m.content.items)) {
        for (const id of ids) allContentIds.add(id);
      }
      const CUSTOMIZE_DIRS = ["agents", "commands", "skills", "rules"];
      for (const dir of CUSTOMIZE_DIRS) {
        try {
          const files = await readdir(join(rootDir, ".hatch3r", dir));
          for (const f of files.filter(f => f.endsWith(".customize.yaml") || f.endsWith(".customize.md"))) {
            const itemId = f.replace(/\.customize\.(yaml|md)$/, "");
            const prefixed = `hatch3r-${itemId}`;
            if (!allContentIds.has(itemId) && !allContentIds.has(prefixed) &&
                !allContentIds.has(`cmd-${itemId}`) && !allContentIds.has(`cmd-${prefixed}`)) {
              warn(`Orphaned customization: .hatch3r/${dir}/${f} — content no longer in manifest. Consider removing it.`);
            }

            // D10-M12 (Cycle 10): syntax-check .customize.yaml during sync so
            // an invalid override fails loud here rather than silently
            // dropping during adapter generation. Mirrors the cheap half of
            // `validate.ts::validateCustomizeYaml`: 10KB size cap (matches
            // `src/models/customize.ts` skip threshold) + YAML parse.
            if (f.endsWith(".customize.yaml")) {
              const yamlPath = join(rootDir, ".hatch3r", dir, f);
              try {
                const raw = await readFile(yamlPath, "utf-8");
                if (Buffer.byteLength(raw, "utf-8") > 10_240) {
                  warn(`.hatch3r/${dir}/${f} exceeds 10KB and will be skipped during adapter generation. Trim or split the override.`);
                } else {
                  try {
                    parseYaml(raw);
                  } catch (parseErr) {
                    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
                    warn(`Invalid YAML in .hatch3r/${dir}/${f} — ${msg}. Run \`npx hatch3r validate\` for the full error context.`);
                  }
                }
              } catch (readErr) {
                const message = readErr instanceof Error ? readErr.message : String(readErr);
                verbose(`sync: .customize.yaml read failed for ${yamlPath} — ${message}`);
              }
            }
          }
        } catch (err) {
          // .hatch3r/{dir} does not exist — no customizations to check.
          // Surface under --verbose to expose unexpected probe failures.
          const message = err instanceof Error ? err.message : String(err);
          verbose(`sync: orphan-customize scan readdir(.hatch3r/${dir}) skipped — ${message}`);
        }
      }
    }

    // Wave 7: the canonical orphan-file scan walked `.agents/<canonical>/`
    // for files violating the hatch3r-inventory naming convention. Since
    // Wave 3+4 there is no user-side canonical tree — canonical content
    // lives exclusively under the bundled package — so the scan has no
    // remaining surface to inspect. Helpers (`scanOrphanFiles`,
    // `formatOrphanScanDiagnostic`) are kept for the bundled-content
    // validate gate (`npx hatch3r validate`) only.
    void scanOrphanFiles;
    void formatOrphanScanDiagnostic;
  }

  console.log();

  const icons: Record<string, string> = {
    created: chalk.green("+"),
    // F10.4-1: split the prior `updated` icon into `merged` (managed-block
    // merge — user content preserved) and `regenerated` (full-file
    // overwrite) so the customization-preservation messaging in the
    // summary is unambiguous. `updated` itself remains in the map as a
    // fallback for any call-path that has not yet adopted the
    // `renderAction()` heuristic at the call-site (none in this file
    // after F10.4-1; reserved for forward-compatibility).
    updated: chalk.yellow("~"),
    merged: chalk.cyan("*"),
    regenerated: chalk.yellow("~"),
    // G5: "unchanged" is a no-op action returned by safeWriteFile when the
    // computed bytes match the file on disk. We render it the same as
    // "skipped" (dim "=") so the human summary remains readable while still
    // signalling that nothing changed.
    unchanged: chalk.dim("="),
    skipped: chalk.dim("="),
    "dry-run": chalk.cyan("?"),
  };

  // Phase output schema: compact the per-file results so a sync over a very
  // large adapter set still produces a readable summary. compactPhaseOutput
  // is a no-op below the threshold and head/tail-slices large arrays above
  // it, keeping the human summary bounded.
  const compactedResults = compactPhaseOutput(results);
  const summaryLines = compactedResults.map((r) => {
    if (typeof r === "string") {
      return chalk.dim(r);
    }
    const icon = icons[r.action] ?? chalk.dim(" ");
    return `${icon} ${r.path} ${chalk.dim(`(${r.action})`)}`;
  });

  // D10-M11 (Cycle 10): prepend a one-line action-tally so the user reads
  // "X created, Y merged (preserved your edits), Z regenerated (full
  // overwrite)" before scanning the per-file list. The prior summary only
  // showed per-file actions, so a fresh user could not tell at a glance
  // whether their customizations were preserved or wiped.
  const actionCounts: Record<string, number> = {};
  for (const r of results) {
    if (typeof r !== "string") {
      actionCounts[r.action] = (actionCounts[r.action] ?? 0) + 1;
    }
  }
  const tallyParts: string[] = [];
  if (actionCounts.created) tallyParts.push(chalk.green(`${actionCounts.created} created`));
  if (actionCounts.merged) tallyParts.push(chalk.cyan(`${actionCounts.merged} merged (your edits preserved)`));
  if (actionCounts.regenerated) tallyParts.push(chalk.yellow(`${actionCounts.regenerated} regenerated (full overwrite)`));
  if (actionCounts.updated) tallyParts.push(chalk.yellow(`${actionCounts.updated} updated`));
  if (actionCounts.unchanged) tallyParts.push(chalk.dim(`${actionCounts.unchanged} unchanged`));
  if (actionCounts.skipped) tallyParts.push(chalk.dim(`${actionCounts.skipped} skipped`));
  if (actionCounts["dry-run"]) tallyParts.push(chalk.cyan(`${actionCounts["dry-run"]} dry-run`));
  if (tallyParts.length > 0) {
    summaryLines.unshift(tallyParts.join(chalk.dim(" · ")));
    summaryLines.splice(1, 0, "");
  }

  // F8.3.4: the prior post-loop `isPipelineTimedOut`/`terminatePipeline`
  // advisory check lived here. It was advisory-only (it ran after disk writes
  // completed, so a true hang in the adapter phase never reached it). It is
  // replaced by the `runWithPipelineDeadman` wrapper around the adapter phase
  // above, which aborts in-flight on a wall-clock breach.

  // --diff: show file change summary. D12-SA12.2-05: under `--diff --verbose`,
  // also render the managed-block content delta for MODIFIED files from the
  // already-captured before/after content, so an operator previewing a
  // (destructive) managed-block overwrite — notably `sync --dry-run --diff
  // --verbose`, the one case git diff cannot serve because nothing is on disk
  // yet — sees WHAT changes, not only WHICH files. Bounded to the managed block
  // and capped per file to keep the preview short.
  if (opts.diff && diffBefore.size > 0) {
    const diffLines: string[] = [];
    let anyModified = false;
    for (const [filePath] of diffBefore) {
      const before = diffBefore.get(filePath) ?? null;
      const after = diffAfter.get(filePath) ?? null;
      if (before === null && after !== null) {
        diffLines.push(`${chalk.green("+ added")}    ${filePath}`);
      } else if (before !== null && after !== null && before !== after) {
        diffLines.push(`${chalk.yellow("~ modified")} ${filePath}`);
        anyModified = true;
        if (opts.verbose) {
          diffLines.push(...renderManagedBlockDelta(before, after, filePath));
        }
      } else if (before !== null && after !== null && before === after) {
        diffLines.push(`${chalk.dim("= unchanged")} ${filePath}`);
      }
    }
    if (!opts.verbose && anyModified) {
      diffLines.push(
        chalk.dim("Re-run with --verbose to see the managed-block content delta for modified files."),
      );
    }
    if (diffLines.length > 0) {
      printBox("Diff summary", diffLines, "info");
      console.log();
    }
  }

  const boxTitle = opts.dryRun
    ? "Sync dry run complete"
    : adapterFailures.length > 0 ? "Sync complete (with warnings)" : "Sync complete";

  // Decision 27 (Bucket 2.2): when a snapshot was captured, surface the
  // session id so the operator knows the rollback target without scanning
  // `hatch3r rollback list`.
  if (syncSessionId) {
    summaryLines.push("");
    summaryLines.push(`${chalk.dim("Snapshot:")} ${syncSessionId} ${chalk.dim(`(revert: hatch3r rollback --session=${syncSessionId})`)}`);
  }

  // SA12.1-F-D12-M2 (D12, P1): in JSON mode, emit a structured summary in
  // place of the decorated box. The schema lets CI consumers branch on
  // `status` (passed | failed | dry-run), `adapterFailures` (per-tool
  // outcome), and `results` (per-file action). One-shot, single document.
  // W5-bigfour (P1): box-vs-JSON emission flows through the standardized
  // finishCommand chokepoint. Payload field names are unchanged; the envelope
  // adds the standard `command` identity field. The interleaved post-box
  // chrome below (partial-failure box, customization confirmation, next-steps
  // ladder, timing) stays on ui.ts primitives because finishCommand's single
  // box + next-steps shape cannot express chrome BETWEEN the box and the
  // next-steps without reordering the byte-identical human output.
  finishCommand(format, {
    command: "sync",
    title: boxTitle,
    lines: summaryLines,
    style: opts.dryRun ? "info" : adapterFailures.length > 0 ? "info" : "success",
    json: {
      status: opts.dryRun
        ? ("dry-run" as const)
        : adapterFailures.length > 0
          ? ("failed" as const)
          : ("passed" as const),
      dryRun: !!opts.dryRun,
      adapterFailures: adapterFailures.map((f) => ({ tool: f.tool, error: f.error })),
      successfulAdapters: m.tools.filter((t) => !adapterFailures.some((f) => f.tool === t)),
      // Use the raw per-file `results` array (not the compacted human view)
      // so CI consumers see every emission and can branch on per-file action
      // ("created" / "merged" / "regenerated" / "skipped" / "dry-run").
      results,
      partialFailureLines,
      snapshotSessionId: syncSessionId ?? null,
    },
  });
  if (!jsonMode) {
    // SA12.1-F-D12-M6 (D12, P1): partial-failure callout — emit AFTER the
    // main summary box as a dedicated boxed block so the half-state warning
    // is visually distinct and impossible to miss (the prior inline `warn()`
    // lines got buried mid-scroll among per-file warnings).
    if (partialFailureLines.length > 0) {
      printBox("Partial sync — adapter failures", partialFailureLines, "warning");
    }

    // SA12.1-F-D12-M10 (D12, P1): customizations applied during sync used to
    // produce no positive confirmation line — the sync just emitted the file
    // list and customization-applied state stayed silent. Emit a one-line
    // post-summary confirmation listing the artifacts whose `.customize.{yaml,md}`
    // overrides were honored on this run, plus the skipped/failed counts so
    // the operator can see "yes, my overrides were applied". Skipped when no
    // customization files exist so the chrome stays compact for fresh installs.
    try {
      // D10-29: pass the manifest selection so an override on a deselected
      // artifact is reported `inert` (no adapter emitted it on this run) rather
      // than counted as applied.
      const customizationSummary = await buildCustomizationSummary(
        rootDir,
        selectionSetFromManifest(m.content),
      );
      if (customizationSummary.entries.length > 0) {
        const c = customizationSummary.counts;
        const activeIds = customizationSummary.entries
          .filter((e) => e.outcome === "active")
          .map((e) => `${e.type}/${e.id}`);
        if (c.active > 0) {
          const head = activeIds.slice(0, 4).join(", ");
          const tail = activeIds.length > 4 ? ` … (+${activeIds.length - 4} more)` : "";
          info(
            `Customizations applied: ${chalk.bold(String(c.active))} active (${head}${tail})` +
              (c.skipped > 0 ? `, ${c.skipped} skipped` : "") +
              (c.failed > 0 ? `, ${chalk.red(String(c.failed))} failed` : "") +
              (c.inert > 0 ? `, ${chalk.yellow(String(c.inert))} inert` : ""),
          );
        } else if (c.skipped > 0 || c.failed > 0 || c.inert > 0) {
          info(
            `Customizations: 0 active` +
              (c.skipped > 0 ? `, ${c.skipped} skipped` : "") +
              (c.failed > 0 ? `, ${chalk.red(String(c.failed))} failed` : "") +
              (c.inert > 0 ? `, ${chalk.yellow(String(c.inert))} inert` : "") +
              ` (run \`hatch3r explain --customizations\` for detail).`,
          );
        }
      }
    } catch (err) {
      verbose(`sync: customization confirmation skipped — ${err instanceof Error ? err.message : String(err)}`);
    }

    // D10-SA10.2-F5 + F6 (Cycle 10 Wave 4, D10, P1/P4): on a clean sync, emit
    // a next-steps ladder (closing the dead-code gap on `printNextSteps`,
    // which init's inline ladder never routed through) and an elapsed-time
    // read-out. Suppressed on dry-run and partial failure so the post-summary
    // chrome only fires when there is a confirmed success to act on. Both
    // helpers are no-ops under quiet/json mode.
    if (!opts.dryRun && adapterFailures.length === 0) {
      printNextSteps([
        "Run `hatch3r status` to verify your generated files are in sync.",
        "Run `hatch3r validate` to check canonical content + customizations.",
      ]);
      printTimingSummary(syncStartMs);
    }
  }

  // D1-SA1.3-12: Dry-run returns here without throwing on partial adapter
  // failure. The workspace cascade below carries write-free dry-run support
  // (`syncWorkspaceRepos` short-circuits at `options.dryRun` before any write),
  // but this root-repo preview does not drive the sub-repo previews from a
  // `--dry-run` root run. Rather than silently ignore a requested `--repos`
  // (or on-sync) propagation under `--dry-run` (Silent Failure Contract,
  // CONSTITUTION §2 P5), surface the un-previewed cascade explicitly.
  if (opts.dryRun) {
    const dryRunWsManifest = await readWorkspaceManifest(rootDir);
    if (dryRunWsManifest) {
      const cascadeWouldRun =
        opts.repos !== undefined || dryRunWsManifest.syncStrategy === "on-sync";
      const cascadeRepoCount = dryRunWsManifest.repos.filter((r) => r.sync).length;
      if (cascadeWouldRun && cascadeRepoCount > 0) {
        warn(
          `--dry-run: workspace propagation to ${cascadeRepoCount} repo(s) not previewed. ` +
            `Re-run without --dry-run to propagate, or preview the root-repo output above.`,
        );
      }
    }
    return;
  }

  // #253 (D8-8.20): Exit non-zero on partial adapter failure
  // so CI pipelines can detect incomplete syncs.
  if (adapterFailures.length > 0) {
    // C8-D8-M1 (D8): attach aggregated recovery guidance to the terminal
    // HatchError so CI operators reading the error (without the preceding
    // logs) still receive an actionable retry hint.
    const allTransient = classifiedFailures.length > 0 && classifiedFailures.every((c) => c.failType === "transient");
    const aggregateGuidance = allTransient
      ? "Failures appear transient. Retry `hatch3r sync` after transient conditions clear."
      : "At least one failure is substantive. See the per-adapter messages above for remediation.";

    // SA12.1-F-D12-M12 (D12, P1): structured replay guidance integration.
    // `createReplayGuidance` / `formatReplayGuidance` shipped in observability.ts
    // but no CLI catch-block ever called them; the failure surface stayed
    // ad-hoc. Build a guidance block here so operators (and CI logs) see the
    // structured reproduction steps, then fold the formatted output through
    // the same `warn()` channel that backs the partial-failure callout.
    try {
      const { createReplayGuidance, formatReplayGuidance } = await import("../../pipeline/observability.js");
      const guidance = createReplayGuidance(
        getRunId(),
        "adapter",
        `Sync completed with ${adapterFailures.length} adapter failure(s): ${adapterFailures.map((f) => f.tool).join(", ")}`,
        {
          relevantFiles: adapterFailures.map((f) => f.tool),
          environmentSnapshot: {
            HATCH3R_VERSION,
            NODE_VERSION: process.version,
          },
        },
      );
      const formatted = formatReplayGuidance(guidance);
      if (!jsonMode) {
        console.error();
        for (const line of formatted.split("\n")) console.error(`  ${line}`);
        console.error();
      }
    } catch (err) {
      verbose(`sync: replay guidance emission skipped — ${err instanceof Error ? err.message : String(err)}`);
    }

    throw new HatchError(
      `Sync completed with ${adapterFailures.length} adapter failure(s). ${aggregateGuidance}`,
      2,
      "ADAPTER_ERROR",
      aggregateGuidance,
    );
  }

  // ── Workspace sync cascade ────────────────────────────────────
  const wsManifest = await readWorkspaceManifest(rootDir);
  if (!wsManifest) return;

  const syncReposRequested = opts.repos !== undefined;
  const syncOnSync = wsManifest.syncStrategy === "on-sync";
  const syncableCount = wsManifest.repos.filter((r) => r.sync).length;

  if (!syncReposRequested && !syncOnSync) {
    if (syncableCount > 0) {
      info(`Workspace: ${syncableCount} repo(s) available for sync. Run ${chalk.bold("hatch3r sync --repos")} to propagate.`);
    }
    return;
  }

  // Determine which repos to sync
  const repoPaths = Array.isArray(opts.repos) ? opts.repos : undefined;

  console.log();
  const wsSpinner = createSpinner(
    `Syncing workspace to ${repoPaths ? repoPaths.length : syncableCount} repo(s)...`,
  );
  wsSpinner.start();

  // D14-SA14.2-F4: coerce the `--concurrency <n>` string to a positive
  // integer. Non-numeric or non-positive input is ignored so syncWorkspaceRepos
  // falls back to defaultSyncConcurrency() (min(cpus, 8)).
  const parsedConcurrency =
    opts.concurrency !== undefined ? Number.parseInt(opts.concurrency, 10) : NaN;
  const concurrencyOverride =
    Number.isInteger(parsedConcurrency) && parsedConcurrency > 0
      ? parsedConcurrency
      : undefined;

  const wsResult = await syncWorkspaceRepos(rootDir, {
    repos: repoPaths,
    // D1-SA1.3-12: forward-compatible plumbing. A `--dry-run` root run returns
    // earlier (with the un-previewed-cascade advisory) and never reaches here,
    // so `opts.dryRun` is falsy at this call today; the pass-through is retained
    // so wiring a root-driven sub-repo dry-run preview later needs no change.
    dryRun: opts.dryRun,
    force: opts.force,
    concurrency: concurrencyOverride,
    onWarn: (msg) => warn(msg),
  });

  const succeeded = wsResult.repos.filter((r) => r.action === "synced").length;
  const failed = wsResult.repos.filter((r) => r.action === "error").length;

  if (failed > 0) {
    wsSpinner.warn(`Workspace sync: ${succeeded} synced, ${failed} failed`);
    for (const r of wsResult.repos.filter((r) => r.action === "error")) {
      logError(`  ${r.path}: ${r.error}`);
    }
  } else {
    wsSpinner.succeed(`Workspace sync: ${succeeded} repo(s) synced`);
  }
}
