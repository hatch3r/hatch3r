import { realpathSync } from "node:fs";
import chalk from "chalk";
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
  askCheckbox,
  askConfirm,
  askSelect,
  isBack,
  runStepMachine,
  type Step,
  type StepResult,
} from "../shared/initSteps.js";
import {
  createSpinner,
  printBox,
  info,
  warn,
  error as logError,
} from "../shared/ui.js";
import { beginCommand, finishCommand } from "../shared/commandOutput.js";
import { enableDefaultCrossProcessLocking } from "../../merge/safeWrite.js";

interface CleanupOptions {
  dryRun?: boolean;
  all?: boolean;
  yes?: boolean;
  filesOnly?: boolean;
  /** W5: `--format <human|json>`; json valid only with --yes or --all. */
  format?: string;
  /** W5: `--quiet`: suppress stdout chrome (banner, spinner, boxes). */
  quiet?: boolean;
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

type CleanupMode = "all" | "specific" | "cancel";

interface CleanupFlowState {
  mode: CleanupMode;
  picks: string[];
  proceed: boolean;
}

/**
 * Compute which selected paths have uncommitted work. Returned dirty list
 * drives the `proceed` step's skip predicate and the warning printBox.
 */
function findDirty(
  selected: string[],
  partitioned: ReturnType<typeof partition>,
): Candidate[] {
  const lookup = new Map<string, Candidate>();
  for (const c of [...partitioned.managed, ...partitioned.other]) lookup.set(c.entry.path, c);
  return selected
    .map((p) => lookup.get(p))
    .filter((c): c is Candidate =>
      !!c && (c.status.modified > 0 || c.status.untracked > 0),
    );
}

/**
 * Resolve the effective selection of paths to clean for the current state.
 * `all` mode pulls every candidate; `specific` uses the user-picked set;
 * `cancel` returns empty (caller short-circuits).
 */
function resolveSelected(
  state: Partial<CleanupFlowState>,
  partitioned: ReturnType<typeof partition>,
): string[] {
  if (state.mode === "all") {
    return [...partitioned.managed, ...partitioned.other].map((c) => c.entry.path);
  }
  if (state.mode === "specific") {
    return state.picks ?? [];
  }
  return [];
}

/**
 * Run the 3-prompt interactive flow (mode → picks → proceed) through the
 * step-machine so Shift+Tab walks back across the chain. Each step's run()
 * routes the BACK sentinel via isBack() — no answer is consumed as a
 * string/array/boolean before the sentinel check.
 *
 * Steps:
 *   - mode    : pick "all" / "specific" / "cancel"
 *   - picks   : checkbox of candidate worktrees (skipped unless mode === "specific")
 *   - proceed : confirm destruction of uncommitted work
 *               (skipped when no selection is dirty or mode === "cancel")
 */
async function runInteractiveFlow(
  partitioned: ReturnType<typeof partition>,
  mainRoot: string,
): Promise<{ paths: string[]; cancelled: boolean }> {
  const allCandidates = [...partitioned.managed, ...partitioned.other];

  const steps: Array<Step<CleanupFlowState>> = [
    {
      id: "mode",
      async run(_state, previous): Promise<StepResult<CleanupMode>> {
        return await askSelect<CleanupMode>({
          name: "mode",
          message: `Clean ${allCandidates.length} worktree(s)?`,
          choices: [
            { name: `Pick specific (recommended)`, value: "specific" },
            { name: `Clean all ${allCandidates.length}`, value: "all" },
            { name: `Cancel`, value: "cancel" },
          ],
          default: previous ?? "specific",
        });
      },
    },
    {
      id: "picks",
      skip: (s) => s.mode !== "specific",
      async run(_state, previous): Promise<StepResult<string[]>> {
        return await askCheckbox<string>({
          name: "picks",
          message: "Select worktrees to clean",
          choices: buildChoices(partitioned, mainRoot),
          default: previous,
        });
      },
    },
    {
      id: "proceed",
      skip: (s) => {
        if (s.mode === "cancel") return true;
        const selected = resolveSelected(s, partitioned);
        if (selected.length === 0) return true;
        return findDirty(selected, partitioned).length === 0;
      },
      async run(state): Promise<StepResult<boolean>> {
        const selected = resolveSelected(state, partitioned);
        const dirty = findDirty(selected, partitioned);

        printBox(
          "Uncommitted work in selected worktrees",
          [
            chalk.yellow.bold("These worktrees have local changes that will be DESTROYED:"),
            "",
            ...dirty.map(
              (c) =>
                `  ${chalk.yellow("⚠")} ${shortPath(c.entry.path, mainRoot)}  ${statusBadge(c.status)}`,
            ),
            "",
            chalk.dim(
              "`git worktree remove --force` is required because adapter sync mutates copied files.",
            ),
          ],
          "error",
        );

        // Preserve the legacy non-TTY fallback: when stdin is not a TTY the
        // confirm prompt has no way to render, so auto-proceed with a notice
        // (same behavior as the pre-refactor confirmDirty fall-through).
        if (!process.stdin.isTTY) {
          warn("Non-interactive session detected — proceeding. Pass --yes to silence this notice.");
          return true;
        }

        return await askConfirm({
          name: "proceed",
          message: `Destroy uncommitted work in ${dirty.length} worktree(s)?`,
          default: false,
        });
      },
    },
  ];

  const result = await runStepMachine<CleanupFlowState>(steps);

  // Defensive: the step-machine sets each completed slot via assignment, but
  // skipped steps deliberately leave their slot `undefined`. Route every
  // consumer through the typed accessors below so no raw answer (which might
  // be the BACK sentinel if the prompt somehow leaked it) ever reaches a
  // string/array/boolean method call.
  if (isBack(result.mode)) return { paths: [], cancelled: true };
  if (result.mode === "cancel") return { paths: [], cancelled: true };

  const paths = resolveSelected(result, partitioned);
  if (paths.length === 0) return { paths: [], cancelled: false };

  // proceed step was skipped (no dirty work) → safe to clean.
  // proceed step ran → honour user's confirm answer.
  const dirty = findDirty(paths, partitioned);
  if (dirty.length === 0) return { paths, cancelled: false };

  if (isBack(result.proceed)) return { paths: [], cancelled: true };
  if (result.proceed !== true) return { paths: [], cancelled: true };
  return { paths, cancelled: false };
}

async function selectWorktrees(
  partitioned: ReturnType<typeof partition>,
  mainRoot: string,
  opts: CleanupOptions,
): Promise<{ paths: string[]; cancelled: boolean }> {
  const allCandidates = [...partitioned.managed, ...partitioned.other];
  if (allCandidates.length === 0) return { paths: [], cancelled: false };

  // Non-interactive short-circuit: --all and --yes bypass the prompt chain
  // (mode + picks + proceed) and confirm-dirty entirely.
  if (opts.all || opts.yes) {
    return { paths: allCandidates.map((c) => c.entry.path), cancelled: false };
  }

  return await runInteractiveFlow(partitioned, mainRoot);
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
  // W5: per-invocation interactivity — `--all` (like `--yes`) bypasses every
  // prompt, so json is valid with either; otherwise the selection prompts
  // would interleave with the single JSON document.
  const format = beginCommand(opts, {
    banner: "compact",
    interactive: opts.all !== true && opts.yes !== true,
  });

  // D8-M3: worktree cleanup races the main repo's `.hatch3r/` writes during
  // partial-cleanup rollback. Default-on cross-process locking serializes the
  // window without forcing operators to discover `HATCH3R_LOCK=1`. Set
  // `HATCH3R_LOCK=0` to opt out.
  enableDefaultCrossProcessLocking();

  const cwd = process.cwd();
  // D1-13 (Cycle 11 Wave 2, D1, P1/CQ4): canonicalize the main-repo root on BOTH
  // branches. `findMainWorktree` already returns a `realpathSync.native`-resolved
  // path (worktree/resolve.ts), and `listWorktrees` runs the same canonicalizer on
  // every `git worktree list --porcelain` path. The not-inside-worktree branch
  // previously returned a bare `process.cwd()`: on macOS (`/var` → `/private/var`)
  // and Windows (8.3 short form → long form) that raw path does not byte-match the
  // canonicalized entry git emits for the same directory, so `partition()` never
  // hit the `w.path === mainRoot` arm and the main repo was mis-bucketed as a
  // cleanable candidate. Canonicalize here so the comparison holds. Best-effort:
  // fall back to the raw cwd when realpath throws (deleted/permission-denied cwd),
  // matching the listWorktrees prunable-path fallback.
  let mainRoot: string;
  if (isInsideWorktree(cwd)) {
    mainRoot = findMainWorktree(cwd);
  } else {
    try {
      mainRoot = realpathSync.native(cwd);
    } catch {
      mainRoot = cwd;
    }
  }

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
      throw new HatchError(
        "cwd is inside a candidate worktree",
        undefined,
        "VALIDATION_ERROR",
        `cd to the main repo (${mainRoot}) and re-run the cleanup.`,
      );
    }
  }

  if (allCandidates.length === 0 && partitioned.prunable.length === 0) {
    if (format === "json") {
      finishCommand(format, {
        command: "worktree-cleanup",
        title: "Worktree cleanup",
        lines: [],
        style: "info",
        json: { cleaned: [], failed: [], message: "no hatch3r worktrees found" },
      });
    } else {
      info(`No hatch3r worktrees found in ${chalk.dim(mainRoot)}.`);
    }
    return;
  }

  printBox("Worktree inventory", renderInventory(mainRoot, partitioned), "info");

  const selection = await selectWorktrees(partitioned, mainRoot, opts);
  if (selection.cancelled) {
    info("Cancelled. No worktrees removed.");
    return;
  }
  if (selection.paths.length === 0 && partitioned.prunable.length === 0) {
    if (format === "json") {
      finishCommand(format, {
        command: "worktree-cleanup",
        title: "Worktree cleanup",
        lines: [],
        style: "info",
        json: { cleaned: [], failed: [], message: "no worktrees selected" },
      });
    } else {
      info("No worktrees selected.");
    }
    return;
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
  // W5: ending routes through finishCommand (same "Worktree cleanup" title);
  // the next-step fires only on a live removal that actually detached a
  // worktree (not dry-run, not --files-only, nothing failed).
  finishCommand(format, {
    command: "worktree-cleanup",
    title: "Worktree cleanup",
    lines: lines.length ? lines : [chalk.dim("Nothing changed.")],
    style: result.failed.length ? "error" : "success",
    nextSteps:
      result.failed.length === 0 && !opts.dryRun && !opts.filesOnly && result.cleaned.length > 0
        ? ["Run `git worktree list` to confirm removal."]
        : undefined,
    json: {
      cleaned: result.cleaned,
      failed: result.failed,
      pruned: partitioned.prunable.length,
      dryRun: !!opts.dryRun,
      filesOnly: !!opts.filesOnly,
    },
  });

  if (result.failed.length > 0) {
    throw new HatchError(
      `${result.failed.length} worktree(s) failed to clean.`,
      undefined,
      "FS_ERROR",
      "Resolve the per-worktree reasons listed above (e.g. uncommitted changes), then re-run the cleanup.",
    );
  }
}
