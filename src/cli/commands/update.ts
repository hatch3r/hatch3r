import { appendFile, readFile, readdir, stat, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import { readManifest, writeManifest, addManagedFile } from "../../manifest/hatchJson.js";
import { getApplicableCheckpoints } from "../../version/checkpoints.js";
import { getAdapter, getUnsupportedFeatureWarnings } from "../../adapters/index.js";
import { safeWriteFile } from "../../merge/safeWrite.js";
import { withSnapshot } from "../../pipeline/snapshot.js";
import { sweepOrphansForAdapter, formatOrphanCleanupDiagnostic, type OrphanCleanupEntry } from "../../merge/orphanCleanup.js";
import { HATCH3R_DIR, HatchError, WORKTREE_CAPABLE_TOOLS, WORKTREE_INCLUDE_FILE, type HatchManifest, type Platform } from "../../types.js";
import { resolveBundledContentRoot } from "../../content/contentRoot.js";
import { migrateAgentsToHatch3r } from "../../migration/agentsToHatch3r.js";
import { generateWorktreeInclude, extractManagedContent } from "../../worktree/index.js";
import { ensureEnvMcp, ensureGitignoreEntry, getSourceEnvMcpCommand } from "../../env/mcpEnv.js";
import { HATCH3R_VERSION } from "../../version.js";
import {
  createFailureLogEntry,
  formatLogEntry,
  shouldRotateLog,
  rotateLog,
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
  type CheckpointMeta,
} from "../../pipeline/checkpoint.js";
import { compactPhaseOutput } from "../../pipeline/phaseOutputSchema.js";
import { retryWithBackoff } from "../../pipeline/retryWithBackoff.js";
import {
  printBanner,
  createSpinner,
  printBox,
  error as logError,
  info,
  warn,
  step,
  label,
  verbose,
} from "../shared/ui.js";
import { emitJson, parseFormatOption, type CliOutputFormat } from "../shared/output.js";
import { runSelfUpdate, pickReExecBin } from "../../install/selfUpdate.js";
import { pruneArchives } from "../../archive/index.js";
import { buildSelectionsFromDisk } from "../../content/index.js";
import { scanOrphanFiles, formatOrphanScanDiagnostic } from "../../content/orphanScan.js";
import { validateLearningsDirectory } from "../../content/learningsValidation.js";
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
 * Append a failure entry to the persistent failure log in .agents/.
 * Performs log rotation when the log exceeds 500KB.
 * Silently skips if the write fails (failure logging must not break update).
 */
async function appendFailure(agentsDir: string, phase: string, error: unknown, tool?: string): Promise<void> {
  try {
    const logPath = join(agentsDir, FAILURE_LOG_FILE);
    const entry = createFailureLogEntry(phase, error, {
      tool,
      version: HATCH3R_VERSION,
    });
    const line = formatLogEntry(entry) + "\n";

    // Check if rotation is needed before appending
    try {
      const existing = await readFile(logPath, "utf-8");
      if (shouldRotateLog(existing + line)) {
        const rotated = rotateLog(existing);
        await safeWriteFile(logPath, rotated + line);
        return;
      }
    } catch (err) {
      // File does not exist yet -- appendFile will create it. Read failures
      // other than ENOENT may indicate disk corruption, so surface them.
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        verbose(`update: appendFailure read-before-rotate skipped (file does not exist yet) — ${message}`);
      } else {
        // D1-M7 (Cycle 10 Wave-3 Medium): emit a one-line stderr diagnostic
        // even outside --verbose so persistent read failures are visible.
        console.error(`[hatch3r update] appendFailure read-before-rotate failed — ${message}`);
      }
    }

    await appendFile(logPath, line);
  } catch (err) {
    // Failure logging must not break the update command, but the operator
    // needs to know when the audit trail is failing to persist. Emit a
    // single-line diagnostic to stderr regardless of --verbose so the
    // signal is visible in CI logs. D1-M7 (Cycle 10 Wave-3).
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[hatch3r update] failure-log write suppressed — ${message}`);
  }
}

export interface UpdateResult {
  copiedFiles: number;
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
  options: { stepOffset?: number; totalSteps?: number; diff?: boolean; snapshotCommandName?: string; force?: boolean } = {},
): Promise<UpdateResult> {
  const offset = options.stepOffset ?? 0;
  const total = options.totalSteps ?? 3;
  // Wave 6: idempotent migration shim. `updateCommand` already runs this,
  // but `runRegenerate` is also called directly (e.g. from tests, batch
  // pipelines) so re-run here to keep every entry point covered.
  await migrateAgentsToHatch3r(rootDir);
  // Wave 7: failure log writes target `.hatch3r/.failures.log`.
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
  const regenSnapshot = await withSnapshot(
    snapshotCommandName,
    Array.from(new Set(regenSnapshotPaths)),
    async (_sessionId) => undefined,
    { projectRoot: rootDir, onWarn: warn },
  );
  const snapshotSessionId = regenSnapshot.sessionId;

  // F16.1-C1 (Decision 27 / Bucket 2.2): record a checkpoint after each
  // mutation phase under `.<command>-workspace/checkpoint.json` (namespaced by
  // `snapshotCommandName`, so `update`, `config`, etc. don't collide). This
  // makes the resumability substrate functional even though `update`/`config`
  // run single-pass — the checkpoint records "this phase completed at this
  // hatch3r version" so a future resume read (or an operator inspecting state)
  // sees an authoritative progress marker. Best-effort: a checkpoint-write
  // failure routes through verbose() and never aborts the regenerate.
  const regenWorkspace = join(rootDir, `.${snapshotCommandName}-workspace`);
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

  // F6.4-H1 (D6, OWASP ASI06): materialization-time learnings gate. Like
  // `hatch3r sync`, the regenerate write path pours `.hatch3r/learnings/` into
  // each tool's context file. Run the deterministic `validateLearningsDirectory`
  // pass before any adapter materializes output. Errors refuse the regenerate
  // unless `--force`; denied-pattern matches are surfaced as a quarantine
  // notice (loaded user-tier, not as instructions). ENOENT = clean.
  try {
    const learnings = await validateLearningsDirectory(join(rootDir, HATCH3R_DIR, "learnings"));
    if (learnings.warnings.length > 0) {
      warn(`Learnings content scan: ${learnings.warnings.length} suspicious pattern(s) quarantined (loaded with user-tier markers, not as instructions):`);
      for (const w of learnings.warnings) warn(`  ${w}`);
    }
    if (!learnings.valid) {
      warn(`Learnings validation: ${learnings.errors.length} error(s) detected`);
      for (const e of learnings.errors) warn(`  ${e}`);
      if (!options.force) {
        logError(
          "Refusing to materialize tool context files with invalid learnings. " +
          "Fix the offending file(s) under .hatch3r/learnings/, or re-run with --force.",
        );
        throw new HatchError(
          "Learnings pre-flight scan failed (use --force to override)",
          undefined,
          "VALIDATION_ERROR",
          "Fix the offending learning file(s) listed above (oversized, binary, or invalid name), or re-run with `--force` to materialize them as-is.",
        );
      }
      warn("Continuing with --force: invalid learnings will be materialized into tool context.");
    }
  } catch (err) {
    if (err instanceof HatchError) throw err;
    verbose(`Learnings pre-flight scan skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  const s1 = createSpinner(step(offset + 1, total, "Resolving canonical content..."));
  s1.start();

  // Wave 3: canonical content lives inside the freshly installed hatch3r
  // package. No more `.agents/` materialization; adapters source from
  // resolveBundledContentRoot. No canonical or root AGENTS.md emission
  // (per blueprint v2 decisions #3 and #8).
  const canonicalContentRoot = resolveBundledContentRoot();
  const copied: string[] = [];
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
  const orphanEntries: OrphanCleanupEntry[] = [];
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
    breakers = hydrateBreakersFromLog(breakerLog);
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
        async () => {
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
              undefined,
              rootDir,
            ),
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
          if (out.managedContent) {
            await safeWriteFile(fullPath, out.content, {
              managedContent: out.managedContent,
              force: options.force,
            });
          } else {
            await safeWriteFile(fullPath, out.content, { force: options.force });
          }
          addManagedFile(manifest, out.path);
          toolPaths.push(out.path);
          if (options.diff) {
            diffAfter.set(out.path, await readFileOrNull(join(rootDir, out.path)));
          }
        }
        newManagedByAdapter[tool] = toolPaths;
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
      await safeWriteFile(breakerStatePath, serializeBreakerMap(breakers));
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
        const { getRunId } = await import("../shared/runId.js");
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
    await safeWriteFile(
      join(rootDir, WORKTREE_INCLUDE_FILE),
      wtContent,
      { managedContent: wtManaged, force: options.force },
    );
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

  // F16.1-C1: merge phase (worktree + mcp env + manifest) committed.
  await recordPhase(2, "passed");

  // Wave 3: integrity manifest writes removed; Wave 7 will reintroduce a
  // bundled-content integrity model. Adapter outputs are no longer covered
  // by the legacy `.agents/`-scoped integrity manifest.

  // Prune stale archive entries
  await pruneArchives(rootDir);

  s3.succeed(step(offset + 3, total, "Manifest updated"));

  return {
    copiedFiles: copied.length,
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
 * Canonical content is enumerated via a dry-pass over the same source tree
 * that `runRegenerate` copies from; adapter outputs are produced in-memory
 * via the same `generateWithTimeout` pipeline used by sync/update.
 */
export async function runUpdateDryRun(
  rootDir: string,
  manifest: HatchManifest,
  options: { offline?: boolean } = {},
): Promise<{
  canonicalCandidates: string[];
  adapterChanges: Map<string, { added: string[]; modified: string[]; unchanged: string[]; error?: string }>;
}> {
  // Wave 3: dry-run no longer enumerates `.agents/` canonical copy candidates
  // because the materialization is gone. canonicalCandidates stays empty;
  // TODO Wave 7: re-derive a meaningful "candidates" list from the bundled
  // content root or drop this column entirely.
  const canonicalContentRoot = resolveBundledContentRoot();
  const canonicalCandidates: string[] = [];

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
  summaryLines.push(chalk.dim(`Canonical candidate files: ${canonicalCandidates.length}`));
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
  return { canonicalCandidates, adapterChanges };
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
  options: { stepOffset?: number; totalSteps?: number; diff?: boolean; snapshotCommandName?: string; force?: boolean } = {},
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
  execute: (manifest: HatchManifest, rootDir: string, headless: boolean) => Promise<{ manifest: HatchManifest; notices: string[] }>;
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
    execute: async (manifest, rootDir, _headless) => {
      const enabled = true;
      const updated = { ...manifest, worktree: { enabled } };
      const wtContent = await generateWorktreeInclude(updated, rootDir);
      await safeWriteFile(join(rootDir, WORKTREE_INCLUDE_FILE), wtContent, {
        appendIfNoBlock: true,
      });
      return { manifest: updated, notices: ["Worktree isolation enabled — .worktreeinclude generated"] };
    },
  },
];

async function runMigrationCheckpoints(manifest: HatchManifest, rootDir: string, headless = false): Promise<{ manifest: HatchManifest; allNotices: string[] }> {
  let current = manifest;
  const allNotices: string[] = [];

  for (const checkpoint of MIGRATION_CHECKPOINTS) {
    if (await checkpoint.condition(current, rootDir)) {
      const { manifest: updated, notices } = await checkpoint.execute(current, rootDir, headless);
      current = updated;
      allNotices.push(...notices);
    }
  }

  return { manifest: current, allNotices };
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
     * SA12.1-F-D12-M2 (D12, P1): output format for CI consumers. `"json"`
     * emits a one-shot structured payload in place of the decorated summary
     * box. `"human"` (default) keeps the legacy chrome.
     */
    format?: string;
  },
): Promise<void> {
  // SA12.1-F-D12-M2: branch on `--format json` BEFORE banner so CI consumers
  // see exactly one JSON document on stdout.
  const format: CliOutputFormat = parseFormatOption(_opts?.format);
  const jsonMode = format === "json";
  if (!jsonMode) printBanner(true);

  // F8.3.4 (D8): the pipeline wall-clock deadman now lives inside
  // `runRegenerate` (which wraps the adapter phase in
  // `runWithPipelineDeadman`), so the command-level advisory
  // `isPipelineTimedOut`/`terminatePipeline` state that used to be tracked
  // here — and only checked after all disk writes completed — is removed. A
  // true hang now aborts in-flight rather than being reported after the fact.

  const rootDir = process.cwd();
  // Wave 6: relocate pre-1.9 `.agents/` state before reading the manifest.
  await migrateAgentsToHatch3r(rootDir);
  const manifest = await readManifest(rootDir);

  if (!manifest) {
    if (jsonMode) {
      emitJson({
        status: "failed",
        error: `No ${HATCH3R_DIR}/hatch.json found.`,
        errorCode: "CONFIG_ERROR",
        recoveryHint: "Run `npx hatch3r init` to set up your project first.",
        hatch3rVersion: HATCH3R_VERSION,
        timestamp: new Date().toISOString(),
      });
    } else {
      logError(`No ${HATCH3R_DIR}/hatch.json found.`);
      console.log(chalk.dim("  Run `npx hatch3r init` to set up your project first.\n"));
    }
    throw new HatchError(
      `No ${HATCH3R_DIR}/hatch.json found.`,
      undefined,
      "CONFIG_ERROR",
      "Run `npx hatch3r init` to set up your project first.",
    );
  }

  const headless = !!(_opts?.yes);
  const { manifest: migrated, allNotices } = await runMigrationCheckpoints(manifest, rootDir, headless);
  const m = migrated;

  for (const notice of allNotices) {
    warn(notice);
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
    if (_opts.pinVersion === "latest") {
      versionConstraint = undefined;
      info("Cleared version pin: future `hatch3r update` runs will install hatch3r@latest.");
    } else {
      info(`Pinning hatch3r to '${_opts.pinVersion}' (persisted to .hatch3r/hatch.json::versionConstraint).`);
    }
    const persisted: HatchManifest = { ...m, versionConstraint };
    await writeManifest(rootDir, persisted);
    m.versionConstraint = versionConstraint;
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
  void _opts?.cleanOrphans;
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
    label("Files", `${compactedResult.copiedFiles} canonical files updated`),
    label("Tools", `${compactedResult.syncedTools} tool(s) re-synced`),
    label("Version", `v${compactedResult.version}`),
  ];
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
  if (jsonMode) {
    emitJson({
      status: result.failedTools > 0 ? "partial" : "passed",
      copiedFiles: result.copiedFiles,
      syncedTools: result.syncedTools,
      failedTools: result.failedTools,
      version: result.version,
      snapshotSessionId: result.snapshotSessionId ?? null,
      hatch3rVersion: HATCH3R_VERSION,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  printBox("Update complete", updateSummaryLines, "success");

  // CLI-tooling pivot (plan §4.7 update touchpoint): nudge users who
  // upgraded without ever opting in to the CLI tooling surface. Repeats
  // across runs intentionally — there is no manifest flag to dampen it,
  // and the info() output is one line.
  if (!m.cliTools || m.cliTools.selected.length === 0) {
    info("CLI tooling available as a token-efficient alternative to MCP — run `npx hatch3r cli-tools` to opt in.");
  }

  // F8.3.4: the pipeline-timeout advisory previously emitted here is now
  // enforced (not just reported) by the `runWithPipelineDeadman` wrapper
  // inside `runRegenerate`.
}
