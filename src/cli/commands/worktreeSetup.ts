import { join } from "node:path";
import { readFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import inquirer from "inquirer";
import {
  WORKTREE_INCLUDE_FILE,
  HatchError,
} from "../../types.js";
import {
  setupWorktree,
  parseWorktreeInclude,
  addGitWorktree,
  ensureWorktreesIgnored,
  isValidBranchName,
  resolveWorktreeBranchPlan,
  WORKTREES_DIR,
} from "../../worktree/index.js";
import {
  isInsideWorktree,
  findMainWorktree,
} from "../../worktree/resolve.js";
import type {
  WorktreeBranchPlan,
  WorktreeSkipReason,
  WorktreeSkippedEntry,
} from "../../worktree/types.js";
import {
  createSpinner,
  printBox,
  error as logError,
  info,
  warn,
  label,
} from "../shared/ui.js";
import { beginCommand, finishCommand } from "../shared/commandOutput.js";
import type { CliOutputFormat } from "../shared/output.js";
import { copyToClipboard } from "../shared/clipboard.js";


/**
 * C8-D15-M2 (CWE-552, https://cwe.mitre.org/data/definitions/552.html):
 * When .env.mcp (or any .env.*) is scheduled to propagate into a worktree,
 * surface a prominent blast-radius warning before duplicating plaintext secrets.
 *
 * Blast radius concerns for ephemeral / shared worktrees:
 *   - Worktree paths shared across users (e.g. /tmp mounts, shared network drives,
 *     devcontainer volumes) expose copied secrets to every actor with read access.
 *   - .env.* uses "copy" strategy (src/worktree/index.ts), so credentials leave
 *     the main repo directory and must be cleaned up individually per worktree.
 *   - Ephemeral worktree farms (per-branch CI sandboxes, AI agent scratch dirs)
 *     multiply the exposure surface: N worktrees = N plaintext credential copies.
 */
async function detectSecretEnvFiles(
  root: string,
  entries: ReadonlyArray<{ pattern: string; strategy: "copy" | "symlink" }>,
): Promise<string[]> {
  const candidates = new Set<string>();
  for (const e of entries) {
    if (e.strategy !== "copy") continue;
    if (e.pattern === ".env" || e.pattern === ".env.mcp") {
      candidates.add(e.pattern);
    } else if (e.pattern === ".env.*") {
      candidates.add(".env.mcp");
    }
  }
  const present: string[] = [];
  for (const name of candidates) {
    const exists = await access(join(root, name))
      .then(() => true)
      .catch(() => false);
    if (exists) present.push(name);
  }
  return present.sort();
}

function printSecretPropagationWarning(
  files: string[],
  mainRoot: string,
  targetRoot: string,
): void {
  const fileList = files.map((f) => chalk.red.bold(f)).join(", ");
  printBox(
    "Secret propagation warning",
    [
      chalk.yellow.bold(`${fileList} will be copied into the worktree.`),
      "",
      `${chalk.bold("Source:")} ${chalk.dim(mainRoot)}`,
      `${chalk.bold("Target:")} ${chalk.dim(targetRoot)}`,
      "",
      chalk.bold("Blast radius (CWE-552):"),
      "  - Plaintext credentials leave the main repo and land in the worktree.",
      "  - Anyone with read access to the worktree path can read the secrets.",
      "  - Shared paths (/tmp mounts, network drives, devcontainer volumes) expose",
      "    secrets beyond your user account.",
      "  - Ephemeral worktree farms multiply the exposure: N worktrees = N copies.",
      "",
      chalk.bold("Before continuing:"),
      "  - Confirm the worktree path is private to you.",
      "  - Rotate credentials if the worktree was ever shared.",
      "  - Run `hatch3r worktree-cleanup` when finished to remove the copies.",
    ],
    "error",
  );
}

async function pathExists(p: string): Promise<boolean> {
  return access(p).then(() => true).catch(() => false);
}

interface SetupOptions {
  from?: string;
  dryRun?: boolean;
  force?: boolean;
  yes?: boolean;
  fromPath?: string;
  verbose?: boolean;
  /** W5: `--format <human|json>`; json valid only with --yes or --dry-run. */
  format?: string;
  /** W5: `--quiet`: suppress stdout chrome (banner, spinner, boxes). */
  quiet?: boolean;
  /**
   * release/2.8.0 attach mode: consent to reuse an existing branch <name>.
   * `true` (`--use-existing`) attaches/tracks without prompting; `false`
   * (`--no-use-existing`) refuses with a rename hint; `undefined` (no flag)
   * prompts on an interactive human-mode TTY and fails VALIDATION_ERROR
   * with the exact `--use-existing` rerun command everywhere else.
   */
  useExisting?: boolean;
}

async function readIncludeOrThrow(mainRoot: string): Promise<string> {
  const includePath = join(mainRoot, WORKTREE_INCLUDE_FILE);
  try {
    return await readFile(includePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logError(`No ${WORKTREE_INCLUDE_FILE} found in ${mainRoot}`);
      console.log(chalk.dim("  Run `hatch3r init` or `hatch3r sync` to generate it.\n"));
      throw new HatchError(
        `Missing ${WORKTREE_INCLUDE_FILE}`,
        undefined,
        "FS_ERROR",
        "Run `hatch3r init` or `hatch3r sync` to generate the worktree-include file.",
      );
    }
    throw err;
  }
}

async function confirmSecretsOrAbort(
  includeContent: string,
  mainRoot: string,
  targetRoot: string,
  opts: SetupOptions,
): Promise<void> {
  const parsedEntries = parseWorktreeInclude(includeContent);
  const secretFiles = await detectSecretEnvFiles(mainRoot, parsedEntries);
  if (secretFiles.length === 0) return;

  printSecretPropagationWarning(secretFiles, mainRoot, targetRoot);
  if (opts.dryRun || opts.yes) return;
  if (!process.stdin.isTTY) {
    warn("Non-interactive session detected — proceeding. Pass --yes to silence this notice.");
    return;
  }
  const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
    {
      type: "confirm",
      name: "proceed",
      message: "Copy secrets into this worktree?",
      default: false,
    },
  ]);
  if (!proceed) {
    info("Worktree setup cancelled. No files were copied.");
    throw new HatchError("Worktree setup cancelled by user.", 0);
  }
}

