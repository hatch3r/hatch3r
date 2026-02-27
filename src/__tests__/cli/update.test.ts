import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const AGENTS_DIR = ".agents";

async function createTestProject(
  root: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const agentsDir = join(root, AGENTS_DIR);
  await mkdir(agentsDir, { recursive: true });
  await mkdir(join(agentsDir, "rules"), { recursive: true });
  await mkdir(join(agentsDir, "agents"), { recursive: true });
  await mkdir(join(agentsDir, "skills"), { recursive: true });
  await mkdir(join(agentsDir, "commands"), { recursive: true });

  const manifest = {
    version: "1.0.0",
    hatch3rVersion: "0.0.9",
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
    "---\nid: hatch3r-test\ntype: rule\ndescription: test rule\nscope: always\n---\n# Test Rule\n\nOld test content.\n",
  );
}

describe("update command", () => {
  let tempDir: string;
  let originalCwd: string;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-update-"));
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
    const { updateCommand } = await import("../../cli/commands/update.js");

    await expect(updateCommand()).rejects.toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);

    const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allOutput).toContain("No .agents/hatch.json found");
  });

  it("should update hatch3rVersion in manifest", async () => {
    await createTestProject(tempDir);

    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    const manifest = JSON.parse(
      await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"),
    );
    expect(manifest.hatch3rVersion).toBe("1.0.0");
  });

  it("should copy hatch3r-prefixed files from pack", async () => {
    await createTestProject(tempDir);

    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    const rulesDir = join(tempDir, AGENTS_DIR, "rules");
    const rules = await readdir(rulesDir);
    const hatch3rRules = rules.filter((f) => f.startsWith("hatch3r-"));
    expect(hatch3rRules.length).toBeGreaterThan(0);
  });

  it("should preserve custom (non-hatch3r-prefixed) files", async () => {
    await createTestProject(tempDir);
    const customRulePath = join(tempDir, AGENTS_DIR, "rules", "my-custom-rule.md");
    await writeFile(customRulePath, "# My custom rule\n\nThis should be preserved.");

    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    const content = await readFile(customRulePath, "utf-8");
    expect(content).toContain("My custom rule");
    expect(content).toContain("This should be preserved");
  });

  it("should regenerate adapter output files after update", async () => {
    await createTestProject(tempDir);

    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    const bridgePath = join(tempDir, ".cursor", "rules", "hatch3r-bridge.mdc");
    const bridgeContent = await readFile(bridgePath, "utf-8").catch(() => null);
    expect(bridgeContent).not.toBeNull();
    expect(bridgeContent).toContain("Hatch3r Bridge");
  });

  it("should report update summary", async () => {
    await createTestProject(tempDir);

    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Update complete");
    expect(output).toContain("canonical files");
  });

  it("should note when already at latest version", async () => {
    await createTestProject(tempDir, { hatch3rVersion: "1.0.0" });

    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Already at");
  });

  it("should update canonical files for multiple tools", async () => {
    await createTestProject(tempDir, { tools: ["cursor", "claude"] });

    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("2 tool(s) re-synced");
  });
});
