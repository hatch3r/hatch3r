import { appendFile, cp, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import { readManifest, writeManifest, addManagedFile } from "../../manifest/hatchJson.js";
import { getApplicableCheckpoints } from "../../version/checkpoints.js";
import { getAdapter, getUnsupportedFeatureWarnings } from "../../adapters/index.js";
import { safeWriteFile } from "../../merge/safeWrite.js";
import { sweepOrphansForAdapter, formatOrphanCleanupDiagnostic, type OrphanCleanupEntry } from "../../merge/orphanCleanup.js";
import { AGENTS_DIR, HATCH3R_PREFIX, HatchError, WORKTREE_CAPABLE_TOOLS, WORKTREE_INCLUDE_FILE, type HatchManifest, type Platform } from "../../types.js";
import { generateCanonicalAgentsMd, generateRootAgentsMd } from "../shared/agentsContent.js";
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
  warn,
  step,
  label,
} from "../shared/ui.js";
import { findPackageRoot } from "../shared/paths.js";
import { detectPackageManager } from "../../detect/packageManager.js";
import { generateIntegrityManifest, writeIntegrityManifest, verifyIntegrity } from "../../integrity/index.js";
import { pruneArchives } from "../../archive/index.js";
import { buildSelectionsFromDisk } from "../../content/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIRS = ["agents", "commands", "rules", "skills", "prompts", "github-agents", "mcp", "hooks"];
const ALWAYS_COPY_FILES = new Set(["mcp.json"]);

/**
 * Package update timeout in milliseconds.
 * Override with HATCH3R_UPDATE_TIMEOUT_MS env var (default: 30000).
 */
const UPDATE_TIMEOUT_MS = (() => {
  const envVal = process.env.HATCH3R_UPDATE_TIMEOUT_MS;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return 30_000;
})();

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
    } catch {
      // File does not exist yet -- appendFile will create it
    }

    await appendFile(logPath, line);
  } catch {
    // Failure logging must not break the update command
  }
}

async function copyHatch3rFiles(
  srcDir: string,
  destDir: string,
  insideHatch3rDir = false,
  selectedIds?: Set<string>,
): Promise<string[]> {
  const copied: string[] = [];
  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = await readdir(srcDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      // If we have selectedIds and this is a skill dir, check if the skill is selected
      if (selectedIds && entry.name.startsWith(HATCH3R_PREFIX)) {
        if (!selectedIds.has(entry.name)) continue;
      }
      await mkdir(destPath, { recursive: true });
      const subCopied = await copyHatch3rFiles(
        srcPath,
        destPath,
        insideHatch3rDir || !entry.name.startsWith(HATCH3R_PREFIX),
        selectedIds,
      );
      copied.push(...subCopied.map((p) => join(entry.name, p)));
    } else if (entry.name.startsWith(HATCH3R_PREFIX) || insideHatch3rDir || ALWAYS_COPY_FILES.has(entry.name)) {
      // If we have selectedIds, check if this file's base ID is selected
      if (selectedIds && entry.name.startsWith(HATCH3R_PREFIX)) {
        const baseId = entry.name.replace(/\.(md|mdc)$/, "");
        if (!selectedIds.has(baseId)) continue;
      }
      await mkdir(dirname(destPath), { recursive: true });
      await cp(srcPath, destPath, { force: true });
      copied.push(entry.name);
    }
  }

  return copied;
}

export interface UpdateResult {
  copiedFiles: number;
  syncedTools: number;
  failedTools: number;
  version: string;
  /** Diff data: before/after snapshots for each generated file (only populated when --diff is used). */
  diffBefore?: Map<string, string | null>;
  diffAfter?: Map<string, string | null>;
}

/**
 * Fetch the latest hatch3r package via the project's package manager.
 *
 * C7-H9 (D1): Extracted from `runUpdate` so callers that only need to
 * regenerate output from already-installed canonical content (config,
 * verify --fix) can skip the 30s network step.
 *
 * Step numbering: occupies `stepOffset + 1` of `totalSteps`. When called
 * standalone with default options the step renders as `[1/1]`.
 */
