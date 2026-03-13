import { execFileSync } from "node:child_process";
import { statSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

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
    } catch {
      // Temp file may already be gone
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
  } catch {
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
    throw new Error(
      `Unable to parse .git file in ${worktreeDir}: expected "gitdir: <path>"`,
    );
  }

  // gitdir points to <main-repo>/.git/worktrees/<name>
  // Resolve relative paths against the worktree directory, then go up 3 levels.
  const rawGitdir = match[1].trim();
  const absGitdir = resolve(worktreeDir, rawGitdir);

  // Traverse: .git/worktrees/<name> → .git/worktrees → .git → repo root
  const mainRoot = dirname(dirname(dirname(absGitdir)));
  return mainRoot;
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
  } catch {
    return false;
  }
}
