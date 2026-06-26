import { execFileSync } from "node:child_process";
import { access, mkdir, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import { HatchError } from "../../types.js";
import { beginCommand, finishCommand } from "../shared/commandOutput.js";
import { info, verbose, warn } from "../shared/ui.js";
import { initCommand } from "./init.js";

/**
 * `hatch3r setup [dir]` — scaffold a fresh project directory (mkdir + git init,
 * optional GitHub remote) and then chain into the standard `hatch3r init`
 * prompting flow inside that directory. This is a regular CLI command (like
 * `init` / `sync`), NOT a canonical `commands/hatch3r-*.md` content artifact.
 *
 * The happy path needs only Node 22+ and `git` — `--remote` (GitHub remote via
 * `gh repo create`) is opt-in and degrades to a warning (never aborts the
 * scaffold) when the GitHub CLI is missing or unauthenticated.
 */
export interface SetupOptions {
  /**
   * Opt-in: create a GitHub remote via `gh repo create` after `git init`. Only
   * acts when `gh` is installed AND authenticated (`gh auth status` exits 0);
   * otherwise a warning is emitted and the local scaffold continues.
   */
  remote?: boolean;
  /** Forwarded to `initCommand`: comma-separated tool list. */
  tools?: string;
  /** Forwarded to `initCommand`: content preset. */
  preset?: string;
  /** Forwarded to `initCommand`: maturity tier. */
  maturity?: string;
  /** Forwarded to `initCommand`: skip interactive prompts / headless run. */
  yes?: boolean;
  /** Forwarded to `initCommand`: suppress stdout chrome. */
  quiet?: boolean;
  /** Forwarded to `initCommand`: `--format <human|json>`. */
  format?: string;
  /** Forwarded to `initCommand`: verbose per-step output. */
  verbose?: boolean;
  /** Preview only: print the scaffold plan and run `init` would-run; write nothing. */
  dryRun?: boolean;
}

/**
 * Directory entries that do NOT make a target "non-empty" for the overwrite
 * guard. A lone `.git` is a VCS skeleton, not project content — treating it as
 * empty lets `hatch3r setup myrepo` run idempotently against a `git init`'d but
 * otherwise empty directory (git init is then skipped — see `gitDirExists`).
 */
const EMPTINESS_IGNORED_ENTRIES = new Set([".git"]);

/** True when `p` exists on disk (file or directory). */
async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch (err) {
    // Absence is the expected case for a not-yet-created target; surface the
    // reason under --verbose so a real failure (e.g. EACCES) stays observable
    // rather than collapsing silently into "does not exist".
    verbose(`setup: path probe access(${p}) → ${(err as NodeJS.ErrnoException).code ?? "absent"}`);
    return false;
  }
}

/**
 * True when `dir` does not exist or contains nothing beyond
 * {@link EMPTINESS_IGNORED_ENTRIES}. A missing directory is "empty" so callers
 * can create it.
 */
async function isDirEffectivelyEmpty(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.every((e) => EMPTINESS_IGNORED_ENTRIES.has(e));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw err;
  }
}

