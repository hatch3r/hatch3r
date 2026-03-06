import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import { readManifest, writeManifest } from "../../manifest/hatchJson.js";
import { getAdapter } from "../../adapters/index.js";
import { safeWriteFile } from "../../merge/safeWrite.js";
import { AGENTS_DIR, HATCH3R_PREFIX, HatchError, type HatchManifest, type Platform } from "../../types.js";
import { CANONICAL_AGENTS_MD } from "../shared/agentsContent.js";
import { HATCH3R_VERSION } from "../../version.js";
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
import { generateIntegrityManifest, writeIntegrityManifest } from "../../integrity/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIRS = ["agents", "commands", "rules", "skills", "prompts", "github-agents", "mcp", "hooks"];
const ALWAYS_COPY_FILES = new Set(["mcp.json"]);

async function copyHatch3rFiles(
  srcDir: string,
  destDir: string,
  insideHatch3rDir = false,
): Promise<string[]> {
  const copied: string[] = [];
  const entries = await readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      await mkdir(destPath, { recursive: true });
      const subCopied = await copyHatch3rFiles(
        srcPath,
        destPath,
        entry.name.startsWith(HATCH3R_PREFIX),
      );
      copied.push(...subCopied.map((p) => join(entry.name, p)));
    } else if (entry.name.startsWith(HATCH3R_PREFIX) || insideHatch3rDir || ALWAYS_COPY_FILES.has(entry.name)) {
      await mkdir(dirname(destPath), { recursive: true });
      await cp(srcPath, destPath, { force: true });
      copied.push(entry.name);
    }
  }

  return copied;
}

interface MigrationCheckpoint {
  id: string;
  condition: (manifest: HatchManifest, rootDir: string) => Promise<boolean>;
  execute: (manifest: HatchManifest, rootDir: string) => Promise<{ manifest: HatchManifest; notices: string[] }>;
}

const MIGRATION_CHECKPOINTS: MigrationCheckpoint[] = [
  {
    id: "platform-selection",
    condition: async (manifest) => !manifest.platform,
    execute: async (manifest) => {
      const { platform } = await inquirer.prompt<{ platform: Platform }>([
        {
          type: "list",
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
    execute: async (manifest, rootDir) => {
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
];

async function runMigrationCheckpoints(manifest: HatchManifest, rootDir: string): Promise<{ manifest: HatchManifest; allNotices: string[] }> {
  let current = manifest;
  const allNotices: string[] = [];

  for (const checkpoint of MIGRATION_CHECKPOINTS) {
    if (await checkpoint.condition(current, rootDir)) {
      const { manifest: updated, notices } = await checkpoint.execute(current, rootDir);
      current = updated;
      allNotices.push(...notices);
    }
  }

  return { manifest: current, allNotices };
}

export async function updateCommand(_opts?: Record<string, unknown>): Promise<void> {
  printBanner(true);

  const rootDir = process.cwd();
  const agentsDir = join(rootDir, AGENTS_DIR);
  const manifest = await readManifest(rootDir);

  if (!manifest) {
    logError("No .agents/hatch.json found.");
    console.log(chalk.dim("  Run `npx hatch3r init` to set up your project first.\n"));
    throw new HatchError("No .agents/hatch.json found.", 1);
  }

  const { manifest: migrated, allNotices } = await runMigrationCheckpoints(manifest, rootDir);
  const m = migrated;

  for (const notice of allNotices) {
    warn(notice);
  }

  let CONTENT_ROOT = findPackageRoot(__dirname);
  const currentVersion = m.hatch3rVersion;
  const isUpToDate = currentVersion === HATCH3R_VERSION;

  if (isUpToDate) {
    info(`Already at hatch3r v${HATCH3R_VERSION}`);
  } else {
    info(`Updating from v${currentVersion} to v${HATCH3R_VERSION}`);
  }
  console.log();

  const totalSteps = 4;

  const pm = await detectPackageManager(rootDir);
  const s0 = createSpinner(step(1, totalSteps, "Updating package..."));
  s0.start();
  try {
    execFileSync(pm.updateCmd, pm.updateArgs, { stdio: "pipe", shell: process.platform === "win32" });
    CONTENT_ROOT = findPackageRoot(__dirname);
  } catch (err) {
    s0.fail(step(1, totalSteps, "Failed to update package"));
    logError(err instanceof Error ? err.message : String(err));
    throw new HatchError("Failed to update package", 1);
  }
  s0.succeed(step(1, totalSteps, "Package updated"));

  const s1 = createSpinner(step(2, totalSteps, "Updating canonical files..."));
  s1.start();
  const copied: string[] = [];
  for (const dir of CONTENT_DIRS) {
    const srcDir = join(CONTENT_ROOT, dir);
    try {
      const dirCopied = await copyHatch3rFiles(srcDir, join(agentsDir, dir));
      copied.push(...dirCopied.map((p) => join(dir, p)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  // no backup on update — managed files are overwritten in place
  await safeWriteFile(join(agentsDir, "AGENTS.md"), CANONICAL_AGENTS_MD);

  s1.succeed(step(2, totalSteps, `Updated ${copied.length} canonical files`));

  const s2 = createSpinner(step(3, totalSteps, "Re-syncing adapter output..."));
  s2.start();
  const adapterFailures: { tool: string; error: string }[] = [];
  for (const tool of m.tools) {
    const adapter = getAdapter(tool);
    try {
      const outputs = await adapter.generate(agentsDir, m);
      for (const w of adapter.warnings) { warn(w); }
      for (const out of outputs) {
        const fullPath = join(rootDir, out.path);
        if (out.managedContent) {
          // no backup on update — managed files are overwritten in place
          await safeWriteFile(fullPath, out.content, {
            managedContent: out.managedContent,
          });
        } else {
          await safeWriteFile(fullPath, out.content);
        }
      }
    } catch (err) {
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
      s2.fail(step(3, totalSteps, "All adapters failed"));
      throw new HatchError("All adapters failed", 1);
    }
  }
  s2.succeed(step(3, totalSteps, adapterFailures.length > 0
    ? `Re-synced ${m.tools.length - adapterFailures.length}/${m.tools.length} tool(s)`
    : `Re-synced ${m.tools.length} tool(s)`));

  const s3 = createSpinner(step(4, totalSteps, "Writing manifest..."));
  s3.start();
  m.hatch3rVersion = HATCH3R_VERSION;
  await writeManifest(rootDir, m);

  const integrityManifest = await generateIntegrityManifest(agentsDir, HATCH3R_VERSION);
  await writeIntegrityManifest(agentsDir, integrityManifest);

  s3.succeed(step(4, totalSteps, "Manifest updated"));

  console.log();
  printBox("Update complete", [
    label("Files", `${copied.length} canonical files updated`),
    label("Tools", `${m.tools.length} tool(s) re-synced`),
    label("Version", `v${HATCH3R_VERSION}`),
  ], "success");
}
