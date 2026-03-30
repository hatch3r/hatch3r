import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { readManifest } from "../../manifest/hatchJson.js";
import { getAdapter } from "../../adapters/index.js";
import { AGENTS_DIR, HatchError } from "../../types.js";
import { extractManagedBlock } from "../../merge/managedBlocks.js";
import {
  printBanner,
  createSpinner,
  printBox,
  error as logError,
  info,
} from "../shared/ui.js";
import { readWorkspaceManifest } from "../../workspace/manifest.js";

/** Recursively sum the byte size of all files under a directory. */
async function dirCharCount(dir: string): Promise<number> {
  let total = 0;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirCharCount(fullPath);
    } else if (entry.isFile()) {
      const info = await stat(fullPath);
      total += info.size;
    }
  }
  return total;
}

export async function statusCommand(): Promise<void> {
  printBanner(true);

  const rootDir = process.cwd();
  const agentsDir = join(rootDir, AGENTS_DIR);
  const manifest = await readManifest(rootDir);

  if (!manifest) {
    logError("No .agents/hatch.json found.");
    console.log(chalk.dim("  Run `npx hatch3r init` to set up your project first.\n"));
    throw new HatchError("No .agents/hatch.json found.", 1, "CONFIG_ERROR");
  }

  const spinner = createSpinner("Checking sync status...");
  spinner.start();

  const stats = { synced: 0, drifted: 0, missing: 0 };
  const fileLines: string[] = [];

  for (const tool of manifest.tools) {
    const adapter = getAdapter(tool);
    const outputs = await adapter.generate(agentsDir, manifest);

    fileLines.push(chalk.bold(`${tool}:`));

    for (const out of outputs) {
      const destPath = join(rootDir, out.path);
      try {
        const existing = await readFile(destPath, "utf-8");
        const existingBlock = extractManagedBlock(existing);
        const expectedBlock = out.managedContent ?? extractManagedBlock(out.content);
        if (existingBlock !== null && expectedBlock !== null ? existingBlock === expectedBlock : existing === out.content) {
          fileLines.push(`  ${chalk.green("=")} ${out.path}`);
          stats.synced++;
        } else {
          fileLines.push(`  ${chalk.yellow("~")} ${out.path} ${chalk.dim("(drifted)")}`);
          stats.drifted++;
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        fileLines.push(`  ${chalk.red("+")} ${out.path} ${chalk.dim("(missing)")}`);
        stats.missing++;
      }
    }
  }

  spinner.stop();
  console.log();

  for (const line of fileLines) {
    console.log(`  ${line}`);
  }
  console.log();

  const summaryLines = [
    `${chalk.green("=")} In sync: ${stats.synced}`,
  ];
  if (stats.drifted > 0) {
    summaryLines.push(`${chalk.yellow("~")} Drifted: ${stats.drifted}`);
  }
  if (stats.missing > 0) {
    summaryLines.push(`${chalk.red("+")} Missing: ${stats.missing}`);
  }

  // Estimate canonical token count from .agents/ directory size
  const totalChars = await dirCharCount(agentsDir);
  const estimatedTokens = Math.round(totalChars / 4);
  const formattedTokens = estimatedTokens.toLocaleString("en-US");
  summaryLines.push(`${chalk.dim("~")} Estimated canonical tokens: ~${formattedTokens}`);

  const style = stats.drifted > 0 || stats.missing > 0 ? "info" as const : "success" as const;
  printBox("Status", summaryLines, style);

  if (stats.drifted > 0 || stats.missing > 0) {
    info(`Run ${chalk.bold("hatch3r sync")} to regenerate drifted/missing files.`);
    console.log();
  }

  // ── Workspace topology ──────────────────────────────────────
  const wsManifest = await readWorkspaceManifest(rootDir);
  if (wsManifest && wsManifest.repos.length > 0) {
    const wsLines: string[] = [];
    for (const repo of wsManifest.repos) {
      const icon = repo.sync ? chalk.green("\u2713") : chalk.dim("\u25CB");
      let detail: string;
      if (!repo.sync) {
        detail = chalk.dim("sync disabled");
      } else if (repo.lastSync) {
        const elapsed = Math.max(0, Date.now() - new Date(repo.lastSync).getTime());
        const hours = Math.floor(elapsed / (1000 * 60 * 60));
        const timeAgo = hours < 1 ? "just now" : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
        detail = `synced ${timeAgo}`;
      } else {
        detail = chalk.yellow("never synced");
      }
      const identity = repo.owner && repo.repo
        ? chalk.dim(`${repo.owner}/${repo.repo}`)
        : "";
      const branch = repo.defaultBranch
        ? chalk.dim(`[${repo.defaultBranch}]`)
        : "";
      const identityPart = identity || branch ? `  ${identity} ${branch}` : "";
      wsLines.push(`${icon} ${repo.name ?? repo.path}${identityPart}  ${chalk.dim(`(${detail})`)}`);
    }
    printBox(`Workspace: ${wsManifest.name} (${wsManifest.repos.length} repos)`, wsLines, "info");
  }

  // Show workspace membership info if this repo is managed by a workspace
  if (manifest.workspace) {
    const wsInfo = [
      `Managed by workspace at ${chalk.bold(manifest.workspace.rootPath)}`,
      `Last synced: ${manifest.workspace.lastSync ? new Date(manifest.workspace.lastSync).toLocaleString() : "never"}`,
    ];
    printBox("Workspace member", wsInfo, "info");
  }
}
