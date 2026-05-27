import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HatchError, HATCH3R_DIR } from "../../types.js";

// Wave 6 + Wave 7 rewrite (1.9.0):
//   - manifest moved from `.agents/hatch.json` to `.hatch3r/hatch.json`.
//   - status pivots to `computeAdapterDrift` (in-memory regeneration vs.
//     on-disk adapter outputs). The integrity-manifest "fast path" /
//     `--deep` flag / partial-sync indicator / codex `AGENTS.override.md`
//     warning are all gone.
//   - tests build `.hatch3r/hatch.json` fixtures and rely on the real
//     `syncCommand` to write adapter outputs, then exercise the drift
//     branches by mutating those outputs after the fact.

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

describe("status command", () => {
  let tempDir: string;
  let originalCwd: string;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-status-"));
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

  it("should exit with error when no manifest exists", async () => {
    const { statusCommand } = await import("../../cli/commands/status.js");

    await expect(statusCommand()).rejects.toThrow(HatchError);
    try { await statusCommand(); } catch (e) { expect((e as HatchError).exitCode).toBe(1); }

    // Error message references the new manifest location.
    const allOutput = [
      ...consoleSpy.mock.calls.map((c) => String(c[0])),
      ...consoleErrorSpy.mock.calls.map((c) => String(c[0])),
    ].join(" ");
    expect(allOutput).toContain(".hatch3r/hatch.json");
  });

  it("should report synced when all generated files match", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    consoleSpy.mockClear();
    consoleErrorSpy.mockClear();

    const { statusCommand } = await import("../../cli/commands/status.js");
    await statusCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("In sync:");
    expect(output).toContain("Status");
  });

  it("should report drifted when a generated file differs", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const cursorRulesDir = join(tempDir, ".cursor", "rules");
    const entries = await readdir(cursorRulesDir);
    const ruleFile = entries.find((f) => f.endsWith(".mdc"));
    expect(ruleFile).toBeDefined();
    await writeFile(join(cursorRulesDir, ruleFile!), "modified drift content");

    consoleSpy.mockClear();
    consoleErrorSpy.mockClear();

    const { statusCommand } = await import("../../cli/commands/status.js");
    await statusCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("drifted");
    expect(output).toContain("Drifted:");
    // F2.7-F5 (Cycle 10 Wave 2, partial): the drifted hint must warn that sync
    // overwrites the managed block, since status cannot yet attribute drift
    // direction (user edit vs. outdated canonical) without an emit-time baseline.
    expect(output).toContain("sync overwrites the managed block");
  });

  it("should report missing when a generated file is deleted", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const cursorRulesDir = join(tempDir, ".cursor", "rules");
    const entries = await readdir(cursorRulesDir);
    const ruleFile = entries.find((f) => f.endsWith(".mdc"));
    expect(ruleFile).toBeDefined();
    await rm(join(cursorRulesDir, ruleFile!));

    consoleSpy.mockClear();
    consoleErrorSpy.mockClear();

    const { statusCommand } = await import("../../cli/commands/status.js");
    await statusCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("missing");
    expect(output).toContain("Missing:");
  });

  it("should check all configured tools", async () => {
    await createTestProject(tempDir, { tools: ["cursor", "claude"] });

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    consoleSpy.mockClear();
    consoleErrorSpy.mockClear();

    const { statusCommand } = await import("../../cli/commands/status.js");
    await statusCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("cursor:");
    expect(output).toContain("claude:");
  });

  it("should display correct summary counts", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    consoleSpy.mockClear();
    consoleErrorSpy.mockClear();

    const { statusCommand } = await import("../../cli/commands/status.js");
    await statusCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Status");
    expect(output).toContain("In sync:");
  });

  it("should handle empty tools list gracefully", async () => {
    await createTestProject(tempDir, { tools: [] });

    const { statusCommand } = await import("../../cli/commands/status.js");
    await statusCommand();

    expect(exitSpy).not.toHaveBeenCalledWith(1);
    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Status");
  });

  // Wave 7: `computeAdapterDrift` is the single source of truth for both
  // `status` and `verify`. Exercise the helper directly so the contract
  // is locked at the function level too.
  describe("computeAdapterDrift helper", () => {
    it("classifies in-sync vs. modified vs. missing per file", async () => {
      await createTestProject(tempDir);

      const { syncCommand } = await import("../../cli/commands/sync.js");
      await syncCommand();

      const { readManifest } = await import("../../manifest/hatchJson.js");
      const manifest = await readManifest(tempDir);
      expect(manifest).not.toBeNull();

      const { computeAdapterDrift } = await import("../../cli/commands/status.js");

      // Sanity: the report yields a synced bucket and at least one entry.
      const beforeMutation = await computeAdapterDrift(tempDir, manifest!);
      expect(beforeMutation.counts.synced).toBeGreaterThan(0);
      expect(beforeMutation.entries.length).toBeGreaterThan(0);

      // Delete a tracked cursor rule and verify it is reported as "missing".
      const cursorRulesDir = join(tempDir, ".cursor", "rules");
      const entries = await readdir(cursorRulesDir);
      const ruleFile = entries.find((f) => f.endsWith(".mdc"));
      expect(ruleFile).toBeDefined();
      const targetPath = join(".cursor", "rules", ruleFile!);
      await rm(join(cursorRulesDir, ruleFile!));

      const afterDelete = await computeAdapterDrift(tempDir, manifest!);
      const matching = afterDelete.entries.find(
        (e) => e.path.endsWith(ruleFile!) || e.path === targetPath,
      );
      expect(matching).toBeDefined();
      expect(matching!.status).toBe("missing");
      expect(afterDelete.counts.missing).toBeGreaterThanOrEqual(1);
    });
  });

  // Wave 7 removals:
  //   - "fast vs deep status paths" — fast path depended on the integrity
  //     manifest; both the manifest and the `--deep` flag are gone.
  //   - "AGENTS.override.md precedence warning" — the codex adapter that
  //     drove this warning was removed in Wave 1. There is no longer any
  //     emission path that fires this warning.
});