/** Run `git <args>` in `cwd`, inheriting nothing to stdout (output captured). */
function runGit(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * True when the GitHub CLI is installed AND authenticated. `gh auth status`
 * exits 0 only when a logged-in account exists; a missing binary throws
 * (ENOENT) and an unauthenticated CLI exits non-zero — both resolve to `false`
 * so `--remote` degrades to a warning rather than aborting the scaffold.
 */
function isGhReady(): boolean {
  try {
    execFileSync("gh", ["auth", "status"], { stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch (err) {
    verbose(`setup: gh availability probe failed — ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * Resolve the target directory NAME. Precedence:
 *   1. Explicit positional `dir`.
 *   2. `.` (current directory) when the cwd is effectively empty.
 *   3. `.` under `--yes` (headless cannot prompt — the overwrite guard then
 *      produces an actionable FS_ERROR if the cwd is non-empty).
 *   4. Interactive prompt for a directory name.
 */
async function resolveTargetName(
  dir: string | undefined,
  cwd: string,
  headless: boolean,
): Promise<string> {
  if (dir && dir.trim().length > 0) return dir.trim();
  if (await isDirEffectivelyEmpty(cwd)) return ".";
  if (headless) return ".";
  const { dirName } = await inquirer.prompt<{ dirName: string }>([
    {
      type: "input",
      name: "dirName",
      message: "Directory name for the new project:",
      validate: (v: string) =>
        v && v.trim().length > 0 ? true : "Enter a non-empty directory name",
    },
  ]);
  return dirName.trim();
}

export async function setupCommand(
  dir: string | undefined,
  opts: SetupOptions = {},
): Promise<void> {
  const startMs = Date.now();
  const headless = opts.yes === true;
  // `interactive` gates `--format json` without `--yes` (exit 2) at the
  // beginCommand chokepoint, mirroring init.ts. banner "none": init prints its
  // own banner on the happy path, so setup stays silent to avoid a double banner.
  const format = beginCommand(opts, { banner: "none", interactive: !headless });

  const cwd = process.cwd();
  const targetName = await resolveTargetName(dir, cwd, headless);
  const targetDir = resolve(cwd, targetName);

  const alreadyExists = await pathExists(targetDir);
  // Overwrite guard: an existing target with real content (anything beyond a
  // lone `.git`) is never clobbered.
  if (alreadyExists && !(await isDirEffectivelyEmpty(targetDir))) {
    throw new HatchError(
      `Target directory ${chalk.bold(targetName)} already exists and is not empty.`,
      undefined,
      "FS_ERROR",
      `Pick a new or empty directory — e.g. \`hatch3r setup <new-dir>\` — or clear the existing contents first.`,
    );
  }

  const gitDirExists = await pathExists(join(targetDir, ".git"));
  const willCreateDir = !alreadyExists;
  const willGitInit = !gitDirExists;
  // Only probe gh when --remote is requested (read-only, but skipped otherwise
  // to keep the no-flag path free of subprocess calls).
  const ghReady = opts.remote === true ? isGhReady() : false;
  const repoName = basename(targetDir);

  // ── Dry run: print the plan, write nothing, do not run init ───────────────
  if (opts.dryRun) {
    const lines: string[] = [];
    lines.push(
      willCreateDir
        ? `${chalk.green("+")} create directory ${chalk.bold(targetName)}`
        : `${chalk.dim("=")} use existing empty directory ${chalk.bold(targetName)}`,
    );
    lines.push(
      willGitInit
        ? `${chalk.green("+")} run \`git init\` in ${chalk.bold(targetName)}`
        : `${chalk.dim("=")} git repository already present — skip \`git init\``,
    );
    if (opts.remote === true) {
      lines.push(
        ghReady
          ? `${chalk.green("+")} create GitHub remote \`${repoName}\` via \`gh repo create\``
          : `${chalk.yellow("!")} \`--remote\` set but \`gh\` is unavailable/unauthenticated — skip remote`,
      );
    }
    lines.push(`${chalk.cyan(">")} run \`hatch3r init\` in ${chalk.bold(targetName)}`);

    finishCommand(format, {
      command: "setup",
      title: "Setup (dry run)",
      style: "info",
      lines,
      json: {
        dryRun: true,
        targetDir,
        createDir: willCreateDir,
        gitInit: willGitInit,
        remote: opts.remote === true ? { requested: true, ghReady } : { requested: false },
        wouldRunInit: true,
      },
      nextSteps: ["Re-run without --dry-run to scaffold and start init."],
      startMs,
    });
    return;
  }

  // ── Scaffold ──────────────────────────────────────────────────────────────
  await mkdir(targetDir, { recursive: true });
  if (willCreateDir) {
    info(`Created project directory ${chalk.bold(targetName)}`);
  } else {
    info(`Using directory ${chalk.bold(targetName)}`);
  }

  if (willGitInit) {
    runGit(["init"], targetDir);
    info("Initialized empty Git repository");
  } else {
    info("Git repository already present — skipping `git init`");
  }

  if (opts.remote === true) {
    if (ghReady) {
      try {
        runGit(["status"], targetDir); // ensure the repo is readable before gh attaches
        execFileSync("gh", ["repo", "create", repoName, "--source", targetDir, "--private"], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        info(`Created GitHub remote ${chalk.bold(repoName)} (private)`);
      } catch (err) {
        // A remote failure must not abort the local scaffold.
        warn(
          `Could not create the GitHub remote: ${err instanceof Error ? err.message : String(err)}. ` +
            `Continuing with the local project; run \`gh repo create\` manually later.`,
        );
      }
    } else {
      warn(
        `--remote was requested but the GitHub CLI (gh) is not installed or not authenticated. ` +
          `Skipping remote creation. Install gh and run \`gh auth login\`, then \`gh repo create\` ` +
          `from the new directory. Continuing with the local scaffold.`,
      );
    }
  }

  // ── Chain into init inside the new directory ──────────────────────────────
  // init emits its own banner + outcome box / JSON envelope, so setup does not
  // call finishCommand on the happy path (one terminal outcome, never two).
  process.chdir(targetDir);
  await initCommand({
    tools: opts.tools,
    preset: opts.preset,
    maturity: opts.maturity,
    yes: opts.yes,
    quiet: opts.quiet,
    format: opts.format,
    verbose: opts.verbose,
  });
}
