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
 * guard — the OS/VCS/IDE metadata a fresh checkout commonly carries. A target
 * holding only these is still "effectively empty", so both a lone `.git`
 * skeleton (git init is then skipped — see `gitDirExists`) AND the GitHub-first
 * flow (create a repo on github.com with a LICENSE/`.gitignore` → clone →
 * scaffold locally) let `hatch3r setup` proceed instead of hard-failing with
 * FS_ERROR (D1-SA1.1-08, Cycle 12).
 *
 * Scope is the conservative OS/VCS/IDE-metadata subset of create-next-app's
 * is-folder-empty allowlist (vercel/next.js create-next-app
 * helpers/is-folder-empty.ts, accessed 2026-07-09): OS dumps, VCS skeletons,
 * IDE / AI-tool config dirs, and a top-level LICENSE. `README.md` is
 * deliberately excluded — it is frequently real project content, so its
 * presence still blocks the scaffold (falsifiability boundary asserted in
 * setup.test.ts).
 */
const EMPTINESS_IGNORED_ENTRIES = new Set([
  ".git", // VCS skeleton; also drives the `git init` skip via gitDirExists
  ".gitignore", // VCS metadata (GitHub "Add .gitignore")
  ".gitattributes", // VCS metadata
  ".DS_Store", // macOS Finder metadata
  "Thumbs.db", // Windows Explorer thumbnail cache
  ".idea", // JetBrains IDE config dir
  ".vscode", // VS Code workspace config dir
  ".claude", // Claude Code config dir (also an `--import` source)
  ".cursor", // Cursor config dir (the artifact `--import cursor` harvests)
  "LICENSE", // GitHub "Choose a license" — inert, not project code
]);

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

/**
 * The emptiness-guard-ignored entries actually present in `dir` (a subset of
 * {@link EMPTINESS_IGNORED_ENTRIES}), minus `.git`. `.git` is omitted because it
 * has its own dedicated status line (the `git init` skip), so re-announcing it
 * here would duplicate that signal. Sorted for stable output. Names the inert
 * metadata the scaffold preserved so a GitHub-first clone shows the user its
 * LICENSE/`.cursor`/… were kept, not silently scaffolded over (D1-SA1.1-08).
 */
async function ignoredEntriesPresent(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter((e) => e !== ".git" && EMPTINESS_IGNORED_ENTRIES.has(e)).sort();
  } catch (err) {
    // Display-only helper: a read failure just drops the "keeping …" clause.
    // Surface the reason under --verbose rather than collapsing it silently.
    verbose(
      `setup: could not list kept metadata in ${dir} — ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

/** Run `git <args>` in `cwd`, inheriting nothing to stdout (output captured). */
function runGit(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * True when a `git` binary is invocable on PATH. D1-SA1.1-06 (Cycle 12 Wave 3,
 * D1, P1): git is setup's one hard prerequisite beyond Node itself (docstring
 * above + `src/cli/program.ts` registration text), but `runGit`'s bare
 * `execFileSync` gave a missing binary no dependency-failure strategy — the
 * ENOENT fell through to the generic funnel as a raw `spawnSync git ENOENT`
 * crash. Probe shape mirrors `isGhReady` below; the difference is policy:
 * `gh` is optional and degrades to a warning, git is load-bearing so absence
 * aborts with an actionable CONFIG_ERROR at the preflight call site.
 */
function isGitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch (err) {
    verbose(
      `setup: git availability probe failed — ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
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

/**
 * release/2.8.6: child argv for the pre-flight auto-update re-exec
 * (`maybeSelfUpdateBeforeInit` via the chained `initCommand`). By the time
 * the check runs, setup has already scaffolded the target directory and
 * `process.chdir`'d into it — so the re-exec re-enters `setup .` (the current
 * directory, which the emptiness guard accepts: it holds only `.git` plus
 * ignored metadata at this point) rather than replaying the original
 * positional, which would scaffold a nested `<dir>/<dir>` from the inherited
 * cwd. `--remote` is dropped deliberately: the remote was already created (or
 * warned about) in this parent run, and replaying `gh repo create` against an
 * existing repo would only add failure noise. `--dry-run` never reaches the
 * chain (dry runs return before `initCommand`).
 */
function buildSetupReExecArgv(opts: SetupOptions): string[] {
  const args: string[] = ["setup", "."];
  if (opts.tools) args.push("--tools", opts.tools);
  if (opts.preset) args.push("--preset", opts.preset);
  if (opts.maturity) args.push("--maturity", opts.maturity);
  // Defensive completeness: a headless run skips the update check entirely,
  // so --yes never reaches a re-exec in practice — but a forwarded flag set
  // must stay faithful to the invocation it mirrors.
  if (opts.yes === true) args.push("--yes");
  if (opts.quiet === true) args.push("--quiet");
  if (opts.format) args.push("--format", opts.format);
  if (opts.verbose === true) args.push("--verbose");
  return args;
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

  // ── Preflight: git (D1-SA1.1-06) ──────────────────────────────────────────
  // Probe only when this run will actually spawn git (`git init`, or the
  // `runGit(["status"])` readability check before `gh repo create`) so the
  // no-git-needed path stays free of extra subprocess calls, mirroring the
  // gated `isGhReady()` probe above. A missing binary aborts BEFORE any
  // directory is created, with what failed + why + next step instead of the
  // raw `spawnSync git ENOENT` the generic funnel previously emitted.
  const needsGit = willGitInit || (opts.remote === true && ghReady);
  if (needsGit && !isGitAvailable()) {
    throw new HatchError(
      "git is required by `hatch3r setup` but was not found on PATH.",
      undefined,
      "CONFIG_ERROR",
      "Install git (https://git-scm.com/downloads) and re-run, or run `hatch3r init` inside an existing git repository instead.",
    );
  }

  // ── Scaffold ──────────────────────────────────────────────────────────────
  await mkdir(targetDir, { recursive: true });
  if (willCreateDir) {
    info(`Created project directory ${chalk.bold(targetName)}`);
  } else {
    // Name the inert metadata (LICENSE, .cursor, …) tolerated by the emptiness
    // guard so the user sees what the scaffold kept rather than silently
    // scaffolding over it (D1-SA1.1-08).
    const kept = await ignoredEntriesPresent(targetDir);
    info(
      kept.length > 0
        ? `Using directory ${chalk.bold(targetName)} (keeping ${kept.join(", ")})`
        : `Using directory ${chalk.bold(targetName)}`,
    );
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
    // F-SEC-03 (sec-2.8.6-p4): setup's own --dry-run early-returns before
    // this chain, so the thread-through is defense-in-depth — if that early
    // return ever moves, the pre-flight update skip still holds.
    dryRun: opts.dryRun,
    // Pre-flight auto-update re-exec override — see buildSetupReExecArgv.
    reExecArgv: buildSetupReExecArgv(opts),
  });
}
