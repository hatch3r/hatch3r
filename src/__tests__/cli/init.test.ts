import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const AGENTS_DIR = ".agents";

describe("init command", () => {
  let tempDir: string;
  let originalCwd: string;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-"));
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

  it("should create .agents/ directory with --yes flag", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true });

    await expect(access(join(tempDir, AGENTS_DIR))).resolves.toBeUndefined();
  });

  it("should create hatch.json manifest with --yes flag", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const raw = await readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(raw);

    expect(manifest.version).toBe("1.0.0");
    expect(manifest.hatch3rVersion).toBe("1.0.0");
    expect(Array.isArray(manifest.tools)).toBe(true);
    expect(manifest.tools.length).toBeGreaterThan(0);
    expect(manifest.features).toBeDefined();
    expect(manifest.features.agents).toBe(true);
    expect(manifest.features.rules).toBe(true);
    expect(manifest.features.skills).toBe(true);
    expect(Array.isArray(manifest.managedFiles)).toBe(true);
    expect(manifest.managedFiles.length).toBeGreaterThan(0);
  });

  it("should copy canonical files to .agents/", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true });

    const agentsDir = join(tempDir, AGENTS_DIR);
    await expect(access(join(agentsDir, "rules"))).resolves.toBeUndefined();
    await expect(access(join(agentsDir, "agents"))).resolves.toBeUndefined();
    await expect(access(join(agentsDir, "skills"))).resolves.toBeUndefined();
    await expect(access(join(agentsDir, "commands"))).resolves.toBeUndefined();
  });

  it("should create AGENTS.md with managed content", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true });

    const agentsMdPath = join(tempDir, "AGENTS.md");
    const content = await readFile(agentsMdPath, "utf-8");

    expect(content).toContain("<!-- HATCH3R:BEGIN -->");
    expect(content).toContain("<!-- HATCH3R:END -->");
    expect(content).toContain("hatch3r");
  });

  it("should generate adapter output files", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true, tools: "cursor" });

    await expect(access(join(tempDir, ".cursor"))).resolves.toBeUndefined();
    await expect(access(join(tempDir, ".cursor", "rules"))).resolves.toBeUndefined();
  });

  it("should use specified tools from --tools flag", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true, tools: "cursor,claude" });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    expect(manifest.tools).toContain("cursor");
    expect(manifest.tools).toContain("claude");
  });

  it("should reject invalid tools", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");

    await expect(initCommand({ yes: true, tools: "invalid-tool" })).rejects.toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);

    const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allOutput).toContain("Invalid tool(s)");
  });

  it("should set all default features with --yes flag", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    expect(manifest.features.agents).toBe(true);
    expect(manifest.features.skills).toBe(true);
    expect(manifest.features.rules).toBe(true);
    expect(manifest.features.prompts).toBe(true);
    expect(manifest.features.commands).toBe(true);
    expect(manifest.features.mcp).toBe(true);
    expect(manifest.features.guardrails).toBe(false);
    expect(manifest.features.githubAgents).toBe(true);
  });

  it("should include MCP servers when mcp feature is enabled", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    expect(manifest.mcp).toBeDefined();
    expect(manifest.mcp.servers.length).toBeGreaterThan(0);
  });

  it("should create .env.mcp with required env vars for selected servers", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true });

    const envPath = join(tempDir, ".env.mcp");
    const content = await readFile(envPath, "utf-8");
    expect(content).toContain("GITHUB_PAT=");
    expect(content).toContain("BRAVE_API_KEY=");
    expect(content).toContain("hatch3r MCP secrets");
  });

  it("should filter canonical mcp.json to only include selected servers", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    const selectedServers = new Set(manifest.mcp.servers);

    const mcpPath = join(tempDir, AGENTS_DIR, "mcp", "mcp.json");
    const mcpContent = JSON.parse(await readFile(mcpPath, "utf-8"));
    const canonicalServers = Object.keys(mcpContent.mcpServers ?? {});

    expect(canonicalServers.length).toBe(selectedServers.size);
    for (const name of canonicalServers) {
      expect(selectedServers.has(name)).toBe(true);
    }
  });

  it("should print summary after init", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Hatch complete");
    expect(output).toContain("Tools");
    expect(output).toContain("Features");
  });

  it("should display sourcing hint after add secrets message", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Add your secrets to .env.mcp");
    expect(output).toContain("Run this, then start or restart your editor");
  });

  it("should overwrite existing .agents/ without prompting in --yes mode", async () => {
    const agentsDir = join(tempDir, AGENTS_DIR);
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      join(agentsDir, "hatch.json"),
      JSON.stringify({ version: "1.0.0", hatch3rVersion: "0.0.1", tools: [], features: {}, mcp: { servers: [] }, managedFiles: [] }),
    );

    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true });

    const manifest = JSON.parse(await readFile(join(agentsDir, "hatch.json"), "utf-8"));
    expect(manifest.hatch3rVersion).toBe("1.0.0");
  });

  it("should include AGENTS.md in managedFiles", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    expect(manifest.managedFiles).toContain("AGENTS.md");
  });

  it("should preserve user content in AGENTS.md when it pre-exists without managed blocks", async () => {
    const userContent = "# My Project Instructions\n\nUse TypeScript for all new code.";
    await writeFile(join(tempDir, "AGENTS.md"), userContent);

    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true });

    const content = await readFile(join(tempDir, "AGENTS.md"), "utf-8");
    expect(content).toContain(userContent);
    expect(content).toContain("<!-- HATCH3R:BEGIN -->");
    expect(content).toContain("<!-- HATCH3R:END -->");
    expect(content).toContain("hatch3r");
  });

  it("should preserve user content in platform-specific files (e.g. CLAUDE.md) when pre-existing", async () => {
    const userContent = "# My Claude Preferences\n\nAlways prefer functional style.";
    await writeFile(join(tempDir, "CLAUDE.md"), userContent);

    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true, tools: "claude" });

    const content = await readFile(join(tempDir, "CLAUDE.md"), "utf-8");
    expect(content).toContain(userContent);
    expect(content).toContain("<!-- HATCH3R:BEGIN -->");
    expect(content).toContain("hatch3r");
  });

  it("should handle multiple valid tools from --tools flag", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true, tools: "cursor,claude,gemini" });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    expect(manifest.tools).toContain("cursor");
    expect(manifest.tools).toContain("claude");
    expect(manifest.tools).toContain("gemini");
    expect(manifest.tools.length).toBe(3);
  });

  it("should reject when any tool in --tools is invalid", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");

    await expect(initCommand({ yes: true, tools: "cursor,bogus" })).rejects.toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
    const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allOutput).toContain("Invalid tool(s)");
    expect(allOutput).toContain("bogus");
  });

  it("should detect existing tools and use them as defaults with --yes", async () => {
    await mkdir(join(tempDir, ".cursor"), { recursive: true });

    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    expect(manifest.tools).toContain("cursor");
  });

  it("should create canonical content directories", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true });

    const agentsDir = join(tempDir, AGENTS_DIR);
    await expect(access(join(agentsDir, "learnings"))).resolves.toBeUndefined();
  });

  it("should create canonical AGENTS.md inside .agents/", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true });

    const canonicalPath = join(tempDir, AGENTS_DIR, "AGENTS.md");
    const content = await readFile(canonicalPath, "utf-8");
    expect(content.length).toBeGreaterThan(0);
  });

  it("should handle a single tool from --tools flag", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true, tools: "amp" });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    expect(manifest.tools).toEqual(["amp"]);
  });
});
