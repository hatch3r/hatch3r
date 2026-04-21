import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HatchError } from "../../types.js";
import type { IntegrityManifest, VerifyResult } from "../../integrity/index.js";

vi.mock("../../integrity/index.js", () => ({
  readIntegrityManifest: vi.fn(),
  verifyIntegrity: vi.fn(),
}));

vi.mock("../../cli/commands/update.js", () => ({
  runUpdate: vi.fn(async () => ({
    copiedFiles: 5,
    syncedTools: 2,
    failedTools: 0,
    version: "1.0.0",
  })),
  runRegenerate: vi.fn(async () => ({
    copiedFiles: 5,
    syncedTools: 2,
    failedTools: 0,
    version: "1.0.0",
  })),
  runPackageUpdate: vi.fn(async () => undefined),
}));

vi.mock("../../manifest/hatchJson.js", () => ({
  readManifest: vi.fn(async () => ({
    version: "1.0.0",
    hatch3rVersion: "1.0.0",
    owner: "test",
    repo: "test",
    namespace: "test",
    project: "test",
    tools: ["cursor"],
    features: {
      agents: true, skills: true, rules: true, prompts: false,
      commands: false, mcp: false, githubAgents: false, hooks: false,
    },
    mcp: { servers: [] },
    managedFiles: [],
  })),
}));

