import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  resolvePatterns,
  isInsideWorktree,
  findMainWorktree,
  isGitIgnored,
} from "../../worktree/resolve.js";
import {
  parseWorktreeInclude,
  extractManagedContent,
} from "../../worktree/index.js";
import { MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../../types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Creates a temp directory with `git init` and returns its path. */
function makeTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hatch3r-resolve-test-"));
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

// ─── resolvePatterns ──────────────────────────────────────────────────────────

describe("resolvePatterns", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempGitRepo();
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns empty array when patterns list is empty", async () => {
    const result = await resolvePatterns(repoDir, []);
    expect(result).toEqual([]);
  });

  it("resolves gitignored files matching a pattern", async () => {
    // Create .gitignore that ignores .env files
    writeFileSync(join(repoDir, ".gitignore"), ".env\n", "utf-8");
    writeFileSync(join(repoDir, ".env"), "SECRET=42\n", "utf-8");

    // Make an initial commit so git has a tree to work with
    execFileSync("git", ["add", ".gitignore"], {
      cwd: repoDir,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "init"], {
      cwd: repoDir,
      stdio: "ignore",
    });

    const result = await resolvePatterns(repoDir, [".env"]);
    expect(result).toContain(".env");
  });

  it("resolves directory patterns with trailing slash", async () => {
    writeFileSync(join(repoDir, ".gitignore"), "build/\n", "utf-8");
    mkdirSync(join(repoDir, "build"));
    writeFileSync(join(repoDir, "build", "out.js"), "//", "utf-8");

    execFileSync("git", ["add", ".gitignore"], {
      cwd: repoDir,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "init"], {
      cwd: repoDir,
      stdio: "ignore",
    });

    const result = await resolvePatterns(repoDir, ["build/"]);
    expect(result).toContain("build/out.js");
  });

  it("returns empty array when no files match", async () => {
    writeFileSync(join(repoDir, ".gitignore"), "", "utf-8");
    writeFileSync(join(repoDir, "readme.txt"), "hello", "utf-8");

    execFileSync("git", ["add", "."], { cwd: repoDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], {
      cwd: repoDir,
      stdio: "ignore",
    });

    const result = await resolvePatterns(repoDir, ["*.log"]);
    expect(result).toEqual([]);
  });

  it("resolves multiple patterns at once", async () => {
    writeFileSync(join(repoDir, ".gitignore"), ".env\n*.log\n", "utf-8");
    writeFileSync(join(repoDir, ".env"), "KEY=val", "utf-8");
    writeFileSync(join(repoDir, "app.log"), "log output", "utf-8");

    execFileSync("git", ["add", ".gitignore"], {
      cwd: repoDir,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "init"], {
      cwd: repoDir,
      stdio: "ignore",
    });

    const result = await resolvePatterns(repoDir, [".env", "*.log"]);
    expect(result).toContain(".env");
    expect(result).toContain("app.log");
  });

  it("returns empty array on git error (invalid directory)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await resolvePatterns("/nonexistent-dir-xyz", ["*.txt"]);
    expect(result).toEqual([]);
    consoleSpy.mockRestore();
  });
});

// ─── isInsideWorktree ─────────────────────────────────────────────────────────

describe("isInsideWorktree", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hatch3r-worktree-check-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns false for a standard git repo (.git is a directory)", () => {
    mkdirSync(join(tempDir, ".git"));
    expect(isInsideWorktree(tempDir)).toBe(false);
  });

  it("returns true when .git is a file (worktree indicator)", () => {
    writeFileSync(
      join(tempDir, ".git"),
      "gitdir: /some/repo/.git/worktrees/branch-a\n",
      "utf-8",
    );
    expect(isInsideWorktree(tempDir)).toBe(true);
  });

  it("returns false when .git does not exist", () => {
    expect(isInsideWorktree(tempDir)).toBe(false);
  });
});

// ─── findMainWorktree ─────────────────────────────────────────────────────────

