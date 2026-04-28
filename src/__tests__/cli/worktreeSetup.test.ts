import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HatchError, WORKTREE_INCLUDE_FILE, MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../../types.js";

// Mock child_process so `npx hatch3r sync` doesn't actually run, and clipboard
// spawnSync probes don't shell out.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFileSync: vi.fn(),
    spawnSync: vi.fn(() => ({ status: 0, stdout: Buffer.from(""), stderr: Buffer.from("") })),
  };
});

// Mock worktree/resolve so we don't need actual git repos for cwd-detection.
vi.mock("../../worktree/resolve.js", () => ({
  isInsideWorktree: vi.fn(() => false),
  findMainWorktree: vi.fn(() => "/fake/main"),
  resolvePatterns: vi.fn(async () => []),
}));

// Partial-mock worktree/index: replace git wrappers + ignore helper + name
// validator, but keep setupWorktree / parseWorktreeInclude / WORKTREES_DIR real.
vi.mock("../../worktree/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../worktree/index.js")>();
  return {
    ...actual,
    addGitWorktree: vi.fn(),
    removeGitWorktree: vi.fn(),
    ensureWorktreesIgnored: vi.fn(async () => true),
    isValidBranchName: vi.fn(() => true),
  };
});

// Mock clipboard so tests can assert behavior without real pbcopy/xclip.
vi.mock("../../cli/shared/clipboard.js", () => ({
  copyToClipboard: vi.fn(() => "pbcopy"),
}));

// Mock inquirer so the secret-propagation prompt is deterministic.
vi.mock("inquirer", () => ({
  default: { prompt: vi.fn(async () => ({ proceed: true })) },
}));

