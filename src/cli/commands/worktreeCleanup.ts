import chalk from "chalk";
import {
  HatchError,
} from "../../types.js";
import {
  cleanupWorktree,
} from "../../worktree/index.js";
import {
  isInsideWorktree,
} from "../../worktree/resolve.js";
import {
  printBanner,
  createSpinner,
  info,
  error as logError,
} from "../shared/ui.js";

export async function worktreeCleanupCommand(
  opts: { dryRun?: boolean } = {},
): Promise<void> {
  printBanner(true);

  const cwd = process.cwd();

  if (!isInsideWorktree(cwd)) {
    logError("Not inside a git worktree.");
    console.log(chalk.dim("  Run this command from inside a worktree to clean up symlinks and copied files.\n"));
    throw new HatchError("Not inside a git worktree", 1, "VALIDATION_ERROR");
  }

  if (opts.dryRun) {
    info("Dry run — no changes will be made.");
    info(`Would clean up worktree symlinks in: ${cwd}`);
    return;
  }

  const s = createSpinner("Cleaning up worktree files...");
  s.start();

  await cleanupWorktree(cwd);

  s.succeed("Worktree files cleaned up");
  info("Symlinks created by worktree-setup have been removed.");
}
