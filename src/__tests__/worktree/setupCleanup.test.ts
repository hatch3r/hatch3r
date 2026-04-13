import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  lstat,
  readlink,
  symlink,
  access,
} from "node:fs/promises";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import {
  WORKTREE_INCLUDE_FILE,
  MANAGED_BLOCK_START,
  MANAGED_BLOCK_END,
} from "../../types.js";
import {
  setupWorktree,
  cleanupWorktree,
} from "../../worktree/index.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Creates a temp directory with `git init` and returns its path. */
function makeTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hatch3r-wt-setup-test-"));
  execFileSync("git", ["init", "--initial-branch=main"], {
    cwd: dir,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.email", "test@test.com"], {
    cwd: dir,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Test"], {
    cwd: dir,
    stdio: "ignore",
  });
  return dir;
}

/**
 * Creates a .worktreeinclude file with the given entries and commits it
 * so it's tracked by git (gitignored files need a committed .gitignore).
 */
function writeIncludeFile(
  repoDir: string,
  entries: { pattern: string; strategy: "copy" | "symlink"; reason?: string }[],
): void {
  const lines: string[] = [
    "# hatch3r worktree include file",
    "",
    MANAGED_BLOCK_START,
  ];
  for (const entry of entries) {
    if (entry.reason) lines.push(`# ${entry.reason}`);
    if (entry.strategy === "symlink") {
      lines.push(`${entry.pattern}  # hatch3r:symlink`);
    } else {
      lines.push(entry.pattern);
    }
  }
  lines.push(MANAGED_BLOCK_END, "");
  writeFileSync(join(repoDir, WORKTREE_INCLUDE_FILE), lines.join("\n"), "utf-8");
}

// ── setupWorktree ────────────────────────────────────────────────────────────