describe("worktreeSetupCommand", () => {
  let worktreeSetupCommand: typeof import("../../cli/commands/worktreeSetup.js")["worktreeSetupCommand"];
  let isInsideWorktree: ReturnType<typeof vi.fn>;
  let findMainWorktree: ReturnType<typeof vi.fn>;
  let addGitWorktree: ReturnType<typeof vi.fn>;
  let ensureWorktreesIgnored: ReturnType<typeof vi.fn>;
  let isValidBranchName: ReturnType<typeof vi.fn>;
  let copyToClipboard: ReturnType<typeof vi.fn>;
  let inquirerPrompt: ReturnType<typeof vi.fn>;
  let execFileSyncMock: ReturnType<typeof vi.fn>;
  let tempDir: string;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let originalStdinIsTTY: boolean | undefined;

  beforeEach(async () => {
    vi.resetModules();

    const resolveModule = await import("../../worktree/resolve.js");
    isInsideWorktree = resolveModule.isInsideWorktree as ReturnType<typeof vi.fn>;
    findMainWorktree = resolveModule.findMainWorktree as ReturnType<typeof vi.fn>;

    const indexModule = await import("../../worktree/index.js");
    addGitWorktree = indexModule.addGitWorktree as ReturnType<typeof vi.fn>;
    ensureWorktreesIgnored = indexModule.ensureWorktreesIgnored as ReturnType<typeof vi.fn>;
    isValidBranchName = indexModule.isValidBranchName as ReturnType<typeof vi.fn>;
    addGitWorktree.mockReset();
    ensureWorktreesIgnored.mockReset().mockResolvedValue(true);
    isValidBranchName.mockReset().mockReturnValue(true);

    const clipboardModule = await import("../../cli/shared/clipboard.js");
    copyToClipboard = clipboardModule.copyToClipboard as ReturnType<typeof vi.fn>;
    copyToClipboard.mockReset().mockReturnValue("pbcopy");

    const inquirerModule = await import("inquirer");
    inquirerPrompt = inquirerModule.default.prompt as unknown as ReturnType<typeof vi.fn>;
    inquirerPrompt.mockReset();
    inquirerPrompt.mockResolvedValue({ proceed: true });

    const child = await import("node:child_process");
    execFileSyncMock = child.execFileSync as unknown as ReturnType<typeof vi.fn>;
    execFileSyncMock.mockReset();
    execFileSyncMock.mockReturnValue(Buffer.from(""));

    const cmdModule = await import("../../cli/commands/worktreeSetup.js");
    worktreeSetupCommand = cmdModule.worktreeSetupCommand;

    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-wt-setup-"));
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    originalStdinIsTTY = process.stdin.isTTY;
    (process.stdin as { isTTY?: boolean }).isTTY = false;

    findMainWorktree.mockReturnValue(tempDir);
    isInsideWorktree.mockReturnValue(false);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalStdinIsTTY === undefined) {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    } else {
      (process.stdin as { isTTY?: boolean }).isTTY = originalStdinIsTTY;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  // ── Usage ─────────────────────────────────────────────────────

  it("rejects when no name and no --from-path is given", async () => {
    await expect(worktreeSetupCommand()).rejects.toThrow("Missing worktree name");
    try {
      await worktreeSetupCommand();
    } catch (e) {
      expect((e as HatchError).exitCode).toBe(1);
    }
  });

  it("rejects an invalid branch name via isValidBranchName", async () => {
    isValidBranchName.mockReturnValue(false);
    const includeContent = [MANAGED_BLOCK_START, ".env", MANAGED_BLOCK_END].join("\n");
    await writeFile(join(tempDir, WORKTREE_INCLUDE_FILE), includeContent);

    await expect(worktreeSetupCommand("bad name")).rejects.toThrow("Invalid worktree name");
    expect(addGitWorktree).not.toHaveBeenCalled();
  });

  it("throws when .worktreeinclude is missing", async () => {
    await expect(worktreeSetupCommand("feat-x")).rejects.toThrow(WORKTREE_INCLUDE_FILE);
  });

  // ── Name-mode happy path ─────────────────────────────────────

  it("auto-resolves target to <mainRoot>/.worktrees/<name> and creates worktree", async () => {
    const includeContent = [MANAGED_BLOCK_START, ".env", MANAGED_BLOCK_END].join("\n");
    await writeFile(join(tempDir, WORKTREE_INCLUDE_FILE), includeContent);

    await worktreeSetupCommand("feat-a");

    expect(addGitWorktree).toHaveBeenCalledTimes(1);
    const [mainArg, nameArg, pathArg] = addGitWorktree.mock.calls[0];
    expect(mainArg).toBe(tempDir);
    expect(nameArg).toBe("feat-a");
    expect(pathArg).toBe(join(tempDir, ".worktrees", "feat-a"));
  });

  it("ensures the .worktrees/ exclude entry on first use", async () => {
    const includeContent = [MANAGED_BLOCK_START, ".env", MANAGED_BLOCK_END].join("\n");
    await writeFile(join(tempDir, WORKTREE_INCLUDE_FILE), includeContent);

    await worktreeSetupCommand("feat-b");

    expect(ensureWorktreesIgnored).toHaveBeenCalledWith(tempDir);
  });

  it("copies the cd <path> hint to the clipboard via copyToClipboard", async () => {
    const includeContent = [MANAGED_BLOCK_START, ".env", MANAGED_BLOCK_END].join("\n");
    await writeFile(join(tempDir, WORKTREE_INCLUDE_FILE), includeContent);

    await worktreeSetupCommand("feat-c");

    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    expect(copyToClipboard.mock.calls[0][0]).toBe(`cd ${join(tempDir, ".worktrees", "feat-c")}`);
  });

  it("refuses when target path already exists", async () => {
    const includeContent = [MANAGED_BLOCK_START, ".env", MANAGED_BLOCK_END].join("\n");
    await writeFile(join(tempDir, WORKTREE_INCLUDE_FILE), includeContent);
    await mkdir(join(tempDir, ".worktrees", "feat-d"), { recursive: true });

    await expect(worktreeSetupCommand("feat-d")).rejects.toThrow("Target path exists");
    expect(addGitWorktree).not.toHaveBeenCalled();
  });

  it("dry-run does not call addGitWorktree", async () => {
    const includeContent = [
      MANAGED_BLOCK_START,
      "# env vars",
      ".env",
      MANAGED_BLOCK_END,
    ].join("\n");
    await writeFile(join(tempDir, WORKTREE_INCLUDE_FILE), includeContent);

    await worktreeSetupCommand("feat-dry", { dryRun: true });

    expect(addGitWorktree).not.toHaveBeenCalled();
    expect(ensureWorktreesIgnored).not.toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("dry run");
  });

  // ── Sync failure surfacing ───────────────────────────────────

  it("exits non-zero when npx hatch3r sync fails inside the new worktree", async () => {
    const includeContent = [MANAGED_BLOCK_START, ".env", MANAGED_BLOCK_END].join("\n");
    await writeFile(join(tempDir, WORKTREE_INCLUDE_FILE), includeContent);

    execFileSyncMock.mockImplementation(() => {
      const e = new Error("sync failed") as Error & { stderr?: Buffer; stdout?: Buffer };
      e.stderr = Buffer.from("sync output here");
      throw e;
    });

    await expect(worktreeSetupCommand("feat-syncfail")).rejects.toThrow(/Adapter sync failed/);
  });

  // ── --from-path legacy mode ──────────────────────────────────

  it("--from-path skips git worktree add and populates the existing path", async () => {
    const includeContent = [MANAGED_BLOCK_START, ".env", MANAGED_BLOCK_END].join("\n");
    await writeFile(join(tempDir, WORKTREE_INCLUDE_FILE), includeContent);
    const wtDir = join(tempDir, ".worktrees", "legacy");
    await mkdir(wtDir, { recursive: true });

    await worktreeSetupCommand(undefined, { fromPath: wtDir });

    expect(addGitWorktree).not.toHaveBeenCalled();
    expect(copyToClipboard).toHaveBeenCalledWith(`cd ${wtDir}`);
  });

  it("--from-path errors when the target does not exist", async () => {
    const includeContent = [MANAGED_BLOCK_START, ".env", MANAGED_BLOCK_END].join("\n");
    await writeFile(join(tempDir, WORKTREE_INCLUDE_FILE), includeContent);

    await expect(
      worktreeSetupCommand(undefined, { fromPath: join(tempDir, "missing") }),
    ).rejects.toThrow("from-path target missing");
  });

  // ── Secret propagation warning preserved ─────────────────────

  it("prints blast-radius warning when .env.mcp exists in main repo", async () => {
    const includeContent = [
      MANAGED_BLOCK_START,
      "# env vars",
      ".env.*",
      MANAGED_BLOCK_END,
    ].join("\n");
    await writeFile(join(tempDir, WORKTREE_INCLUDE_FILE), includeContent);
    await writeFile(join(tempDir, ".env.mcp"), "GITHUB_PAT=ghp_example");

    await worktreeSetupCommand("feat-secret", { yes: true });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Secret propagation warning");
    expect(output).toContain("CWE-552");
  });

  it("--yes skips the secret confirmation prompt", async () => {
    (process.stdin as { isTTY?: boolean }).isTTY = true;
    const includeContent = [
      MANAGED_BLOCK_START,
      ".env.*",
      MANAGED_BLOCK_END,
    ].join("\n");
    await writeFile(join(tempDir, WORKTREE_INCLUDE_FILE), includeContent);
    await writeFile(join(tempDir, ".env.mcp"), "GITHUB_PAT=x");

    await worktreeSetupCommand("feat-yes", { yes: true });

    expect(inquirerPrompt).not.toHaveBeenCalled();
  });

  it("cancels when interactive user declines secret confirmation", async () => {
    (process.stdin as { isTTY?: boolean }).isTTY = true;
    inquirerPrompt.mockResolvedValueOnce({ proceed: false });

    const includeContent = [MANAGED_BLOCK_START, ".env.*", MANAGED_BLOCK_END].join("\n");
    await writeFile(join(tempDir, WORKTREE_INCLUDE_FILE), includeContent);
    await writeFile(join(tempDir, ".env.mcp"), "GITHUB_PAT=x");

    await expect(worktreeSetupCommand("feat-cancel")).rejects.toThrow("Worktree setup cancelled");
    expect(addGitWorktree).not.toHaveBeenCalled();
  });
});
