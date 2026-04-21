import { access, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { readManifest } from "../../manifest/hatchJson.js";
import { getAdapter } from "../../adapters/index.js";
import { AGENTS_DIR, HatchError, type HatchManifest } from "../../types.js";
import { extractManagedBlock } from "../../merge/managedBlocks.js";
import { readIntegrityManifest } from "../../integrity/index.js";
import {
  printBanner,
  createSpinner,
  printBox,
  error as logError,
  info,
  warn,
  setVerbose,
  verbose,
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

/**
 * D1-SA1.4.1 (High): Fast drift check using the integrity manifest seal
 * timestamp + adapter output path enumeration (via `adapter.getOutputPaths`).
 *
 * Per-file drift uses `stat().mtimeMs > sealMs` — any output file written or
 * touched after the integrity manifest was sealed is reported as drifted.
 * This is cheaper than the deep path because it avoids rendering adapter
 * output content in memory to byte-compare; adapters with lightweight
 * `getOutputPaths` overrides avoid `generate()` entirely.
 *
 * Returns null (falls back to deep check) when the integrity manifest is
 * absent or its seal timestamp is malformed.
 */
async function runFastStatusCheck(
  rootDir: string,
  agentsDir: string,
  manifest: HatchManifest,
): Promise<{ stats: { synced: number; drifted: number; missing: number }; fileLines: string[] } | null> {
  const integrityManifest = await readIntegrityManifest(agentsDir);
  if (!integrityManifest) {
    return null;
  }

  const sealMs = new Date(integrityManifest.generated).getTime();
  if (!Number.isFinite(sealMs)) {
    // Malformed seal timestamp — defer to deep check for correctness
    return null;
  }

  const stats = { synced: 0, drifted: 0, missing: 0 };
  const fileLines: string[] = [];

  // D1-SA1.3.2 (High): If the integrity manifest records adapter tracking
  // metadata, surface partial-sync state so users know which tools need
  // re-running.
  if (integrityManifest.expectedAdapters && integrityManifest.successfulAdapters) {
    const expected = new Set(integrityManifest.expectedAdapters);
    const successful = new Set(integrityManifest.successfulAdapters);
    for (const tool of expected) {
      if (!successful.has(tool)) {
        fileLines.push(chalk.yellow(`${tool}: last sync did not complete (check hatch3r sync output)`));
      }
    }
  }

  for (const tool of manifest.tools) {
    const adapter = getAdapter(tool);
    // Enumerate the output paths without reading the adapter's in-memory
    // content unless the adapter's getOutputPaths override requires it.
    // The BaseAdapter default still calls generate() once and caches, so
    // this is at worst the same cost as the deep path's enumeration; the
    // savings come from skipping the byte-for-byte comparison below.
    const paths = await adapter.getOutputPaths(agentsDir, manifest);
    verbose(`${tool}: ${paths.length} output path(s) to check (fast path)`);
    fileLines.push(chalk.bold(`${tool}:`));

    for (const p of paths) {
      const destPath = join(rootDir, p);
      try {
        const fileStat = await stat(destPath);
        // mtime > sealMs => file was modified after the integrity seal,
        // which indicates drift from what was produced at seal time.
        if (fileStat.mtimeMs > sealMs) {
          fileLines.push(`  ${chalk.yellow("~")} ${p} ${chalk.dim("(drifted)")}`);
          stats.drifted++;
        } else {
          fileLines.push(`  ${chalk.green("=")} ${p}`);
          stats.synced++;
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        fileLines.push(`  ${chalk.red("+")} ${p} ${chalk.dim("(missing)")}`);
        stats.missing++;
      }
    }
  }

  return { stats, fileLines };
}

/**
 * D1-SA1.4.1 (High): Deep drift check — regenerates every adapter's output in
 * memory and compares byte-for-byte. This is the historical path; preserved
 * as the fallback when no integrity manifest exists or when --deep is set.
 */
async function runDeepStatusCheck(
  rootDir: string,
  agentsDir: string,
  manifest: HatchManifest,
): Promise<{ stats: { synced: number; drifted: number; missing: number }; fileLines: string[] }> {
  const stats = { synced: 0, drifted: 0, missing: 0 };
  const fileLines: string[] = [];

  for (const tool of manifest.tools) {
    const adapter = getAdapter(tool);
    const outputs = await adapter.generate(agentsDir, manifest);
    verbose(`${tool}: ${outputs.length} output file(s) to check`);

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
  return { stats, fileLines };
}

export async function statusCommand(opts?: { verbose?: boolean; deep?: boolean }): Promise<void> {
  setVerbose(!!opts?.verbose);
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

  verbose(`Checking ${manifest.tools.length} tool(s): ${manifest.tools.join(", ")}`);

  // D1-SA1.4.1 (High): Prefer the integrity-manifest-based fast path to avoid
  // the O(N adapters x M canonical files) regeneration on every status call.
  // Fall back to the deep path when (a) user passes --deep or (b) no
  // integrity manifest exists (fresh repo never synced).
  let checkResult: { stats: { synced: number; drifted: number; missing: number }; fileLines: string[] } | null = null;
  let usedFastPath = false;

  if (!opts?.deep) {
    checkResult = await runFastStatusCheck(rootDir, agentsDir, manifest);
    if (checkResult) {
      usedFastPath = true;
      verbose("Used fast-path status check (integrity-manifest based)");
    }
  }
  if (!checkResult) {
    checkResult = await runDeepStatusCheck(rootDir, agentsDir, manifest);
    verbose(opts?.deep ? "Used deep status check (--deep)" : "Used deep status check (no integrity manifest)");
  }

  const { stats, fileLines } = checkResult;

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
  if (usedFastPath) {
    summaryLines.push(chalk.dim("mode: fast (integrity-manifest). Pass --deep for byte-for-byte regeneration check."));
  }

  const style = stats.drifted > 0 || stats.missing > 0 ? "info" as const : "success" as const;
  printBox("Status", summaryLines, style);

  if (stats.drifted > 0 || stats.missing > 0) {
    info(`Run ${chalk.bold("hatch3r sync")} to regenerate drifted/missing files.`);
    console.log();
  }

  // ── Codex precedence-chain warning (C7.5-W2B2-H36 / D9-SA9.5.1) ──
  // OpenAI Codex CLI checks AGENTS.override.md before AGENTS.md in every
  // scope. If ops or compliance has placed AGENTS.override.md at the
  // project root, hatch3r-managed AGENTS.md is silently superseded. Warn
  // when the override file is present so users know their hatch3r content
  // is being overridden by a non-hatch3r file.
  if (manifest.tools.includes("codex")) {
    const overridePath = join(rootDir, "AGENTS.override.md");
    try {
      await access(overridePath);
      warn(
        `AGENTS.override.md present at project root -- Codex will use it instead of hatch3r's AGENTS.md (per Codex 2026 discovery precedence).`,
      );
      console.log();
    } catch (err) {
      // Expected path: no override file present is normal operation. Surface
      // the probe outcome via the verbose channel so the silent-failure
      // contract is satisfied and diagnostics are available when debugging
      // (CONSTITUTION.md §2 P5).
      const code = (err as NodeJS.ErrnoException | undefined)?.code ?? "UNKNOWN";
      verbose(`AGENTS.override.md probe: not present (${code})`);
    }
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