/**
 * release/2.8.0 attach mode: consent gate for reusing an existing branch.
 * No-op for a `create` plan. Consent tokens, in precedence order:
 * - `--no-use-existing` → VALIDATION_ERROR with a rename hint (never prompts).
 * - `--use-existing` → proceed without prompting (one info line).
 * - No flag + interactive human-mode TTY → one confirm prompt (default yes);
 *   decline → VALIDATION_ERROR with a rename hint.
 * - No flag + (non-TTY or json mode) → VALIDATION_ERROR whose recoveryHint
 *   names the exact `--use-existing` rerun command (json is a single-document
 *   stdout contract, so it never opens the prompt).
 */
async function confirmBranchPlanOrThrow(
  name: string,
  plan: WorktreeBranchPlan,
  opts: SetupOptions,
  format: CliOutputFormat,
): Promise<void> {
  if (plan.mode === "create") return;
  const state =
    plan.mode === "attach"
      ? `Branch '${name}' already exists locally`
      : `Branch '${name}' exists on origin but not locally`;
  const action =
    plan.mode === "attach"
      ? "attach it to the new worktree"
      : `create a local branch tracking origin/${name} in the new worktree`;

  if (opts.useExisting === false) {
    throw new HatchError(
      `${state}, and --no-use-existing refuses to reuse it.`,
      undefined,
      "VALIDATION_ERROR",
      `Pick a different worktree name (the branch is named after it), or drop --no-use-existing to ${action}.`,
    );
  }
  if (opts.useExisting === true) {
    info(`${state} — will ${action} (--use-existing).`);
    return;
  }
  if (!process.stdin.isTTY || format === "json") {
    throw new HatchError(
      `${state}. Reusing it needs explicit consent, and this session cannot prompt for it.`,
      undefined,
      "VALIDATION_ERROR",
      `Re-run with the consent flag: \`hatch3r worktree-setup ${name} --use-existing\` (or pick a different name).`,
    );
  }
  const { attachExisting } = await inquirer.prompt<{ attachExisting: boolean }>([
    {
      type: "confirm",
      name: "attachExisting",
      message:
        plan.mode === "attach"
          ? `Branch '${name}' exists — attach it to the new worktree?`
          : `Branch '${name}' exists on origin — create a local tracking branch in the new worktree?`,
      default: true,
    },
  ]);
  if (!attachExisting) {
    throw new HatchError(
      `${state}, and reusing it was declined.`,
      undefined,
      "VALIDATION_ERROR",
      `Pick a different worktree name (e.g. \`hatch3r worktree-setup ${name}-2\`) to create a fresh branch.`,
    );
  }
}

