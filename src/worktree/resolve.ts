import { execFileSync } from "node:child_process";
import { statSync, readFileSync, writeFileSync, unlinkSync, realpathSync } from "node:fs";
import { join, resolve, dirname, sep } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { HatchError } from "../types.js";
import { verbose } from "../cli/shared/ui.js";
import type { WorktreeListEntry, WorktreeStatus } from "./types.js";

/**
 * Record a worktree-probe failure on stderr under --verbose. Per D8-H8.4.6
 * (C9-H19) Silent Failure Contract — soft probes that have no warnings channel
 * still emit a diagnostic at this level.
 */
function recordWorktreeProbeFailure(operation: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  verbose(`worktree/resolve: ${operation} — ${message}`);
}

/**
 * D1-SA1.10-03 (D1, P2): structured result of {@link resolvePatterns} so a hard
 * resolution failure is DISTINGUISHABLE from "no matches". Previously both
 * returned `[]`, so `setupWorktree` could not tell an empty match set apart
 * from a git failure and proceeded to a success box with an empty include set.
 */
export interface ResolvePatternsResult {
  /** Matched (untracked + gitignored) file paths, relative to `rootDir`. */
  paths: string[];
  /**
   * Set when the `git ls-files` probe HARD-FAILED (10 MiB stdout-buffer overrun
   * or a git error). Callers push this into `result.errors` so the failure is
   * surfaced (warn loop + non-zero exit) instead of being swallowed.
   */
  error?: string;
}

/**
 * Writes the given gitignore-style patterns to a temp file, then runs
 * `git ls-files --others --ignored --exclude-from=<tmpfile>` to resolve
 * them against the working tree. Returns the matched file paths plus an
 * optional hard-failure `error` (D1-SA1.10-03).
 *
 * D1-M21 (Cycle 10): emits a verbose() progress trace at entry/exit so the
 * shell-out is observable under `--verbose`, and explicitly classifies an
 * ENOBUFS / `stdout maxBuffer length exceeded` outcome with an actionable
 * message instead of the generic execFileSync error. The maxBuffer is kept
 * at 10 MiB (per the four other worktree git probes in this file); a repo
 * whose `git ls-files --others --ignored` output exceeds 10 MiB has either
 * an over-broad include pattern or a build-artifact tree that should not
 * be copied into a worktree — both are user-actionable.
 */
