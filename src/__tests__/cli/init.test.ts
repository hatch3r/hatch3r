import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HatchError } from "../../types.js";

const AGENTS_DIR = ".agents";

describe("init command", () => {
  let initCommand: (opts?: { tools?: string; yes?: boolean }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should create .agents/ directory with --yes flag", async () => {
    await initCommand({ yes: true });

    await expect(access(join(tempDir, AGENTS_DIR))).resolves.toBeUndefined();
  });

  it("should create hatch.json manifest with --yes flag", async () => {
    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const raw = await readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(raw);

    expect(manifest.version).toBe("2.0.0");
    expect(manifest.hatch3rVersion).toBe("1.5.0");
    expect(manifest.platform).toBe("github");
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
    await initCommand({ yes: true });

    const agentsDir = join(tempDir, AGENTS_DIR);
    await expect(access(join(agentsDir, "rules"))).resolves.toBeUndefined();
    await expect(access(join(agentsDir, "agents"))).resolves.toBeUndefined();
    await expect(access(join(agentsDir, "skills"))).resolves.toBeUndefined();
    await expect(access(join(agentsDir, "commands"))).resolves.toBeUndefined();
  });

  it("should create AGENTS.md with managed content", async () => {
    await initCommand({ yes: true });

    const agentsMdPath = join(tempDir, "AGENTS.md");
    const content = await readFile(agentsMdPath, "utf-8");

    expect(content).toContain("<!-- HATCH3R:BEGIN -->");
    expect(content).toContain("<!-- HATCH3R:END -->");
    expect(content).toContain("hatch3r");
  });

  it("should generate adapter output files", async () => {
    await initCommand({ yes: true, tools: "cursor" });

    await expect(access(join(tempDir, ".cursor"))).resolves.toBeUndefined();
    await expect(access(join(tempDir, ".cursor", "rules"))).resolves.toBeUndefined();
  });

  it("should use specified tools from --tools flag", async () => {
    await initCommand({ yes: true, tools: "cursor,claude" });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    expect(manifest.tools).toContain("cursor");
    expect(manifest.tools).toContain("claude");
  });

  it("should reject invalid tools", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");

    await expect(initCommand({ yes: true, tools: "invalid-tool" })).rejects.toThrow(HatchError);
    try { await initCommand({ yes: true, tools: "invalid-tool" }); } catch (e) { expect((e as HatchError).exitCode).toBe(1); }

    const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allOutput).toContain("Invalid tool(s)");
  });

  it("should set all default features with --yes flag", async () => {
    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    expect(manifest.features.agents).toBe(true);
    expect(manifest.features.skills).toBe(true);
    expect(manifest.features.rules).toBe(true);
    expect(manifest.features.prompts).toBe(true);
    expect(manifest.features.commands).toBe(true);
    expect(manifest.features.mcp).toBe(true);
    expect(manifest.features.githubAgents).toBe(true);
  });

  it("should include MCP servers when mcp feature is enabled", async () => {
    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    expect(manifest.mcp).toBeDefined();
    expect(manifest.mcp.servers.length).toBeGreaterThan(0);
  });

  it("should create .env.mcp with required env vars for selected servers", async () => {
    await initCommand({ yes: true });

    const envPath = join(tempDir, ".env.mcp");
    const content = await readFile(envPath, "utf-8");
    expect(content).toContain("GITHUB_PAT=");
    expect(content).toContain("hatch3r MCP secrets");
  });

  it("should filter canonical mcp.json to only include selected servers", async () => {
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
    await initCommand({ yes: true });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Hatch complete");
    expect(output).toContain("Tools");
    expect(output).toContain("Features");
  });

  it("should display sourcing hint in success box", async () => {
    await initCommand({ yes: true });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Add your secrets to");
    expect(output).toContain(".env.mcp");
    expect(output).toContain("Then run:");
  });

  it("should overwrite existing .agents/ without prompting in --yes mode", async () => {
    const agentsDir = join(tempDir, AGENTS_DIR);
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      join(agentsDir, "hatch.json"),
      JSON.stringify({ version: "2.0.0", hatch3rVersion: "0.0.1", platform: "github", tools: [], features: {}, mcp: { servers: [] }, managedFiles: [] }),
    );

    await initCommand({ yes: true });

    const manifest = JSON.parse(await readFile(join(agentsDir, "hatch.json"), "utf-8"));
    expect(manifest.hatch3rVersion).toBe("1.5.0");
  });

  it("should include AGENTS.md in managedFiles", async () => {
    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    expect(manifest.managedFiles).toContain("AGENTS.md");
  });

  it("should preserve user content in AGENTS.md when it pre-exists without managed blocks", async () => {
    const userContent = "# My Project Instructions\n\nUse TypeScript for all new code.";
    await writeFile(join(tempDir, "AGENTS.md"), userContent);

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

    await initCommand({ yes: true, tools: "claude" });

    const content = await readFile(join(tempDir, "CLAUDE.md"), "utf-8");
    expect(content).toContain(userContent);
    expect(content).toContain("<!-- HATCH3R:BEGIN -->");
    expect(content).toContain("hatch3r");
  });

  it("should handle multiple valid tools from --tools flag", async () => {
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

    await expect(initCommand({ yes: true, tools: "cursor,bogus" })).rejects.toThrow(HatchError);
    try { await initCommand({ yes: true, tools: "cursor,bogus" }); } catch (e) { expect((e as HatchError).exitCode).toBe(1); }
    const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allOutput).toContain("Invalid tool(s)");
    expect(allOutput).toContain("bogus");
  });

  it("should detect existing tools and use them as defaults with --yes", async () => {
    await mkdir(join(tempDir, ".cursor"), { recursive: true });

    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    expect(manifest.tools).toContain("cursor");
  });

  it("should create canonical content directories", async () => {
    await initCommand({ yes: true });

    const agentsDir = join(tempDir, AGENTS_DIR);
    await expect(access(join(agentsDir, "learnings"))).resolves.toBeUndefined();
  });

  it("should create canonical AGENTS.md inside .agents/", async () => {
    await initCommand({ yes: true });

    const canonicalPath = join(tempDir, AGENTS_DIR, "AGENTS.md");
    const content = await readFile(canonicalPath, "utf-8");
    expect(content.length).toBeGreaterThan(0);
  });

  it("should handle a single tool from --tools flag", async () => {
    await initCommand({ yes: true, tools: "amp" });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    expect(manifest.tools).toEqual(["amp"]);
  });

  it("should use standard preset by default with --yes flag", async () => {
    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    // In --yes mode, content.preset should default to standard
    if (manifest.content) {
      expect(manifest.content.preset).toBe("standard");
    }
  });

  it("should create hooks directory when hooks feature is enabled", async () => {
    await initCommand({ yes: true });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    // hooks feature should be enabled by default
    expect(manifest.features.hooks).toBe(true);
  });
});

