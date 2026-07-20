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
  // D1-SA1.10-03: resolvePatterns now returns a structured { paths, error? }
  // result so hard failures propagate to setupWorktree's result.errors.
  resolvePatterns: vi.fn(async () => ({ paths: [] })),
}));

// Partial-mock worktree/index: replace git wrappers + ignore helper + name
// validator + branch-plan resolver, but keep setupWorktree /
// parseWorktreeInclude / WORKTREES_DIR real. resolveWorktreeBranchPlan MUST be
// mocked here: the real one shells out via the globally-mocked execFileSync
// (which "succeeds" on every call), so it would misreport every branch as
// existing locally.
vi.mock("../../worktree/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../worktree/index.js")>();
  return {
    ...actual,
    addGitWorktree: vi.fn(),
    removeGitWorktree: vi.fn(),
    ensureWorktreesIgnored: vi.fn(async () => true),
    isValidBranchName: vi.fn(() => true),
    resolveWorktreeBranchPlan: vi.fn(() => ({ mode: "create" })),
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
  let resolveWorktreeBranchPlan: ReturnType<typeof vi.fn>;
  let copyToClipboard: ReturnType<typeof vi.fn>;
  let inquirerPrompt: ReturnType<typeof vi.fn>;
  let execFileSyncMock: ReturnType<typeof vi.fn>;
  let tempDir: string;
  let consoleSpy: MockInstance;
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
    resolveWorktreeBranchPlan = indexModule.resolveWorktreeBranchPlan as ReturnType<typeof vi.fn>;
    addGitWorktree.mockReset();
    ensureWorktreesIgnored.mockReset().mockResolvedValue(true);
    isValidBranchName.mockReset().mockReturnValue(true);
    resolveWorktreeBranchPlan.mockReset().mockReturnValue({ mode: "create" });

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
    vi.spyOn(console, "error").mockImplementation(() => {});
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
      // C8-D1-M5: VALIDATION_ERROR -> EX_USAGE (64) via central map.
      expect((e as HatchError).exitCode).toBe(64);
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

  // ── Auto-sync spawn shape (D1-SA1.10-04) ─────────────────────

  it("spawns the running CLI directly (process.execPath + argv[1]) for auto-sync — never npx", async () => {
    // D1-SA1.10-04 (Cycle 12 Wave 3, D1, P1): `execFileSync("npx", ...)`
    // fails on native Windows (npx is `npx.cmd`; .cmd files cannot be
    // launched via execFile without a shell per the Node child_process docs
    // and the CVE-2024-27980 hardening), so every Windows worktree-setup run
    // exited FS_ERROR at the sync step. Same-binary re-invocation is
    // platform-independent and needs no npx resolution or install prompt.
    const includeContent = [MANAGED_BLOCK_START, ".env", MANAGED_BLOCK_END].join("\n");
    await writeFile(join(tempDir, WORKTREE_INCLUDE_FILE), includeContent);

    await worktreeSetupCommand("feat-spawnshape", { yes: true });

    const syncCall = execFileSyncMock.mock.calls.find(
      (c) => Array.isArray(c[1]) && (c[1] as string[]).includes("sync"),
    );
    expect(syncCall).toBeDefined();
    expect(syncCall![0]).toBe(process.execPath); // the running node binary
    expect(syncCall![1]).toEqual([process.argv[1], "sync"]); // this CLI's entry script
    expect(syncCall![0]).not.toBe("npx");
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

  // ── Existing-branch attach/track consent (release/2.8.0) ─────

  describe("existing-branch consent flow", () => {
    const writeInclude = async (): Promise<void> => {
      const includeContent = [MANAGED_BLOCK_START, ".env", MANAGED_BLOCK_END].join("\n");
      await writeFile(join(tempDir, WORKTREE_INCLUDE_FILE), includeContent);
    };

    it("create plan passes mode 'create' through to addGitWorktree", async () => {
      await writeInclude();
      await worktreeSetupCommand("feat-new");
      expect(addGitWorktree.mock.calls[0][3]).toEqual({ mode: "create" });
    });

    it("--use-existing attaches a local branch without prompting", async () => {
      resolveWorktreeBranchPlan.mockReturnValue({ mode: "attach" });
      await writeInclude();

      await worktreeSetupCommand("feat-exist", { useExisting: true });

      expect(inquirerPrompt).not.toHaveBeenCalled();
      expect(addGitWorktree).toHaveBeenCalledTimes(1);
      expect(addGitWorktree.mock.calls[0][3]).toEqual({ mode: "attach" });
    });

    it("--use-existing tracks a remote-only branch without prompting", async () => {
      resolveWorktreeBranchPlan.mockReturnValue({ mode: "track" });
      await writeInclude();

      await worktreeSetupCommand("feat-remote", { useExisting: true });

      expect(inquirerPrompt).not.toHaveBeenCalled();
      expect(addGitWorktree.mock.calls[0][3]).toEqual({ mode: "track" });
    });

    it("non-TTY without --use-existing → VALIDATION_ERROR exit 64 naming the exact rerun command", async () => {
      resolveWorktreeBranchPlan.mockReturnValue({ mode: "attach" });
      await writeInclude();
      // beforeEach sets process.stdin.isTTY = false.

      let caught: unknown;
      try {
        await worktreeSetupCommand("feat-exist", {});
      } catch (e) {
        caught = e;
      }
      // Name-based check: vi.resetModules() gives the command module a fresh
      // types.js instance, so cross-module instanceof would false-negative.
      const err = caught as HatchError;
      expect(err.name).toBe("HatchError");
      expect(err.errorCode).toBe("VALIDATION_ERROR");
      expect(err.exitCode).toBe(64);
      expect(err.recoveryHint).toContain("hatch3r worktree-setup feat-exist --use-existing");
      expect(addGitWorktree).not.toHaveBeenCalled();
    });

    it("interactive TTY prompts once (default yes) and attaches on accept", async () => {
      (process.stdin as { isTTY?: boolean }).isTTY = true;
      resolveWorktreeBranchPlan.mockReturnValue({ mode: "attach" });
      inquirerPrompt.mockResolvedValueOnce({ attachExisting: true });
      await writeInclude();

      await worktreeSetupCommand("feat-exist", {});

      expect(inquirerPrompt).toHaveBeenCalledTimes(1);
      const question = (inquirerPrompt.mock.calls[0][0] as Array<Record<string, unknown>>)[0];
      expect(question.name).toBe("attachExisting");
      expect(question.default).toBe(true);
      expect(String(question.message)).toContain("attach it to the new worktree");
      expect(addGitWorktree.mock.calls[0][3]).toEqual({ mode: "attach" });
    });

    it("prompt decline → VALIDATION_ERROR with a different-name hint, nothing created", async () => {
      (process.stdin as { isTTY?: boolean }).isTTY = true;
      resolveWorktreeBranchPlan.mockReturnValue({ mode: "attach" });
      inquirerPrompt.mockResolvedValueOnce({ attachExisting: false });
      await writeInclude();

      let caught: unknown;
      try {
        await worktreeSetupCommand("feat-exist", {});
      } catch (e) {
        caught = e;
      }
      const err = caught as HatchError;
      expect(err.name).toBe("HatchError");
      expect(err.errorCode).toBe("VALIDATION_ERROR");
      expect(err.exitCode).toBe(64);
      expect(err.recoveryHint).toMatch(/different worktree name/i);
      expect(addGitWorktree).not.toHaveBeenCalled();
    });

    it("--no-use-existing declines without prompting → VALIDATION_ERROR + rename hint", async () => {
      (process.stdin as { isTTY?: boolean }).isTTY = true; // flag wins even on a TTY
      resolveWorktreeBranchPlan.mockReturnValue({ mode: "attach" });
      await writeInclude();

      let caught: unknown;
      try {
        await worktreeSetupCommand("feat-exist", { useExisting: false });
      } catch (e) {
        caught = e;
      }
      const err = caught as HatchError;
      expect(err.name).toBe("HatchError");
      expect(err.errorCode).toBe("VALIDATION_ERROR");
      expect(err.exitCode).toBe(64);
      expect(err.recoveryHint).toMatch(/different worktree name/i);
      expect(inquirerPrompt).not.toHaveBeenCalled();
      expect(addGitWorktree).not.toHaveBeenCalled();
    });

    it("dry-run previews the attach action offline — no prompt, no fetch, no worktree", async () => {
      resolveWorktreeBranchPlan.mockReturnValue({ mode: "attach" });
      await writeInclude();

      await worktreeSetupCommand("feat-exist", { dryRun: true });

      expect(addGitWorktree).not.toHaveBeenCalled();
      expect(inquirerPrompt).not.toHaveBeenCalled();
      // --dry-run stays offline: allowFetch:false.
      expect(resolveWorktreeBranchPlan).toHaveBeenCalledWith(tempDir, "feat-exist", {
        allowFetch: false,
      });
      // Hyphenated plan ids are single words, so boxen's word-wrap cannot
      // split them — wrap-proof assertions.
      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).toContain("attach-existing-local");
      expect(output).not.toContain("create-new");
    });

    it("dry-run previews the remote-track action with the --track argv", async () => {
      resolveWorktreeBranchPlan.mockReturnValue({ mode: "track" });
      await writeInclude();

      await worktreeSetupCommand("feat-remote", { dryRun: true });

      expect(addGitWorktree).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).toContain("track-remote-only");
      expect(output).toContain("origin/feat-remote");
    });

    it("dry-run json reports branchPlan for the attach path", async () => {
      resolveWorktreeBranchPlan.mockReturnValue({ mode: "attach" });
      await writeInclude();

      // emitJson writes the single document via process.stdout.write.
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);
      try {
        await worktreeSetupCommand("feat-exist", { dryRun: true, format: "json" });
        const jsonCall = stdoutSpy.mock.calls
          .map((c) => String(c[0]))
          .find((s) => s.trimStart().startsWith("{"));
        expect(jsonCall).toBeDefined();
        const doc = JSON.parse(jsonCall as string) as Record<string, unknown>;
        expect(doc.dryRun).toBe(true);
        expect(doc.branchPlan).toBe("attach");
        expect(doc.command).toBe("worktree-setup");
      } finally {
        stdoutSpy.mockRestore();
      }
    });

    it("NETWORK_ERROR from branch detection propagates with exit 75, nothing created", async () => {
      resolveWorktreeBranchPlan.mockImplementation(() => {
        throw new HatchError(
          "git fetch origin feat-exist failed: Could not resolve host",
          undefined,
          "NETWORK_ERROR",
          "Check connectivity and the origin URL (`git remote -v`), then re-run worktree-setup.",
        );
      });
      await writeInclude();

      let caught: unknown;
      try {
        await worktreeSetupCommand("feat-exist", {});
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(HatchError);
      const err = caught as HatchError;
      expect(err.errorCode).toBe("NETWORK_ERROR");
      expect(err.exitCode).toBe(75);
      expect(addGitWorktree).not.toHaveBeenCalled();
    });
  });
});
