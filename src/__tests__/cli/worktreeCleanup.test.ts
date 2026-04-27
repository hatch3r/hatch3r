import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { join } from "node:path";
import type { WorktreeListEntry, WorktreeStatus } from "../../worktree/types.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../worktree/resolve.js", () => ({
  isInsideWorktree: vi.fn(() => false),
  findMainWorktree: vi.fn(() => "/fake/main"),
  listWorktrees: vi.fn((): WorktreeListEntry[] => []),
  getWorktreeStatus: vi.fn((): WorktreeStatus => ({ modified: 0, untracked: 0, stashes: 0 })),
}));

vi.mock("../../worktree/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../worktree/index.js")>();
  return {
    ...actual,
    cleanupWorktree: vi.fn(async () => {}),
    removeGitWorktree: vi.fn(),
  };
});

vi.mock("inquirer", () => ({
  default: { prompt: vi.fn(async () => ({})) },
}));

const MAIN = "/fake/main";
const W1 = `${MAIN}/.worktrees/feat-a`;
const W2 = `${MAIN}/.worktrees/feat-b`;
const WOTHER = "/elsewhere/worktree";

function entry(path: string, branch: string, extra: Partial<WorktreeListEntry> = {}): WorktreeListEntry {
  return {
    path,
    head: "abc123",
    branch: `refs/heads/${branch}`,
    detached: false,
    bare: false,
    locked: false,
    prunable: false,
    ...extra,
  };
}

