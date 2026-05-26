import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HatchError, HATCH3R_DIR } from "../../types.js";

// Wave 7 (1.9.0) — fresh test for the verify command. The integrity
// manifest subsystem was deleted in this wave; `verify` is now a thin
// drift-detection wrapper over `computeAdapterDrift`. It must:
//   - exit 0 (no throw) when every tracked adapter output matches a
//     freshly regenerated copy (sourced from the bundled content root);
//   - throw HatchError(INTEGRITY_ERROR) with exitCode=1 when any file is
//     drifted (modified) or missing on disk.
//
// Mirrors the fixture/spy pattern used in `src/__tests__/cli/status.test.ts`
// because verify reuses the same drift helper as `status` (Wave 7 contract:
// one drift definition, two CLI front doors).

async function createTestProject(root: string, overrides: Record<string, unknown> = {}): Promise<void> {
  const hatch3rDir = join(root, HATCH3R_DIR);
  await mkdir(hatch3rDir, { recursive: true });

  const manifest = {
    version: "3.0.0",
    hatch3rVersion: "1.9.0",
    platform: "github",
    owner: "test-org",
    repo: "test-repo",
    namespace: "test-org",
    project: "test-repo",
    tools: ["cursor"],
    features: {
      agents: true,
      skills: true,
      rules: true,
      prompts: true,
      commands: true,
      mcp: true,
      githubAgents: true,
      hooks: true,
      handoffs: true,
    },
    mcp: { servers: [] },
    managedFiles: [],
    ...overrides,
  };
  await writeFile(join(hatch3rDir, "hatch.json"), JSON.stringify(manifest, null, 2));
}

describe("verify command", () => {
  let tempDir: string;
  let originalCwd: string;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

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
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("exits with error when no manifest exists", async () => {
    const { verifyCommand } = await import("../../cli/commands/verify.js");

    await expect(verifyCommand()).rejects.toThrow(HatchError);
    try {
      await verifyCommand();
    } catch (e) {
      expect((e as HatchError).exitCode).toBe(1);
      expect((e as HatchError).errorCode).toBe("CONFIG_ERROR");
    }

    const allOutput = [
      ...consoleSpy.mock.calls.map((c) => String(c[0])),
      ...consoleErrorSpy.mock.calls.map((c) => String(c[0])),
    ].join(" ");
    expect(allOutput).toContain(".hatch3r/hatch.json");
  });

  it("exits cleanly (exit 0) when there is no adapter output to check", async () => {
    // Manifest with an empty tools list — `computeAdapterDrift` walks
    // zero adapters and zero managed files, so verify must succeed.
    await createTestProject(tempDir, { tools: [], managedFiles: [] });

    consoleSpy.mockClear();
    consoleErrorSpy.mockClear();

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    await expect(verifyCommand()).resolves.toBeUndefined();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("verify: PASS");
  });

  it("throws HatchError(INTEGRITY_ERROR) when an adapter output is modified", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    // Tamper with one rule file so the regenerated content no longer
    // matches the on-disk managed block.
    const cursorRulesDir = join(tempDir, ".cursor", "rules");
    const entries = await readdir(cursorRulesDir);
    const ruleFile = entries.find((f) => f.endsWith(".mdc"));
    expect(ruleFile).toBeDefined();
    await writeFile(join(cursorRulesDir, ruleFile!), "tampered drift content\n");

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    let thrown: unknown;
    try {
      await verifyCommand();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(HatchError);
    const err = thrown as HatchError;
    expect(err.errorCode).toBe("INTEGRITY_ERROR");
    expect(err.exitCode).toBe(1);
    expect(err.message).toMatch(/drift detected/i);
  });

  it("throws HatchError(INTEGRITY_ERROR) when an adapter output is missing", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    // Delete one rule file so verify sees a missing output.
    const cursorRulesDir = join(tempDir, ".cursor", "rules");
    const entries = await readdir(cursorRulesDir);
    const ruleFile = entries.find((f) => f.endsWith(".mdc"));
    expect(ruleFile).toBeDefined();
    await rm(join(cursorRulesDir, ruleFile!));

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    let thrown: unknown;
    try {
      await verifyCommand();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(HatchError);
    const err = thrown as HatchError;
    expect(err.errorCode).toBe("INTEGRITY_ERROR");
    expect(err.exitCode).toBe(1);
    expect(err.message).toMatch(/drift detected/i);

    // Failure output should surface the verify: FAIL header so operators
    // see immediately which command rejected the run.
    const output = [
      ...consoleSpy.mock.calls.map((c) => String(c[0])),
      ...consoleErrorSpy.mock.calls.map((c) => String(c[0])),
    ].join("\n");
    expect(output).toMatch(/verify: FAIL/);
  });
});
