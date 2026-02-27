import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KiroAdapter } from "../../adapters/kiro.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../../types.js";
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

describe("KiroAdapter", () => {
  const adapter = new KiroAdapter();

  it("has correct name", () => {
    expect(adapter.name).toBe("kiro");
  });

  it("generates .kiro/steering/hatch3r-agents.md with rules and agents", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const steering = outputs.find((o) => o.path === ".kiro/steering/hatch3r-agents.md");
    expect(steering).toBeDefined();
    expect(steering!.content).toContain(MANAGED_BLOCK_START);
    expect(steering!.content).toContain(MANAGED_BLOCK_END);
    expect(steering!.content).toContain("Hatch3r Agent Instructions");
    expect(steering!.content).toContain("Mandatory Behaviors");
    expect(steering!.content).toContain("test-rule");
    expect(steering!.content).toContain("Agent: test-agent");
    expect(steering!.managedContent).toBeDefined();
  });

  it("generates scoped rules as separate steering files with frontmatter", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const scopedRule = outputs.find(
      (o) => o.path.startsWith(".kiro/steering/hatch3r-scoped-rule"),
    );
    expect(scopedRule).toBeDefined();
    expect(scopedRule!.content).toContain("inclusion: conditional");
    expect(scopedRule!.content).toContain("globs:");
    expect(scopedRule!.content).toContain("Scoped Rule");
  });

  it("still generates steering file with orchestration when rules and agents are disabled", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
      features: { rules: false, agents: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const steering = outputs.find((o) => o.path === ".kiro/steering/hatch3r-agents.md");
    expect(steering).toBeDefined();
    expect(steering!.content).toContain("Mandatory Behaviors");
    expect(steering!.content).not.toContain("Agent: test-agent");
  });

  it("generates skill files in .kiro/steering/", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter(
      (o) =>
        o.path.startsWith(".kiro/steering/") &&
        o.path !== ".kiro/steering/hatch3r-agents.md" &&
        !o.path.includes("scoped-rule"),
    );
    expect(skills.length).toBeGreaterThanOrEqual(1);
    const skill = skills.find((s) => s.content.includes("test-skill"));
    expect(skill).toBeDefined();
    expect(skill!.managedContent).toBeDefined();
  });

  it("skips skills when features.skills is false", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
      features: { skills: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const hasSkillOutput = outputs.some(
      (o) =>
        o.path.startsWith(".kiro/steering/") &&
        o.content.includes("test-skill"),
    );
    expect(hasSkillOutput).toBe(false);
  });

  it("generates MCP settings when MCP servers are configured", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
      mcpServers: ["github"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcpSettings = outputs.find((o) => o.path === ".kiro/settings/mcp.json");
    expect(mcpSettings).toBeDefined();

    const parsed = JSON.parse(mcpSettings!.content);
    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers.github).toBeDefined();
    expect(parsed.mcpServers.github.url).toBe("https://api.githubcopilot.com/mcp/");
  });

  it("does not generate MCP settings when no servers configured", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
      mcpServers: [],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcpSettings = outputs.find((o) => o.path === ".kiro/settings/mcp.json");
    expect(mcpSettings).toBeUndefined();
  });

  it("all outputs have action 'create'", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
      mcpServers: ["github"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.action).toBe("create");
    }
  });

  describe("extended MCP scenarios", () => {
    let extendedDir: string;

    beforeAll(async () => {
      extendedDir = await mkdtemp(join(tmpdir(), "hatch3r-kiro-mcp-"));
      await cp(FIXTURES_DIR, extendedDir, { recursive: true });
      await mkdir(join(extendedDir, "mcp"), { recursive: true });
      await writeFile(join(extendedDir, "mcp", "mcp.json"), JSON.stringify(EXTENDED_MCP, null, 2));
    });

    afterAll(async () => {
      await rm(extendedDir, { recursive: true, force: true });
    });

    it("generates command-based MCP server entries", async () => {
      const manifest = createManifest({
        tools: ["kiro"],
        mcpServers: ["github", "filesystem"],
      });
      const outputs = await adapter.generate(extendedDir, manifest);

      const mcpSettings = outputs.find((o) => o.path === ".kiro/settings/mcp.json")!;
      const parsed = JSON.parse(mcpSettings.content);
      expect(parsed.mcpServers.filesystem).toBeDefined();
      expect(parsed.mcpServers.filesystem.command).toBe("npx");
      expect(parsed.mcpServers.filesystem.args).toContain("-y");
      expect(parsed.mcpServers.filesystem.env).toBeDefined();
      expect(parsed.mcpServers.filesystem.env.MCP_FS_ROOT).toBe("/tmp");
    });

    it("skips _disabled MCP servers", async () => {
      const manifest = createManifest({
        tools: ["kiro"],
        mcpServers: ["github", "disabled-server"],
      });
      const outputs = await adapter.generate(extendedDir, manifest);

      const mcpSettings = outputs.find((o) => o.path === ".kiro/settings/mcp.json");
      if (mcpSettings) {
        const parsed = JSON.parse(mcpSettings.content);
        expect(parsed.mcpServers["disabled-server"]).toBeUndefined();
      }
    });
  });
});
