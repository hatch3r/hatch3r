import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexAdapter } from "../../adapters/codex.js";
import { createManifest } from "../../manifest/hatchJson.js";
import type { HatchManifest } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

const EXTENDED_MCP = {
  mcpServers: {
    github: { _description: "Test GitHub MCP", url: "https://api.githubcopilot.com/mcp/" },
    filesystem: {
      _description: "Test filesystem MCP",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      env: { MCP_FS_ROOT: "/tmp" },
    },
    "disabled-server": {
      _description: "A disabled MCP server",
      _disabled: true,
      command: "npx",
      args: ["disabled-server"],
    },
  },
};

describe("CodexAdapter", () => {
  const adapter = new CodexAdapter();

  function makeManifest(overrides: Partial<Parameters<typeof createManifest>[0]> = {}): HatchManifest {
    return createManifest({
      tools: ["codex"],

      mcpServers: ["github"],
      ...overrides,
    });
  }

  it("has correct name", () => {
    expect(adapter.name).toBe("codex");
  });

  it("generates .codex/config.toml with model_instructions_file", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const configToml = outputs.find((o) => o.path === ".codex/config.toml");
    expect(configToml).toBeDefined();
    expect(configToml!.content).toContain("hatch3r");
    expect(configToml!.content).toContain('model_instructions_file = ".agents/AGENTS.md"');
  });

  it("includes rule references in config.toml when rules are enabled", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const configToml = outputs.find((o) => o.path === ".codex/config.toml");
    expect(configToml).toBeDefined();
    expect(configToml!.content).toContain("rule: test-rule");
    expect(configToml!.content).toContain("A test rule for unit testing");
  });

  it("skips rule references when features.rules is false", async () => {
    const manifest = makeManifest({ features: { rules: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const configToml = outputs.find((o) => o.path === ".codex/config.toml");
    expect(configToml).toBeDefined();
    expect(configToml!.content).not.toContain("rule: test-rule");
  });

  it("includes agent sections in config.toml when agents are enabled", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const configToml = outputs.find((o) => o.path === ".codex/config.toml");
    expect(configToml).toBeDefined();
    expect(configToml!.content).toContain("[agents.hatch3r-test-agent]");
    expect(configToml!.content).toContain('.agents/agents/test-agent.md');
  });

  it("skips agent sections when features.agents is false", async () => {
    const manifest = makeManifest({ features: { agents: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const configToml = outputs.find((o) => o.path === ".codex/config.toml");
    expect(configToml).toBeDefined();
    expect(configToml!.content).not.toContain("[agents.");
  });

  it("generates skill files in .codex/skills/", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".codex/skills/"));
    expect(skills.length).toBe(1);

    const skill = skills[0]!;
    expect(skill.path).toContain("hatch3r-");
    expect(skill.path).toMatch(/SKILL\.md$/);
    expect(skill.content).toContain("test-skill");
    expect(skill.managedContent).toBeDefined();
  });

  it("skips skills when features.skills is false", async () => {
    const manifest = makeManifest({ features: { skills: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".codex/skills/"));
    expect(skills.length).toBe(0);
  });

  it("always generates config.toml as first output", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs[0]!.path).toBe(".codex/config.toml");
  });

  it("all outputs have action 'create'", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.action).toBe("create");
    }
  });

  it("generates MCP section with URL-based servers", async () => {
    const manifest = makeManifest({ mcpServers: ["github"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const configToml = outputs.find((o) => o.path === ".codex/config.toml")!;
    expect(configToml.content).toContain("[mcp_servers.github]");
    expect(configToml.content).toContain('url = "https://api.githubcopilot.com/mcp/"');
  });

  it("does not include MCP when no servers configured", async () => {
    const manifest = makeManifest({ mcpServers: [] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const configToml = outputs.find((o) => o.path === ".codex/config.toml")!;
    expect(configToml.content).not.toContain("[mcp_servers.");
  });

  it("does not include MCP when features.mcp is false", async () => {
    const manifest = makeManifest({ mcpServers: ["github"], features: { mcp: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const configToml = outputs.find((o) => o.path === ".codex/config.toml")!;
    expect(configToml.content).not.toContain("[mcp_servers.");
  });

  it("returns only config.toml when all features are disabled and no MCP", async () => {
    const manifest = makeManifest({
      mcpServers: [],
      features: { skills: false, mcp: false, rules: false, agents: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs.length).toBe(1);
    expect(outputs[0]!.path).toBe(".codex/config.toml");
  });

  describe("extended MCP scenarios", () => {
    let extendedDir: string;

    beforeAll(async () => {
      extendedDir = await mkdtemp(join(tmpdir(), "hatch3r-codex-mcp-"));
      await cp(FIXTURES_DIR, extendedDir, { recursive: true });
      await mkdir(join(extendedDir, "mcp"), { recursive: true });
      await writeFile(join(extendedDir, "mcp", "mcp.json"), JSON.stringify(EXTENDED_MCP, null, 2));
    });

    afterAll(async () => {
      await rm(extendedDir, { recursive: true, force: true });
    });

    it("generates MCP section with command-based servers and env vars", async () => {
      const manifest = makeManifest({ mcpServers: ["github", "filesystem"] });
      const outputs = await adapter.generate(extendedDir, manifest);

      const configToml = outputs.find((o) => o.path === ".codex/config.toml")!;
      expect(configToml.content).toContain("[mcp_servers.filesystem]");
      expect(configToml.content).toContain('command = "npx"');
      expect(configToml.content).toContain('args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]');
      expect(configToml.content).toContain('env.MCP_FS_ROOT = "/tmp"');
    });

    it("skips _disabled MCP servers", async () => {
      const manifest = makeManifest({ mcpServers: ["github", "disabled-server"] });
      const outputs = await adapter.generate(extendedDir, manifest);

      const configToml = outputs.find((o) => o.path === ".codex/config.toml")!;
      expect(configToml.content).not.toContain("disabled-server");
    });
  });
});
