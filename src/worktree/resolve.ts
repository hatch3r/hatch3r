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
 * Writes the given gitignore-style patterns to a temp file, then runs
 * `git ls-files --others --ignored --exclude-from=<tmpfile>` to resolve
 * them against the working tree. Returns the matched file paths.
 */
export async function resolvePatterns(
  rootDir: string,
  patterns: string[],
): Promise<string[]> {
  if (patterns.length === 0) return [];

  const tmpFile = join(
    tmpdir(),
    `hatch3r-worktree-${randomBytes(4).toString("hex")}`,
  );

  try {
    writeFileSync(tmpFile, patterns.join("\n") + "\n", "utf-8");

    const output = execFileSync(
      "git",
      ["ls-files", "--others", "--ignored", `--exclude-from=${tmpFile}`],
      { cwd: rootDir, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
    );

    return output
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (err) {
    console.error(`[hatch3r] worktree pattern resolution failed: ${(err as Error).message}`);
    return [];
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
 * levels to reach the main repo root.
 *
 * @throws if the `.git` file can't be read or parsed.
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
  const mainRoot = dirname(dirname(dirname(absGitdir)));

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
 * `git worktree list --porcelain`. The porcelain format is record-per-blank-line
 * with `worktree`, `HEAD`, `branch`, and zero or more flag lines (`detached`,
 * `bare`, `locked`, `prunable`).
 *
 * The first record is always the main worktree.
 */
export function listWorktrees(mainRoot: string): WorktreeListEntry[] {
  let raw: string;
  try {
    raw = execFileSync("git", ["worktree", "list", "--porcelain"], {
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

  for (const line of raw.split("\n")) {
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
 * Reports counts of modified, untracked, and stashed entries inside a worktree.
 * Used by `worktree-cleanup` to badge candidates so the user knows what they're
 * about to destroy with `git worktree remove --force`.
 *
 * Returns zeros (with no throw) when git can't read the path — the caller
 * already knows the path exists from `listWorktrees`; this is a soft probe.
 */
export function getWorktreeStatus(worktreePath: string): WorktreeStatus {
  let status: WorktreeStatus = { modified: 0, untracked: 0, stashes: 0 };
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
    status = { modified: 0, untracked: 0, stashes: 0 };
  }
  try {
    const out = execFileSync("git", ["-C", worktreePath, "stash", "list"], {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    status.stashes = out.split("\n").filter((l) => l.length > 0).length;
  } catch {
    // Soft probe: a failed `git stash list` is masked because the destructive
    // path (`removeGitWorktree`) surfaces the real git error with stderr when
    // it runs. Status badges are advisory only — assigning to 0 keeps the
    // catch body non-empty per the silent-failure contract.
    status.stashes = 0;
  }
  return status;
}
