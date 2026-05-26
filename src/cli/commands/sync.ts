import { appendFile, readFile, stat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import { readManifest, writeManifest } from "../../manifest/hatchJson.js";
import { getAdapter, getUnsupportedFeatureWarnings } from "../../adapters/index.js";
import { checkContextBudget, formatBudgetWarning } from "../../adapters/contextBudget.js";
import { safeWriteFile } from "../../merge/safeWrite.js";
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
  createPipelineExecution,
  isPipelineTimedOut,
  terminatePipeline,
  DEFAULT_PIPELINE_TIMEOUT_MS,
} from "../../pipeline/pipelineTimeout.js";
import { compactPhaseOutput } from "../../pipeline/phaseOutputSchema.js";
import { retryWithBackoff } from "../../pipeline/retryWithBackoff.js";
import { discoverUserContent, validateContentBody } from "../../content/userContent.js";
import { scanOrphanFiles, formatOrphanScanDiagnostic } from "../../content/orphanScan.js";
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
  void opts.resume;
  printBanner(true);

  // Pipeline-level timeout: track overall command duration and emit a warning
  // if the run exceeds the configured budget. The state is read after the
  // critical work completes so a slow run still surfaces as a notice without
  // aborting in-progress disk writes.
  const pipelineState = createPipelineExecution(
    ["generation", "adapter", "merge", "integrity"],
    DEFAULT_PIPELINE_TIMEOUT_MS,
  );

  const rootDir = process.cwd();

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
    throw new HatchError(`No ${HATCH3R_DIR}/hatch.json found.`, 1, "CONFIG_ERROR");
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

  // Wave 7: the canonical-content integrity preflight is gone — adapters now
  // source content directly from the bundled package (`resolveBundledContentRoot`),
  // which is read-only and verified by npm's tarball signature. Drift is
  // detected per-output by `hatch3r status` / `hatch3r verify`, not per
  // canonical-input by a sha256 manifest. The `--force` flag is preserved
  // for future use (orphan-cleanup overrides etc.).
  void opts.force;

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

  // Wrap the entire per-adapter generation loop in a phase timeout so a
  // hanging adapter cohort surfaces as a phase-level timeout in addition
  // to the per-adapter timeout.
  const phaseResult = await executeWithPhaseTimeout("adapter", async () => {
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
        throw new HatchError(errMessage, 1, "ADAPTER_ERROR");
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
          if (out.managedContent) {
            const result = await safeWriteFile(fullPath, out.content, {
              managedContent: out.managedContent,
            });
            if (result.warning) warn(result.warning);
            verbose(`${out.path}: ${result.action}`);
            results.push({ path: out.path, action: result.action });
          } else {
            const result = await safeWriteFile(fullPath, out.content);
            if (result.warning) warn(result.warning);
            verbose(`${out.path}: ${result.action}`);
            results.push({ path: out.path, action: result.action });
          }
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
  });
  if (!phaseResult.completed && phaseResult.error) {
    warn(phaseResult.error);
  }
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
      throw new HatchError(`All adapters failed. ${aggregateGuidance}`, exitCode, "ADAPTER_ERROR");
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
      const wtResult = await safeWriteFile(
        join(rootDir, WORKTREE_INCLUDE_FILE),
        wtContent,
        { managedContent: wtManaged },
      );
      if (wtResult.warning) warn(wtResult.warning);
      results.push({ path: WORKTREE_INCLUDE_FILE, action: wtResult.action });
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
      warn(
        `Adapter outputs: ${successfulAdapters.length}/${m.tools.length} adapters successful. ` +
        `Re-run sync after resolving errors.`,
      );
    }

    // Wave 7: the `.agents/.provenance.json` writer was removed alongside
    // the integrity subsystem. Per-adapter source-file attribution is now
    // available via the BaseAdapter `sourceFiles` field on AdapterOutput
    // (in-memory only) and via the bundled-content root, which is the
    // single immutable source of truth for canonical inputs.
    void perAdapterOutputs;

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
    updated: chalk.yellow("~"),
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

  // Pipeline timeout advisory: if total wall time exceeded the budget, surface
  // it as a warning. We do not abort an in-flight sync — disk writes are
  // already complete by this point — but the user gets visibility.
  if (isPipelineTimedOut(pipelineState)) {
    const { report } = terminatePipeline(pipelineState);
    warn(report.summary);
  }

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
