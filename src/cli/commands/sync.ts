import { appendFile, readFile, stat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import { readManifest } from "../../manifest/hatchJson.js";
import { getAdapter, getUnsupportedFeatureWarnings } from "../../adapters/index.js";
import { checkContextBudget, formatBudgetWarning } from "../../adapters/contextBudget.js";
import { safeWriteFile } from "../../merge/safeWrite.js";
import { generateWorktreeInclude, extractManagedContent } from "../../worktree/index.js";
import { AGENTS_DIR, HatchError, WORKTREE_INCLUDE_FILE, type GenerationMode } from "../../types.js";
import { ensureEnvMcp, ensureGitignoreEntry, getSourceEnvMcpCommand } from "../../env/mcpEnv.js";
import { readWorkspaceManifest } from "../../workspace/manifest.js";
import { detectWorkspaceContext } from "../../workspace/detect.js";
import { syncWorkspaceRepos } from "../../workspace/sync.js";
import { generateCanonicalAgentsMd, generateRootAgentsMd } from "../shared/agentsContent.js";
import { verifyIntegrity, generateIntegrityManifest, writeIntegrityManifest } from "../../integrity/index.js";
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
  } catch {
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
  } catch {
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
  } catch {
    // git not available or no commits — skip
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
    } catch {
      // File does not exist yet — that is fine, appendFile will create it
    }

    await appendFile(logPath, line);
  } catch {
    // Failure logging must not break the sync command
  }
}

/**
 * Read a file's content, returning null if the file does not exist.
 */