describe("worktreeCleanupCommand", () => {
  let worktreeCleanupCommand: typeof import("../../cli/commands/worktreeCleanup.js")["worktreeCleanupCommand"];
  let isInsideWorktree: ReturnType<typeof vi.fn>;
  let findMainWorktree: ReturnType<typeof vi.fn>;
  let listWorktrees: ReturnType<typeof vi.fn>;
  let getWorktreeStatus: ReturnType<typeof vi.fn>;
  let cleanupWorktree: ReturnType<typeof vi.fn>;
  let removeGitWorktree: ReturnType<typeof vi.fn>;
  let inquirerPrompt: ReturnType<typeof vi.fn>;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let originalStdinIsTTY: boolean | undefined;

  beforeEach(async () => {
    vi.resetModules();

    const resolveModule = await import("../../worktree/resolve.js");
    isInsideWorktree = resolveModule.isInsideWorktree as ReturnType<typeof vi.fn>;
    findMainWorktree = resolveModule.findMainWorktree as ReturnType<typeof vi.fn>;
    listWorktrees = resolveModule.listWorktrees as ReturnType<typeof vi.fn>;
    getWorktreeStatus = resolveModule.getWorktreeStatus as ReturnType<typeof vi.fn>;

    const indexModule = await import("../../worktree/index.js");
    cleanupWorktree = indexModule.cleanupWorktree as ReturnType<typeof vi.fn>;
    removeGitWorktree = indexModule.removeGitWorktree as ReturnType<typeof vi.fn>;

    isInsideWorktree.mockReset().mockReturnValue(false);
    findMainWorktree.mockReset().mockReturnValue(MAIN);
    listWorktrees.mockReset().mockReturnValue([]);
    getWorktreeStatus.mockReset().mockReturnValue({ modified: 0, untracked: 0, stashes: 0 });
    cleanupWorktree.mockReset().mockResolvedValue(undefined);
    removeGitWorktree.mockReset();

    const inquirerModule = await import("inquirer");
    inquirerPrompt = inquirerModule.default.prompt as unknown as ReturnType<typeof vi.fn>;
    inquirerPrompt.mockReset();

    const cmdModule = await import("../../cli/commands/worktreeCleanup.js");
    worktreeCleanupCommand = cmdModule.worktreeCleanupCommand;

    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "cwd").mockReturnValue(MAIN);
    originalStdinIsTTY = process.stdin.isTTY;
    (process.stdin as { isTTY?: boolean }).isTTY = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalStdinIsTTY === undefined) {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    } else {
      (process.stdin as { isTTY?: boolean }).isTTY = originalStdinIsTTY;
    }
  });

  // ── Empty / discovery edge cases ─────────────────────────────────────

  it("exits cleanly when only the main worktree exists", async () => {
    listWorktrees.mockReturnValue([entry(MAIN, "main")]);

    await worktreeCleanupCommand();

    expect(cleanupWorktree).not.toHaveBeenCalled();
    expect(removeGitWorktree).not.toHaveBeenCalled();
  });

  it("partitions managed (under .worktrees/) and other worktrees", async () => {
    listWorktrees.mockReturnValue([
      entry(MAIN, "main"),
      entry(W1, "feat-a"),
      entry(WOTHER, "external"),
    ]);
    inquirerPrompt
      .mockResolvedValueOnce({ mode: "all" });

    await worktreeCleanupCommand();

    expect(cleanupWorktree).toHaveBeenCalledTimes(2);
    expect(cleanupWorktree).toHaveBeenCalledWith(W1);
    expect(cleanupWorktree).toHaveBeenCalledWith(WOTHER);
  });

  it("refuses when cwd is inside a candidate worktree", async () => {
    listWorktrees.mockReturnValue([entry(MAIN, "main"), entry(W1, "feat-a")]);
    vi.spyOn(process, "cwd").mockReturnValue(join(W1, "src"));

    await expect(worktreeCleanupCommand()).rejects.toThrow("inside");
    expect(cleanupWorktree).not.toHaveBeenCalled();
  });

  // ── Selection paths ──────────────────────────────────────────────────

  it("--all skips the all/specific prompt and cleans every candidate", async () => {
    listWorktrees.mockReturnValue([entry(MAIN, "main"), entry(W1, "feat-a"), entry(W2, "feat-b")]);

    await worktreeCleanupCommand({ all: true });

    expect(inquirerPrompt).not.toHaveBeenCalled();
    expect(cleanupWorktree).toHaveBeenCalledTimes(2);
    expect(removeGitWorktree).toHaveBeenCalledTimes(2);
    expect(removeGitWorktree).toHaveBeenCalledWith(MAIN, W1, { force: true });
    expect(removeGitWorktree).toHaveBeenCalledWith(MAIN, W2, { force: true });
  });

  it("specific mode prompts a checkbox and cleans only selections", async () => {
    listWorktrees.mockReturnValue([entry(MAIN, "main"), entry(W1, "feat-a"), entry(W2, "feat-b")]);
    inquirerPrompt
      .mockResolvedValueOnce({ mode: "specific" })
      .mockResolvedValueOnce({ picks: [W2] });

    await worktreeCleanupCommand();

    expect(cleanupWorktree).toHaveBeenCalledTimes(1);
    expect(cleanupWorktree).toHaveBeenCalledWith(W2);
    expect(removeGitWorktree).toHaveBeenCalledWith(MAIN, W2, { force: true });
  });

  it("cancel mode does nothing", async () => {
    listWorktrees.mockReturnValue([entry(MAIN, "main"), entry(W1, "feat-a")]);
    inquirerPrompt.mockResolvedValueOnce({ mode: "cancel" });

    await worktreeCleanupCommand();

    expect(cleanupWorktree).not.toHaveBeenCalled();
    expect(removeGitWorktree).not.toHaveBeenCalled();
  });

  // ── Dirty confirmation ───────────────────────────────────────────────

  it("requires explicit confirmation when selection has uncommitted changes (TTY)", async () => {
    (process.stdin as { isTTY?: boolean }).isTTY = true;
    listWorktrees.mockReturnValue([entry(MAIN, "main"), entry(W1, "feat-a")]);
    getWorktreeStatus.mockImplementation((p: string) =>
      p === W1 ? { modified: 3, untracked: 1, stashes: 0 } : { modified: 0, untracked: 0, stashes: 0 },
    );
    inquirerPrompt
      .mockResolvedValueOnce({ mode: "all" })
      .mockResolvedValueOnce({ proceed: false });

    await worktreeCleanupCommand();

    expect(cleanupWorktree).not.toHaveBeenCalled();
  });

  it("--yes bypasses the dirty confirmation", async () => {
    listWorktrees.mockReturnValue([entry(MAIN, "main"), entry(W1, "feat-a")]);
    getWorktreeStatus.mockReturnValue({ modified: 5, untracked: 0, stashes: 2 });

    await worktreeCleanupCommand({ yes: true });

    expect(cleanupWorktree).toHaveBeenCalledTimes(1);
    expect(removeGitWorktree).toHaveBeenCalledTimes(1);
  });

  // ── Mode flags ───────────────────────────────────────────────────────

  it("--files-only calls cleanupWorktree but skips git worktree remove", async () => {
    listWorktrees.mockReturnValue([entry(MAIN, "main"), entry(W1, "feat-a")]);

    await worktreeCleanupCommand({ all: true, filesOnly: true });

    expect(cleanupWorktree).toHaveBeenCalledTimes(1);
    expect(removeGitWorktree).not.toHaveBeenCalled();
  });

  it("--dry-run skips both cleanupWorktree and removeGitWorktree", async () => {
    listWorktrees.mockReturnValue([entry(MAIN, "main"), entry(W1, "feat-a")]);

    await worktreeCleanupCommand({ all: true, dryRun: true });

    expect(cleanupWorktree).not.toHaveBeenCalled();
    expect(removeGitWorktree).not.toHaveBeenCalled();
  });

  // ── Error reporting ──────────────────────────────────────────────────

  it("reports failures in the summary box and throws", async () => {
    listWorktrees.mockReturnValue([entry(MAIN, "main"), entry(W1, "feat-a"), entry(W2, "feat-b")]);
    removeGitWorktree.mockImplementationOnce(() => {
      throw new Error("locked by another process");
    });

    await expect(worktreeCleanupCommand({ all: true })).rejects.toThrow(/failed to clean/);
    // First worktree's cleanup should still be attempted on the second.
    expect(cleanupWorktree).toHaveBeenCalledTimes(2);
  });

  // ── Locked / prunable handling ───────────────────────────────────────

  it("does not include locked worktrees in the candidate list", async () => {
    listWorktrees.mockReturnValue([
      entry(MAIN, "main"),
      entry(W1, "feat-a", { locked: true }),
    ]);

    await worktreeCleanupCommand({ all: true });

    expect(cleanupWorktree).not.toHaveBeenCalled();
  });

  it("calls prune for prunable entries even when no candidates are selected", async () => {
    listWorktrees.mockReturnValue([
      entry(MAIN, "main"),
      entry(W1, "feat-a", { prunable: true }),
    ]);

    await worktreeCleanupCommand({ all: true });

    expect(removeGitWorktree).toHaveBeenCalledWith(MAIN, "", { prune: true });
  });
});
