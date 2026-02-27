import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const AGENTS_DIR = ".agents";

async function createTestProject(root: string, overrides: Record<string, unknown> = {}): Promise<void> {
  const agentsDir = join(root, AGENTS_DIR);
  await mkdir(agentsDir, { recursive: true });
  await mkdir(join(agentsDir, "rules"), { recursive: true });
  await mkdir(join(agentsDir, "agents"), { recursive: true });
  await mkdir(join(agentsDir, "skills"), { recursive: true });
  await mkdir(join(agentsDir, "commands"), { recursive: true });

  const manifest = {
    version: "1.0.0",
    hatch3rVersion: "1.0.0",
    owner: "test-org",
    repo: "test-repo",
    tools: ["cursor"],
    features: {
      agents: true,
      skills: true,
      rules: true,
      prompts: true,
      commands: true,
      mcp: true,
      guardrails: true,
      githubAgents: true,
      hooks: true,
    },
    mcp: { servers: [] },
    managedFiles: [],
    ...overrides,
  };
  await writeFile(join(agentsDir, "hatch.json"), JSON.stringify(manifest, null, 2));

  await writeFile(
    join(agentsDir, "rules", "hatch3r-test.md"),
    "---\nid: hatch3r-test\ntype: rule\ndescription: test rule\nscope: always\n---\n# Test Rule\n\nTest content.\n",
  );

  await writeFile(
    join(agentsDir, "agents", "hatch3r-test-agent.md"),
    "---\nid: test-agent\ntype: agent\ndescription: test agent\n---\n# Test Agent\n\nYou are a test agent.\n",
  );
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

    await expect(statusCommand()).rejects.toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);

    const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allOutput).toContain("No .agents/hatch.json found");
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
});
