import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  lstat,
  symlink,
  access,
} from "node:fs/promises";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
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
import { wrapInManagedBlock } from "../../merge/managedBlocks.js";
import { safeWriteFile } from "../../merge/safeWrite.js";

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
  // Isolate the test fixture from the host's git line-ending policy.
  // Windows runners default to core.autocrlf=true, which would CRLF-ize
  // files on checkout and turn the G6 round-trip test into a line-ending
  // assertion. The unit under test is safeWriteFile's byte-equality
  // contract, not git's eol behavior.
  execFileSync("git", ["config", "core.autocrlf", "false"], {
    cwd: dir,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "core.eol", "lf"], {
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

  // ─────────────────────────────────────────────────────────────────────────
  // G6 (v1.7.1) — End-to-end regression guard for the worktree-setup
  // "many local git changes" symptom. Simulates the exact sequence that
  // worktree-setup runs: a hatch3r-managed file is written + committed in
  // main, then a real `git worktree add` checks it out into a fresh
  // worktree, then we re-run the same merge-layer write inside the
  // worktree (as syncWorktree would). The worktree's `git status` MUST
  // be empty — that is the user-facing contract this release restores.
  // ─────────────────────────────────────────────────────────────────────────

  it("worktree round-trip after commit shows no git drift (G6 v1.7.1)", async () => {
    // Adapter-style write in main: wrapInManagedBlock + safeWriteFile is
    // the same path every adapter uses for pure managed-block outputs.
    const body = "rule body line 1\nrule body line 2";
    const content = wrapInManagedBlock(body);
    const mainFile = join(mainRepo, "hatch3r-roundtrip-test.md");
    await safeWriteFile(mainFile, content);

    // Commit on main so the worktree checks out the committed bytes.
    execFileSync("git", ["add", "."], { cwd: mainRepo, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "add managed file"], {
      cwd: mainRepo,
      stdio: "ignore",
    });

    // Real git worktree on a new branch — exactly what hatch3r
    // worktree-setup does via addGitWorktree.
    const wtPath = mkdtempSync(join(tmpdir(), "hatch3r-wt-roundtrip-"));
    rmSync(wtPath, { recursive: true, force: true });
    try {
      execFileSync(
        "git",
        ["worktree", "add", "-b", "feat-roundtrip-test", wtPath],
        { cwd: mainRepo, stdio: "ignore" },
      );

      // Re-run the same managed-block write inside the worktree
      // (simulates `npx hatch3r sync` inside the new worktree).
      const wtFile = join(wtPath, "hatch3r-roundtrip-test.md");
      const result = await safeWriteFile(wtFile, content);
      expect(result.action).toBe("unchanged");

      // The user-facing contract: the new worktree's git status is clean.
      const status = execFileSync("git", ["status", "--porcelain"], {
        cwd: wtPath,
      }).toString();
      expect(status).toBe("");
    } finally {
      // Detach the worktree so git's state stays consistent for other tests.
      try {
        execFileSync(
          "git",
          ["worktree", "remove", "--force", wtPath],
          { cwd: mainRepo, stdio: "ignore" },
        );
      } catch (err) {
        // Worktree may already be gone if the test threw before `add` ran.
        void err;
      }
      rmSync(wtPath, { recursive: true, force: true });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // F1.10-H2 (cycle 10 wave 2) — glob patterns paired with the symlink
  // strategy must surface a structured error instead of silently falling
  // back to copy. The strategy-resolution loop only does literal-prefix
  // matching, so `.cache/*.log  # hatch3r:symlink` cannot be honoured —
  // record an error and downgrade to copy.
  // ─────────────────────────────────────────────────────────────────────────

  it("records error for symlink-strategy entries with glob metacharacters (F1.10-H2)", async () => {
    writeFileSync(join(mainRepo, ".gitignore"), ".cache/\n", "utf-8");
    mkdirSync(join(mainRepo, ".cache"));
    writeFileSync(join(mainRepo, ".cache", "a.log"), "log\n", "utf-8");
    execFileSync("git", ["add", ".gitignore"], { cwd: mainRepo, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: mainRepo, stdio: "ignore" });

    // Glob pattern (`*.log`) with symlink annotation — must be rejected.
    writeIncludeFile(mainRepo, [
      { pattern: ".cache/*.log", strategy: "symlink", reason: "glob symlink" },
    ]);

    const result = await setupWorktree(mainRepo, worktreeDir);
    expect(
      result.errors.some((e) => e.includes(".cache/*.log") && /glob/.test(e)),
    ).toBe(true);
    // Anything that did get resolved must NOT have been symlinked.
    expect(result.symlinked).toEqual([]);
  });

  it("accepts globs with copy strategy (no error)", async () => {
    writeFileSync(join(mainRepo, ".gitignore"), ".cache/\n", "utf-8");
    mkdirSync(join(mainRepo, ".cache"));
    writeFileSync(join(mainRepo, ".cache", "a.log"), "log\n", "utf-8");
    execFileSync("git", ["add", ".gitignore"], { cwd: mainRepo, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: mainRepo, stdio: "ignore" });

    writeIncludeFile(mainRepo, [
      { pattern: ".cache/*.log", strategy: "copy", reason: "glob copy" },
    ]);

    const result = await setupWorktree(mainRepo, worktreeDir);
    expect(result.errors).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // F1.10-H3 (cycle 10 wave 2) — TOCTOU hardening. The pre-write lstat
  // probe is gone; setup relies on syscall-level atomicity (copyFile
  // COPYFILE_EXCL, symlink throws EEXIST). The pre-existing idempotency,
  // mixed-strategy, and force-overwrite tests above already cover the
  // observable outcomes; this case pins the "exists" branch behaviour for
  // a copy with --force to detect any future regression in the unlink +
  // retry path.
  // ─────────────────────────────────────────────────────────────────────────

  it("re-runs with --force replace existing target atomically (F1.10-H3)", async () => {
    writeFileSync(join(mainRepo, ".gitignore"), ".env\n", "utf-8");
    writeFileSync(join(mainRepo, ".env"), "NEW=value\n", "utf-8");
    execFileSync("git", ["add", ".gitignore"], { cwd: mainRepo, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: mainRepo, stdio: "ignore" });

    writeIncludeFile(mainRepo, [{ pattern: ".env", strategy: "copy" }]);

    // Pre-create the file in the target so the copy hits EEXIST first.
    await writeFile(join(worktreeDir, ".env"), "OLD=value\n");

    const result = await setupWorktree(mainRepo, worktreeDir, { force: true });
    expect(result.copied).toContain(".env");
    expect(result.skipped).not.toContain(".env");

    // Verify the contents really were replaced (no silent skip).
    const content = await readFile(join(worktreeDir, ".env"), "utf-8");
    expect(content).toBe("NEW=value\n");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // D3-SA3.4-04 — overlapping-pattern strategy resolution at the setup seam.
  // The D1-12 isolation mechanism relies on the resolver taking the LAST
  // matching `.worktreeinclude` entry (not the most-specific): a specific copy
  // override emitted AFTER a broad symlink pattern must win for its own path,
  // while a sibling under the broad pattern stays symlinked. The generation
  // layer pins entry ORDER (generate.test.ts); this pins the resolver APPLYING
  // that order — the seam a "break on first match" refactor would silently
  // regress, de-linking or clobbering the main repo's manifest through a symlink.
  // ─────────────────────────────────────────────────────────────────────────
  it("last-matching copy override wins for its path while siblings stay symlinked (D1-12 seam)", async () => {
    writeFileSync(join(mainRepo, ".gitignore"), ".hatch3r/\n", "utf-8");
    mkdirSync(join(mainRepo, ".hatch3r"));
    writeFileSync(join(mainRepo, ".hatch3r", "hatch.json"), '{"version":"1"}\n', "utf-8");
    writeFileSync(join(mainRepo, ".hatch3r", "overrides.txt"), "shared\n", "utf-8");
    execFileSync("git", ["add", ".gitignore"], { cwd: mainRepo, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: mainRepo, stdio: "ignore" });

    // Broad symlink pattern FIRST, specific copy override AFTER — the exact
    // ordering generateWorktreeInclude emits for the .hatch3r/ manifest override.
    writeIncludeFile(mainRepo, [
      { pattern: ".hatch3r/", strategy: "symlink", reason: "shared hatch3r state" },
      { pattern: ".hatch3r/hatch.json", strategy: "copy", reason: "per-worktree manifest" },
    ]);

    const result = await setupWorktree(mainRepo, worktreeDir);

    // The specific override wins for hatch.json (last matching entry = copy).
    expect(result.copied).toContain(".hatch3r/hatch.json");
    expect(result.symlinked).not.toContain(".hatch3r/hatch.json");
    const manifestStat = await lstat(join(worktreeDir, ".hatch3r", "hatch.json"));
    expect(manifestStat.isSymbolicLink()).toBe(false);
    expect(manifestStat.isFile()).toBe(true);

    // The sibling under the broad pattern (no override) stays symlinked.
    expect(result.symlinked).toContain(".hatch3r/overrides.txt");
    expect(result.copied).not.toContain(".hatch3r/overrides.txt");
    const siblingStat = await lstat(join(worktreeDir, ".hatch3r", "overrides.txt"));
    expect(siblingStat.isSymbolicLink()).toBe(true);
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

// ── setup → cleanup inverse property (D1-SA1.10-02) ───────────────────────────
// The pre-receipt cleanup lstat()'d each raw `.worktreeinclude` pattern string,
// so it could NOT invert two shapes setup routinely produces: a glob copy
// (`.env.*` → the concrete `.env.mcp` plaintext secret) and a symlink-strategy
// DIRECTORY that setup materialized as a per-file symlink tree. The setup
// receipt records the concrete created paths so cleanup removes exactly them.
// These run against a REAL `git worktree add` fixture because cleanup resolves
// the main repo (for the copy byte-equal check) via the worktree's `.git`
// pointer file.

describe("setupWorktree + cleanupWorktree inverse property (D1-SA1.10-02)", () => {
  let mainRepo: string;

  beforeEach(() => {
    mainRepo = makeTempGitRepo();
  });

  afterEach(() => {
    rmSync(mainRepo, { recursive: true, force: true });
  });

  /** Real `git worktree add` on a fresh branch; returns the worktree path. */
  function addRealWorktree(branch: string): string {
    const wtPath = mkdtempSync(join(tmpdir(), "hatch3r-wt-inverse-"));
    rmSync(wtPath, { recursive: true, force: true });
    execFileSync("git", ["worktree", "add", "-b", branch, wtPath], {
      cwd: mainRepo,
      stdio: "ignore",
    });
    return wtPath;
  }

  function removeRealWorktree(wtPath: string): void {
    try {
      execFileSync("git", ["worktree", "remove", "--force", wtPath], {
        cwd: mainRepo,
        stdio: "ignore",
      });
    } catch (err) {
      void err;
    }
    rmSync(wtPath, { recursive: true, force: true });
  }

  it("cleanup removes glob-copied secrets AND per-file symlink trees setup created", async () => {
    writeFileSync(join(mainRepo, ".gitignore"), ".env.*\nshared/\n", "utf-8");
    writeFileSync(join(mainRepo, ".env.mcp"), "SECRET=xyz\n", "utf-8");
    mkdirSync(join(mainRepo, "shared", "nested"), { recursive: true });
    writeFileSync(join(mainRepo, "shared", "a.js"), "//a", "utf-8");
    writeFileSync(join(mainRepo, "shared", "nested", "b.js"), "//b", "utf-8");
    execFileSync("git", ["add", ".gitignore"], { cwd: mainRepo, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: mainRepo, stdio: "ignore" });

    // A GLOB COPY entry (.env.* → .env.mcp) and a SYMLINK DIRECTORY entry
    // (shared/ → per-file symlinks) — the two shapes the old cleanup leaked.
    writeIncludeFile(mainRepo, [
      { pattern: ".env.*", strategy: "copy", reason: "env glob (includes .env.mcp)" },
      { pattern: "shared/", strategy: "symlink", reason: "shared dir" },
    ]);

    const wtPath = addRealWorktree("feat-inverse");
    try {
      const setup = await setupWorktree(mainRepo, wtPath);
      // Setup materialized both shapes.
      expect(setup.copied).toContain(".env.mcp");
      expect(setup.symlinked).toContain("shared/a.js");
      expect(setup.symlinked).toContain("shared/nested/b.js");
      // Pre-cleanup: the residues the OLD cleanup left behind are present.
      expect(existsSync(join(wtPath, ".env.mcp"))).toBe(true);
      expect(existsSync(join(wtPath, "shared", "a.js"))).toBe(true);

      await cleanupWorktree(wtPath);

      // Inverse property: every setup-created path is gone.
      expect(existsSync(join(wtPath, ".env.mcp"))).toBe(false);
      expect(existsSync(join(wtPath, "shared", "a.js"))).toBe(false);
      expect(existsSync(join(wtPath, "shared", "nested", "b.js"))).toBe(false);
    } finally {
      removeRealWorktree(wtPath);
    }
  });

  it("preserves a user-modified copy during cleanup (byte-equal guard, receipt path)", async () => {
    writeFileSync(join(mainRepo, ".gitignore"), ".env\n", "utf-8");
    writeFileSync(join(mainRepo, ".env"), "SECRET=42\n", "utf-8");
    execFileSync("git", ["add", ".gitignore"], { cwd: mainRepo, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: mainRepo, stdio: "ignore" });
    writeIncludeFile(mainRepo, [{ pattern: ".env", strategy: "copy" }]);

    const wtPath = addRealWorktree("feat-inverse2");
    try {
      await setupWorktree(mainRepo, wtPath);
      // User edits the copied .env after setup — it diverges from source.
      writeFileSync(join(wtPath, ".env"), "SECRET=EDITED\n", "utf-8");

      await cleanupWorktree(wtPath);

      // The user-modified copy is preserved, never blind-deleted.
      expect(existsSync(join(wtPath, ".env"))).toBe(true);
      expect(readFileSync(join(wtPath, ".env"), "utf-8")).toBe("SECRET=EDITED\n");
    } finally {
      removeRealWorktree(wtPath);
    }
  });
});