/**
 * Dry-run Action label: the exact `git worktree add` argv that WOULD run for
 * the resolved branch plan.
 */
function planActionArgv(name: string, mode: WorktreeBranchPlan["mode"]): string {
  if (mode === "attach") return `git worktree add <target> ${name}`;
  if (mode === "track") return `git worktree add --track -b ${name} <target> origin/${name}`;
  return `git worktree add -b ${name} <target>`;
}

/**
 * Dry-run Branch label: hyphenated plan id (kept as one word so boxen's
 * word-wrap never splits it) + reuse/consent note.
 */
function planBranchNote(name: string, mode: WorktreeBranchPlan["mode"]): string {
  if (mode === "attach") {
    return `attach-existing-local (reuses branch '${name}'; consent: --use-existing or prompt)`;
  }
  if (mode === "track") {
    return `track-remote-only (tracks origin/${name}; consent: --use-existing or prompt)`;
  }
  return "create-new (branches off HEAD)";
}

function printDryRun(
  includeContent: string,
  mainRoot: string,
  targetRoot: string,
  mode: "name" | "from-path",
  name?: string,
  plan?: WorktreeBranchPlan,
): void {
  const entries = parseWorktreeInclude(includeContent);
  const summaryLines = entries.map((e) => {
    const icon = e.strategy === "symlink" ? chalk.cyan("→") : chalk.green("+");
    return `  ${icon} ${e.pattern} ${chalk.dim(`(${e.strategy})`)}`;
  });
  const header: string[] = [
    label("Mode", mode === "name" ? `name (${name})` : "from-path (legacy)"),
    label("Source", mainRoot),
    label("Target", targetRoot),
  ];
  if (mode === "name") {
    const planMode = plan?.mode ?? "create";
    header.push(label("Action", planActionArgv(name ?? "", planMode)));
    header.push(label("Branch", planBranchNote(name ?? "", planMode)));
  }
  header.push(label("Entries", `${entries.length}`), "");
  printBox("Worktree setup (dry run)", [...header, ...summaryLines], "info");
}

/**
 * W5: json twin of {@link printDryRun} — one envelope document describing the
 * planned worktree population (mode, source/target, per-entry strategy).
 * `branchPlan` reports the resolved branch action (`create`/`attach`/`track`)
 * for name-mode previews; null in from-path mode (no branch is created there).
 */
function emitDryRunJson(
  format: CliOutputFormat,
  includeContent: string,
  mainRoot: string,
  targetRoot: string,
  mode: "name" | "from-path",
  name?: string,
  plan?: WorktreeBranchPlan,
): void {
  const entries = parseWorktreeInclude(includeContent);
  finishCommand(format, {
    command: "worktree-setup",
    title: "Worktree setup (dry run)",
    lines: [],
    style: "info",
    json: {
      dryRun: true,
      mode,
      name: name ?? null,
      branchPlan: mode === "name" ? (plan?.mode ?? "create") : null,
      source: mainRoot,
      target: targetRoot,
      entries: entries.map((e) => ({ pattern: e.pattern, strategy: e.strategy })),
    },
  });
}

/**
 * D1-SA1.10-04 (Cycle 12 Wave 3, D1, P1): spawn the RUNNING CLI directly —
 * `process.execPath` (the node binary) + `process.argv[1]` (this CLI's entry
 * script) — instead of `execFileSync("npx", ...)`. Two defects in the npx
 * form: (1) on native Windows the npx binary is `npx.cmd`, and .bat/.cmd
 * files cannot be launched via `execFile` without a shell (Node docs;
 * CVE-2024-27980 hardening), so every Windows `worktree-setup` run failed
 * the auto-sync step with FS_ERROR; (2) with `stdio: ["ignore", ...]` npx's
 * install prompt received EOF and aborted whenever hatch3r was not locally
 * resolvable, so even POSIX auto-sync silently depended on the npx cache.
 * Same-binary re-invocation has neither failure mode on any platform.
 */
