import chalk from "chalk";
import inquirer from "inquirer";
import {
  HatchError,
} from "../../types.js";
import {
  cleanupWorktree,
  removeGitWorktree,
  WORKTREES_DIR,
} from "../../worktree/index.js";
import {
  isInsideWorktree,
  findMainWorktree,
  listWorktrees,
  getWorktreeStatus,
} from "../../worktree/resolve.js";
import type { WorktreeListEntry, WorktreeStatus } from "../../worktree/types.js";
import {
  printBanner,
  createSpinner,
  printBox,
  info,
  warn,
  error as logError,
} from "../shared/ui.js";

interface CleanupOptions {
  dryRun?: boolean;
  all?: boolean;
  yes?: boolean;
  filesOnly?: boolean;
}

interface Candidate {
  entry: WorktreeListEntry;
  managed: boolean;
  status: WorktreeStatus;
}

/** Normalise both Windows backslashes and POSIX forward slashes to `/` so
 * prefix comparisons work regardless of which form the path arrived in
 * (git porcelain emits `/`; process.cwd / path.join emit native). */
function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function isUnderManagedDir(worktreePath: string, mainRoot: string): boolean {
  const wt = toPosix(worktreePath);
  const root = toPosix(mainRoot);
  const prefix = root.endsWith("/") ? root : root + "/";
  return wt.startsWith(prefix + WORKTREES_DIR + "/");
}

function isCwdInside(worktreePath: string, cwd: string): boolean {
  const wt = toPosix(worktreePath);
  const c = toPosix(cwd);
  const prefix = wt.endsWith("/") ? wt : wt + "/";
  return c === wt || c.startsWith(prefix);
}

function shortPath(p: string, mainRoot: string): string {
  if (p === mainRoot) return ".";
  const pp = toPosix(p);
  const root = toPosix(mainRoot);
  const prefix = root.endsWith("/") ? root : root + "/";
  return pp.startsWith(prefix) ? pp.slice(prefix.length) : p;
}

function statusBadge(s: WorktreeStatus): string {
  const parts: string[] = [];
  if (s.modified) parts.push(`${s.modified} modified`);
  if (s.untracked) parts.push(`${s.untracked} untracked`);
  if (s.stashes) parts.push(`${s.stashes} stash${s.stashes === 1 ? "" : "es"}`);
  return parts.length === 0 ? chalk.dim("clean") : chalk.yellow(parts.join(", "));
}

function partition(
  worktrees: WorktreeListEntry[],
  mainRoot: string,
): {
  main: WorktreeListEntry | null;
  managed: Candidate[];
  other: Candidate[];
  locked: WorktreeListEntry[];
  prunable: WorktreeListEntry[];
} {
  let main: WorktreeListEntry | null = null;
  const managed: Candidate[] = [];
  const other: Candidate[] = [];
  const locked: WorktreeListEntry[] = [];
  const prunable: WorktreeListEntry[] = [];

  for (const w of worktrees) {
    if (w.path === mainRoot) {
      main = w;
      continue;
    }
    if (w.locked) {
      locked.push(w);
      continue;
    }
    if (w.prunable) {
      prunable.push(w);
      continue;
    }
    const status = getWorktreeStatus(w.path);
    if (isUnderManagedDir(w.path, mainRoot)) {
      managed.push({ entry: w, managed: true, status });
    } else {
      other.push({ entry: w, managed: false, status });
    }
  }
  return { main, managed, other, locked, prunable };
}

function renderInventory(
  mainRoot: string,
  partitioned: ReturnType<typeof partition>,
): string[] {
  const lines: string[] = [];
  if (partitioned.managed.length) {
    lines.push(chalk.bold(`Hatch3r-managed worktrees (${WORKTREES_DIR}/):`));
    for (const c of partitioned.managed) {
      lines.push(`  ${chalk.green("●")} ${shortPath(c.entry.path, mainRoot)}  ${chalk.dim(c.entry.branch ?? "")}  ${statusBadge(c.status)}`);
    }
  }
  if (partitioned.other.length) {
    lines.push(chalk.bold("Other worktrees (not under .worktrees/):"));
    for (const c of partitioned.other) {
      lines.push(`  ${chalk.dim("○")} ${chalk.dim(c.entry.path)}  ${chalk.dim(c.entry.branch ?? "")}  ${statusBadge(c.status)}`);
    }
  }
  if (partitioned.locked.length) {
    lines.push(chalk.bold("Locked (skip — `git worktree unlock` first):"));
    for (const w of partitioned.locked) {
      lines.push(`  ${chalk.yellow("◆")} ${chalk.dim(w.path)}  ${chalk.dim(w.branch ?? "")}`);
    }
  }
  if (partitioned.prunable.length) {
    lines.push(chalk.bold("Prunable (stale — will run `git worktree prune`):"));
    for (const w of partitioned.prunable) {
      lines.push(`  ${chalk.magenta("✂")} ${chalk.dim(w.path)}  ${chalk.dim(w.branch ?? "")}`);
    }
  }
  return lines;
}

