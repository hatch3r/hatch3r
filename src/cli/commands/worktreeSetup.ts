import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import {
  WORKTREE_INCLUDE_FILE,
  HatchError,
} from "../../types.js";
import {
  setupWorktree,
  parseWorktreeInclude,
} from "../../worktree/index.js";
import {
  isInsideWorktree,
  findMainWorktree,
} from "../../worktree/resolve.js";
import {
  printBanner,
  createSpinner,
  printBox,
  error as logError,
  info,
  warn,
  label,
} from "../shared/ui.js";

export async function worktreeSetupCommand(
  worktreePath?: string,
  opts: { from?: string; dryRun?: boolean; force?: boolean } = {},
): Promise<void> {
  printBanner(true);

  const cwd = process.cwd();
  let mainRoot: string;
  let targetRoot: string;

  if (isInsideWorktree(cwd)) {
    mainRoot = opts.from ?? findMainWorktree(cwd);
    targetRoot = worktreePath ? join(cwd, worktreePath) : cwd;
    info(`Detected worktree. Main repo: ${chalk.dim(mainRoot)}`);
  } else {
    mainRoot = opts.from ?? cwd;
    if (!worktreePath) {
      logError("Worktree path is required when running from the main repo.");
      console.log(chalk.dim("  Usage: hatch3r worktree-setup <worktree-path>"));
      console.log(chalk.dim("  Or run this command from inside a worktree.\n"));
      throw new HatchError("Missing worktree path", 1, "VALIDATION_ERROR");
    }
    targetRoot = join(cwd, worktreePath);
  }

  const includePath = join(mainRoot, WORKTREE_INCLUDE_FILE);
  let includeContent: string;
  try {
    includeContent = await readFile(includePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logError(`No ${WORKTREE_INCLUDE_FILE} found in ${mainRoot}`);
      console.log(chalk.dim("  Run `hatch3r init` or `hatch3r sync` to generate it.\n"));
      throw new HatchError(`Missing ${WORKTREE_INCLUDE_FILE}`, 1, "FS_ERROR");
    }
    throw err;
  }

  if (opts.dryRun) {
    info("Dry run — no changes will be made.\n");
    const entries = parseWorktreeInclude(includeContent);
    const summaryLines = entries.map((e) => {
      const icon = e.strategy === "symlink" ? chalk.cyan("→") : chalk.green("+");
      return `  ${icon} ${e.pattern} ${chalk.dim(`(${e.strategy})`)}`;
    });
    printBox("Worktree setup (dry run)", [
      label("Source", mainRoot),
      label("Target", targetRoot),
      label("Entries", `${entries.length}`),
      "",
      ...summaryLines,
    ], "info");
    return;
  }

  const s = createSpinner("Setting up worktree files...");
  s.start();

  const result = await setupWorktree(mainRoot, targetRoot, { force: opts.force });

  s.succeed("Worktree files set up");

  const summaryLines: string[] = [];
  if (result.copied.length > 0) {
    summaryLines.push(label("Copied", `${result.copied.length} file(s)`));
    for (const f of result.copied) {
      summaryLines.push(`  ${chalk.green("+")} ${f}`);
    }
  }
  if (result.symlinked.length > 0) {
    summaryLines.push(label("Symlinked", `${result.symlinked.length} path(s)`));
    for (const f of result.symlinked) {
      summaryLines.push(`  ${chalk.cyan("→")} ${f}`);
    }
  }
  if (result.skipped.length > 0) {
    summaryLines.push(label("Skipped", `${result.skipped.length} path(s)`));
  }
  if (result.errors.length > 0) {
    for (const e of result.errors) {
      warn(e);
    }
  }

  if (summaryLines.length > 0) {
    printBox("Worktree setup", summaryLines, "success");
  } else {
    info("No files to set up (all patterns already satisfied or source files missing).");
  }

  // Auto-sync adapter output in the worktree so CLAUDE.md, .claude/, etc. are fresh
  try {
    info("Syncing adapter output in worktree...");
    execFileSync("npx", ["hatch3r", "sync"], {
      cwd: targetRoot,
      stdio: "pipe",
    });
    info("Adapter output synced in worktree");
  } catch {
    warn("Could not auto-sync adapter output. Run `hatch3r sync` in the worktree manually.");
  }
}
