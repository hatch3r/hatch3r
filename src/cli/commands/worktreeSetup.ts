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
  WORKTREES_DIR,
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
}

async function readIncludeOrThrow(mainRoot: string): Promise<string> {
  const includePath = join(mainRoot, WORKTREE_INCLUDE_FILE);
  try {
    return await readFile(includePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logError(`No ${WORKTREE_INCLUDE_FILE} found in ${mainRoot}`);
      console.log(chalk.dim("  Run `hatch3r init` or `hatch3r sync` to generate it.\n"));
      throw new HatchError(`Missing ${WORKTREE_INCLUDE_FILE}`, 1, "FS_ERROR");
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

function printDryRun(
  includeContent: string,
  mainRoot: string,
  targetRoot: string,
  mode: "name" | "from-path",
  name?: string,
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
    header.push(label("Action", `git worktree add -b ${name} <target>`));
  }
  header.push(label("Entries", `${entries.length}`), "");
  printBox("Worktree setup (dry run)", [...header, ...summaryLines], "info");
}

function syncWorktree(targetRoot: string): { ok: boolean; output: string } {
  try {
    const out = execFileSync("npx", ["hatch3r", "sync"], {
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

function printSetupSuccessBox(
  targetRoot: string,
  result: { copied: string[]; symlinked: string[]; skipped: string[]; errors: string[] },
  syncOk: boolean,
  syncOutput: string,
  clipboardTool: string | null,
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
    if (result.skipped.length) lines.push(`  ${chalk.dim("·")} skipped: ${result.skipped.length}`);
  }
  if (!syncOk) {
    lines.push(
      "",
      chalk.yellow.bold("Adapter output sync FAILED inside the worktree."),
      chalk.yellow("  Run `hatch3r sync` inside the worktree before starting work."),
      ...(syncOutput ? [chalk.dim(`  ${syncOutput.split("\n").slice(0, 5).join("\n  ")}`)] : []),
    );
  }
  printBox("Worktree setup", lines, syncOk ? "success" : "error");
}

// ─── Mode 1: --from-path (legacy hook flow) ──────────────────────────────────

async function runFromPath(targetPath: string, opts: SetupOptions): Promise<void> {
  const mainRoot = opts.from ?? (isInsideWorktree(targetPath) ? findMainWorktree(targetPath) : process.cwd());
  if (!(await pathExists(targetPath))) {
    logError(`--from-path target does not exist: ${targetPath}`);
    console.log(chalk.dim("  Did you run `git worktree add` first?\n"));
    throw new HatchError("from-path target missing", 1, "FS_ERROR");
  }

  const includeContent = await readIncludeOrThrow(mainRoot);
  await confirmSecretsOrAbort(includeContent, mainRoot, targetPath, opts);

  if (opts.dryRun) {
    printDryRun(includeContent, mainRoot, targetPath, "from-path");
    return;
  }

  const s = createSpinner("Populating worktree files...");
  s.start();
  const result = await setupWorktree(mainRoot, targetPath, { force: opts.force });
  s.succeed("Worktree files populated");

  for (const e of result.errors) warn(e);

  const sync = syncWorktree(targetPath);
  const cdLine = `cd ${targetPath}`;
  const tool = copyToClipboard(cdLine);
  printSetupSuccessBox(targetPath, result, sync.ok, sync.output, tool);

  if (!sync.ok) {
    throw new HatchError("Adapter sync failed inside the new worktree.", 1, "FS_ERROR");
  }
}

// ─── Mode 2: <name> (new full flow) ──────────────────────────────────────────

async function runByName(name: string, opts: SetupOptions): Promise<void> {
  const cwd = process.cwd();
  const mainRoot = opts.from ?? (isInsideWorktree(cwd) ? findMainWorktree(cwd) : cwd);

  if (!isValidBranchName(name)) {
    logError(`Invalid worktree name: '${name}'`);
    console.log(chalk.dim("  Names must be valid git branch names (no spaces, no '..', no leading '-').\n"));
    throw new HatchError("Invalid worktree name", 1, "VALIDATION_ERROR");
  }

  const targetRoot = join(mainRoot, WORKTREES_DIR, name);

  if (await pathExists(targetRoot)) {
    logError(`Target path already exists: ${targetRoot}`);
    console.log(chalk.dim("  Pick a different name, or run `hatch3r worktree-cleanup` to remove the existing worktree first.\n"));
    throw new HatchError("Target path exists", 1, "FS_ERROR");
  }

  const includeContent = await readIncludeOrThrow(mainRoot);
  await confirmSecretsOrAbort(includeContent, mainRoot, targetRoot, opts);

  if (opts.dryRun) {
    printDryRun(includeContent, mainRoot, targetRoot, "name", name);
    return;
  }

  // Per-clone gitignore so .worktrees/ doesn't appear in the main repo's
  // `git status`. No tracked file change, no PR diff.
  const added = await ensureWorktreesIgnored(mainRoot);
  if (added) info(`Added ${WORKTREES_DIR}/ to ${chalk.dim(".git/info/exclude")} (per-clone)`);

  const sCreate = createSpinner(`Creating worktree on new branch '${name}'...`);
  sCreate.start();
  try {
    addGitWorktree(mainRoot, name, targetRoot);
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
  printSetupSuccessBox(targetRoot, result, sync.ok, sync.output, tool);

  if (!sync.ok) {
    throw new HatchError("Adapter sync failed inside the new worktree.", 1, "FS_ERROR");
  }
}

// ─── Entry ───────────────────────────────────────────────────────────────────

export async function worktreeSetupCommand(
  nameOrUndefined?: string,
  opts: SetupOptions = {},
): Promise<void> {
  printBanner(true);

  if (opts.fromPath) {
    if (nameOrUndefined) {
      warn("Both <name> positional and --from-path supplied; using --from-path.");
    }
    return runFromPath(opts.fromPath, opts);
  }

  if (!nameOrUndefined) {
    logError("Worktree name is required.");
    console.log(chalk.dim("  Usage: hatch3r worktree-setup <name>"));
    console.log(chalk.dim("         hatch3r worktree-setup --from-path <existing-worktree-path>\n"));
    throw new HatchError("Missing worktree name", 1, "VALIDATION_ERROR");
  }

  return runByName(nameOrUndefined, opts);
}