export async function resolvePatterns(
  rootDir: string,
  patterns: string[],
): Promise<ResolvePatternsResult> {
  if (patterns.length === 0) return { paths: [] };

  const tmpFile = join(
    tmpdir(),
    `hatch3r-worktree-${randomBytes(4).toString("hex")}`,
  );

  verbose(
    `worktree/resolve: resolvePatterns starting (cwd=${rootDir}, ${patterns.length} pattern(s))`,
  );

  try {
    writeFileSync(tmpFile, patterns.join("\n") + "\n", "utf-8");

    const output = execFileSync(
      "git",
      ["ls-files", "--others", "--ignored", `--exclude-from=${tmpFile}`],
      { cwd: rootDir, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
    );

    const resolved = output
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    verbose(`worktree/resolve: resolvePatterns matched ${resolved.length} path(s)`);
    return { paths: resolved };
  } catch (err) {
    // D1-M21: distinguish stdout-buffer overrun (ENOBUFS or the textual
    // form Node emits when `maxBuffer` is exceeded) from a generic git
    // failure. Both Node's docs (https://nodejs.org/api/child_process.html
    // #child_processexecfilesyncfile-args-options, accessed 2026-05-28) and
    // observed behavior describe the overrun as either `err.code === "ENOBUFS"`
    // or a message containing "maxBuffer length exceeded".
    const e = err as NodeJS.ErrnoException & { stderr?: Buffer };
    const message = (err as Error).message ?? String(err);
    const isBufferOverrun =
      e.code === "ENOBUFS" || /maxBuffer length exceeded/.test(message);
    // D1-SA1.10-03 (D1, P2): return the failure to the caller (not just a bare
    // console.error). Previously this returned [] indistinguishably from "no
    // matches", so `setupWorktree` proceeded to a success box on an EMPTY
    // include set — a near-silent total failure when one over-broad pattern
    // overran the buffer.
    const errorMessage = isBufferOverrun
      ? `worktree pattern resolution exceeded the 10 MiB stdout buffer in ${rootDir}. ` +
        `Narrow your .worktreeinclude patterns (avoid build-artifact trees like dist/ or node_modules/) or split into multiple worktrees.`
      : `worktree pattern resolution failed: ${message}`;
    console.error(`[hatch3r] ${errorMessage}`);
    return { paths: [], error: errorMessage };
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch (err) {
      recordWorktreeProbeFailure(
        `unlinkSync(${tmpFile}) — temp file may already be gone`,
        err,
      );
    }
  }
}

/**
 * Checks whether the given directory is inside a git worktree (as opposed to
 * the main repo). In a worktree, `.git` is a *file* containing `gitdir: ...`
 * rather than a directory.
 */
export function isInsideWorktree(dir: string): boolean {
  try {
    const stat = statSync(join(dir, ".git"));
    return stat.isFile();
  } catch (err) {
    recordWorktreeProbeFailure(`isInsideWorktree(${dir}) — no .git`, err);
    return false;
  }
}

/**
 * Given a worktree directory, reads the `.git` file, parses the `gitdir:`
 * pointer, and traverses up to find the main repo root.
 *
 * The gitdir typically points to `.git/worktrees/<name>`, so we go up 3
 * levels to reach the main repo root. For bare-repo mains (no working tree
 * at the parent of `.git`), or when the gitdir layout does not match the
 * dirname-by-3 pattern (e.g. a worktree whose gitdir lives outside the
 * main repo's `.git/worktrees/`), fall back to `git rev-parse
 * --git-common-dir`, which is the official git query for the shared git
 * directory across linked worktrees (per `git-rev-parse(1)`,
 * https://git-scm.com/docs/git-rev-parse, accessed 2026-05-28).
 *
 * @throws if neither the `.git` file nor `git rev-parse --git-common-dir`
 *   yields a usable main-repo root.
 */
export function findMainWorktree(worktreeDir: string): string {
  const gitFilePath = join(worktreeDir, ".git");
  const content = readFileSync(gitFilePath, "utf-8").trim();

  const match = content.match(/^gitdir:\s*(.+)$/m);
  if (!match) {
    throw new HatchError(
      `Unable to parse .git file in ${worktreeDir}: expected "gitdir: <path>"`,
      1,
      "FS_ERROR",
    );
  }

  // gitdir points to <main-repo>/.git/worktrees/<name>
  // Resolve relative paths against the worktree directory, then go up 3 levels.
  const rawGitdir = match[1].trim();
  const absGitdir = resolve(worktreeDir, rawGitdir);

  // Traverse: .git/worktrees/<name> → .git/worktrees → .git → repo root
  const dirnameMainRoot = dirname(dirname(dirname(absGitdir)));

  // D1-M22 (Cycle 10): the dirname-by-3 traversal only holds when the main
  // repo has a working tree (gitdir layout `<repo>/.git/worktrees/<name>`).
  // For a *bare* main repo, the gitdir layout is `<repo.git>/worktrees/<name>`,
  // so dirname-by-3 over-shoots and returns the parent of the bare repo
  // instead of the bare repo itself. Detect this by checking the basename of
  // the dirname-by-2 result: when it equals `.git` the parent layout holds
  // and dirnameMainRoot is the main working tree; otherwise consult `git
  // rev-parse --git-common-dir` for the authoritative shared-git-dir path
  // (works for both bare and non-bare mains).
  const dirnameTwoUp = dirname(dirname(absGitdir));
  const layoutLooksWorking = dirnameTwoUp.endsWith(`${sep}.git`) || dirnameTwoUp.endsWith("/.git");
  let mainRoot: string;
  if (layoutLooksWorking) {
    mainRoot = dirnameMainRoot;
  } else {
    try {
      const commonDir = execFileSync(
        "git",
        ["-C", worktreeDir, "rev-parse", "--git-common-dir"],
        { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
      ).trim();
      // `git-common-dir` returns the *git dir* (the bare repo itself, or the
      // `.git` directory of a non-bare repo). For a non-bare main with a
      // working tree the main-repo root is the parent of `.git`; for a bare
      // main the bare repo IS the main root.
      const absCommonDir = resolve(worktreeDir, commonDir);
      const commonBase = absCommonDir.split(sep).pop() ?? "";
      mainRoot = commonBase === ".git" ? dirname(absCommonDir) : absCommonDir;
    } catch (err) {
      recordWorktreeProbeFailure(
        `findMainWorktree(${worktreeDir}) git rev-parse --git-common-dir failed — falling back to dirname traversal`,
        err,
      );
      mainRoot = dirnameMainRoot;
    }
  }

  // F1.10-H1 (Cycle 10 D1): canonicalise via the native realpath so this
  // return value can be compared byte-for-byte against `listWorktrees`, which
  // already runs `realpathSync.native` on every porcelain path (resolve.ts
  // listWorktrees). Without parity the two diverge on macOS (`/var` vs
  // `/private/var`) and Windows (8.3 short form vs long form), so the
  // worktree-setup/cleanup pairing — which calls findMainWorktree then
  // listWorktrees — would fail string comparison and mis-identify the main
  // worktree. Falls back to the un-canonicalised path when the main repo is
  // prunable/missing (realpath throws ENOENT), matching listWorktrees'
  // best-effort behavior for prunable worktrees.
  try {
    return realpathSync.native(mainRoot);
  } catch (err) {
    recordWorktreeProbeFailure(
      `findMainWorktree(${worktreeDir}) realpath(${mainRoot}) — main repo may be prunable/missing`,
      err,
    );
    return mainRoot;
  }
}

/**
 * Checks whether a path is gitignored in the given repository root.
 * Runs `git check-ignore -q <path>` — exit code 0 means ignored.
 */
export function isGitIgnored(rootDir: string, filePath: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", filePath], {
      cwd: rootDir,
      stdio: "ignore",
    });
    return true;
  } catch (err) {
    // `git check-ignore -q` exits non-zero when the path is NOT ignored, so a
    // throw here is the normal "not ignored" signal. Surface under --verbose
    // so unexpected errors (e.g., `git` missing from PATH) remain observable.
    recordWorktreeProbeFailure(
      `isGitIgnored(${filePath}) — not ignored or git unavailable`,
      err,
    );
    return false;
  }
}