describe("setupWorktree", () => {
  let mainRepo: string;
  let worktreeDir: string;

  beforeEach(() => {
    mainRepo = makeTempGitRepo();
    worktreeDir = mkdtempSync(join(tmpdir(), "hatch3r-wt-target-"));
  });

  afterEach(() => {
    rmSync(mainRepo, { recursive: true, force: true });
    rmSync(worktreeDir, { recursive: true, force: true });
  });

  it("returns error when .worktreeinclude is missing", async () => {
    const result = await setupWorktree(mainRepo, worktreeDir);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain(WORKTREE_INCLUDE_FILE);
    expect(result.copied).toEqual([]);
    expect(result.symlinked).toEqual([]);
  });

  it("returns empty result when include file has no entries", async () => {
    writeFileSync(
      join(mainRepo, WORKTREE_INCLUDE_FILE),
      "# empty file\n",
      "utf-8",
    );
    const result = await setupWorktree(mainRepo, worktreeDir);
    expect(result.copied).toEqual([]);
    expect(result.symlinked).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("copies files matched by copy-strategy patterns", async () => {
    // Set up gitignore and source file
    writeFileSync(join(mainRepo, ".gitignore"), ".env\n", "utf-8");
    writeFileSync(join(mainRepo, ".env"), "SECRET=42\n", "utf-8");
    execFileSync("git", ["add", ".gitignore"], { cwd: mainRepo, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: mainRepo, stdio: "ignore" });

    writeIncludeFile(mainRepo, [
      { pattern: ".env", strategy: "copy", reason: "env vars" },
    ]);

    const result = await setupWorktree(mainRepo, worktreeDir);
    expect(result.copied).toContain(".env");

    const content = await readFile(join(worktreeDir, ".env"), "utf-8");
    expect(content).toBe("SECRET=42\n");
  });

  it("creates symlinks for symlink-strategy patterns", async () => {
    // Create a gitignored directory
    writeFileSync(join(mainRepo, ".gitignore"), "node_modules/\n", "utf-8");
    mkdirSync(join(mainRepo, "node_modules"));
    writeFileSync(join(mainRepo, "node_modules", "pkg.js"), "module.exports = {};", "utf-8");
    execFileSync("git", ["add", ".gitignore"], { cwd: mainRepo, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: mainRepo, stdio: "ignore" });

    writeIncludeFile(mainRepo, [
      { pattern: "node_modules/", strategy: "symlink", reason: "shared deps" },
    ]);

    const result = await setupWorktree(mainRepo, worktreeDir);
    expect(result.symlinked).toContain("node_modules/pkg.js");

    // Verify the symlink exists and points to the correct target
    const symlinkPath = join(worktreeDir, "node_modules", "pkg.js");
    const stat = await lstat(symlinkPath);
    expect(stat.isSymbolicLink()).toBe(true);
  });

  it("skips files that already exist in target without --force", async () => {
    writeFileSync(join(mainRepo, ".gitignore"), ".env\n", "utf-8");
    writeFileSync(join(mainRepo, ".env"), "NEW=value\n", "utf-8");
    execFileSync("git", ["add", ".gitignore"], { cwd: mainRepo, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: mainRepo, stdio: "ignore" });

    writeIncludeFile(mainRepo, [
      { pattern: ".env", strategy: "copy" },
    ]);

    // Pre-create the file in the target
    await writeFile(join(worktreeDir, ".env"), "OLD=value\n");

    const result = await setupWorktree(mainRepo, worktreeDir);
    expect(result.skipped).toContain(".env");
    expect(result.copied).not.toContain(".env");

    // Original content preserved
    const content = await readFile(join(worktreeDir, ".env"), "utf-8");
    expect(content).toBe("OLD=value\n");
  });

  it("overwrites existing files with --force", async () => {
    writeFileSync(join(mainRepo, ".gitignore"), ".env\n", "utf-8");
    writeFileSync(join(mainRepo, ".env"), "NEW=value\n", "utf-8");
    execFileSync("git", ["add", ".gitignore"], { cwd: mainRepo, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: mainRepo, stdio: "ignore" });

    writeIncludeFile(mainRepo, [
      { pattern: ".env", strategy: "copy" },
    ]);

    // Pre-create the file in the target
    await writeFile(join(worktreeDir, ".env"), "OLD=value\n");

    const result = await setupWorktree(mainRepo, worktreeDir, { force: true });
    expect(result.copied).toContain(".env");

    const content = await readFile(join(worktreeDir, ".env"), "utf-8");
    expect(content).toBe("NEW=value\n");
  });

  it("creates parent directories for nested files", async () => {
    writeFileSync(join(mainRepo, ".gitignore"), "config/\n", "utf-8");
    mkdirSync(join(mainRepo, "config", "deep"), { recursive: true });
    writeFileSync(join(mainRepo, "config", "deep", "settings.json"), '{"key":"val"}', "utf-8");
    execFileSync("git", ["add", ".gitignore"], { cwd: mainRepo, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: mainRepo, stdio: "ignore" });

    writeIncludeFile(mainRepo, [
      { pattern: "config/", strategy: "copy" },
    ]);

    const result = await setupWorktree(mainRepo, worktreeDir);
    expect(result.copied).toContain("config/deep/settings.json");

    const content = await readFile(join(worktreeDir, "config", "deep", "settings.json"), "utf-8");
    expect(content).toBe('{"key":"val"}');
  });

  it("handles mixed copy and symlink strategies", async () => {
    writeFileSync(join(mainRepo, ".gitignore"), ".env\nnode_modules/\n", "utf-8");
    writeFileSync(join(mainRepo, ".env"), "KEY=val\n", "utf-8");
    mkdirSync(join(mainRepo, "node_modules"));
    writeFileSync(join(mainRepo, "node_modules", "index.js"), "// mod", "utf-8");
    execFileSync("git", ["add", ".gitignore"], { cwd: mainRepo, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: mainRepo, stdio: "ignore" });

    writeIncludeFile(mainRepo, [
      { pattern: ".env", strategy: "copy" },
      { pattern: "node_modules/", strategy: "symlink" },
    ]);

    const result = await setupWorktree(mainRepo, worktreeDir);
    expect(result.copied).toContain(".env");
    expect(result.symlinked).toContain("node_modules/index.js");
  });

  it("is idempotent (re-run skips already-set-up files)", async () => {
    writeFileSync(join(mainRepo, ".gitignore"), ".env\n", "utf-8");
    writeFileSync(join(mainRepo, ".env"), "SECRET=42\n", "utf-8");
    execFileSync("git", ["add", ".gitignore"], { cwd: mainRepo, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: mainRepo, stdio: "ignore" });

    writeIncludeFile(mainRepo, [
      { pattern: ".env", strategy: "copy" },
    ]);

    // First run
    const result1 = await setupWorktree(mainRepo, worktreeDir);
    expect(result1.copied).toContain(".env");

    // Second run (idempotent)
    const result2 = await setupWorktree(mainRepo, worktreeDir);
    expect(result2.skipped).toContain(".env");
    expect(result2.copied).not.toContain(".env");
  });
});

// ── cleanupWorktree ──────────────────────────────────────────────────────────

describe("cleanupWorktree", () => {
  let worktreeDir: string;

  beforeEach(async () => {
    worktreeDir = await mkdtemp(join(tmpdir(), "hatch3r-wt-cleanup-"));
  });

  afterEach(async () => {
    await rm(worktreeDir, { recursive: true, force: true });
  });

  it("does nothing when no .worktreeinclude exists", async () => {
    // cleanupWorktree should not throw
    await expect(cleanupWorktree(worktreeDir)).resolves.toBeUndefined();
  });

  it("removes symlinks listed in .worktreeinclude", async () => {
    const includeContent = [
      MANAGED_BLOCK_START,
      "# shared deps",
      "node_modules/  # hatch3r:symlink",
      MANAGED_BLOCK_END,
    ].join("\n");
    await writeFile(join(worktreeDir, WORKTREE_INCLUDE_FILE), includeContent);

    // Create a symlink at the target location
    const symlinkTarget = await mkdtemp(join(tmpdir(), "hatch3r-symlink-target-"));
    await symlink(symlinkTarget, join(worktreeDir, "node_modules"));

    // Verify symlink exists
    const statBefore = await lstat(join(worktreeDir, "node_modules"));
    expect(statBefore.isSymbolicLink()).toBe(true);

    await cleanupWorktree(worktreeDir);

    // Symlink should be removed
    await expect(access(join(worktreeDir, "node_modules"))).rejects.toThrow();

    await rm(symlinkTarget, { recursive: true, force: true });
  });

  it("does not remove copy-strategy entries", async () => {
    const includeContent = [
      MANAGED_BLOCK_START,
      "# env vars",
      ".env",
      MANAGED_BLOCK_END,
    ].join("\n");
    await writeFile(join(worktreeDir, WORKTREE_INCLUDE_FILE), includeContent);

    // Create a regular file (copy strategy)
    await writeFile(join(worktreeDir, ".env"), "SECRET=42\n");

    await cleanupWorktree(worktreeDir);

    // Regular file should still exist (cleanup only removes symlinks)
    const content = await readFile(join(worktreeDir, ".env"), "utf-8");
    expect(content).toBe("SECRET=42\n");
  });

  it("does not throw when symlink targets do not exist", async () => {
    const includeContent = [
      MANAGED_BLOCK_START,
      "missing/  # hatch3r:symlink",
      MANAGED_BLOCK_END,
    ].join("\n");
    await writeFile(join(worktreeDir, WORKTREE_INCLUDE_FILE), includeContent);

    // No symlink created — cleanupWorktree should gracefully skip
    await expect(cleanupWorktree(worktreeDir)).resolves.toBeUndefined();
  });

  it("only removes symbolic links, not regular files at symlink paths", async () => {
    const includeContent = [
      MANAGED_BLOCK_START,
      "data/  # hatch3r:symlink",
      MANAGED_BLOCK_END,
    ].join("\n");
    await writeFile(join(worktreeDir, WORKTREE_INCLUDE_FILE), includeContent);

    // Create a regular directory (not a symlink) at the symlink-strategy path
    await mkdir(join(worktreeDir, "data"), { recursive: true });
    await writeFile(join(worktreeDir, "data", "file.txt"), "content");

    await cleanupWorktree(worktreeDir);

    // Regular directory should still exist since it's not a symlink
    const content = await readFile(join(worktreeDir, "data", "file.txt"), "utf-8");
    expect(content).toBe("content");
  });
});