function syncWorktree(targetRoot: string): { ok: boolean; output: string } {
  try {
    const out = execFileSync(process.execPath, [process.argv[1], "sync"], {
      cwd: targetRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output: out.toString() };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: Buffer; stdout?: Buffer };
    const merged = (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "");
    return { ok: false, output: merged.trim() || (err as Error).message };
  }
}

// F-1.10.12 (D1 cycle 10): human-readable label per skip reason for the
// `--verbose` breakdown. Keep in lock-step with the WorktreeSkipReason union
// in src/worktree/types.ts.
const SKIP_REASON_LABELS: Record<WorktreeSkipReason, string> = {
  exists: "already present (idempotent re-run)",
  "eexist-race": "concurrent write won the race (use --force to overwrite)",
};

function printSetupSuccessBox(
  format: CliOutputFormat,
  targetRoot: string,
  result: {
    copied: string[];
    symlinked: string[];
    skipped: string[];
    skippedDetails: WorktreeSkippedEntry[];
    errors: string[];
  },
  syncOk: boolean,
  syncOutput: string,
  clipboardTool: string | null,
  verbose = false,
): void {
  const cdLine = `cd ${targetRoot}`;
  const lines: string[] = [
    chalk.bold("Worktree ready:"),
    `  ${chalk.cyan(targetRoot)}`,
    "",
    chalk.bold("Get to work:"),
    `  ${chalk.green(cdLine)}${clipboardTool ? chalk.dim(`   (copied to clipboard via ${clipboardTool})`) : ""}`,
    "",
  ];
  if (result.copied.length || result.symlinked.length || result.skipped.length) {
    lines.push(chalk.bold("Files:"));
    if (result.copied.length) lines.push(`  ${chalk.green("+")} copied: ${result.copied.length}`);
    if (result.symlinked.length) lines.push(`  ${chalk.cyan("→")} symlinked: ${result.symlinked.length}`);
    if (result.skipped.length) {
      lines.push(`  ${chalk.dim("·")} skipped: ${result.skipped.length}`);
      // F-1.10.12: progressive disclosure — the bare count by default, the
      // per-reason breakdown (idempotent re-run vs TOCTOU race) under --verbose.
      if (verbose) {
        const byReason = new Map<WorktreeSkipReason, number>();
        for (const entry of result.skippedDetails) {
          byReason.set(entry.reason, (byReason.get(entry.reason) ?? 0) + 1);
        }
        for (const [reason, count] of byReason) {
          lines.push(`      ${chalk.dim("·")} ${count} ${SKIP_REASON_LABELS[reason]}`);
        }
      }
    }
  }
  if (!syncOk) {
    lines.push(
      "",
      chalk.yellow.bold("Adapter output sync FAILED inside the worktree."),
      chalk.yellow("  Run `hatch3r sync` inside the worktree before starting work."),
      ...(syncOutput ? [chalk.dim(`  ${syncOutput.split("\n").slice(0, 5).join("\n  ")}`)] : []),
    );
  }
  // W5: ending routes through finishCommand (same "Worktree setup" box title);
  // json emits one envelope; the next-step is success-only (the failure body
  // already carries the sync-repair guidance).
  finishCommand(format, {
    command: "worktree-setup",
    title: "Worktree setup",
    lines,
    style: syncOk ? "success" : "error",
    nextSteps: syncOk
      ? [`\`${cdLine}\` and start your agent — the worktree is ready.`]
      : undefined,
    json: {
      target: targetRoot,
      copied: result.copied.length,
      symlinked: result.symlinked.length,
      skipped: result.skipped.length,
      errors: result.errors,
      syncOk,
    },
  });
}

// ─── Mode 1: --from-path (legacy hook flow) ──────────────────────────────────