/**
 * Enumerates all git worktrees attached to the repo at `mainRoot` by parsing
 * `git worktree list --porcelain -z`. The porcelain format is record-per-blank-line
 * with `worktree`, `HEAD`, `branch`, and zero or more flag lines (`detached`,
 * `bare`, `locked`, `prunable`).
 *
 * F-1.10.10 (Cycle 10 D1): the `-z` flag makes git NUL-terminate every
 * attribute line and use an empty NUL-terminated line (yielding `\0\0`) as the
 * record separator. Splitting on `\0` instead of `\n` is the git-documented
 * machine-parse mode (`git-worktree(1)`, https://git-scm.com/docs/git-worktree,
 * accessed 2026-05-28) and is the only safe parse for worktree paths that
 * legally contain a newline on POSIX — the prior `\n` split truncated such a
 * path at the embedded newline. On platforms where newlines in paths are
 * impossible (Windows) the flag is a no-op. The empty-token boundary maps
 * exactly onto the old empty-line boundary, so the per-record state machine is
 * unchanged below.
 *
 * The first record is always the main worktree.
 */
export function listWorktrees(mainRoot: string): WorktreeListEntry[] {
  let raw: string;
  try {
    raw = execFileSync("git", ["worktree", "list", "--porcelain", "-z"], {
      cwd: mainRoot,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    throw new HatchError(
      `git worktree list failed in ${mainRoot}: ${(err as Error).message}`,
      1,
      "FS_ERROR",
    );
  }

  const entries: WorktreeListEntry[] = [];
  let current: Partial<WorktreeListEntry> | null = null;

  const flush = () => {
    if (current && current.path) {
      entries.push({
        path: current.path,
        head: current.head,
        branch: current.branch,
        detached: current.detached ?? false,
        bare: current.bare ?? false,
        locked: current.locked ?? false,
        prunable: current.prunable ?? false,
      });
    }
    current = null;
  };

  for (const line of raw.split("\0")) {
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      flush();
      let pathStr = line.slice("worktree ".length).trim();
      // Git porcelain emits forward-slash paths (and on Windows, the long
      // form `C:/Users/runneradmin/...`). Canonicalise via the native
      // realpath (libuv → GetFinalPathNameByHandleW on Windows) so a
      // short-form 8.3 path (`C:\\Users\\RUNNER~1\\...` from os.tmpdir)
      // and the long form returned by git both resolve to the same string.
      // Plain `realpathSync` (the JS impl) preserves whichever form it
      // received, so it would NOT collapse the two — only `.native` does.
      try {
        pathStr = realpathSync.native(pathStr);
      } catch {
        // Prunable worktree — path may not exist on disk anymore.
        // Best-effort: normalise separators only so downstream string
        // comparisons against platform-native paths still align.
        pathStr = pathStr.split("/").join(sep);
      }
      current = { path: pathStr };
    } else if (!current) {
      continue;
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length).trim();
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).trim();
    } else if (line === "detached") {
      current.detached = true;
    } else if (line === "bare") {
      current.bare = true;
    } else if (line === "locked" || line.startsWith("locked ")) {
      current.locked = true;
    } else if (line === "prunable" || line.startsWith("prunable ")) {
      current.prunable = true;
    }
  }
  flush();

  return entries;
}

/**
 * Reports counts of modified and untracked entries inside a worktree from
 * `git -C <wt> status --porcelain`. Used by `worktree-cleanup` to badge
 * candidates so the user knows what they're about to destroy with
 * `git worktree remove --force`.
 *
 * Stash count is intentionally not reported: `git stash` writes to a single
 * repo-global `refs/stash`, so `git -C <wt> stash list` returns the SAME shared
 * stack from every linked worktree. Git exposes no reliable per-worktree stash
 * ownership, so counting it here mis-badged every worktree as dirty whenever a
 * stash existed anywhere and produced a false destruction-confirm prompt
 * (D1-32, Cycle 11 Wave 3). See {@link WorktreeStatus}.
 *
 * Returns zeros (with no throw) when git can't read the path — the caller
 * already knows the path exists from `listWorktrees`; this is a soft probe.
 */
export function getWorktreeStatus(worktreePath: string): WorktreeStatus {
  let status: WorktreeStatus = { modified: 0, untracked: 0 };
  try {
    const out = execFileSync("git", ["-C", worktreePath, "status", "--porcelain"], {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    for (const line of out.split("\n")) {
      if (!line) continue;
      if (line.startsWith("?? ")) status.untracked += 1;
      else status.modified += 1;
    }
  } catch {
    // Soft probe: a missing or broken worktree returns zero counts so the caller
    // can still render the badge; the subsequent `git worktree remove` will
    // surface the real error.
    status = { modified: 0, untracked: 0 };
  }
  return status;
}