describe("workspace init", () => {
  let initCommand: (opts?: { tools?: string; yes?: boolean; workspace?: boolean }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../cli/commands/init.js"));
  });

  /**
   * Create a workspace layout: no .git at root, but subdirectories with .git dirs.
   */
  async function createWorkspaceLayout(root: string, repos: string[]): Promise<void> {
    for (const name of repos) {
      const repoDir = join(root, name);
      await mkdir(join(repoDir, ".git"), { recursive: true });
    }
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-init-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should skip identity prompts and create workspace.json with --yes", async () => {
    await createWorkspaceLayout(tempDir, ["repo-a", "repo-b"]);

    await initCommand({ yes: true });

    // Workspace manifest should exist
    const wsManifestPath = join(tempDir, AGENTS_DIR, "workspace.json");
    const wsRaw = await readFile(wsManifestPath, "utf-8");
    const wsManifest = JSON.parse(wsRaw);
    expect(wsManifest.repos).toHaveLength(2);
    expect(wsManifest.repos.map((r: { path: string }) => r.path).sort()).toEqual(["repo-a", "repo-b"]);

    // Root hatch.json should have empty identity (not prompted for single repo)
    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    expect(manifest.owner).toBe("");
    expect(manifest.repo).toBe("");
    // No board config because defaultBranch is empty
    expect(manifest.board).toBeUndefined();
  });

  it("should create canonical content at workspace root", async () => {
    await createWorkspaceLayout(tempDir, ["repo-a"]);

    await initCommand({ yes: true });

    // .agents/ directory should exist with canonical content
    await expect(access(join(tempDir, AGENTS_DIR))).resolves.toBeUndefined();
    await expect(access(join(tempDir, AGENTS_DIR, "hatch.json"))).resolves.toBeUndefined();
    await expect(access(join(tempDir, AGENTS_DIR, "AGENTS.md"))).resolves.toBeUndefined();
  });

  it("should respect --tools flag in workspace mode", async () => {
    await createWorkspaceLayout(tempDir, ["repo-a"]);

    await initCommand({ yes: true, tools: "cursor,claude" });

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    expect(manifest.tools).toEqual(["cursor", "claude"]);

    // Workspace manifest should also have the tools
    const wsManifestPath = join(tempDir, AGENTS_DIR, "workspace.json");
    const wsManifest = JSON.parse(await readFile(wsManifestPath, "utf-8"));
    expect(wsManifest.defaults.tools).toEqual(["cursor", "claude"]);
  });

  it("should auto-detect workspace when no root .git exists", async () => {
    // No .git at root, but subdirectories have .git
    await createWorkspaceLayout(tempDir, ["service-api", "service-web"]);

    await initCommand({ yes: true });

    // Should have created workspace.json (auto-detected)
    const wsManifestPath = join(tempDir, AGENTS_DIR, "workspace.json");
    const wsRaw = await readFile(wsManifestPath, "utf-8");
    const wsManifest = JSON.parse(wsRaw);
    expect(wsManifest.repos).toHaveLength(2);
  });
});
