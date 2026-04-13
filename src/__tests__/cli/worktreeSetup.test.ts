import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HatchError, WORKTREE_INCLUDE_FILE, MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../../types.js";

// Mock child_process so `npx hatch3r sync` doesn't actually run
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn() };
});

// Mock worktree/resolve so we don't need actual git repos
vi.mock("../../worktree/resolve.js", () => ({
  isInsideWorktree: vi.fn(() => false),
  findMainWorktree: vi.fn(() => "/fake/main"),
  resolvePatterns: vi.fn(async () => []),
}));

describe("worktreeSetupCommand", () => {
  let worktreeSetupCommand: typeof import("../../cli/commands/worktreeSetup.js")["worktreeSetupCommand"];
  let isInsideWorktree: ReturnType<typeof vi.fn>;
  let findMainWorktree: ReturnType<typeof vi.fn>;
  let resolvePatterns: ReturnType<typeof vi.fn>;
  let tempDir: string;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeEach(async () => {
    vi.resetModules();

    const resolveModule = await import("../../worktree/resolve.js");
    isInsideWorktree = resolveModule.isInsideWorktree as ReturnType<typeof vi.fn>;
    findMainWorktree = resolveModule.findMainWorktree as ReturnType<typeof vi.fn>;
    resolvePatterns = resolveModule.resolvePatterns as ReturnType<typeof vi.fn>;

    const cmdModule = await import("../../cli/commands/worktreeSetup.js");
    worktreeSetupCommand = cmdModule.worktreeSetupCommand;

    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-wt-setup-"));
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  // ── Error cases ──────────────────────────────────────────────

  it("throws when running from main repo without worktree path", async () => {
    isInsideWorktree.mockReturnValue(false);

    await expect(worktreeSetupCommand()).rejects.toThrow("Missing worktree path");
    try {
      await worktreeSetupCommand();
    } catch (e) {
      expect((e as HatchError).exitCode).toBe(1);
    }
  });

  it("throws when .worktreeinclude is missing", async () => {
    isInsideWorktree.mockReturnValue(false);

    const worktreePath = "feature-branch";
    await mkdir(join(tempDir, worktreePath), { recursive: true });

    await expect(worktreeSetupCommand(worktreePath)).rejects.toThrow(WORKTREE_INCLUDE_FILE);
  });

  // ── Dry run ──────────────────────────────────────────────────

  it("dry run shows summary without making changes", async () => {
    isInsideWorktree.mockReturnValue(false);

    const includeContent = [
      MANAGED_BLOCK_START,
      "# env vars",
      ".env",
      "# shared deps",
      "node_modules/  # hatch3r:symlink",
      MANAGED_BLOCK_END,
    ].join("\n");
    await writeFile(join(tempDir, WORKTREE_INCLUDE_FILE), includeContent);

    const worktreePath = "wt-branch";
    await mkdir(join(tempDir, worktreePath), { recursive: true });

    await worktreeSetupCommand(worktreePath, { dryRun: true });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Dry run");
  });

  // ── Worktree detection ───────────────────────────────────────

  it("detects worktree and uses current directory as target when no path given", async () => {
    isInsideWorktree.mockReturnValue(true);
    findMainWorktree.mockReturnValue(tempDir);

    // Create include file in the main root (which is tempDir in this mock)
    const includeContent = [
      MANAGED_BLOCK_START,
      ".env",
      MANAGED_BLOCK_END,
    ].join("\n");
    await writeFile(join(tempDir, WORKTREE_INCLUDE_FILE), includeContent);

    // resolvePatterns returns nothing (no files to process)
    resolvePatterns.mockResolvedValue([]);

    await worktreeSetupCommand(undefined);

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Detected worktree");
  });

  it("uses --from option to override main root", async () => {
    isInsideWorktree.mockReturnValue(false);

    const customMain = await mkdtemp(join(tmpdir(), "hatch3r-wt-main-"));
    const includeContent = [
      MANAGED_BLOCK_START,
      ".env",
      MANAGED_BLOCK_END,
    ].join("\n");
    await writeFile(join(customMain, WORKTREE_INCLUDE_FILE), includeContent);

    const worktreePath = "wt-from";
    await mkdir(join(tempDir, worktreePath), { recursive: true });
    resolvePatterns.mockResolvedValue([]);

    await worktreeSetupCommand(worktreePath, { from: customMain });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // Should not throw — successfully found worktreeinclude from custom main
    // No files matched, so it reports "No files to set up" which is fine
    expect(output).toContain("No files to set up");

    await rm(customMain, { recursive: true, force: true });
  });

  // ── Successful setup with results ────────────────────────────

  it("reports copied and symlinked files in summary", async () => {
    isInsideWorktree.mockReturnValue(false);

    const includeContent = [
      MANAGED_BLOCK_START,
      "# env vars",
      ".env",
      "# shared deps",
      "node_modules/  # hatch3r:symlink",
      MANAGED_BLOCK_END,
    ].join("\n");
    await writeFile(join(tempDir, WORKTREE_INCLUDE_FILE), includeContent);

    const worktreePath = "wt-full";
    const worktreeDir = join(tempDir, worktreePath);
    await mkdir(worktreeDir, { recursive: true });

    // Create source files so setupWorktree can copy them
    await writeFile(join(tempDir, ".env"), "SECRET=42");
    await mkdir(join(tempDir, "node_modules"), { recursive: true });

    // resolvePatterns returns the matched files
    resolvePatterns.mockResolvedValue([".env"]);

    await worktreeSetupCommand(worktreePath);

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Worktree setup");
  });

  // ── Force option ─────────────────────────────────────────────

  it("passes force option through to setupWorktree", async () => {
    isInsideWorktree.mockReturnValue(false);

    const includeContent = [
      MANAGED_BLOCK_START,
      ".env",
      MANAGED_BLOCK_END,
    ].join("\n");
    await writeFile(join(tempDir, WORKTREE_INCLUDE_FILE), includeContent);

    const worktreePath = "wt-force";
    const worktreeDir = join(tempDir, worktreePath);
    await mkdir(worktreeDir, { recursive: true });

    // Create existing file in the target
    await writeFile(join(worktreeDir, ".env"), "OLD=value");
    // Create source file
    await writeFile(join(tempDir, ".env"), "NEW=value");

    resolvePatterns.mockResolvedValue([".env"]);

    await worktreeSetupCommand(worktreePath, { force: true });

    // With force, the file should be overwritten
    const content = await readFile(join(worktreeDir, ".env"), "utf-8");
    expect(content).toBe("NEW=value");
  });

  // ── Auto-sync warning ────────────────────────────────────────

  it("warns when auto-sync fails gracefully", async () => {
    isInsideWorktree.mockReturnValue(false);

    const includeContent = [
      MANAGED_BLOCK_START,
      ".env",
      MANAGED_BLOCK_END,
    ].join("\n");
    await writeFile(join(tempDir, WORKTREE_INCLUDE_FILE), includeContent);

    const worktreePath = "wt-sync-fail";
    await mkdir(join(tempDir, worktreePath), { recursive: true });

    resolvePatterns.mockResolvedValue([]);

    // execFileSync for npx hatch3r sync will throw (mocked)
    const { execFileSync } = await import("node:child_process");
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("sync failed");
    });

    await worktreeSetupCommand(worktreePath);

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Could not auto-sync");
  });
});