describe("findMainWorktree", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hatch3r-main-worktree-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("resolves absolute gitdir path to main repo root", () => {
    // Use a real temp directory so the path is platform-native (Windows drives, etc.)
    const mainRepoDir = mkdtempSync(join(tmpdir(), "hatch3r-main-abs-"));
    mkdirSync(join(mainRepoDir, ".git", "worktrees", "feat-x"), {
      recursive: true,
    });
    const gitdirPath = join(mainRepoDir, ".git", "worktrees", "feat-x");
    writeFileSync(join(tempDir, ".git"), `gitdir: ${gitdirPath}\n`, "utf-8");

    const result = findMainWorktree(tempDir);
    expect(result).toBe(mainRepoDir);

    rmSync(mainRepoDir, { recursive: true, force: true });
  });

  it("resolves relative gitdir path against worktree directory", () => {
    // Simulate a relative .git pointer: ../<main>/.git/worktrees/<name>
    // If worktreeDir is /tmp/xyz and gitdir is ../main-repo/.git/worktrees/br
    // then absGitdir = /tmp/main-repo/.git/worktrees/br
    // and mainRoot = /tmp/main-repo
    const mainRepoDir = mkdtempSync(join(tmpdir(), "hatch3r-main-repo-"));
    mkdirSync(join(mainRepoDir, ".git", "worktrees", "feat"), {
      recursive: true,
    });

    // Compute relative path from tempDir to mainRepoDir/.git/worktrees/feat
    const relPath = relative(tempDir, join(mainRepoDir, ".git/worktrees/feat"));

    writeFileSync(join(tempDir, ".git"), `gitdir: ${relPath}\n`, "utf-8");

    const result = findMainWorktree(tempDir);
    expect(result).toBe(mainRepoDir);

    rmSync(mainRepoDir, { recursive: true, force: true });
  });

  it("throws when .git file has no gitdir: line", () => {
    writeFileSync(join(tempDir, ".git"), "garbage content\n", "utf-8");

    expect(() => findMainWorktree(tempDir)).toThrow(
      /Unable to parse .git file/,
    );
  });

  it("throws when .git file does not exist", () => {
    expect(() => findMainWorktree(tempDir)).toThrow();
  });
});

// ─── isGitIgnored ─────────────────────────────────────────────────────────────

describe("isGitIgnored", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempGitRepo();
    writeFileSync(
      join(repoDir, ".gitignore"),
      "node_modules/\n*.log\n.env\n",
      "utf-8",
    );
    execFileSync("git", ["add", ".gitignore"], {
      cwd: repoDir,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "init"], {
      cwd: repoDir,
      stdio: "ignore",
    });
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns true for a gitignored file", () => {
    expect(isGitIgnored(repoDir, ".env")).toBe(true);
  });

  it("returns true for a gitignored directory", () => {
    expect(isGitIgnored(repoDir, "node_modules/")).toBe(true);
  });

  it("returns true for a file matching a glob pattern", () => {
    expect(isGitIgnored(repoDir, "server.log")).toBe(true);
  });

  it("returns false for a file that is not gitignored", () => {
    expect(isGitIgnored(repoDir, "index.ts")).toBe(false);
  });
});

// ─── parseWorktreeInclude (resolve-adjacent) ──────────────────────────────────

describe("parseWorktreeInclude", () => {
  it("parses a minimal include with copy and symlink entries", () => {
    const content = [
      "# hatch3r worktree include file",
      "",
      MANAGED_BLOCK_START,
      "# environment variables",
      ".env",
      "# shared deps",
      "node_modules/  # hatch3r:symlink",
      MANAGED_BLOCK_END,
    ].join("\n");

    const entries = parseWorktreeInclude(content);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      pattern: ".env",
      strategy: "copy",
      reason: "environment variables",
    });
    expect(entries[1]).toEqual({
      pattern: "node_modules/",
      strategy: "symlink",
      reason: "shared deps",
    });
  });

  it("skips empty lines and standalone comments", () => {
    const content = [
      "# just a comment",
      "",
      "",
      "# another comment",
    ].join("\n");

    const entries = parseWorktreeInclude(content);
    expect(entries).toHaveLength(0);
  });

  it("clears reason context after an empty line", () => {
    const content = [
      "# reason one",
      "",
      ".env",
    ].join("\n");

    const entries = parseWorktreeInclude(content);
    expect(entries).toHaveLength(1);
    // After an empty line, lastComment is reset, so reason is undefined
    expect(entries[0].reason).toBeUndefined();
  });

  it("handles entries without a preceding comment", () => {
    const content = ".env\nnode_modules/  # hatch3r:symlink\n";
    const entries = parseWorktreeInclude(content);

    expect(entries).toHaveLength(2);
    expect(entries[0].reason).toBeUndefined();
    expect(entries[1].reason).toBeUndefined();
  });
});

// ─── extractManagedContent ────────────────────────────────────────────────────

describe("extractManagedContent", () => {
  it("extracts content between managed block markers", () => {
    const content = [
      "# header",
      MANAGED_BLOCK_START,
      ".env",
      "node_modules/  # hatch3r:symlink",
      MANAGED_BLOCK_END,
      "# footer",
    ].join("\n");

    const extracted = extractManagedContent(content);
    expect(extracted).toContain(".env");
    expect(extracted).toContain("node_modules/");
    expect(extracted).not.toContain("# header");
    expect(extracted).not.toContain("# footer");
  });

  it("returns empty string when no markers are present", () => {
    expect(extractManagedContent("no markers here")).toBe("");
  });

  it("returns empty string when only start marker is present", () => {
    expect(extractManagedContent(MANAGED_BLOCK_START + "\ncontent")).toBe("");
  });

  it("returns empty string when only end marker is present", () => {
    expect(extractManagedContent("content\n" + MANAGED_BLOCK_END)).toBe("");
  });

  it("returns empty string for adjacent markers with no content", () => {
    const content = MANAGED_BLOCK_START + "\n" + MANAGED_BLOCK_END;
    const extracted = extractManagedContent(content);
    expect(extracted).toBe("");
  });
});