async function runFromPath(
  targetPath: string,
  opts: SetupOptions,
  format: CliOutputFormat,
): Promise<void> {
  const mainRoot = opts.from ?? (isInsideWorktree(targetPath) ? findMainWorktree(targetPath) : process.cwd());
  if (!(await pathExists(targetPath))) {
    logError(`--from-path target does not exist: ${targetPath}`);
    console.log(chalk.dim("  Did you run `git worktree add` first?\n"));
    throw new HatchError(
      "from-path target missing",
      undefined,
      "FS_ERROR",
      "Run `git worktree add <path>` first, then point --from-path at that path.",
    );
  }

  const includeContent = await readIncludeOrThrow(mainRoot);
  await confirmSecretsOrAbort(includeContent, mainRoot, targetPath, opts);

  if (opts.dryRun) {
    if (format === "json") {
      emitDryRunJson(format, includeContent, mainRoot, targetPath, "from-path");
    } else {
      printDryRun(includeContent, mainRoot, targetPath, "from-path");
    }
    return;
  }

  // release/2.8.6: from-path mode writes the setup receipt into the worktree
  // too (setupWorktree → writeWorktreeReceipt), so it needs the same per-clone
  // exclude entries as name mode — otherwise the receipt shows as untracked
  // and worktree-cleanup's dirty gate flags the fresh worktree. The
  // `.worktrees/` entry is a no-op safety net when the target lives elsewhere.
  // Skipped under --dry-run (early return above — no writes).
  const added = await ensureWorktreesIgnored(mainRoot);
  if (added) info(`Added ${WORKTREES_DIR}/ + worktree-receipt excludes to ${chalk.dim(".git/info/exclude")} (per-clone)`);

  const s = createSpinner("Populating worktree files...");
  s.start();
  const result = await setupWorktree(mainRoot, targetPath, { force: opts.force });
  s.succeed("Worktree files populated");

  for (const e of result.errors) warn(e);

  const sync = syncWorktree(targetPath);
  const cdLine = `cd ${targetPath}`;
  const tool = copyToClipboard(cdLine);
  printSetupSuccessBox(format, targetPath, result, sync.ok, sync.output, tool, opts.verbose);

  if (!sync.ok) {
    throw new HatchError(
      "Adapter sync failed inside the new worktree.",
      undefined,
      "FS_ERROR",
      "cd into the worktree and run `hatch3r sync --verbose` to see the adapter failure.",
    );
  }
}

// ─── Mode 2: <name> (new full flow) ──────────────────────────────────────────

