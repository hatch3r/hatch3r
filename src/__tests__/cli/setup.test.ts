import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";
import inquirer from "inquirer";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HatchError } from "../../types.js";
import { setupCommand } from "../../cli/commands/setup.js";
import { initCommand } from "../../cli/commands/init.js";

// Mock inquirer so the dir-name prompt branch (no [dir] + non-empty cwd) can be
// exercised deterministically. Separator is required by other CLI shared code
// that may be pulled into the module graph.
vi.mock("inquirer", () => {
  class Separator {
    constructor(public readonly line: string) {}
  }
  return { default: { prompt: vi.fn(), Separator } };
});

// Mock the chained init so setup tests assert the hand-off (opts forwarding)
// without running the real init pipeline.
vi.mock("../../cli/commands/init.js", () => ({
  initCommand: vi.fn().mockResolvedValue(undefined),
}));

// Mock subprocess execution (git / gh) — the established repo pattern
// (selfUpdate.test.ts, worktree). Default no-op covers `git init`; per-test
// mockImplementation drives the gh-missing path.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn() };
});

describe("setup command", () => {
  let tempDir: string;
  let cwdSpy: MockInstance;
  let chdirSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-setup-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    // No-op chdir so the test process stays in a stable cwd for cleanup.
    chdirSpy = vi.spyOn(process, "chdir").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(execFileSync).mockReset().mockReturnValue(Buffer.from(""));
    vi.mocked(inquirer.prompt).mockReset();
    vi.mocked(initCommand).mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    chdirSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  /** All git/gh argv arrays seen by the execFileSync mock, for assertion. */
  function execCalls(): { cmd: string; args: string[] }[] {
    return vi.mocked(execFileSync).mock.calls.map((c) => ({
      cmd: c[0] as string,
      args: (c[1] as string[]) ?? [],
    }));
  }

  it("creates the target directory and chains into init", async () => {
    await setupCommand("myproj", {});

    await expect(access(join(tempDir, "myproj"))).resolves.toBeUndefined();
    expect(initCommand).toHaveBeenCalledTimes(1);
  });

  it("runs `git init` when no .git is present", async () => {
    await setupCommand("fresh", {});

    const gitInit = execCalls().find((c) => c.cmd === "git" && c.args[0] === "init");
    expect(gitInit).toBeDefined();
  });

  it("skips `git init` when the target already has a .git directory (idempotent)", async () => {
    await mkdir(join(tempDir, "existing", ".git"), { recursive: true });

    await setupCommand("existing", {});

    const gitInit = execCalls().find((c) => c.cmd === "git" && c.args[0] === "init");
    expect(gitInit).toBeUndefined();
    expect(initCommand).toHaveBeenCalledTimes(1);
  });

  it("forwards the relevant init options to initCommand", async () => {
    await setupCommand("proj", {
      tools: "claude",
      preset: "minimal",
      maturity: "team",
      yes: true,
      quiet: true,
      verbose: true,
    });

    expect(initCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: "claude",
        preset: "minimal",
        maturity: "team",
        yes: true,
        quiet: true,
        verbose: true,
      }),
    );
  });

  it("uses the current directory when the cwd is empty and no [dir] is given", async () => {
    await setupCommand(undefined, { yes: true });

    const gitInit = execCalls().find((c) => c.cmd === "git" && c.args[0] === "init");
    expect(gitInit).toBeDefined();
    expect(initCommand).toHaveBeenCalledTimes(1);
  });

  it("prompts for a directory name when the cwd is non-empty and no [dir] is given", async () => {
    await writeFile(join(tempDir, "preexisting.txt"), "x");
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ dirName: "fromprompt" });

    await setupCommand(undefined, {});

    expect(inquirer.prompt).toHaveBeenCalledTimes(1);
    await expect(access(join(tempDir, "fromprompt"))).resolves.toBeUndefined();
    expect(initCommand).toHaveBeenCalledTimes(1);
  });

  it("--dry-run writes nothing and does not run init", async () => {
    await setupCommand("preview", { dryRun: true });

    await expect(access(join(tempDir, "preview"))).rejects.toThrow();
    expect(initCommand).not.toHaveBeenCalled();
    expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
  });

  it("throws FS_ERROR when the target exists and is not empty", async () => {
    await mkdir(join(tempDir, "occupied"), { recursive: true });
    await writeFile(join(tempDir, "occupied", "README.md"), "real content");

    let thrown: unknown;
    try {
      await setupCommand("occupied", {});
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(HatchError);
    expect((thrown as HatchError).errorCode).toBe("FS_ERROR");
    expect((thrown as HatchError).exitCode).toBe(74);
    expect(initCommand).not.toHaveBeenCalled();
  });

  it("throws FS_ERROR under --yes when the cwd is non-empty and no [dir] is given", async () => {
    await writeFile(join(tempDir, "existing.txt"), "content");

    let thrown: unknown;
    try {
      await setupCommand(undefined, { yes: true });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(HatchError);
    expect((thrown as HatchError).errorCode).toBe("FS_ERROR");
    expect(initCommand).not.toHaveBeenCalled();
  });

  it("throws an actionable CONFIG_ERROR naming git when git is missing from PATH (D1-SA1.1-06)", async () => {
    // Every git spawn fails with ENOENT (binary absent). The preflight probe
    // must convert this into a HatchError BEFORE any directory is created —
    // previously the raw `spawnSync git ENOENT` fell through to the generic
    // "unexpected error" funnel.
    vi.mocked(execFileSync).mockImplementation((...callArgs: unknown[]) => {
      const cmd = callArgs[0] as string;
      if (cmd === "git") {
        const err = new Error("spawnSync git ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return Buffer.from("");
    });

    let thrown: unknown;
    try {
      await setupCommand("nogit", { yes: true });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(HatchError);
    expect((thrown as HatchError).errorCode).toBe("CONFIG_ERROR");
    expect((thrown as HatchError).message).toContain("git");
    expect((thrown as HatchError).recoveryHint).toContain("git-scm.com");
    // Preflight fires before the scaffold: no directory, no init chain.
    await expect(access(join(tempDir, "nogit"))).rejects.toThrow();
    expect(initCommand).not.toHaveBeenCalled();
  });

  it("skips the git preflight when the target already has .git and no --remote (gated probe)", async () => {
    // git absent AND unneeded: .git exists so `git init` is skipped and no
    // remote was requested — setup must succeed without spawning git at all.
    await mkdir(join(tempDir, "hasgit", ".git"), { recursive: true });
    vi.mocked(execFileSync).mockImplementation((...callArgs: unknown[]) => {
      const cmd = callArgs[0] as string;
      if (cmd === "git") {
        const err = new Error("spawnSync git ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return Buffer.from("");
    });

    await expect(setupCommand("hasgit", { yes: true })).resolves.toBeUndefined();
    expect(execCalls().filter((c) => c.cmd === "git").length).toBe(0);
    expect(initCommand).toHaveBeenCalledTimes(1);
  });

  it("a failing `gh repo create` warns but does not abort the scaffold", async () => {
    // gh auth status + git succeed; gh repo create throws.
    vi.mocked(execFileSync).mockImplementation((...callArgs: unknown[]) => {
      const cmd = callArgs[0] as string;
      const args = callArgs[1] as string[] | undefined;
      if (cmd === "gh" && args?.[0] === "repo") throw new Error("gh repo create failed");
      return Buffer.from("");
    });

    await expect(setupCommand("ghfail", { remote: true, yes: true })).resolves.toBeUndefined();

    await expect(access(join(tempDir, "ghfail"))).resolves.toBeUndefined();
    expect(initCommand).toHaveBeenCalledTimes(1);
    const warned = consoleErrorSpy.mock.calls
      .flat()
      .some((line) => typeof line === "string" && /remote/i.test(line));
    expect(warned).toBe(true);
  });

  it("--remote with an available gh creates the GitHub remote", async () => {
    // gh auth status + gh repo create succeed; git calls succeed.
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(""));

    await setupCommand("withgh", { remote: true, yes: true });

    const repoCreate = execCalls().find(
      (c) => c.cmd === "gh" && c.args[0] === "repo" && c.args[1] === "create",
    );
    expect(repoCreate).toBeDefined();
    expect(repoCreate!.args).toContain("withgh");
    expect(initCommand).toHaveBeenCalledTimes(1);
  });

  it("--remote without an available gh warns but still scaffolds + chains init", async () => {
    // gh auth status throws (gh missing/unauthed); git calls succeed.
    vi.mocked(execFileSync).mockImplementation((...callArgs: unknown[]) => {
      const cmd = callArgs[0] as string;
      if (cmd === "gh") throw new Error("gh: command not found");
      return Buffer.from("");
    });

    await expect(setupCommand("withremote", { remote: true, yes: true })).resolves.toBeUndefined();

    // Scaffold still happened.
    await expect(access(join(tempDir, "withremote"))).resolves.toBeUndefined();
    expect(initCommand).toHaveBeenCalledTimes(1);
    // A warning about the skipped remote went to stderr.
    const warnedAboutRemote = consoleErrorSpy.mock.calls
      .flat()
      .some((line) => typeof line === "string" && /gh|remote/i.test(line));
    expect(warnedAboutRemote).toBe(true);
  });
});
