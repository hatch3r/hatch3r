import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
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

describe("sync command", () => {
  let tempDir: string;
  let originalCwd: string;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-sync-"));
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
    const { syncCommand } = await import("../../cli/commands/sync.js");

    await expect(syncCommand()).rejects.toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);

    const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allOutput).toContain("No .agents/hatch.json found");
  });

  it("should sync and create adapter output files", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const cursorRulesDir = join(tempDir, ".cursor", "rules");
    const rulesContent = await readFile(
      join(cursorRulesDir, "hatch3r-test.mdc"),
      "utf-8",
    ).catch(() => null);
    expect(rulesContent).not.toBeNull();
  });

  it("should create or update AGENTS.md with managed block", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const agentsMd = await readFile(join(tempDir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain("<!-- HATCH3R:BEGIN -->");
    expect(agentsMd).toContain("<!-- HATCH3R:END -->");
    expect(agentsMd).toContain("hatch3r");
  });

  it("should skip AGENTS.md when it has no managed block markers", async () => {
    await createTestProject(tempDir);
    const customContent =
      "# My Custom Header\n\nCustom content that should be preserved.\n";
    await writeFile(join(tempDir, "AGENTS.md"), customContent);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const agentsMd = await readFile(join(tempDir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toBe(customContent);
  });

  it("should report sync summary", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Sync complete");
  });

  it("should sync multiple tools when configured", async () => {
    await createTestProject(tempDir, { tools: ["cursor", "claude"] });

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const cursorRulesExists = await readFile(
      join(tempDir, ".cursor", "rules", "hatch3r-bridge.mdc"),
      "utf-8",
    ).catch(() => null);
    expect(cursorRulesExists).not.toBeNull();

    const claudeMdExists = await readFile(
      join(tempDir, "CLAUDE.md"),
      "utf-8",
    ).catch(() => null);
    expect(claudeMdExists).not.toBeNull();
  });

  it("should report actions for each synced file", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("AGENTS.md");
  });

  it("should warn about new MCP env vars when servers require them", async () => {
    await createTestProject(tempDir, {
      mcp: { servers: ["github"] },
    });

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("New secrets needed in .env.mcp");
    expect(output).toContain("GITHUB_PAT");
  });
});
