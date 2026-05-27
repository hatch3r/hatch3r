import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
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

  // Cycle 10 / D11-H-6: the advertised `--fix` flag (declared in program.ts)
  // was silently ignored — `hatch3r verify --fix` behaved identically to a
  // plain drift report (Silent-Failure-Contract, P5). `--fix` now repairs
  // drift by regenerating adapter output (the same in-memory regeneration
  // `sync` performs) up to `--max-fix-attempts` times, re-checking after each
  // pass.
  it("repairs drift and exits PASS when run with --fix", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    // Introduce genuine drift INSIDE the managed block while preserving the
    // HATCH3R:BEGIN/END markers — this is the drift `--fix` regenerates.
    // (Destroying the markers entirely is a separate, fail-closed case:
    // safeWriteFile refuses to clobber a marker-less file by design, so
    // `--fix` cannot and must not auto-repair that.)
    const cursorRulesDir = join(tempDir, ".cursor", "rules");
    const entries = await readdir(cursorRulesDir);
    const ruleFile = entries.find((f) => f.endsWith(".mdc"));
    expect(ruleFile).toBeDefined();
    const rulePath = join(cursorRulesDir, ruleFile!);
    const original = await readFile(rulePath, "utf-8");
    // Insert AFTER the full begin marker comment so the marker itself stays
    // intact and the injected line lands inside the managed block (the
    // regenerable region). Splicing inside the `<!-- ... -->` marker text
    // would instead corrupt the marker — a separate fail-closed case.
    const beginMarker = "<!-- HATCH3R:BEGIN -->";
    const beginIdx = original.indexOf(beginMarker);
    expect(beginIdx).toBeGreaterThan(-1);
    const insertAt = beginIdx + beginMarker.length;
    const tampered =
      original.slice(0, insertAt) + "\ndrifted-inside-block-line" + original.slice(insertAt);
    await writeFile(rulePath, tampered);

    consoleSpy.mockClear();
    consoleErrorSpy.mockClear();

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    // --fix must regenerate the drifted block and exit cleanly (no throw).
    await expect(verifyCommand({ fix: true })).resolves.toBeUndefined();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toMatch(/--fix attempt 1\//);
    expect(output).toContain("verify: PASS");

    // The drifted line must be gone and a subsequent plain verify confirms
    // the repair persisted on disk.
    const repaired = await readFile(rulePath, "utf-8");
    expect(repaired).not.toContain("drifted-inside-block-line");
    await expect(verifyCommand()).resolves.toBeUndefined();
  });

  it("repairs a missing adapter output when run with --fix", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const cursorRulesDir = join(tempDir, ".cursor", "rules");
    const entries = await readdir(cursorRulesDir);
    const ruleFile = entries.find((f) => f.endsWith(".mdc"));
    expect(ruleFile).toBeDefined();
    await rm(join(cursorRulesDir, ruleFile!));

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    // The missing file must be regenerated; verify --fix exits 0.
    await expect(verifyCommand({ fix: true, maxFixAttempts: 1 })).resolves.toBeUndefined();

    const restored = await readdir(cursorRulesDir);
    expect(restored).toContain(ruleFile!);
  });
});
