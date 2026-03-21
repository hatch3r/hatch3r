import { stat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import { readManifest } from "../../manifest/hatchJson.js";
import { getAdapter, getUnsupportedFeatureWarnings } from "../../adapters/index.js";
import { safeWriteFile } from "../../merge/safeWrite.js";
import { generateWorktreeInclude, extractManagedContent } from "../../worktree/index.js";
import { AGENTS_DIR, HatchError, WORKTREE_INCLUDE_FILE, type GenerationMode } from "../../types.js";
import { ensureEnvMcp, ensureGitignoreEntry, getSourceEnvMcpCommand } from "../../env/mcpEnv.js";
import { readWorkspaceManifest } from "../../workspace/manifest.js";
import { syncWorkspaceRepos } from "../../workspace/sync.js";
import { AGENTS_MD_INNER, AGENTS_MD_FULL, generateCanonicalAgentsMd } from "../shared/agentsContent.js";
import { verifyIntegrity } from "../../integrity/index.js";
import {
  printBanner,
  createSpinner,
  printBox,
  error as logError,
  info,
  step,
  warn,
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

export async function syncCommand(
  opts: {
    repos?: string[] | true;
    dryRun?: boolean;
    force?: boolean;
    minimal?: boolean;
  } = {},
): Promise<void> {
  printBanner(true);

  const rootDir = process.cwd();
  const agentsDir = join(rootDir, AGENTS_DIR);
  const manifest = await readManifest(rootDir);

  if (!manifest) {
    logError("No .agents/hatch.json found.");
    console.log(chalk.dim("  Run `npx hatch3r init` to set up your project first.\n"));
    throw new HatchError("No .agents/hatch.json found.", 1);
  }

  const m = manifest;

  const integrityResults = await verifyIntegrity(agentsDir);
  const modified = integrityResults.filter((r) => r.status === "modified");
  const missing = integrityResults.filter((r) => r.status === "missing");
  if (modified.length > 0 || missing.length > 0) {
    warn("Integrity issues detected in canonical files:");
    for (const r of modified) {
      warn(`  MODIFIED: ${r.file}`);
    }
    for (const r of missing) {
      warn(`  MISSING:  ${r.file}`);
    }
    warn("These files may have been tampered with. Syncing will propagate their current content.");
    console.log();
  }

  const results: { path: string; action: string }[] = [];
  const totalSteps = m.tools.length + 1;
  let currentStep = 0;

  const s1 = createSpinner(step(++currentStep, totalSteps, "Syncing AGENTS.md..."));
  s1.start();
  const agentsMdResult = await safeWriteFile(join(rootDir, "AGENTS.md"), AGENTS_MD_FULL, {
    managedContent: AGENTS_MD_INNER,
  });
  if (agentsMdResult.warning) warn(agentsMdResult.warning);
  results.push({ path: "AGENTS.md", action: agentsMdResult.action });
  const canonicalAgentsMd = await generateCanonicalAgentsMd(agentsDir);
  const canonicalResult = await safeWriteFile(join(agentsDir, "AGENTS.md"), canonicalAgentsMd);
  if (canonicalResult.warning) warn(canonicalResult.warning);
  results.push({ path: `${AGENTS_DIR}/AGENTS.md`, action: canonicalResult.action });
  s1.succeed(step(currentStep, totalSteps, "AGENTS.md synced"));

  const generationMode: GenerationMode = opts.minimal ? "minimal" : "standard";
  if (opts.minimal) {
    info("Minimal generation mode: output will be stripped-down to reduce token usage.");
  }

  const adapterFailures: { tool: string; error: string }[] = [];
  for (const tool of m.tools) {
    const s = createSpinner(step(++currentStep, totalSteps, `Generating ${tool} output...`));
    s.start();
    try {
      const adapter = getAdapter(tool);
      const outputs = await adapter.generate(agentsDir, m, generationMode);
      for (const w of adapter.warnings) { warn(w); }
      for (const out of outputs) {
        const fullPath = join(rootDir, out.path);
        if (out.managedContent) {
          const result = await safeWriteFile(fullPath, out.content, {
            managedContent: out.managedContent,
          });
          if (result.warning) warn(result.warning);
          results.push({ path: out.path, action: result.action });
        } else {
          const result = await safeWriteFile(fullPath, out.content);
          if (result.warning) warn(result.warning);
          results.push({ path: out.path, action: result.action });
        }
      }
      s.succeed(step(currentStep, totalSteps, `${tool} output generated`));
    } catch (err) {
      s.fail(step(currentStep, totalSteps, `Failed to generate ${tool} output`));
      adapterFailures.push({
        tool,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (adapterFailures.length > 0) {
    for (const f of adapterFailures) {
      logError(`Failed to generate ${f.tool}: ${f.error}`);
    }
    if (adapterFailures.length === m.tools.length) {
      throw new HatchError("All adapters failed", 1);
    }
  }

  for (const tool of m.tools) {
    const warnings = getUnsupportedFeatureWarnings(tool, m);
    for (const w of warnings) {
      warn(w);
    }
  }

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

  // Check spec freshness
  await checkSpecFreshness(rootDir);

  console.log();

  const icons: Record<string, string> = {
    created: chalk.green("+"),
    updated: chalk.yellow("~"),
    skipped: chalk.dim("="),
  };

  const summaryLines = results.map((r) => {
    const icon = icons[r.action] ?? chalk.dim(" ");
    return `${icon} ${r.path} ${chalk.dim(`(${r.action})`)}`;
  });

  printBox("Sync complete", summaryLines, "success");

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
    opts.dryRun
      ? "Workspace sync (dry run)..."
      : `Syncing workspace to ${repoPaths ? repoPaths.length : syncableCount} repo(s)...`,
  );
  wsSpinner.start();

  const wsResult = await syncWorkspaceRepos(rootDir, {
    repos: repoPaths,
    dryRun: opts.dryRun,
    force: opts.force,
    onWarn: (msg) => warn(msg),
  });

  if (opts.dryRun) {
    wsSpinner.succeed("Workspace sync (dry run)");
    for (const r of wsResult.repos) {
      const changes = [];
      if (r.added.length > 0) changes.push(`+${r.added.length} content`);
      if (r.removed.length > 0) changes.push(`-${r.removed.length} content`);
      if (r.toolsSynced.length > 0) changes.push(`${r.toolsSynced.length} tools`);
      info(`  ${r.path}: ${changes.length > 0 ? changes.join(", ") : "up to date"}`);
    }
    return;
  }

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