export async function runPackageUpdate(
  rootDir: string,
  options: { stepOffset?: number; totalSteps?: number } = {},
): Promise<void> {
  const offset = options.stepOffset ?? 0;
  const total = options.totalSteps ?? 1;

  const pm = await detectPackageManager(rootDir);
  const s0 = createSpinner(step(offset + 1, total, "Updating package..."));
  s0.start();
  try {
    const cmd = process.platform === "win32" && pm.name !== "bun"
      ? `${pm.updateCmd}.cmd`
      : pm.updateCmd;
    // Retry the package update on transient network failures (ECONNRESET,
    // 503, EAI_AGAIN, etc.). Substantive failures (auth, missing package)
    // throw on the first attempt without further retries.
    await retryWithBackoff(
      async () => {
        execFileSync(cmd, pm.updateArgs, { stdio: "pipe", timeout: UPDATE_TIMEOUT_MS, killSignal: "SIGTERM" });
      },
      { maxAttempts: 2, initialDelayMs: 500, maxDelayMs: 2_000 },
    );
  } catch (err) {
    const isTimeout = err && typeof err === "object" && ("killed" in err || "signal" in err);
    // C7.5-W2B2-H28 (D8): classify non-timeout failures so the error
    // surfaces dependency-aware recovery guidance (package-manager vs
    // network vs auth) instead of a bare vendor string.
    let msg: string;
    let errorCode: "NETWORK_ERROR" | "UNKNOWN_ERROR" = "UNKNOWN_ERROR";
    if (isTimeout) {
      msg = `Package update timed out after ${UPDATE_TIMEOUT_MS / 1000}s. Check network connectivity and retry, or set HATCH3R_UPDATE_TIMEOUT_MS to increase the timeout.`;
      errorCode = "NETWORK_ERROR";
    } else {
      const raw = err instanceof Error ? err.message : String(err);
      const depClass = classifyDependency(err);
      const failType = classifyFailure(err);
      const guidance = getRecoveryGuidance(depClass, failType);
      msg = `${raw}. ${guidance}`;
      // Map dependency class -> canonical HatchErrorCode.
      if (depClass === "network") errorCode = "NETWORK_ERROR";
    }
    s0.fail(step(offset + 1, total, "Failed to update package"));
    logError(msg);
    throw new HatchError(msg, 1, errorCode);
  }
  s0.succeed(step(offset + 1, total, "Package updated"));
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
  options: { stepOffset?: number; totalSteps?: number; diff?: boolean } = {},
): Promise<UpdateResult> {
  const offset = options.stepOffset ?? 0;
  const total = options.totalSteps ?? 3;
  const agentsDir = join(rootDir, AGENTS_DIR);

  // Re-resolve the package root each invocation so that callers chaining
  // runPackageUpdate -> runRegenerate see the freshly fetched content.
  const contentRoot = findPackageRoot(__dirname);

  const s1 = createSpinner(step(offset + 1, total, "Updating canonical files..."));
  s1.start();

  // Build a set of selected IDs if manifest has content selections
  let selectedIds: Set<string> | undefined;
  if (manifest.content) {
    selectedIds = new Set<string>();
    for (const ids of Object.values(manifest.content.items)) {
      for (const id of ids) selectedIds.add(id);
    }
  }

  const copied: string[] = [];
  for (const dir of CONTENT_DIRS) {
    const srcDir = join(contentRoot, dir);
    try {
      const dirCopied = await copyHatch3rFiles(srcDir, join(agentsDir, dir), false, selectedIds);
      copied.push(...dirCopied.map((p) => join(dir, p)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  // Generate dynamic AGENTS.md based on what's on disk
  const canonicalAgentsMd = await generateCanonicalAgentsMd(agentsDir);
  await safeWriteFile(join(agentsDir, "AGENTS.md"), canonicalAgentsMd);
  // Regenerate root AGENTS.md with inline agent/skill/command rosters for platform discovery
  const rootAgentsMd = await generateRootAgentsMd(agentsDir);
  await safeWriteFile(join(rootDir, "AGENTS.md"), rootAgentsMd.full, {
    managedContent: rootAgentsMd.inner,
  });
  s1.succeed(step(offset + 1, total, `Updated ${copied.length} canonical files`));

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
  const breakers = new Map<string, CircuitBreakerState>();
  const adapterPhaseResult = await executeWithPhaseTimeout("adapter", async () => {
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
        const generationResult = await retryWithBackoff(
          () => generateWithTimeout(tool, adapter, agentsDir, manifest, "standard"),
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
        const toolPaths: string[] = [];
        for (const out of outputs) {
          if (options.diff) {
            diffBefore.set(out.path, await readFileOrNull(join(rootDir, out.path)));
          }
          const fullPath = join(rootDir, out.path);
          if (out.managedContent) {
            await safeWriteFile(fullPath, out.content, {
              managedContent: out.managedContent,
            });
          } else {
            await safeWriteFile(fullPath, out.content);
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
        await appendFailure(agentsDir, "update:adapter-generate", err, tool);
      }
    }
  });
  if (!adapterPhaseResult.completed && adapterPhaseResult.error) {
    warn(adapterPhaseResult.error);
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
      throw new HatchError(`All adapters failed. ${aggregateGuidance}`, 1, "ADAPTER_ERROR");
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
      { managedContent: wtManaged },
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

  // C7-H13 (D11): Only refresh the integrity manifest when every adapter
  // succeeded. When adapter A succeeds and adapter B fails, A's output is
  // freshly written to disk; regenerating the integrity manifest here would
  // certify the partial state and cause a later `verify` run to flag A as
  // "modified" even though it matches what we just produced.
  if (adapterFailures.length === 0) {
    const integrityManifest = await generateIntegrityManifest(agentsDir, HATCH3R_VERSION);
    await writeIntegrityManifest(agentsDir, integrityManifest);
  } else {
    warn("Integrity manifest not updated due to adapter failures. Re-run update after resolving errors.");
  }

  // Prune stale archive entries
  await pruneArchives(rootDir);

  s3.succeed(step(offset + 3, total, "Manifest updated"));

  return {
    copiedFiles: copied.length,
    syncedTools: manifest.tools.length - adapterFailures.length,
    failedTools: adapterFailures.length,
    version: HATCH3R_VERSION,
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
  const agentsDir = join(rootDir, AGENTS_DIR);
  const contentRoot = findPackageRoot(__dirname);

  let selectedIds: Set<string> | undefined;
  if (manifest.content) {
    selectedIds = new Set<string>();
    for (const ids of Object.values(manifest.content.items)) {
      for (const id of ids) selectedIds.add(id);
    }
  }

  const canonicalCandidates: string[] = [];
  for (const dir of CONTENT_DIRS) {
    const srcDir = join(contentRoot, dir);
    const entries = await enumerateHatch3rFiles(srcDir, false, selectedIds);
    for (const rel of entries) canonicalCandidates.push(join(dir, rel));
  }

  const adapterChanges = new Map<
    string,
    { added: string[]; modified: string[]; unchanged: string[]; error?: string }
  >();

  for (const tool of manifest.tools) {
    const bucket = { added: [] as string[], modified: [] as string[], unchanged: [] as string[] };
    try {
      const adapter = getAdapter(tool);
      const generationResult = await generateWithTimeout(tool, adapter, agentsDir, manifest, "standard");
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
 * Recursively enumerate files that would be copied under `copyHatch3rFiles`
 * without actually copying. Mirrors the filter rules (hatch3r prefix,
 * insideHatch3rDir, ALWAYS_COPY_FILES, selectedIds). Used by the dry-run
 * branch so we do not need a `dry` flag threaded through copyHatch3rFiles.
 */
async function enumerateHatch3rFiles(
  srcDir: string,
  insideHatch3rDir: boolean,
  selectedIds: Set<string> | undefined,
): Promise<string[]> {
  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = await readdir(srcDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: string[] = [];
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    if (entry.isDirectory()) {
      if (selectedIds && entry.name.startsWith(HATCH3R_PREFIX)) {
        if (!selectedIds.has(entry.name)) continue;
      }
      const sub = await enumerateHatch3rFiles(
        srcPath,
        insideHatch3rDir || !entry.name.startsWith(HATCH3R_PREFIX),
        selectedIds,
      );
      out.push(...sub.map((p) => join(entry.name, p)));
    } else if (entry.name.startsWith(HATCH3R_PREFIX) || insideHatch3rDir || ALWAYS_COPY_FILES.has(entry.name)) {
      if (selectedIds && entry.name.startsWith(HATCH3R_PREFIX)) {
        const baseId = entry.name.replace(/\.(md|mdc)$/, "");
        if (!selectedIds.has(baseId)) continue;
      }
      out.push(entry.name);
    }
  }
  return out;
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
  options: { stepOffset?: number; totalSteps?: number; diff?: boolean } = {},
): Promise<UpdateResult> {
  const offset = options.stepOffset ?? 0;
  const total = options.totalSteps ?? 4;
  await runPackageUpdate(rootDir, { stepOffset: offset, totalSteps: total });
  return runRegenerate(rootDir, manifest, {
    stepOffset: offset + 1,
    totalSteps: total,
    diff: options.diff,
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
      const agentsDir = join(rootDir, AGENTS_DIR);
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
      const agentsDir = join(rootDir, AGENTS_DIR);
      try {
        const entries = await readdir(agentsDir, { recursive: true });
        for (const entry of entries) {
          if (typeof entry === "string" && entry.endsWith(".customize.yaml")) {
            const s = await stat(join(agentsDir, entry));
            if (s.size > 10240) return true;
          }
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      return false;
    },
    execute: async (manifest, rootDir, _headless) => {
      const notices: string[] = [];
      const agentsDir = join(rootDir, AGENTS_DIR);
      try {
        const entries = await readdir(agentsDir, { recursive: true });
        for (const entry of entries) {
          if (typeof entry === "string" && entry.endsWith(".customize.yaml")) {
            const s = await stat(join(agentsDir, entry));
            if (s.size > 10240) {
              notices.push(`Large customize file detected: ${entry} (${Math.round(s.size / 1024)}KB) — consider splitting`);
            }
          }
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
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
    execute: async (manifest, rootDir, headless) => {
      let enabled: boolean;

      if (headless) {
        // Default to enabled in headless/CI mode
        enabled = true;
      } else {
        const answer = await inquirer.prompt<{ enabled: boolean }>([{
          type: "confirm",
          name: "enabled",
          message: "hatch3r now supports worktree file isolation for parallel agent sessions. Enable it?",
          default: true,
        }]);
        enabled = answer.enabled;
      }

      const updated = { ...manifest, worktree: { enabled } };
      const notices: string[] = [];

      if (enabled) {
        const wtContent = await generateWorktreeInclude(updated, rootDir);
        await safeWriteFile(join(rootDir, WORKTREE_INCLUDE_FILE), wtContent, {
          appendIfNoBlock: true,
        });
        notices.push("Worktree isolation enabled — .worktreeinclude generated");
      } else {
        notices.push("Worktree isolation skipped (enable later with `hatch3r config`)");
      }

      return { manifest: updated, notices };
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
  },
): Promise<void> {
  printBanner(true);

  // Pipeline-level timeout: tracks overall command duration and emits a
  // warning at the end if the run exceeded the configured budget.
  const pipelineState = createPipelineExecution(
    ["generation", "adapter", "merge", "integrity"],
    DEFAULT_PIPELINE_TIMEOUT_MS,
  );

  const rootDir = process.cwd();
  const manifest = await readManifest(rootDir);

  if (!manifest) {
    logError("No .agents/hatch.json found.");
    console.log(chalk.dim("  Run `npx hatch3r init` to set up your project first.\n"));
    throw new HatchError("No .agents/hatch.json found.", 1, "CONFIG_ERROR");
  }

  const headless = !!(_opts?.yes);
  const { manifest: migrated, allNotices } = await runMigrationCheckpoints(manifest, rootDir, headless);
  const m = migrated;

  for (const notice of allNotices) {
    warn(notice);
  }

  // C7-H5 (D15, OWASP ASI 2026): Preflight integrity check. If canonical
  // files have drifted (modified, missing, or tampered manifest) we refuse
  // the mutation operation unless the user opts in with --force. Update
  // would overwrite the drifted files in-place, silently destroying any
  // legitimate edits that were not yet integrated through `hatch3r config`
  // or a `.customize.yaml` file.
  const agentsDir = join(rootDir, AGENTS_DIR);
  const integrityResults = await verifyIntegrity(agentsDir);
  const modified = integrityResults.filter((r) => r.status === "modified");
  const missing = integrityResults.filter((r) => r.status === "missing");
  const tampered = integrityResults.filter((r) => r.status === "tampered");
  const driftDetected = modified.length > 0 || missing.length > 0 || tampered.length > 0;
  if (driftDetected) {
    warn("Integrity issues detected before update:");
    for (const r of tampered) { warn(`  TAMPERED: ${r.file}`); }
    for (const r of modified) { warn(`  MODIFIED: ${r.file}`); }
    for (const r of missing) { warn(`  MISSING:  ${r.file}`); }
    if (!_opts?.force) {
      logError(
        "Refusing to update with integrity drift. Run `hatch3r verify` to inspect, " +
        "or re-run with --force to overwrite the drifted files with the latest canonical content.",
      );
      throw new HatchError(
        "Integrity drift detected (use --force to override)",
        1,
        "INTEGRITY_ERROR",
      );
    }
    warn("Continuing with --force: drifted files will be overwritten with canonical content.");
    console.log();
  }

  const isUpToDate = m.hatch3rVersion === HATCH3R_VERSION;
  // Commander stores `--offline, --skip-fetch` under the last long name
  // (`skipFetch`), so we accept both keys for compatibility with
  // programmatic callers that still pass `offline`.
  const offlineMode = !!(_opts?.offline || _opts?.skipFetch);
  const dryRun = !!_opts?.dryRun;
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

  // C8-D1-M6: --offline / --skip-fetch skips runPackageUpdate and invokes
  // runRegenerate directly, so update can still repair drifted output
  // without network access (e.g. air-gapped CI, slow/offline networks).
  const result = offlineMode
    ? await runRegenerate(rootDir, m, { diff: !!_opts?.diff })
    : await runUpdate(rootDir, m, { diff: !!_opts?.diff });

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
  printBox("Update complete", [
    label("Files", `${compactedResult.copiedFiles} canonical files updated`),
    label("Tools", `${compactedResult.syncedTools} tool(s) re-synced`),
    label("Version", `v${compactedResult.version}`),
  ], "success");

  // Pipeline timeout advisory: surface a warning if total wall time exceeded
  // the budget. Disk writes are already complete; this is informational only.
  if (isPipelineTimedOut(pipelineState)) {
    const { report } = terminatePipeline(pipelineState);
    warn(report.summary);
  }
}