interface SelectableChoice {
  name: string;
  value: string;
  short: string;
}

function buildChoices(partitioned: ReturnType<typeof partition>, mainRoot: string): SelectableChoice[] {
  const out: SelectableChoice[] = [];
  for (const c of partitioned.managed) {
    out.push({
      name: `${shortPath(c.entry.path, mainRoot)}  ${chalk.dim(c.entry.branch ?? "")}  ${statusBadge(c.status)}`,
      value: c.entry.path,
      short: shortPath(c.entry.path, mainRoot),
    });
  }
  for (const c of partitioned.other) {
    out.push({
      name: `${chalk.dim(c.entry.path)}  ${chalk.dim(c.entry.branch ?? "")}  ${statusBadge(c.status)} ${chalk.dim("(not in .worktrees/)")}`,
      value: c.entry.path,
      short: c.entry.path,
    });
  }
  return out;
}

async function selectWorktrees(
  partitioned: ReturnType<typeof partition>,
  mainRoot: string,
  opts: CleanupOptions,
): Promise<{ paths: string[]; cancelled: boolean }> {
  const allCandidates = [...partitioned.managed, ...partitioned.other];
  if (allCandidates.length === 0) return { paths: [], cancelled: false };

  if (opts.all || opts.yes) {
    return { paths: allCandidates.map((c) => c.entry.path), cancelled: false };
  }

  const { mode } = await inquirer.prompt<{ mode: "all" | "specific" | "cancel" }>([
    {
      type: "list",
      name: "mode",
      message: `Clean ${allCandidates.length} worktree(s)?`,
      default: "specific",
      choices: [
        { name: `Pick specific (recommended)`, value: "specific" },
        { name: `Clean all ${allCandidates.length}`, value: "all" },
        { name: `Cancel`, value: "cancel" },
      ],
    },
  ]);
  if (mode === "cancel") return { paths: [], cancelled: true };
  if (mode === "all") return { paths: allCandidates.map((c) => c.entry.path), cancelled: false };

  const { picks } = await inquirer.prompt<{ picks: string[] }>([
    {
      type: "checkbox",
      name: "picks",
      message: "Select worktrees to clean",
      choices: buildChoices(partitioned, mainRoot),
    },
  ]);
  return { paths: picks, cancelled: false };
}

async function confirmDirty(
  selected: string[],
  partitioned: ReturnType<typeof partition>,
  mainRoot: string,
  opts: CleanupOptions,
): Promise<boolean> {
  if (opts.yes) return true;
  const lookup = new Map<string, Candidate>();
  for (const c of [...partitioned.managed, ...partitioned.other]) lookup.set(c.entry.path, c);
  const dirty = selected
    .map((p) => lookup.get(p))
    .filter((c): c is Candidate => !!c && (c.status.modified > 0 || c.status.untracked > 0 || c.status.stashes > 0));
  if (dirty.length === 0) return true;

  printBox(
    "Uncommitted work in selected worktrees",
    [
      chalk.yellow.bold("These worktrees have local changes that will be DESTROYED:"),
      "",
      ...dirty.map((c) => `  ${chalk.yellow("⚠")} ${shortPath(c.entry.path, mainRoot)}  ${statusBadge(c.status)}`),
      "",
      chalk.dim("`git worktree remove --force` is required because adapter sync mutates copied files."),
    ],
    "error",
  );

  if (!process.stdin.isTTY) {
    warn("Non-interactive session detected — proceeding. Pass --yes to silence this notice.");
    return true;
  }
  const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
    {
      type: "confirm",
      name: "proceed",
      message: `Destroy uncommitted work in ${dirty.length} worktree(s)?`,
      default: false,
    },
  ]);
  return proceed;
}

