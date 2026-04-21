import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { HatchError } from "../../types.js";

// Mock child_process to prevent actual git/npx calls from update command
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn() };
});

const AGENTS_DIR = ".agents";

// Heavy filesystem I/O per test (mkdtemp + init creates 131 files + per-adapter
// generation + integrity hashing + rm -rf teardown). On Windows Node 22 CI
// runners this regularly exceeds the 30s default (vitest#7302, nodejs/node#60397).
describe("init -> sync -> update lifecycle", { timeout: 60_000 }, () => {
  let tempDir: string;
  let originalCwd: string;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-lifecycle-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(""));
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  });

  it("full lifecycle: init creates project, sync generates output, update refreshes", async () => {
    // ── Phase 1: Init ──────────────────────────────────────────
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true, tools: "cursor" });

    // Verify init created the project structure
    await expect(access(join(tempDir, AGENTS_DIR))).resolves.toBeUndefined();
    await expect(access(join(tempDir, AGENTS_DIR, "hatch.json"))).resolves.toBeUndefined();

    const manifestRaw = await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8");
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.tools).toContain("cursor");
    expect(manifest.features.rules).toBe(true);

    // Verify canonical files were created
    await expect(access(join(tempDir, AGENTS_DIR, "rules"))).resolves.toBeUndefined();
    await expect(access(join(tempDir, AGENTS_DIR, "agents"))).resolves.toBeUndefined();

    // ── Phase 2: Sync ──────────────────────────────────────────
    consoleSpy.mockClear();
    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    // Verify sync generated adapter output
    const cursorRulesDir = join(tempDir, ".cursor", "rules");
    const bridgePath = join(cursorRulesDir, "hatch3r-bridge.mdc");
    const bridgeContent = await readFile(bridgePath, "utf-8").catch(() => null);
    expect(bridgeContent).not.toBeNull();
    expect(bridgeContent).toContain("Hatch3r Bridge");

    // Verify AGENTS.md was created with managed blocks
    const agentsMd = await readFile(join(tempDir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain("<!-- HATCH3R:BEGIN -->");
    expect(agentsMd).toContain("<!-- HATCH3R:END -->");

    const syncOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(syncOutput).toContain("Sync complete");

    // ── Phase 3: Update ────────────────────────────────────────
    consoleSpy.mockClear();
    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    // Verify update refreshed the manifest version
    const updatedManifestRaw = await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8");
    const updatedManifest = JSON.parse(updatedManifestRaw);
    expect(updatedManifest.hatch3rVersion).toBe("1.6.0");

    // Verify adapter output was regenerated
    const updatedBridge = await readFile(bridgePath, "utf-8").catch(() => null);
    expect(updatedBridge).not.toBeNull();

    const updateOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(updateOutput).toContain("Update complete");
  });

  it("sync is idempotent: re-sync after init produces consistent results", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true, tools: "cursor" });

    const { syncCommand } = await import("../../cli/commands/sync.js");

    // First sync
    await syncCommand();
    const agentsMd1 = await readFile(join(tempDir, "AGENTS.md"), "utf-8");

    // Second sync (should be idempotent)
    consoleSpy.mockClear();
    await syncCommand();
    const agentsMd2 = await readFile(join(tempDir, "AGENTS.md"), "utf-8");

    // Content should be the same after re-sync
    expect(agentsMd1).toBe(agentsMd2);

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // On re-sync, some files may be skipped (already up to date)
    expect(output).toContain("Sync complete");
  });

  it("update preserves custom user files", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true, tools: "cursor" });

    // Add a custom rule file
    const customRulePath = join(tempDir, AGENTS_DIR, "rules", "my-team-rule.md");
    await writeFile(
      customRulePath,
      "---\nid: my-team-rule\ntype: rule\ndescription: Team rule\nscope: always\n---\n# My Team Rule\n\nCustom team content.\n",
    );

    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    // Custom file should be preserved
    const customContent = await readFile(customRulePath, "utf-8");
    expect(customContent).toContain("My Team Rule");
    expect(customContent).toContain("Custom team content");
  });

  it("update after sync refreshes hatch3r-prefixed canonical files", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true, tools: "cursor" });

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    // Capture the initial state of a hatch3r-prefixed rule
    const rulesDir = join(tempDir, AGENTS_DIR, "rules");
    const ruleFiles = await readdir(rulesDir);
    const hatch3rRules = ruleFiles.filter((f) => f.startsWith("hatch3r-"));
    expect(hatch3rRules.length).toBeGreaterThan(0);

    // Run update
    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    // hatch3r-prefixed files should still exist after update
    const updatedRuleFiles = await readdir(rulesDir);
    const updatedHatch3rRules = updatedRuleFiles.filter((f) => f.startsWith("hatch3r-"));
    expect(updatedHatch3rRules.length).toBeGreaterThan(0);
  });

  it("multi-tool lifecycle: init with multiple tools, sync generates all outputs", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true, tools: "cursor,claude" });

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    // Verify cursor output exists
    const cursorBridge = await readFile(
      join(tempDir, ".cursor", "rules", "hatch3r-bridge.mdc"),
      "utf-8",
    ).catch(() => null);
    expect(cursorBridge).not.toBeNull();

    // Verify claude output exists
    const claudeMd = await readFile(
      join(tempDir, "CLAUDE.md"),
      "utf-8",
    ).catch(() => null);
    expect(claudeMd).not.toBeNull();

    // Run update to verify both tools are refreshed
    consoleSpy.mockClear();
    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    const updateOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(updateOutput).toContain("2 tool(s) re-synced");
  });
});