async function runByName(
  name: string,
  opts: SetupOptions,
  format: CliOutputFormat,
): Promise<void> {
  const cwd = process.cwd();
  const mainRoot = opts.from ?? (isInsideWorktree(cwd) ? findMainWorktree(cwd) : cwd);

  if (!isValidBranchName(name)) {
    logError(`Invalid worktree name: '${name}'`);
    console.log(chalk.dim("  Names must be valid git branch names (no spaces, no '..', no leading '-').\n"));
    throw new HatchError(
      "Invalid worktree name",
      undefined,
      "VALIDATION_ERROR",
      "Use a valid git branch name (no spaces, no '..', no leading '-').",
    );
  }

  const targetRoot = join(mainRoot, WORKTREES_DIR, name);

  if (await pathExists(targetRoot)) {
    logError(`Target path already exists: ${targetRoot}`);
    console.log(chalk.dim("  Pick a different name, or run `hatch3r worktree-cleanup` to remove the existing worktree first.\n"));
    throw new HatchError(
      "Target path exists",
      undefined,
      "FS_ERROR",
      "Pick a different name, or run `hatch3r worktree-cleanup` to remove the existing worktree first.",
    );
  }

  // release/2.8.0 attach mode: resolve how the branch will be materialized
  // BEFORE creating anything. Real runs may fetch origin/<name> (transport
  // failure → NETWORK_ERROR, exit 75); --dry-run stays offline (allowFetch:
  // false) and derives the plan from local refs only.
  const plan = resolveWorktreeBranchPlan(mainRoot, name, {
    allowFetch: opts.dryRun !== true,
  });
  if (opts.dryRun !== true) {
    await confirmBranchPlanOrThrow(name, plan, opts, format);
  }

  const includeContent = await readIncludeOrThrow(mainRoot);
  await confirmSecretsOrAbort(includeContent, mainRoot, targetRoot, opts);

  if (opts.dryRun) {
    if (format === "json") {
      emitDryRunJson(format, includeContent, mainRoot, targetRoot, "name", name, plan);
    } else {
      printDryRun(includeContent, mainRoot, targetRoot, "name", name, plan);
    }
    return;
  }

  // Per-clone exclude entries (.git/info/exclude is untracked — no PR diff):
  // `.worktrees/` keeps the farm out of the main repo's `git status`, and the
  // setup-receipt line keeps `.hatch3r/worktree-receipt.json` out of every
  // linked worktree's status (info/exclude lives in the shared common dir;
  // patterns match relative to each worktree's own root). The durable
  // committed twin is src/env/mcpEnv.ts::REQUIRED_GITIGNORE_ENTRIES.
  const added = await ensureWorktreesIgnored(mainRoot);
  if (added) info(`Added ${WORKTREES_DIR}/ + worktree-receipt excludes to ${chalk.dim(".git/info/exclude")} (per-clone)`);

  const spinnerText =
    plan.mode === "attach"
      ? `Attaching existing branch '${name}' to a new worktree...`
      : plan.mode === "track"
        ? `Creating worktree tracking origin/${name}...`
        : `Creating worktree on new branch '${name}'...`;
  const sCreate = createSpinner(spinnerText);
  sCreate.start();
  try {
    addGitWorktree(mainRoot, name, targetRoot, { mode: plan.mode });
    sCreate.succeed(`Created worktree: ${chalk.dim(targetRoot)}`);
  } catch (err) {
    sCreate.fail("git worktree add failed");
    throw err;
  }

  const sPop = createSpinner("Populating worktree files...");
  sPop.start();
  const result = await setupWorktree(mainRoot, targetRoot, { force: opts.force });
  sPop.succeed("Worktree files populated");

  for (const e of result.errors) warn(e);

  const sync = syncWorktree(targetRoot);
  const cdLine = `cd ${targetRoot}`;
  const tool = copyToClipboard(cdLine);
  printSetupSuccessBox(format, targetRoot, result, sync.ok, sync.output, tool, opts.verbose);

  if (!sync.ok) {
    throw new HatchError(
      "Adapter sync failed inside the new worktree.",
      undefined,
      "FS_ERROR",
      "cd into the worktree and run `hatch3r sync --verbose` to see the adapter failure.",
    );
  }
}

// ─── Entry ───────────────────────────────────────────────────────────────────

export async function worktreeSetupCommand(
  nameOrUndefined?: string,
  opts: SetupOptions = {},
): Promise<void> {
  // W5: per-invocation interactivity — the secret-propagation confirm can
  // prompt unless --yes or --dry-run, so `--format json` requires one of them
  // (beginCommand's gate keys on --yes; --dry-run flips interactive off here).
  const format = beginCommand(opts, {
    banner: "compact",
    interactive: opts.dryRun !== true,
  });

  // DD-A3 (release/2.8.5): the D8-M3 `enableDefaultCrossProcessLocking()`
  // call that lived here is gone — cross-process locking is default-on
  // process-wide (src/merge/safeWrite.ts::isLockingEnabled), so the worktree
  // silent-clobber window (CHANGELOG #73) is closed without a per-command
  // enable. Opt-outs: `hatch3r --no-lock worktree-setup` or HATCH3R_LOCK=0.

  if (opts.fromPath) {
    if (nameOrUndefined) {
      warn("Both <name> positional and --from-path supplied; using --from-path.");
    }
    return runFromPath(opts.fromPath, opts, format);
  }

  if (!nameOrUndefined) {
    logError("Worktree name is required.");
    console.log(chalk.dim("  Usage: hatch3r worktree-setup <name>"));
    console.log(chalk.dim("         hatch3r worktree-setup --from-path <existing-worktree-path>\n"));
    throw new HatchError(
      "Missing worktree name",
      undefined,
      "VALIDATION_ERROR",
      "Provide a name: `hatch3r worktree-setup <name>` (or use --from-path <path>).",
    );
  }

  return runByName(nameOrUndefined, opts, format);
}
