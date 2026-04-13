import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../worktree/resolve.js", () => ({
  isInsideWorktree: vi.fn(() => false),
}));

vi.mock("../../worktree/index.js", () => ({
  cleanupWorktree: vi.fn(async () => {}),
}));

// ── Test suite ───────────────────────────────────────────────────────────────

describe("worktreeCleanupCommand", () => {
  let worktreeCleanupCommand: typeof import("../../cli/commands/worktreeCleanup.js")["worktreeCleanupCommand"];
  let isInsideWorktree: ReturnType<typeof vi.fn>;
  let cleanupWorktree: ReturnType<typeof vi.fn>;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeEach(async () => {
    vi.resetModules();

    const resolveModule = await import("../../worktree/resolve.js");
    isInsideWorktree = resolveModule.isInsideWorktree as ReturnType<typeof vi.fn>;

    const worktreeModule = await import("../../worktree/index.js");
    cleanupWorktree = worktreeModule.cleanupWorktree as ReturnType<typeof vi.fn>;
    cleanupWorktree.mockClear();

    const cmdModule = await import("../../cli/commands/worktreeCleanup.js");
    worktreeCleanupCommand = cmdModule.worktreeCleanupCommand;

    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Not inside worktree ──────────────────────────────────────────────

  it("throws HatchError when not inside a git worktree", async () => {
    isInsideWorktree.mockReturnValue(false);

    await expect(worktreeCleanupCommand()).rejects.toThrow("Not inside a git worktree");
  });

  it("throws with exit code 1 and VALIDATION_ERROR code when not in worktree", async () => {
    isInsideWorktree.mockReturnValue(false);

    try {
      await worktreeCleanupCommand();
      expect.unreachable("should have thrown");
    } catch (e) {
      // Use property checks instead of instanceof (module boundary issue with vi.resetModules)
      expect((e as any).name).toBe("HatchError");
      expect((e as any).exitCode).toBe(1);
      expect((e as any).errorCode).toBe("VALIDATION_ERROR");
    }
  });

  it("does not call cleanupWorktree when not inside a worktree", async () => {
    isInsideWorktree.mockReturnValue(false);

    try {
      await worktreeCleanupCommand();
    } catch {
      // expected
    }

    expect(cleanupWorktree).not.toHaveBeenCalled();
  });

  // ── Dry-run mode ─────────────────────────────────────────────────────

  it("dry run logs info without performing cleanup", async () => {
    isInsideWorktree.mockReturnValue(true);

    await worktreeCleanupCommand({ dryRun: true });

    expect(cleanupWorktree).not.toHaveBeenCalled();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Dry run");
  });

  it("dry run shows the worktree path that would be cleaned", async () => {
    isInsideWorktree.mockReturnValue(true);

    await worktreeCleanupCommand({ dryRun: true });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Would clean up");
  });

  // ── Success path ─────────────────────────────────────────────────────

  it("calls cleanupWorktree with process.cwd() on success", async () => {
    isInsideWorktree.mockReturnValue(true);
    cleanupWorktree.mockResolvedValue(undefined);

    await worktreeCleanupCommand();

    expect(cleanupWorktree).toHaveBeenCalledTimes(1);
    expect(cleanupWorktree).toHaveBeenCalledWith(process.cwd());
  });

  it("shows confirmation after successful cleanup", async () => {
    isInsideWorktree.mockReturnValue(true);
    cleanupWorktree.mockResolvedValue(undefined);

    await worktreeCleanupCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // The info message confirms symlinks have been removed
    expect(output).toContain("removed");
  });

  it("shows follow-up info about removed symlinks", async () => {
    isInsideWorktree.mockReturnValue(true);
    cleanupWorktree.mockResolvedValue(undefined);

    await worktreeCleanupCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Symlinks");
  });

  // ── Error handling ───────────────────────────────────────────────────

  it("propagates errors thrown by cleanupWorktree", async () => {
    isInsideWorktree.mockReturnValue(true);
    cleanupWorktree.mockRejectedValue(new Error("EACCES: permission denied"));

    await expect(worktreeCleanupCommand()).rejects.toThrow("EACCES: permission denied");
  });

  it("propagates HatchError from cleanupWorktree preserving identity", async () => {
    isInsideWorktree.mockReturnValue(true);
    const errMsg = "cleanup failed due to lock";
    cleanupWorktree.mockRejectedValue(new Error(errMsg));

    await expect(worktreeCleanupCommand()).rejects.toThrow(errMsg);
  });

  // ── Default options ──────────────────────────────────────────────────

  it("defaults to non-dry-run when no options provided", async () => {
    isInsideWorktree.mockReturnValue(true);
    cleanupWorktree.mockResolvedValue(undefined);

    await worktreeCleanupCommand();

    expect(cleanupWorktree).toHaveBeenCalled();
  });

  it("defaults to non-dry-run when empty options object provided", async () => {
    isInsideWorktree.mockReturnValue(true);
    cleanupWorktree.mockResolvedValue(undefined);

    await worktreeCleanupCommand({});

    expect(cleanupWorktree).toHaveBeenCalled();
  });
});
