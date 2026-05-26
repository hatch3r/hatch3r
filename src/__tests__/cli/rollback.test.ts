import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HatchError } from "../../types.js";
import { createSnapshot } from "../../pipeline/snapshot.js";

// inquirer is mocked per-test so we can drive the confirmation prompt
// without TTY interaction. Use `vi.mock` against the same module path the
// production code imports.
vi.mock("inquirer", () => {
  const mockPrompt = vi.fn();
  return {
    default: { prompt: mockPrompt },
    prompt: mockPrompt,
  };
});

describe("rollback command", () => {
  let projectRoot: string;
  let originalCwd: string;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let inquirerMock: { prompt: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "hatch3r-rollback-test-"));
    originalCwd = process.cwd();
    process.chdir(projectRoot);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const inquirerModule = await import("inquirer");
    inquirerMock = inquirerModule as unknown as { prompt: ReturnType<typeof vi.fn> };
    inquirerMock.prompt.mockReset();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(projectRoot, { recursive: true, force: true });
  });

  describe("rollbackCommand", () => {
    it("throws HatchError(exitCode=2) when --session is missing", async () => {
      const { rollbackCommand } = await import("../../cli/commands/rollback.js");
      let thrown: unknown;
      try {
        await rollbackCommand({});
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(HatchError);
      const err = thrown as HatchError;
      expect(err.exitCode).toBe(2);
      expect(err.errorCode).toBe("VALIDATION_ERROR");
      expect(err.message).toContain("session");
    });

    it("throws HatchError(CONFIG_ERROR) for an unknown session id", async () => {
      const { rollbackCommand } = await import("../../cli/commands/rollback.js");
      let thrown: unknown;
      try {
        await rollbackCommand({ session: "no-such-session", yes: true });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(HatchError);
      const err = thrown as HatchError;
      expect(err.errorCode).toBe("CONFIG_ERROR");
      expect(err.message).toContain("no-such-session");
    });

    it("restores files when --yes skips the prompt", async () => {
      const fileA = join(projectRoot, "a.txt");
      await writeFile(fileA, "original");
      await createSnapshot("yes-session", [fileA], { projectRoot });
      await writeFile(fileA, "mutated");

      const { rollbackCommand } = await import("../../cli/commands/rollback.js");
      await expect(
        rollbackCommand({ session: "yes-session", yes: true }),
      ).resolves.toBeUndefined();
      const content = await readFile(fileA, "utf-8");
      expect(content).toBe("original");
      // inquirer should never have been called with --yes.
      expect(inquirerMock.prompt).not.toHaveBeenCalled();
    });

    it("prompts when --yes is omitted and applies on confirmation", async () => {
      const fileA = join(projectRoot, "a.txt");
      await writeFile(fileA, "original");
      await createSnapshot("prompt-yes-session", [fileA], { projectRoot });
      await writeFile(fileA, "mutated");
      inquirerMock.prompt.mockResolvedValueOnce({ confirmed: true });

      const { rollbackCommand } = await import("../../cli/commands/rollback.js");
      await rollbackCommand({ session: "prompt-yes-session" });

      expect(inquirerMock.prompt).toHaveBeenCalledTimes(1);
      const content = await readFile(fileA, "utf-8");
      expect(content).toBe("original");
    });

    it("aborts cleanly when the confirmation prompt is declined", async () => {
      const fileA = join(projectRoot, "a.txt");
      await writeFile(fileA, "original");
      await createSnapshot("prompt-no-session", [fileA], { projectRoot });
      await writeFile(fileA, "mutated");
      inquirerMock.prompt.mockResolvedValueOnce({ confirmed: false });

      const { rollbackCommand } = await import("../../cli/commands/rollback.js");
      await rollbackCommand({ session: "prompt-no-session" });

      // Should NOT have restored the file.
      const content = await readFile(fileA, "utf-8");
      expect(content).toBe("mutated");
    });

    it("dry-run does not mutate disk state", async () => {
      const fileA = join(projectRoot, "a.txt");
      await writeFile(fileA, "original");
      await createSnapshot("dry-session", [fileA], { projectRoot });
      await writeFile(fileA, "mutated");

      const { rollbackCommand } = await import("../../cli/commands/rollback.js");
      await rollbackCommand({ session: "dry-session", dryRun: true });

      // Dry-run skips prompt by spec.
      expect(inquirerMock.prompt).not.toHaveBeenCalled();
      const content = await readFile(fileA, "utf-8");
      expect(content).toBe("mutated");
    });

    it("throws HatchError(FS_ERROR) when applyRollback reports errors", async () => {
      // Set up a session and corrupt the snapshot directory to provoke
      // a read error during restore.
      const fileA = join(projectRoot, "a.txt");
      await writeFile(fileA, "original");
      await createSnapshot("bad-session", [fileA], { projectRoot });
      // Remove the snapshot file body but keep meta so applyRollback
      // tries (and fails) to read each entry.
      const filesDir = join(projectRoot, ".hatch3r", "snapshots", "bad-session", "files");
      await rm(join(filesDir, "a.txt"));
      await mkdir(join(filesDir, "a.txt"), { recursive: true }); // dir clashes with readFile target

      const { rollbackCommand } = await import("../../cli/commands/rollback.js");
      let thrown: unknown;
      try {
        await rollbackCommand({ session: "bad-session", yes: true });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(HatchError);
      expect((thrown as HatchError).errorCode).toBe("FS_ERROR");
    });
  });

  describe("rollbackListCommand", () => {
    it("emits a friendly hint when there are no sessions", async () => {
      const { rollbackListCommand } = await import("../../cli/commands/rollback.js");
      await rollbackListCommand();
      const out = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      const errOut = consoleErrorSpy.mock.calls.map((c) => String(c[0])).join("\n");
      const combined = out + "\n" + errOut;
      expect(combined).toMatch(/No snapshot sessions/);
    });

    it("lists captured sessions", async () => {
      const fileA = join(projectRoot, "a.txt");
      await writeFile(fileA, "x");
      await createSnapshot("list-one", [fileA], { projectRoot });
      await createSnapshot("list-two", [fileA], { projectRoot });

      const { rollbackListCommand } = await import("../../cli/commands/rollback.js");
      await rollbackListCommand();
      const out = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(out).toContain("list-one");
      expect(out).toContain("list-two");
    });
  });
});
