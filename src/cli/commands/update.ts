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

export async function runUpdate(
  rootDir: string,
  manifest: HatchManifest,
  options: { stepOffset?: number; totalSteps?: number; diff?: boolean } = {},
): Promise<UpdateResult> {
  const offset = options.stepOffset ?? 0;
  const total = options.totalSteps ?? 4;
  const agentsDir = join(rootDir, AGENTS_DIR);

  let contentRoot = findPackageRoot(__dirname);

  const pm = await detectPackageManager(rootDir);
  const s0 = createSpinner(step(offset + 1, total, "Updating package..."));
  s0.start();
  try {
    const cmd = process.platform === "win32" && pm.name !== "bun"
      ? `${pm.updateCmd}.cmd`
      : pm.updateCmd;
    execFileSync(cmd, pm.updateArgs, { stdio: "pipe", timeout: 30_000, killSignal: "SIGTERM" });
    contentRoot = findPackageRoot(__dirname);
  } catch (err) {
    const isTimeout = err && typeof err === "object" && ("killed" in err || "signal" in err);
    const msg = isTimeout
      ? "Package update timed out after 30s. Check network connectivity and retry."
      : (err instanceof Error ? err.message : String(err));
    s0.fail(step(offset + 1, total, "Failed to update package"));
    logError(msg);
    throw new HatchError(msg, 1, isTimeout ? "NETWORK_ERROR" : "UNKNOWN_ERROR");
  }
  s0.succeed(step(offset + 1, total, "Package updated"));

  const s1 = createSpinner(step(offset + 2, total, "Updating canonical files..."));
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
  s1.succeed(step(offset + 2, total, `Updated ${copied.length} canonical files`));

  // --diff: track file snapshots before and after generation
  const diffBefore = new Map<string, string | null>();
  const diffAfter = new Map<string, string | null>();

  const s2 = createSpinner(step(offset + 3, total, "Re-syncing adapter output..."));
  s2.start();
  const adapterFailures: { tool: string; error: string }[] = [];
  for (const tool of manifest.tools) {
    const adapter = getAdapter(tool);
    try {
      const outputs = await adapter.generate(agentsDir, manifest);
      for (const w of adapter.warnings) { warn(w); }
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
        if (options.diff) {
          diffAfter.set(out.path, await readFileOrNull(join(rootDir, out.path)));
        }
      }
    } catch (err) {
      adapterFailures.push({
        tool,
        error: err instanceof Error ? err.message : String(err),
      });
      // Record to persistent failure log for post-hoc debugging
      await appendFailure(agentsDir, "update:adapter-generate", err, tool);
    }
  }
  if (adapterFailures.length > 0) {
    for (const f of adapterFailures) {
      logError(`Failed to generate ${f.tool}: ${f.error}`);
    }
    if (adapterFailures.length === manifest.tools.length) {
      s2.fail(step(offset + 3, total, "All adapters failed"));
      throw new HatchError("All adapters failed", 1, "ADAPTER_ERROR");
    }
  }
  s2.succeed(step(offset + 3, total, adapterFailures.length > 0
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

  const s3 = createSpinner(step(offset + 4, total, "Writing manifest..."));
  s3.start();
  manifest.hatch3rVersion = HATCH3R_VERSION;
  await writeManifest(rootDir, manifest);

  const integrityManifest = await generateIntegrityManifest(agentsDir, HATCH3R_VERSION);
  await writeIntegrityManifest(agentsDir, integrityManifest);

  // Prune stale archive entries
  await pruneArchives(rootDir);

  s3.succeed(step(offset + 4, total, "Manifest updated"));

  return {
    copiedFiles: copied.length,
    syncedTools: manifest.tools.length - adapterFailures.length,
    failedTools: adapterFailures.length,
    version: HATCH3R_VERSION,
    ...(options.diff ? { diffBefore, diffAfter } : {}),
  };
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

export async function updateCommand(_opts?: Record<string, unknown> & { yes?: boolean; diff?: boolean }): Promise<void> {
  printBanner(true);

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

  // #118: Run integrity pre-check before update to detect tampered files
  const agentsDir = join(rootDir, AGENTS_DIR);
  const integrityResults = await verifyIntegrity(agentsDir);
  const modified = integrityResults.filter((r) => r.status === "modified");
  const missing = integrityResults.filter((r) => r.status === "missing");
  if (modified.length > 0 || missing.length > 0) {
    warn("Integrity issues detected before update:");
    for (const r of modified) { warn(`  MODIFIED: ${r.file}`); }
    for (const r of missing) { warn(`  MISSING:  ${r.file}`); }
    warn("These files will be overwritten during update.");
    console.log();
  }

  const isUpToDate = m.hatch3rVersion === HATCH3R_VERSION;
  if (isUpToDate) {
    info(`Already at hatch3r v${HATCH3R_VERSION}`);
  } else {
    info(`Updating from v${m.hatch3rVersion} to v${HATCH3R_VERSION}`);
  }
  console.log();

  const result = await runUpdate(rootDir, m, { diff: !!_opts?.diff });

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
  printBox("Update complete", [
    label("Files", `${result.copiedFiles} canonical files updated`),
    label("Tools", `${result.syncedTools} tool(s) re-synced`),
    label("Version", `v${result.version}`),
  ], "success");
}