async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
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
  } = {},
): Promise<void> {
  setVerbose(!!opts.verbose);
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

  const agentsDir = join(rootDir, AGENTS_DIR);
  const manifest = await readManifest(rootDir);

  if (!manifest) {
    logError("No .agents/hatch.json found.");
    console.log(chalk.dim("  Run `npx hatch3r init` to set up your project first.\n"));
    throw new HatchError("No .agents/hatch.json found.", 1, "CONFIG_ERROR");
  }

  const m = manifest;

  verbose(`Manifest loaded: ${m.tools.length} tool(s), ${Object.keys(m.features).filter(k => m.features[k as keyof typeof m.features]).length} feature(s)`);

  // C7-H5 (D15, OWASP ASI 2026): Preflight integrity check. If canonical
  // files have drifted (modified, missing, or tampered manifest) we refuse
  // the mutation operation unless the user explicitly opts in with --force.
  // This stops sync from amplifying unauthorized edits to every adapter
  // output silently.
  const integrityResults = await verifyIntegrity(agentsDir);
  const modified = integrityResults.filter((r) => r.status === "modified");
  const missing = integrityResults.filter((r) => r.status === "missing");
  const tampered = integrityResults.filter((r) => r.status === "tampered");
  const driftDetected = modified.length > 0 || missing.length > 0 || tampered.length > 0;
  if (driftDetected) {
    warn("Integrity issues detected in canonical files:");
    for (const r of tampered) {
      warn(`  TAMPERED: ${r.file}`);
    }
    for (const r of modified) {
      warn(`  MODIFIED: ${r.file}`);
    }
    for (const r of missing) {
      warn(`  MISSING:  ${r.file}`);
    }
    if (!opts.force) {
      logError(
        "Refusing to sync with integrity drift. Run `hatch3r verify` to inspect, " +
        "`hatch3r update` to restore canonical content, or re-run with --force to " +
        "proceed and propagate the current on-disk content.",
      );
      throw new HatchError(
        "Integrity drift detected (use --force to override)",
        1,
        "INTEGRITY_ERROR",
      );
    }
    warn("Continuing with --force: drifted files will be propagated as-is.");
    console.log();
  }

  const results: { path: string; action: string }[] = [];
  const totalSteps = m.tools.length + 1;
  let currentStep = 0;

  // --diff: track file snapshots before and after generation
  const diffBefore = new Map<string, string | null>();
  const diffAfter = new Map<string, string | null>();

  if (opts.diff) {
    diffBefore.set("AGENTS.md", await readFileOrNull(join(rootDir, "AGENTS.md")));
    diffBefore.set(`${AGENTS_DIR}/AGENTS.md`, await readFileOrNull(join(agentsDir, "AGENTS.md")));
  }

  const s1 = createSpinner(step(++currentStep, totalSteps, "Syncing AGENTS.md..."));
  s1.start();
  const rootAgentsMd = await generateRootAgentsMd(agentsDir);

  if (opts.dryRun) {
    results.push({ path: "AGENTS.md", action: "dry-run" });
    const canonicalAgentsMd = await generateCanonicalAgentsMd(agentsDir);
    results.push({ path: `${AGENTS_DIR}/AGENTS.md`, action: "dry-run" });
    if (opts.diff) {
      diffAfter.set("AGENTS.md", rootAgentsMd.full);
      diffAfter.set(`${AGENTS_DIR}/AGENTS.md`, canonicalAgentsMd);
    }
  } else {
    const agentsMdResult = await safeWriteFile(join(rootDir, "AGENTS.md"), rootAgentsMd.full, {
      managedContent: rootAgentsMd.inner,
    });
    if (agentsMdResult.warning) warn(agentsMdResult.warning);
    results.push({ path: "AGENTS.md", action: agentsMdResult.action });
    const canonicalAgentsMd = await generateCanonicalAgentsMd(agentsDir);
    const canonicalResult = await safeWriteFile(join(agentsDir, "AGENTS.md"), canonicalAgentsMd);
    if (canonicalResult.warning) warn(canonicalResult.warning);
    results.push({ path: `${AGENTS_DIR}/AGENTS.md`, action: canonicalResult.action });
    if (opts.diff) {
      diffAfter.set("AGENTS.md", await readFileOrNull(join(rootDir, "AGENTS.md")));
      diffAfter.set(`${AGENTS_DIR}/AGENTS.md`, await readFileOrNull(join(agentsDir, "AGENTS.md")));
    }
  }
  s1.succeed(step(currentStep, totalSteps, opts.dryRun ? "AGENTS.md (dry run)" : "AGENTS.md synced"));

  const generationMode: GenerationMode = opts.minimal ? "minimal" : "standard";
  if (opts.minimal) {
    info("Minimal generation mode: output will be stripped-down to reduce token usage.");
  }

  // #260 (D11-11.7): Track output paths across adapters to detect collisions.
  // Multiple adapters writing to the same file (e.g. Amp's AGENTS.md vs the
  // sync bridge's AGENTS.md) can cause silent overwrites.
  const outputPathOwners = new Map<string, string>();
  // Seed with sync bridge outputs
  outputPathOwners.set("AGENTS.md", "sync-bridge");
  outputPathOwners.set(`${AGENTS_DIR}/AGENTS.md`, "sync-bridge");

  const adapterFailures: { tool: string; error: string }[] = [];
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
      const generationResult = await retryWithBackoff(
        () => generateWithTimeout(tool, adapter, agentsDir, m, generationMode),
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
      // Check context budget utilization for this adapter
      const budgetResult = checkContextBudget(tool, outputs);
      const budgetWarning = formatBudgetWarning(budgetResult);
      if (budgetWarning) { warn(budgetWarning); }

      breaker = recordSuccess(breaker);
      breakers.set(tool, breaker);
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
      await appendFailure(agentsDir, "sync:adapter-generate", err, tool);
    }
    }
  });
  if (!phaseResult.completed && phaseResult.error) {
    warn(phaseResult.error);
  }
  if (adapterFailures.length > 0) {
    for (const f of adapterFailures) {
      logError(`Failed to generate ${f.tool}: ${f.error}`);
    }
    if (adapterFailures.length === m.tools.length) {
      throw new HatchError("All adapters failed", 1, "ADAPTER_ERROR");
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

    // #259 (D11-11.6): Only regenerate integrity manifest on full sync success.
    // Writing a manifest after partial adapter failure would certify incomplete
    // output, masking missing files in subsequent integrity checks.
    if (adapterFailures.length === 0) {
      const integrityManifest = await generateIntegrityManifest(agentsDir, HATCH3R_VERSION);
      await writeIntegrityManifest(agentsDir, integrityManifest);
    } else {
      warn("Integrity manifest not updated due to adapter failures. Re-run sync after resolving errors.");
    }

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
        } catch {
          // .hatch3r/{dir} does not exist — no customizations to check
        }
      }
    }
  }

  console.log();

  const icons: Record<string, string> = {
    created: chalk.green("+"),
    updated: chalk.yellow("~"),
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
    throw new HatchError(
      `Sync completed with ${adapterFailures.length} adapter failure(s)`,
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
