import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";

import {
  resolvePatterns,
  isInsideWorktree,
  findMainWorktree,
  isGitIgnored,
  listWorktrees,
  getWorktreeStatus,
} from "../../worktree/resolve.js";
import {
  parseWorktreeInclude,
  extractManagedContent,
  addGitWorktree,
  removeGitWorktree,
  ensureWorktreesIgnored,
  isValidBranchName,
  localBranchExists,
  remoteBranchExists,
  hasOriginRemote,
  fetchOriginBranch,
  resolveWorktreeBranchPlan,
  WORKTREES_DIR,
} from "../../worktree/index.js";
import { readFileSync, existsSync } from "node:fs";
import { MANAGED_BLOCK_START, MANAGED_BLOCK_END, HatchError } from "../../types.js";
import { setVerbose } from "../../cli/shared/ui.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Creates a temp directory with `git init` and returns its canonical path.
 *  Uses `realpathSync.native` so on macOS `/var/...` → `/private/var/...`
 *  (symlink resolution) AND on Windows the 8.3 short form returned by
 *  `os.tmpdir()` (`C:\\Users\\RUNNER~1\\...`) is upgraded to the long form
 *  via `GetFinalPathNameByHandleW`. listWorktrees uses the same native
 *  realpath, so the two strings can be compared directly. */
