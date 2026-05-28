import { appendFile, readFile, stat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
// SA12.4-F1 / F2.7-F5 (D12/D2): the provenance writer records an emit-time
// content hash per output so `hatch3r status` can later attribute drift
// direction (user edit vs outdated canonical). `hashEmittedContent` is the
// single normalization both the writer (here) and the reader (status.ts)
// share, so the hash computed at emit time matches the hash status.ts derives
// from the on-disk managed block.
import { hashEmittedContent } from "./status.js";
import { readManifest, writeManifest, addManagedFile } from "../../manifest/hatchJson.js";
import { getAdapter, getUnsupportedFeatureWarnings } from "../../adapters/index.js";
import { checkContextBudget, formatBudgetWarning } from "../../adapters/contextBudget.js";
import { safeWriteFile } from "../../merge/safeWrite.js";
import { withSnapshot } from "../../pipeline/snapshot.js";
import { sweepOrphansForAdapter, formatOrphanCleanupDiagnostic, type OrphanCleanupEntry } from "../../merge/orphanCleanup.js";
import { generateWorktreeInclude, extractManagedContent } from "../../worktree/index.js";
import { HATCH3R_DIR, HatchError, WORKTREE_INCLUDE_FILE, type AdapterOutput, type GenerationMode } from "../../types.js";
import { migrateAgentsToHatch3r } from "../../migration/agentsToHatch3r.js";
import { ensureEnvMcp, ensureGitignoreEntry, getSourceEnvMcpCommand } from "../../env/mcpEnv.js";
import { readWorkspaceManifest } from "../../workspace/manifest.js";
import { detectWorkspaceContext } from "../../workspace/detect.js";
import { syncWorkspaceRepos } from "../../workspace/sync.js";
import { resolveBundledContentRoot } from "../../content/contentRoot.js";
import { pruneArchives } from "../../archive/index.js";
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
  type CheckpointMeta,
} from "../../pipeline/checkpoint.js";
import { compactPhaseOutput } from "../../pipeline/phaseOutputSchema.js";
import { retryWithBackoff } from "../../pipeline/retryWithBackoff.js";
import { discoverUserContent, validateContentBody } from "../../content/userContent.js";
import { scanOrphanFiles, formatOrphanScanDiagnostic } from "../../content/orphanScan.js";
import { validateLearningsDirectory } from "../../content/learningsValidation.js";
import {
  printBanner,
  createSpinner,
  printBox,
  error as logError,
  info,
  step,
  warn,
  setVerbose,
  verbose,
} from "../shared/ui.js";

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
    const commitDate = execFileSync("git", ["log", "-1", "--format=%ct"], { stdio: "pipe" })
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
 * Append a failure entry to the persistent failure log in .agents/.
 * Performs log rotation when the log exceeds 500KB.
 * Silently skips if the write fails (failure logging must not break sync).
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
      // File does not exist yet — that is fine, appendFile will create it.
      // Surface under --verbose so unexpected read failures stay observable.
      const message = err instanceof Error ? err.message : String(err);
      verbose(`sync: appendFailure read-before-rotate skipped — ${message}`);
    }

    await appendFile(logPath, line);
  } catch (err) {
    // Failure logging must not break the sync command. Surface under --verbose
    // so persistent write failures still get attention from operators.
    const message = err instanceof Error ? err.message : String(err);
    verbose(`sync: appendFailure suppressed — ${message}`);
  }
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
  } = {},
): Promise<void> {
  setVerbose(!!opts.verbose);
  printBanner(true);

  const rootDir = process.cwd();

  // F16.1-C1 (Decision 27 / Bucket 2.2): sync writes a checkpoint after each
  // mutation phase under `.sync-workspace/checkpoint.json` so `--resume` can
  // detect a previously-completed run and short-circuit instead of redoing
  // every adapter write. The baseline is the bundled hatch3r version: a
  // checkpoint left by a different hatch3r version is correctly flagged as
  // drift and re-run from scratch. `readCheckpoint` throws on a corrupt file
  // (with a preserved-backup recovery hint), so resume fails loud.
  const syncWorkspace = join(rootDir, ".sync-workspace");
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

  // Wave 6: relocate any pre-1.9 `.agents/` state before reading the manifest
  // so legacy installs sync without manual `init` first.
  await migrateAgentsToHatch3r(rootDir);
  // Wave 7: legacy state lives under `.hatch3r/`; the failure log + orphan
  // sweeper write into that directory.
  const hatch3rDir = join(rootDir, HATCH3R_DIR);
  const manifest = await readManifest(rootDir);

  if (!manifest) {
    logError(`No ${HATCH3R_DIR}/hatch.json found.`);
    console.log(chalk.dim("  Run `npx hatch3r init` to set up your project first.\n"));
    throw new HatchError(
      `No ${HATCH3R_DIR}/hatch.json found.`,
      1,
      "CONFIG_ERROR",
      "Run `npx hatch3r init` to set up your project first.",
    );
  }

  const m = manifest;

  verbose(`Manifest loaded: ${m.tools.length} tool(s), ${Object.keys(m.features).filter(k => m.features[k as keyof typeof m.features]).length} feature(s)`);

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
          1,
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
  // learnings gate. Adapters pour `.hatch3r/learnings/` into the per-tool
  // context file (CLAUDE.md / `.cursor/rules/*` / copilot-instructions). The
  // loader agent's "invoke sanitizeUserContent" prose is unenforceable — the
  // LLM is the very actor being hijacked and has no JS runtime. We run the
  // deterministic `validateLearningsDirectory` pass HERE, in the CLI write
  // path, BEFORE any adapter materializes the context file. `validate.ts`
  // already runs this at `validate` time; this closes the runtime-write gap.
  // Errors (oversized / binary / malformed-name files) refuse the sync unless
  // `--force`; warnings (denied-pattern matches) are surfaced as a quarantine
  // notice and never block (the loader's instruction-hierarchy markers keep
  // them user-tier). Missing `.hatch3r/learnings/` is a valid clean state
  // (the function returns valid+empty on ENOENT).
  try {
    const learnings = await validateLearningsDirectory(join(rootDir, HATCH3R_DIR, "learnings"));
    if (learnings.warnings.length > 0) {
      warn(`Learnings content scan: ${learnings.warnings.length} suspicious pattern(s) quarantined (loaded with user-tier markers, not as instructions):`);
      for (const w of learnings.warnings) warn(`  ${w}`);
    }
    if (!learnings.valid) {
      warn(`Learnings validation: ${learnings.errors.length} error(s) detected`);
      for (const e of learnings.errors) warn(`  ${e}`);
      if (!opts.force) {
        logError(
          "Refusing to materialize tool context files with invalid learnings. " +
          "Fix the offending file(s) under .hatch3r/learnings/, or re-run with --force.",
        );
        throw new HatchError(
          "Learnings pre-flight scan failed (use --force to override)",
          1,
          "VALIDATION_ERROR",
          "Fix the offending learning file(s) listed above (oversized, binary, or invalid name), or re-run with `--force` to materialize them as-is.",
        );
      }
      warn("Continuing with --force: invalid learnings will be materialized into tool context.");
      console.log();
    }
  } catch (err) {
    if (err instanceof HatchError) throw err;
    verbose(`Learnings pre-flight scan skipped: ${err instanceof Error ? err.message : String(err)}`);
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

  const adapterFailures: { tool: string; error: string }[] = [];
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
  const breakers = new Map<string, CircuitBreakerState>();

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
        async () => {
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
          1,
          "ADAPTER_ERROR",
          `Re-run with --verbose for ${tool} detail, or run \`npx hatch3r validate\` to check canonical content.`,
        );
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
        for (const out of outputs) {
          results.push({ path: out.path, action: "dry-run" });
          if (opts.diff) {
            diffBefore.set(out.path, await readFileOrNull(join(rootDir, out.path)));
            diffAfter.set(out.path, out.content);
          }
        }
      } else {
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
          if (opts.diff) {
            diffAfter.set(out.path, await readFileOrNull(join(rootDir, out.path)));
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
      // Task #11 orphan-cleanup: record the paths this adapter emitted in
      // the in-memory manifest snapshot, then sweep paths the prior run
      // wrote but this run did not re-emit. Skipped entirely on dry-run
      // and when no prior history exists for the adapter (first-run).
      const currentPaths = outputs.map((o) => o.path);
      newManagedByAdapter[tool] = currentPaths;
      if (!opts.dryRun) {
        const priorPaths = previousManagedByAdapter[tool];
        if (priorPaths && priorPaths.length > 0) {
          const entries = await sweepOrphansForAdapter(tool, rootDir, priorPaths, currentPaths);
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
  ).catch((err: unknown) => {
    // F8.3.4: a wall-clock breach rejects the deadman with PipelineTimeoutError.
    // Unlike the old advisory check, the in-flight adapter phase has already
    // been signalled to abort. Surface it as a usage-actionable timeout (exit
    // 2 — the run did not complete within budget) rather than a silent partial.
    if (err instanceof PipelineTimeoutError) {
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
  // C8-D8-M1 (D8): classify each adapter failure and aggregate transience
  // across tools so the thrown HatchError carries actionable guidance in
  // addition to the per-tool log lines. classifiedFailures persists past
  // this block so the partial-failure terminal throw can reuse it.
  const classifiedFailures: { tool: string; depClass: ReturnType<typeof classifyDependency>; failType: ReturnType<typeof classifyFailure> }[] = [];
  if (adapterFailures.length > 0) {
    for (const f of adapterFailures) {
      const reconstructed = new Error(f.error);
      const depClass = classifyDependency(reconstructed);
      const failType = classifyFailure(reconstructed);
      classifiedFailures.push({ tool: f.tool, depClass, failType });
      const guidance = getRecoveryGuidance(depClass, failType);
      logError(`Failed to generate ${f.tool}: ${f.error}`);
      info(`  ${guidance}`);
    }
    if (adapterFailures.length === m.tools.length) {
      // C7.5-W2B2-H22: when --strict-budget tripped the only adapter(s) in
      // this run, surface a usage-error exit code (2) instead of the generic
      // runtime-error exit code (1). This matches the finding's contract:
      // --strict-budget is a caller-driven gate, not an internal fault.
      const exitCode = budgetGateFailed ? 2 : 1;
      const allTransient = classifiedFailures.every((c) => c.failType === "transient");
      const aggregateGuidance = budgetGateFailed
        ? "Re-run without --strict-budget, or reduce output size with `hatch3r sync --minimal` / `hatch3r config`."
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
    if (adapterFailures.length > 0) {
      // D11-H-4: the adapter loop is non-transactional — successful adapters
      // already wrote new bytes to disk while failed adapters left their
      // prior outputs in place. Emit a per-adapter disposition so the
      // operator has the actionable half-state list (which files are new
      // vs stale), then point at the pre-sync snapshot (captured by
      // withSnapshot above, D11-C-3) as the all-or-nothing recovery. The
      // generic "N successful" line alone hid which on-disk files changed.
      const failedTools = adapterFailures.map((f) => f.tool);
      warn(
        `Adapter outputs: ${successfulAdapters.length}/${m.tools.length} adapters successful — repo is in a partial state.`,
      );
      if (successfulAdapters.length > 0) {
        warn(`  Updated on disk (new output): ${successfulAdapters.join(", ")}`);
      }
      warn(`  Unchanged (prior output retained): ${failedTools.join(", ")}`);
      if (syncSessionId) {
        warn(
          `  To revert the whole repo to its pre-sync state, run ` +
          `\`hatch3r rollback --session=${syncSessionId}\`. ` +
          `Otherwise re-run \`hatch3r sync\` after resolving the failed adapter(s).`,
        );
      } else {
        warn(`  Re-run \`hatch3r sync\` after resolving the failed adapter(s).`);
      }
    }

    // SA12.4-F1 (D12): Restore a minimal on-disk provenance manifest at
    // `.hatch3r/provenance.json`. Wave 7 (1.9.0) removed the old
    // `.agents/.provenance.json` writer alongside the integrity
    // subsystem, leaving operators unable to trace a generated adapter
    // file back to the canonical content that shaped it. We persist a
    // ≤200-bytes-per-entry record built from the per-adapter outputs
    // collected during the loop above; each entry pairs the output
    // path with the adapter that produced it and the sorted
    // `sourceFiles[]` set populated by `BaseAdapter.generate()`.
    //
    // Out of lock scope for this work unit (`src/cli/commands/sync.ts`):
    // mirroring the writer into init.ts/update.ts and adding the
    // `hatch3r explain --source` reader flag. Those landings belong to
    // their respective work units; the writer here makes the file
    // available for any consumer to read once those land.
    try {
      const provenancePath = join(rootDir, HATCH3R_DIR, "provenance.json");
      const outputs = perAdapterOutputs
        .flatMap((entry) =>
          entry.outputs.map((out) => ({
            path: out.path,
            adapter: entry.adapter,
            sourceFiles: [...(out.sourceFiles ?? [])].sort(),
            // F2.7-F5 (D2): emit-time hash of the normalized managed block (or
            // full content when the output has no block). `status` re-derives
            // this from the on-disk file to tell a user edit (on-disk differs
            // from this baseline) from an outdated canonical block (a fresh
            // regeneration differs from this baseline).
            contentHash: hashEmittedContent(out.content, out.managedContent),
          })),
        )
        .sort((a, b) => {
          const byAdapter = a.adapter.localeCompare(b.adapter);
          if (byAdapter !== 0) return byAdapter;
          return a.path.localeCompare(b.path);
        });
      // Read previous manifest for idempotency comparison. Failure to
      // read (missing or malformed) is treated as "no previous" so the
      // new manifest writes with a fresh timestamp.
      let previousGeneratedAt: string | null = null;
      try {
        const prevRaw = await readFile(provenancePath, "utf-8");
        const prev = JSON.parse(prevRaw) as {
          schemaVersion?: number;
          hatch3rVersion?: string;
          generatedAt?: string;
          outputs?: Array<{ path: string; adapter: string; sourceFiles: string[]; contentHash?: string }>;
        };
        if (
          prev.schemaVersion === 1 &&
          prev.hatch3rVersion === HATCH3R_VERSION &&
          Array.isArray(prev.outputs) &&
          prev.outputs.length === outputs.length &&
          prev.outputs.every((p, i) => {
            const c = outputs[i];
            return (
              p.adapter === c.adapter &&
              p.path === c.path &&
              // F2.7-F5: the emit-time hash participates in the idempotency
              // check so a content change refreshes both the baseline hash and
              // the timestamp; identical re-syncs stay byte-identical.
              p.contentHash === c.contentHash &&
              p.sourceFiles.length === c.sourceFiles.length &&
              p.sourceFiles.every((s, j) => s === c.sourceFiles[j])
            );
          })
        ) {
          previousGeneratedAt = typeof prev.generatedAt === "string" ? prev.generatedAt : null;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        verbose(`sync: provenance idempotency read skipped — ${message}`);
      }
      const provenance = {
        schemaVersion: 1 as const,
        hatch3rVersion: HATCH3R_VERSION,
        generatedAt: previousGeneratedAt ?? new Date().toISOString(),
        outputs,
      };
      await safeWriteFile(
        provenancePath,
        JSON.stringify(provenance, null, 2) + "\n",
        { force: true },
      );
    } catch (err) {
      // Silent Failure Contract (P5): a provenance write failure must
      // not break sync. Surface via warn() so operators see the gap;
      // the per-output `sourceFiles` field remains available in-memory
      // to any caller that re-runs sync.
      warn(
        `Failed to write .hatch3r/provenance.json: ` +
        `${err instanceof Error ? err.message : String(err)}. ` +
        `Source-file attribution will not be available for this run.`,
      );
    }

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

  // F8.3.4: the prior post-loop `isPipelineTimedOut`/`terminatePipeline`
  // advisory check lived here. It was advisory-only (it ran after disk writes
  // completed, so a true hang in the adapter phase never reached it). It is
  // replaced by the `runWithPipelineDeadman` wrapper around the adapter phase
  // above, which aborts in-flight on a wall-clock breach.

  // --diff: show file change summary
  if (opts.diff && diffBefore.size > 0) {
    const diffLines: string[] = [];
    for (const [filePath] of diffBefore) {
      const before = diffBefore.get(filePath) ?? null;
      const after = diffAfter.get(filePath) ?? null;
      if (before === null && after !== null) {
        diffLines.push(`${chalk.green("+ added")}    ${filePath}`);
      } else if (before !== null && after !== null && before !== after) {
        diffLines.push(`${chalk.yellow("~ modified")} ${filePath}`);
      } else if (before !== null && after !== null && before === after) {
        diffLines.push(`${chalk.dim("= unchanged")} ${filePath}`);
      }
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

  printBox(
    boxTitle,
    summaryLines,
    opts.dryRun ? "info" : adapterFailures.length > 0 ? "info" : "success",
  );

  // Dry-run: skip error throwing and return before workspace cascade
  // (workspace sync has its own dry-run handling below)
  if (opts.dryRun) return;

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

  const wsResult = await syncWorkspaceRepos(rootDir, {
    repos: repoPaths,
    dryRun: opts.dryRun,
    force: opts.force,
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