describe("verify command", () => {
  let tempDir: string;
  let originalCwd: string;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  let mockReadIntegrityManifest: ReturnType<typeof vi.fn>;
  let mockVerifyIntegrity: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-verify-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const integrityMod = await import("../../integrity/index.js");
    mockReadIntegrityManifest = integrityMod.readIntegrityManifest as ReturnType<typeof vi.fn>;
    mockVerifyIntegrity = integrityMod.verifyIntegrity as ReturnType<typeof vi.fn>;
    mockReadIntegrityManifest.mockReset();
    mockVerifyIntegrity.mockReset();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  function allOutput(): string {
    return consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join(" ");
  }

  function allErrorOutput(): string {
    return consoleErrorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join(" ");
  }

  const dummyManifest: IntegrityManifest = {
    version: 1,
    generated: "2025-01-01T00:00:00.000Z",
    hatchVersion: "1.0.0",
    files: {},
    checksum: createHash("sha256").update(JSON.stringify({})).digest("hex"),
  };

  it("throws HatchError when no integrity manifest found", async () => {
    mockReadIntegrityManifest.mockResolvedValue(null);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    await expect(verifyCommand()).rejects.toThrow(HatchError);

    try {
      await verifyCommand();
    } catch (e) {
      expect((e as HatchError).exitCode).toBe(1);
    }
  });

  it("mentions missing .integrity.json when manifest not found", async () => {
    mockReadIntegrityManifest.mockResolvedValue(null);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    try {
      await verifyCommand();
    } catch {
      // expected
    }

    const combined = allOutput() + " " + allErrorOutput();
    expect(combined).toContain(".integrity.json");
  });

  it("shows 'No files to verify' when results array is empty", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    mockVerifyIntegrity.mockResolvedValue([]);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    await verifyCommand();

    expect(allOutput()).toContain("No files to verify");
  });

  it("shows 'Integrity check passed' when all files pass", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    const results: VerifyResult[] = [
      { file: "agents/hatch3r-test.md", status: "pass" },
      { file: "rules/hatch3r-code.md", status: "pass" },
    ];
    mockVerifyIntegrity.mockResolvedValue(results);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    await verifyCommand();

    expect(allOutput()).toContain("Integrity check passed");
  });

  it("shows pass count in summary", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    const results: VerifyResult[] = [
      { file: "agents/hatch3r-test.md", status: "pass" },
      { file: "rules/hatch3r-code.md", status: "pass" },
      { file: "rules/hatch3r-git.md", status: "pass" },
    ];
    mockVerifyIntegrity.mockResolvedValue(results);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    await verifyCommand();

    expect(allOutput()).toContain("Passed: 3");
  });

  it("shows 'Integrity check failed' when modified files exist", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    const results: VerifyResult[] = [
      { file: "agents/hatch3r-test.md", status: "pass" },
      { file: "rules/hatch3r-code.md", status: "modified", expected: "sha256:aaa", actual: "sha256:bbb" },
    ];
    mockVerifyIntegrity.mockResolvedValue(results);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    await expect(verifyCommand()).rejects.toThrow(HatchError);
    expect(allOutput()).toContain("Integrity check failed");
  });

  it("shows 'Integrity check failed' when missing files exist", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    const results: VerifyResult[] = [
      { file: "agents/hatch3r-test.md", status: "pass" },
      { file: "rules/hatch3r-gone.md", status: "missing", expected: "sha256:aaa" },
    ];
    mockVerifyIntegrity.mockResolvedValue(results);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    await expect(verifyCommand()).rejects.toThrow(HatchError);
    expect(allOutput()).toContain("Integrity check failed");
  });

  it("shows 'Integrity check failed' when tampered files exist", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    const results: VerifyResult[] = [
      { file: ".integrity.json", status: "tampered" },
    ];
    mockVerifyIntegrity.mockResolvedValue(results);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    await expect(verifyCommand()).rejects.toThrow(HatchError);
    expect(allOutput()).toContain("Integrity check failed");
  });

  it("shows tamper warning when tampered status present", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    const results: VerifyResult[] = [
      { file: ".integrity.json", status: "tampered" },
    ];
    mockVerifyIntegrity.mockResolvedValue(results);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    try {
      await verifyCommand();
    } catch {
      // expected
    }

    const combined = allOutput() + " " + allErrorOutput();
    expect(combined).toContain("tampered");
    expect(combined).toContain("regenerate");
  });

  it("shows modified info when modified status present", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    const results: VerifyResult[] = [
      { file: "rules/hatch3r-code.md", status: "modified", expected: "sha256:aaa", actual: "sha256:bbb" },
    ];
    mockVerifyIntegrity.mockResolvedValue(results);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    try {
      await verifyCommand();
    } catch {
      // expected
    }

    const combined = allOutput() + " " + allErrorOutput();
    expect(combined).toContain("hatch3r update");
  });

  it("shows correct counts for mixed statuses", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    const results: VerifyResult[] = [
      { file: "agents/hatch3r-a.md", status: "pass" },
      { file: "agents/hatch3r-b.md", status: "pass" },
      { file: "rules/hatch3r-code.md", status: "modified", expected: "sha256:aaa", actual: "sha256:bbb" },
      { file: "rules/hatch3r-gone.md", status: "missing", expected: "sha256:ccc" },
      { file: "commands/hatch3r-new.md", status: "new", actual: "sha256:ddd" },
    ];
    mockVerifyIntegrity.mockResolvedValue(results);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    try {
      await verifyCommand();
    } catch {
      // expected — modified + missing causes failure
    }

    const output = allOutput();
    expect(output).toContain("Passed: 2");
    expect(output).toContain("Modified: 1");
    expect(output).toContain("Missing: 1");
    expect(output).toContain("New: 1");
  });

  it("handles 'new' status without failing", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    const results: VerifyResult[] = [
      { file: "agents/hatch3r-test.md", status: "pass" },
      { file: "commands/hatch3r-new.md", status: "new", actual: "sha256:ddd" },
    ];
    mockVerifyIntegrity.mockResolvedValue(results);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    await verifyCommand();

    expect(allOutput()).toContain("Integrity check passed");
  });

  it("shows all status types in output when present", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    const results: VerifyResult[] = [
      { file: "agents/hatch3r-ok.md", status: "pass" },
      { file: "rules/hatch3r-changed.md", status: "modified", expected: "sha256:aaa", actual: "sha256:bbb" },
      { file: "rules/hatch3r-gone.md", status: "missing", expected: "sha256:ccc" },
      { file: "commands/hatch3r-added.md", status: "new", actual: "sha256:ddd" },
      { file: ".integrity.json", status: "tampered" },
    ];
    mockVerifyIntegrity.mockResolvedValue(results);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    try {
      await verifyCommand();
    } catch {
      // expected
    }

    const output = allOutput();
    expect(output).toContain("PASS");
    expect(output).toContain("MODIFIED");
    expect(output).toContain("MISSING");
    expect(output).toContain("NEW");
    expect(output).toContain("TAMPERED");
  });

  it("HatchError exit code is 1 for integrity check failure", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    const results: VerifyResult[] = [
      { file: "rules/hatch3r-code.md", status: "modified", expected: "sha256:aaa", actual: "sha256:bbb" },
    ];
    mockVerifyIntegrity.mockResolvedValue(results);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    try {
      await verifyCommand();
    } catch (e) {
      expect(e).toBeInstanceOf(HatchError);
      expect((e as HatchError).exitCode).toBe(1);
      expect((e as HatchError).message).toBe("Integrity check failed");
    }
  });

  it("prints each result file path in output", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    const results: VerifyResult[] = [
      { file: "agents/hatch3r-test.md", status: "pass" },
      { file: "rules/hatch3r-code.md", status: "pass" },
    ];
    mockVerifyIntegrity.mockResolvedValue(results);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    await verifyCommand();

    const output = allOutput();
    expect(output).toContain("agents/hatch3r-test.md");
    expect(output).toContain("rules/hatch3r-code.md");
  });

  it("does not show tamper warning when only modified files exist", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    const results: VerifyResult[] = [
      { file: "rules/hatch3r-code.md", status: "modified", expected: "sha256:aaa", actual: "sha256:bbb" },
    ];
    mockVerifyIntegrity.mockResolvedValue(results);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    try {
      await verifyCommand();
    } catch {
      // expected
    }

    const combined = allOutput() + " " + allErrorOutput();
    expect(combined).not.toContain("regenerate");
  });

  it("does not show modified info when only missing files exist", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    const results: VerifyResult[] = [
      { file: "rules/hatch3r-gone.md", status: "missing", expected: "sha256:aaa" },
    ];
    mockVerifyIntegrity.mockResolvedValue(results);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    try {
      await verifyCommand();
    } catch {
      // expected
    }

    const combined = allOutput() + " " + allErrorOutput();
    expect(combined).not.toContain("restore originals");
  });

  it("HatchError exit code is 1 for missing manifest", async () => {
    mockReadIntegrityManifest.mockResolvedValue(null);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    try {
      await verifyCommand();
    } catch (e) {
      expect(e).toBeInstanceOf(HatchError);
      expect((e as HatchError).exitCode).toBe(1);
      expect((e as HatchError).message).toContain(".integrity.json");
    }
  });

  it("does not fail when only pass results exist", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    const results: VerifyResult[] = [
      { file: "agents/hatch3r-one.md", status: "pass" },
    ];
    mockVerifyIntegrity.mockResolvedValue(results);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    await expect(verifyCommand()).resolves.toBeUndefined();
  });

  it("shows MISSING label for missing files in per-file output", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    const results: VerifyResult[] = [
      { file: "rules/hatch3r-gone.md", status: "missing", expected: "sha256:aaa" },
    ];
    mockVerifyIntegrity.mockResolvedValue(results);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    try {
      await verifyCommand();
    } catch {
      // expected
    }

    expect(allOutput()).toContain("MISSING");
    expect(allOutput()).toContain("rules/hatch3r-gone.md");
  });

  it("shows NEW label for new files in per-file output", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    const results: VerifyResult[] = [
      { file: "agents/hatch3r-test.md", status: "pass" },
      { file: "commands/hatch3r-fresh.md", status: "new", actual: "sha256:eee" },
    ];
    mockVerifyIntegrity.mockResolvedValue(results);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    await verifyCommand();

    expect(allOutput()).toContain("NEW");
    expect(allOutput()).toContain("commands/hatch3r-fresh.md");
  });

  // ── --fix flag tests (Finding #61) ────────────────────────────

  it("accepts fix option and attempts repair on failure", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    // First call: modified files. Second call (after fix): all pass.
    const failResults: VerifyResult[] = [
      { file: "rules/hatch3r-code.md", status: "modified", expected: "sha256:aaa", actual: "sha256:bbb" },
    ];
    const passResults: VerifyResult[] = [
      { file: "rules/hatch3r-code.md", status: "pass" },
    ];
    mockVerifyIntegrity
      .mockResolvedValueOnce(failResults)
      .mockResolvedValueOnce(passResults);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    await verifyCommand({ fix: true });

    const combined = allOutput() + " " + allErrorOutput();
    expect(combined).toContain("Integrity restored");
  });

  it("--fix throws after max attempts when issues persist", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    const failResults: VerifyResult[] = [
      { file: "rules/hatch3r-code.md", status: "modified", expected: "sha256:aaa", actual: "sha256:bbb" },
    ];
    // All verify calls return failures (fix doesn't resolve)
    mockVerifyIntegrity.mockResolvedValue(failResults);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    await expect(verifyCommand({ fix: true, maxFixAttempts: 2 })).rejects.toThrow(HatchError);

    const combined = allOutput() + " " + allErrorOutput();
    expect(combined).toContain("fix attempt");
  });

  it("--fix with no issues passes immediately", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    const passResults: VerifyResult[] = [
      { file: "agents/hatch3r-test.md", status: "pass" },
    ];
    mockVerifyIntegrity.mockResolvedValue(passResults);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    await verifyCommand({ fix: true });

    expect(allOutput()).toContain("Integrity check passed");
  });

  it("--fix respects maxFixAttempts option", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    const failResults: VerifyResult[] = [
      { file: "rules/hatch3r-code.md", status: "missing", expected: "sha256:aaa" },
    ];
    mockVerifyIntegrity.mockResolvedValue(failResults);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    try {
      await verifyCommand({ fix: true, maxFixAttempts: 1 });
    } catch (e) {
      expect((e as HatchError).message).toContain("1 fix attempt");
    }
  });

  it("without --fix still reports failure normally", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    const results: VerifyResult[] = [
      { file: "rules/hatch3r-code.md", status: "modified", expected: "sha256:aaa", actual: "sha256:bbb" },
    ];
    mockVerifyIntegrity.mockResolvedValue(results);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    await expect(verifyCommand()).rejects.toThrow(HatchError);
    expect(allOutput()).toContain("Integrity check failed");
  });

  it("--fix clamps maxFixAttempts to 5", async () => {
    mockReadIntegrityManifest.mockResolvedValue(dummyManifest);
    const failResults: VerifyResult[] = [
      { file: "rules/hatch3r-code.md", status: "modified", expected: "sha256:aaa", actual: "sha256:bbb" },
    ];
    mockVerifyIntegrity.mockResolvedValue(failResults);

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    try {
      await verifyCommand({ fix: true, maxFixAttempts: 100 });
    } catch (e) {
      // Should be clamped to 5 max
      expect((e as HatchError).message).toContain("5 fix attempt");
    }
  });
});