function makeTempGitRepo(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "hatch3r-resolve-test-")));
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

  it("returns empty paths when patterns list is empty", async () => {
    const result = await resolvePatterns(repoDir, []);
    expect(result.paths).toEqual([]);
    expect(result.error).toBeUndefined();
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
    expect(result.paths).toContain(".env");
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
    expect(result.paths).toContain("build/out.js");
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
    expect(result.paths).toEqual([]);
    expect(result.error).toBeUndefined();
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
    expect(result.paths).toContain(".env");
    expect(result.paths).toContain("app.log");
  });

  // D1-SA1.10-03 (D1, P2): a hard git failure must be RETURNED to the caller
  // (as `error`), not just logged and returned as an empty array — that is how
  // `setupWorktree` surfaces the failure in `result.errors` instead of printing
  // a success box on an empty include set.
  it("returns paths:[] AND a structured error on git failure (invalid directory)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await resolvePatterns("/nonexistent-dir-xyz", ["*.txt"]);
    expect(result.paths).toEqual([]);
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/worktree pattern resolution/);
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
    // F1.10-H1: findMainWorktree now canonicalises via realpathSync.native,
    // so the expected value must be canonicalised too (on macOS the temp dir
    // is under /var which realpath resolves to /private/var).
    expect(result).toBe(realpathSync.native(mainRepoDir));

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
    // F1.10-H1: canonicalised return (see note above).
    expect(result).toBe(realpathSync.native(mainRepoDir));

    rmSync(mainRepoDir, { recursive: true, force: true });
  });

  it("throws when .git file has no gitdir: line", () => {
    writeFileSync(join(tempDir, ".git"), "garbage content\n", "utf-8");

    expect(() => findMainWorktree(tempDir)).toThrow(
      /Unable to parse .git file/,
    );
    // release/2.8.0 exit-code drift fix: ERROR_CODE_TO_EXIT_CODE governs
    // (FS_ERROR → 74), no hard-coded exit 1.
    try {
      findMainWorktree(tempDir);
      expect.unreachable("findMainWorktree should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HatchError);
      expect((e as HatchError).errorCode).toBe("FS_ERROR");
      expect((e as HatchError).exitCode).toBe(74);
    }
  });

  it("throws when .git file does not exist", () => {
    expect(() => findMainWorktree(tempDir)).toThrow();
  });

  // F1.10-H1 (Cycle 10 D1): findMainWorktree must return a path that compares
  // byte-for-byte against listWorktrees (which already realpath.native's every
  // porcelain path). On macOS os.tmpdir() lives under /var → /private/var; an
  // un-canonicalised findMainWorktree would diverge and break the
  // worktree-setup/cleanup pairing's string comparison.
  it("returns a path byte-for-byte equal to listWorktrees()[0].path for a real worktree", () => {
    const mainRoot = makeTempGitRepo();
    try {
      commitInitial(mainRoot);
      const wtPath = join(mainRoot, WORKTREES_DIR, "feat-parity");
      addGitWorktree(mainRoot, "feat-parity", wtPath);

      // The worktree's .git file points back at the main repo; findMainWorktree
      // resolves it. Its result must equal listWorktrees(mainRoot)[0].path —
      // the canonicalised main-worktree path — exactly.
      const fromFind = findMainWorktree(wtPath);
      const fromList = listWorktrees(mainRoot)[0].path;
      expect(fromFind).toBe(fromList);
    } finally {
      rmSync(mainRoot, { recursive: true, force: true });
    }
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

// ─── listWorktrees / getWorktreeStatus / git wrappers ────────────────────────

function commitInitial(repoDir: string): void {
  writeFileSync(join(repoDir, "README.md"), "init\n", "utf-8");
  execFileSync("git", ["add", "README.md"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repoDir, stdio: "ignore" });
}

describe("listWorktrees", () => {
  let mainRoot: string;

  beforeEach(() => {
    mainRoot = makeTempGitRepo();
    commitInitial(mainRoot);
  });

  afterEach(() => {
    rmSync(mainRoot, { recursive: true, force: true });
  });

  it("returns the main worktree when no others exist", () => {
    const entries = listWorktrees(mainRoot);
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe(mainRoot);
    expect(entries[0].branch).toBe("refs/heads/main");
    expect(entries[0].locked).toBe(false);
    expect(entries[0].prunable).toBe(false);
  });

  it("enumerates an added worktree", () => {
    const wtPath = join(mainRoot, WORKTREES_DIR, "feat-x");
    addGitWorktree(mainRoot, "feat-x", wtPath);

    const entries = listWorktrees(mainRoot);
    expect(entries).toHaveLength(2);
    const wt = entries.find((e) => e.path === wtPath);
    expect(wt).toBeDefined();
    expect(wt!.branch).toBe("refs/heads/feat-x");
    expect(wt!.detached).toBe(false);
  });

  it("flags locked worktrees", () => {
    const wtPath = join(mainRoot, WORKTREES_DIR, "feat-y");
    addGitWorktree(mainRoot, "feat-y", wtPath);
    execFileSync("git", ["-C", mainRoot, "worktree", "lock", wtPath], { stdio: "ignore" });

    const entries = listWorktrees(mainRoot);
    const wt = entries.find((e) => e.path === wtPath);
    expect(wt?.locked).toBe(true);
  });

  it("throws on git failure (non-repo)", () => {
    expect(() => listWorktrees("/nonexistent-dir-xyz")).toThrow();
  });

  // D1-SA1.10-07 (D1, P5 — Silent Failure Contract): when a worktree is prunable
  // (its directory deleted from disk but still tracked in .git/worktrees),
  // realpathSync.native throws ENOENT. The best-effort separator-normalise
  // fallback stays, but the swallowed failure now emits a --verbose diagnostic
  // via recordWorktreeProbeFailure instead of vanishing.
  it("emits a verbose diagnostic when a prunable worktree fails realpath canonicalization", () => {
    const wtPath = join(mainRoot, WORKTREES_DIR, "feat-prunable");
    addGitWorktree(mainRoot, "feat-prunable", wtPath);
    // Delete the worktree dir WITHOUT `git worktree prune`, so git still lists
    // it (flagged prunable) but realpathSync.native(wtPath) throws ENOENT.
    rmSync(wtPath, { recursive: true, force: true });

    setVerbose(true);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const entries = listWorktrees(mainRoot);
      // The prunable entry is still enumerated (best-effort normalise kept).
      expect(entries.some((e) => e.prunable)).toBe(true);
      // Silent Failure Contract: the realpath failure emitted a diagnostic.
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("listWorktrees"),
      );
    } finally {
      consoleSpy.mockRestore();
      setVerbose(false);
    }
  });
});

describe("getWorktreeStatus", () => {
  let mainRoot: string;

  beforeEach(() => {
    mainRoot = makeTempGitRepo();
    commitInitial(mainRoot);
  });

  afterEach(() => {
    rmSync(mainRoot, { recursive: true, force: true });
  });

  it("returns zeros for a clean worktree", () => {
    const s = getWorktreeStatus(mainRoot);
    expect(s).toEqual({ modified: 0, untracked: 0 });
  });

  it("counts modified and untracked files", () => {
    writeFileSync(join(mainRoot, "README.md"), "changed\n", "utf-8");
    writeFileSync(join(mainRoot, "newfile.txt"), "hi\n", "utf-8");

    const s = getWorktreeStatus(mainRoot);
    expect(s.modified).toBe(1);
    expect(s.untracked).toBe(1);
  });

  // D1-32 (Cycle 11 Wave 3): `git stash` writes to a single repo-global
  // `refs/stash`, so a stash is not per-worktree state. After stashing all
  // changes the working tree is clean and getWorktreeStatus must report zeros —
  // it must NOT surface the shared stash stack as worktree dirtiness, which
  // previously triggered a false `worktree-cleanup` destruction-confirm prompt.
  it("does not report a repo-global stash as worktree dirtiness", () => {
    writeFileSync(join(mainRoot, "README.md"), "changed\n", "utf-8");
    execFileSync("git", ["-C", mainRoot, "stash", "push", "-m", "wip"], { stdio: "ignore" });
    const s = getWorktreeStatus(mainRoot);
    expect(s).toEqual({ modified: 0, untracked: 0 });
  });

  it("returns zeros (no throw) on missing path", () => {
    const s = getWorktreeStatus("/nonexistent-dir-xyz");
    expect(s).toEqual({ modified: 0, untracked: 0 });
  });

  // D1-SA1.10-07 (D1, P5 — Silent Failure Contract): the soft-probe catch must
  // still emit a --verbose diagnostic when git fails, so a systemic failure
  // (git missing from PATH, permission wall) is observable rather than silently
  // badging every worktree "clean". Return value stays zeros (soft-probe
  // semantics unchanged).
  it("emits a verbose diagnostic when the git status probe fails", () => {
    setVerbose(true);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const s = getWorktreeStatus("/nonexistent-dir-xyz");
      expect(s).toEqual({ modified: 0, untracked: 0 });
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("getWorktreeStatus(/nonexistent-dir-xyz)"),
      );
    } finally {
      consoleSpy.mockRestore();
      setVerbose(false);
    }
  });

  // The diagnostic is gated on --verbose so a normal (non-verbose) run of the
  // soft probe stays silent on stderr — no per-invocation noise.
  it("stays silent on stderr when the probe fails and verbose is off", () => {
    setVerbose(false);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const s = getWorktreeStatus("/nonexistent-dir-xyz");
      expect(s).toEqual({ modified: 0, untracked: 0 });
      expect(consoleSpy).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe("addGitWorktree / removeGitWorktree", () => {
  let mainRoot: string;

  beforeEach(() => {
    mainRoot = makeTempGitRepo();
    commitInitial(mainRoot);
  });

  afterEach(() => {
    rmSync(mainRoot, { recursive: true, force: true });
  });

  it("creates a worktree on a new branch", () => {
    const wtPath = join(mainRoot, WORKTREES_DIR, "feat-add");
    addGitWorktree(mainRoot, "feat-add", wtPath);
    expect(existsSync(wtPath)).toBe(true);
    const branches = execFileSync("git", ["-C", mainRoot, "branch", "--list", "feat-add"], {
      encoding: "utf-8",
    });
    expect(branches).toContain("feat-add");
  });

  // release/2.8.0: replaces the old message-only collision test with the
  // exit-code contract — ERROR_CODE_TO_EXIT_CODE governs (VALIDATION_ERROR →
  // 64), never a hard-coded exit 1, and the hint steers to --use-existing.
  it("create-mode existing-branch collision → VALIDATION_ERROR, exit 64, --use-existing hint", () => {
    execFileSync("git", ["-C", mainRoot, "branch", "dup"], { stdio: "ignore" });
    const wtPath = join(mainRoot, WORKTREES_DIR, "dup");
    try {
      addGitWorktree(mainRoot, "dup", wtPath);
      expect.unreachable("addGitWorktree should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HatchError);
      const err = e as HatchError;
      expect(err.message).toMatch(/already exists/i);
      expect(err.errorCode).toBe("VALIDATION_ERROR");
      expect(err.exitCode).toBe(64);
      expect(err.recoveryHint).toContain("--use-existing");
    }
  });

  it("attach mode reuses the existing local branch (no -b): worktree HEAD is that branch", () => {
    execFileSync("git", ["-C", mainRoot, "branch", "feat-attach"], { stdio: "ignore" });
    const wtPath = join(mainRoot, WORKTREES_DIR, "feat-attach");
    // `worktree add -b feat-attach` would refuse (branch exists) — success
    // here proves the attach argv shape (no -b) was used.
    addGitWorktree(mainRoot, "feat-attach", wtPath, { mode: "attach" });
    expect(existsSync(wtPath)).toBe(true);
    const head = execFileSync(
      "git",
      ["-C", wtPath, "rev-parse", "--abbrev-ref", "HEAD"],
      { encoding: "utf-8" },
    ).trim();
    expect(head).toBe("feat-attach");
  });

  // Branch checked out in another worktree: 'main' is held by the main
  // worktree itself, so attaching it must refuse — classified via REAL
  // `git worktree list --porcelain` output, naming the holder's path.
  it("branch checked out elsewhere → VALIDATION_ERROR 64 naming the other worktree's path", () => {
    const wtPath = join(mainRoot, WORKTREES_DIR, "main-again");
    try {
      addGitWorktree(mainRoot, "main", wtPath, { mode: "attach" });
      expect.unreachable("addGitWorktree should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HatchError);
      const err = e as HatchError;
      expect(err.errorCode).toBe("VALIDATION_ERROR");
      expect(err.exitCode).toBe(64);
      expect(err.message).toContain(mainRoot); // porcelain-derived holder path
      expect(err.recoveryHint).toMatch(/worktree-cleanup/);
    }
  });

  it("removes a worktree and preserves the branch", () => {
    const wtPath = join(mainRoot, WORKTREES_DIR, "feat-rm");
    addGitWorktree(mainRoot, "feat-rm", wtPath);
    removeGitWorktree(mainRoot, wtPath, { force: true });
    expect(existsSync(wtPath)).toBe(false);
    const branches = execFileSync("git", ["-C", mainRoot, "branch", "--list", "feat-rm"], {
      encoding: "utf-8",
    });
    expect(branches).toContain("feat-rm");
  });

  // release/2.8.0 exit-code drift fix sweep: remove failures map FS_ERROR → 74.
  it("removeGitWorktree failure → FS_ERROR, exit 74 (no hard-coded 1)", () => {
    try {
      removeGitWorktree(mainRoot, join(mainRoot, "no-such-worktree"));
      expect.unreachable("removeGitWorktree should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HatchError);
      expect((e as HatchError).errorCode).toBe("FS_ERROR");
      expect((e as HatchError).exitCode).toBe(74);
    }
  });
});

// ─── Branch detection + plan (release/2.8.0 attach mode) ─────────────────────

describe("branch detection + resolveWorktreeBranchPlan (real git)", () => {
  let originRoot: string;
  let consumerRoot: string;

  beforeEach(() => {
    // originRoot plays the remote: a plain local repo addressed by path.
    originRoot = makeTempGitRepo();
    commitInitial(originRoot);
    execFileSync("git", ["-C", originRoot, "branch", "remote-only"], { stdio: "ignore" });

    consumerRoot = makeTempGitRepo();
    commitInitial(consumerRoot);
    execFileSync("git", ["-C", consumerRoot, "remote", "add", "origin", originRoot], {
      stdio: "ignore",
    });
  });

  afterEach(() => {
    rmSync(originRoot, { recursive: true, force: true });
    rmSync(consumerRoot, { recursive: true, force: true });
  });

  it("localBranchExists: true for a real local branch, false otherwise", () => {
    expect(localBranchExists(consumerRoot, "main")).toBe(true);
    expect(localBranchExists(consumerRoot, "nope")).toBe(false);
  });

  it("hasOriginRemote: true when origin is configured, false when not", () => {
    expect(hasOriginRemote(consumerRoot)).toBe(true);
    expect(hasOriginRemote(originRoot)).toBe(false);
  });

  it("fetchOriginBranch materializes refs/remotes/origin/<name> for remoteBranchExists", () => {
    expect(remoteBranchExists(consumerRoot, "remote-only")).toBe(false);
    fetchOriginBranch(consumerRoot, "remote-only");
    expect(remoteBranchExists(consumerRoot, "remote-only")).toBe(true);
  });

  it("fetchOriginBranch is soft when the branch is absent upstream (no throw)", () => {
    expect(() => fetchOriginBranch(consumerRoot, "no-such-branch")).not.toThrow();
  });

  it("fetchOriginBranch → NETWORK_ERROR, exit 75, when origin is unreachable", () => {
    execFileSync(
      "git",
      ["-C", consumerRoot, "remote", "set-url", "origin", join(consumerRoot, "no-such-origin.git")],
      { stdio: "ignore" },
    );
    try {
      fetchOriginBranch(consumerRoot, "remote-only");
      expect.unreachable("fetchOriginBranch should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HatchError);
      const err = e as HatchError;
      expect(err.errorCode).toBe("NETWORK_ERROR");
      expect(err.exitCode).toBe(75);
      expect(err.recoveryHint).toMatch(/git remote -v/);
    }
  });

  it("plan: existing local branch → attach", () => {
    expect(resolveWorktreeBranchPlan(consumerRoot, "main")).toEqual({ mode: "attach" });
  });

  it("plan: remote-only branch → track (fetch performed)", () => {
    expect(resolveWorktreeBranchPlan(consumerRoot, "remote-only")).toEqual({ mode: "track" });
  });

  it("plan: unknown name → create (missing upstream ref is soft)", () => {
    expect(resolveWorktreeBranchPlan(consumerRoot, "brand-new")).toEqual({ mode: "create" });
  });

  it("plan with allowFetch:false (dry-run shape) stays offline: create without a cached ref, track with one", () => {
    // Unreachable origin proves no fetch is attempted when allowFetch:false.
    execFileSync(
      "git",
      ["-C", consumerRoot, "remote", "set-url", "origin", join(consumerRoot, "no-such-origin.git")],
      { stdio: "ignore" },
    );
    expect(
      resolveWorktreeBranchPlan(consumerRoot, "remote-only", { allowFetch: false }),
    ).toEqual({ mode: "create" });
  });

  it("plan with allowFetch:false honors an already-fetched tracking ref → track", () => {
    fetchOriginBranch(consumerRoot, "remote-only");
    expect(
      resolveWorktreeBranchPlan(consumerRoot, "remote-only", { allowFetch: false }),
    ).toEqual({ mode: "track" });
  });

  it("track mode creates the worktree on a local branch tracking origin/<name>", () => {
    fetchOriginBranch(consumerRoot, "remote-only");
    const wtPath = join(consumerRoot, WORKTREES_DIR, "remote-only");
    addGitWorktree(consumerRoot, "remote-only", wtPath, { mode: "track" });
    const upstream = execFileSync(
      "git",
      ["-C", wtPath, "rev-parse", "--abbrev-ref", "remote-only@{upstream}"],
      { encoding: "utf-8" },
    ).trim();
    expect(upstream).toBe("origin/remote-only");
  });
});

describe("isValidBranchName", () => {
  it("accepts simple names", () => {
    expect(isValidBranchName("feat-x")).toBe(true);
    expect(isValidBranchName("release/1.7.0")).toBe(true);
    expect(isValidBranchName("hotfix.urgent")).toBe(true);
  });

  it("rejects empty / invalid names", () => {
    expect(isValidBranchName("")).toBe(false);
    expect(isValidBranchName("..")).toBe(false);
    expect(isValidBranchName("-leading-dash")).toBe(false);
    expect(isValidBranchName("with space")).toBe(false);
    expect(isValidBranchName("with..double")).toBe(false);
  });
});

describe("ensureWorktreesIgnored", () => {
  let mainRoot: string;

  beforeEach(() => {
    mainRoot = makeTempGitRepo();
  });

  afterEach(() => {
    rmSync(mainRoot, { recursive: true, force: true });
  });

  it("appends a managed block on first call", async () => {
    const added = await ensureWorktreesIgnored(mainRoot);
    expect(added).toBe(true);
    const exclude = readFileSync(join(mainRoot, ".git", "info", "exclude"), "utf-8");
    expect(exclude).toContain("HATCH3R:BEGIN");
    expect(exclude).toContain(`${WORKTREES_DIR}/`);
    expect(exclude).toContain("HATCH3R:END");
  });

  it("is idempotent on second call", async () => {
    await ensureWorktreesIgnored(mainRoot);
    const added2 = await ensureWorktreesIgnored(mainRoot);
    expect(added2).toBe(false);
    const exclude = readFileSync(join(mainRoot, ".git", "info", "exclude"), "utf-8");
    expect(exclude.match(/HATCH3R:BEGIN/g)?.length).toBe(1);
  });
});

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