async function performCleanup(
  mainRoot: string,
  selected: string[],
  partitioned: ReturnType<typeof partition>,
  opts: CleanupOptions,
): Promise<{ cleaned: string[]; failed: { path: string; reason: string }[] }> {
  const cleaned: string[] = [];
  const failed: { path: string; reason: string }[] = [];

  // Always run prune for prunable entries — it costs nothing and clears stale state.
  if (partitioned.prunable.length > 0 && !opts.dryRun) {
    try {
      removeGitWorktree(mainRoot, "", { prune: true });
    } catch (err) {
      warn(`git worktree prune failed: ${(err as Error).message}`);
    }
  }

  for (const path of selected) {
    if (opts.dryRun) {
      info(`would clean ${shortPath(path, mainRoot)}${opts.filesOnly ? "" : " + git worktree remove"}`);
      cleaned.push(path);
      continue;
    }
    try {
      await cleanupWorktree(path);
      if (!opts.filesOnly) {
        removeGitWorktree(mainRoot, path, { force: true });
      }
      cleaned.push(path);
    } catch (err) {
      failed.push({ path, reason: (err as Error).message });
    }
  }
  return { cleaned, failed };
}

export async function worktreeCleanupCommand(
  opts: CleanupOptions = {},
): Promise<void> {
  printBanner(true);

  const cwd = process.cwd();
  const mainRoot = isInsideWorktree(cwd) ? findMainWorktree(cwd) : cwd;

  let worktrees: WorktreeListEntry[];
  try {
    worktrees = listWorktrees(mainRoot);
  } catch (err) {
    logError((err as Error).message);
    throw err;
  }

  const partitioned = partition(worktrees, mainRoot);
  const allCandidates = [...partitioned.managed, ...partitioned.other];

  // Refuse if cwd is inside any candidate — git worktree remove would fail and
  // the user's shell would be left pointing at a destroyed directory.
  for (const c of allCandidates) {
    if (isCwdInside(c.entry.path, cwd)) {
      logError(`You are inside ${shortPath(c.entry.path, mainRoot)}; cd out of it first.`);
      console.log(chalk.dim(`  Try: cd ${mainRoot}\n`));
      throw new HatchError("cwd is inside a candidate worktree", 1, "VALIDATION_ERROR");
    }
  }

  if (allCandidates.length === 0 && partitioned.prunable.length === 0) {
    info(`No hatch3r worktrees found in ${chalk.dim(mainRoot)}.`);
    return;
  }

  printBox("Worktree inventory", renderInventory(mainRoot, partitioned), "info");

  const selection = await selectWorktrees(partitioned, mainRoot, opts);
  if (selection.cancelled) {
    info("Cancelled. No worktrees removed.");
    return;
  }
  if (selection.paths.length === 0 && partitioned.prunable.length === 0) {
    info("No worktrees selected.");
    return;
  }

  if (selection.paths.length > 0) {
    const ok = await confirmDirty(selection.paths, partitioned, mainRoot, opts);
    if (!ok) {
      info("Cancelled. No worktrees removed.");
      return;
    }
  }

  const s = createSpinner(opts.dryRun ? "Previewing cleanup..." : "Cleaning worktrees...");
  s.start();
  const result = await performCleanup(mainRoot, selection.paths, partitioned, opts);
  s.succeed(opts.dryRun ? "Cleanup preview complete" : "Cleanup complete");

  const lines: string[] = [];
  if (result.cleaned.length > 0) {
    lines.push(chalk.bold(opts.dryRun ? "Would clean:" : "Cleaned:"));
    for (const p of result.cleaned) {
      lines.push(`  ${chalk.green("✓")} ${shortPath(p, mainRoot)}`);
    }
  }
  if (partitioned.prunable.length > 0 && !opts.dryRun) {
    lines.push("", chalk.dim(`Pruned ${partitioned.prunable.length} stale worktree record(s).`));
  }
  if (result.failed.length > 0) {
    lines.push("", chalk.bold.red("Failed:"));
    for (const f of result.failed) {
      lines.push(`  ${chalk.red("✗")} ${shortPath(f.path, mainRoot)}: ${f.reason}`);
    }
  }
  if (!opts.filesOnly && result.cleaned.length > 0 && !opts.dryRun) {
    lines.push("", chalk.dim("Branches preserved. To delete, run: git branch -D <name>"));
  }
  printBox("Worktree cleanup", lines.length ? lines : [chalk.dim("Nothing changed.")], result.failed.length ? "error" : "success");

  if (result.failed.length > 0) {
    throw new HatchError(`${result.failed.length} worktree(s) failed to clean.`, 1, "FS_ERROR");
  }
}
