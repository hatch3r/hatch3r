import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OpenCodeAdapter } from "../../adapters/opencode.js";
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

describe("OpenCodeAdapter", () => {
  const adapter = new OpenCodeAdapter();

  function makeManifest(overrides: Partial<Parameters<typeof createManifest>[0]> = {}): HatchManifest {
    return createManifest({
      tools: ["opencode"],

      mcpServers: ["github"],
      ...overrides,
    });
  }

  it("has correct name", () => {
    expect(adapter.name).toBe("opencode");
  });

  it("does not generate AGENTS.md (handled centrally by init/sync)", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agentsMd = outputs.find((o) => o.path === "AGENTS.md");
    expect(agentsMd).toBeUndefined();
  });

  it("generates valid opencode.json with expanded instructions", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const opencodeJson = outputs.find((o) => o.path === "opencode.json");
    expect(opencodeJson).toBeDefined();

    const parsed = JSON.parse(opencodeJson!.content);
    expect(parsed.instructions).toBeDefined();
    expect(Array.isArray(parsed.instructions)).toBe(true);
    expect(parsed.instructions).toContain(".agents/AGENTS.md");
    expect(parsed.instructions).toContain(".agents/rules/*.md");
    expect(parsed.instructions).toContain(".agents/agents/*.md");
    expect(parsed.instructions).toContain(".agents/skills/*/SKILL.md");
  });

  it("uses OpenCode native MCP format with type field", async () => {
    const manifest = makeManifest({ mcpServers: ["github"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const opencodeJson = outputs.find((o) => o.path === "opencode.json");
    const parsed = JSON.parse(opencodeJson!.content);
    expect(parsed.mcp).toBeDefined();
    expect(parsed.mcp.github).toBeDefined();
    expect(parsed.mcp.github.type).toBe("remote");
    expect(parsed.mcp.github.url).toBe("https://api.githubcopilot.com/mcp/");
    expect(parsed.mcp.github.enabled).toBe(true);
  });

  it("does not include MCP when no servers configured", async () => {
    const manifest = makeManifest({ mcpServers: [] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const opencodeJson = outputs.find((o) => o.path === "opencode.json");
    const parsed = JSON.parse(opencodeJson!.content);
    expect(parsed.mcp).toBeUndefined();
  });

  it("generates agent files in .opencode/agents/", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agents = outputs.filter((o) => o.path.startsWith(".opencode/agents/"));
    expect(agents.length).toBe(1);

    const agent = agents[0]!;
    expect(agent.path).toBe(".opencode/agents/hatch3r-test-agent.md");
    expect(agent.content).toContain("description: A test agent for unit testing");
    expect(agent.content).toContain("You are a test agent");
    expect(agent.managedContent).toBeDefined();
  });

  it("skips agents when features.agents is false", async () => {
    const manifest = makeManifest({ features: { agents: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agents = outputs.filter((o) => o.path.startsWith(".opencode/agents/"));
    expect(agents.length).toBe(0);
  });

  it("produces opencode.json plus native skills and commands", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs[0]!.path).toBe("opencode.json");

    const skills = outputs.filter((o) => o.path.startsWith(".opencode/skills/"));
    expect(skills.length).toBe(1);
    expect(skills[0]!.path).toContain("hatch3r-");
    expect(skills[0]!.path).toMatch(/SKILL\.md$/);

    const commands = outputs.filter((o) => o.path.startsWith(".opencode/commands/"));
    expect(commands.length).toBe(1);
    expect(commands[0]!.path).toContain("hatch3r-");
    expect(commands[0]!.path).toMatch(/\.md$/);
  });

  it("all outputs have action 'create'", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.action).toBe("create");
    }
  });

  it("does not include MCP when features.mcp is false", async () => {
    const manifest = makeManifest({ mcpServers: ["github"], features: { mcp: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const opencodeJson = outputs.find((o) => o.path === "opencode.json")!;
    const parsed = JSON.parse(opencodeJson.content);
    expect(parsed.mcp).toBeUndefined();
  });

  it("omits instructions for disabled features", async () => {
    const manifest = makeManifest({
      features: { rules: false, agents: false, skills: false, commands: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const opencodeJson = outputs.find((o) => o.path === "opencode.json")!;
    const parsed = JSON.parse(opencodeJson.content);
    expect(parsed.instructions).toContain(".agents/AGENTS.md");
    expect(parsed.instructions).not.toContain(".agents/rules/*.md");
    expect(parsed.instructions).not.toContain(".agents/agents/*.md");
    expect(parsed.instructions).not.toContain(".agents/skills/*/SKILL.md");
    expect(parsed.instructions).not.toContain(".agents/commands/*.md");
  });

  it("skips skills when features.skills is false", async () => {
    const manifest = makeManifest({ features: { skills: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".opencode/skills/"));
    expect(skills.length).toBe(0);
  });

  it("skips commands when features.commands is false", async () => {
    const manifest = makeManifest({ features: { commands: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const commands = outputs.filter((o) => o.path.startsWith(".opencode/commands/"));
    expect(commands.length).toBe(0);
  });

  it("returns only opencode.json when all features are disabled and no MCP", async () => {
    const manifest = makeManifest({
      mcpServers: [],
      features: { skills: false, mcp: false, rules: false, agents: false, commands: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs.length).toBe(1);
    expect(outputs[0]!.path).toBe("opencode.json");
  });

  describe("extended MCP scenarios", () => {
    let extendedDir: string;

    beforeAll(async () => {
      extendedDir = await mkdtemp(join(tmpdir(), "hatch3r-opencode-mcp-"));
      await cp(FIXTURES_DIR, extendedDir, { recursive: true });
      await mkdir(join(extendedDir, "mcp"), { recursive: true });
      await writeFile(join(extendedDir, "mcp", "mcp.json"), JSON.stringify(EXTENDED_MCP, null, 2));
    });

    afterAll(async () => {
      await rm(extendedDir, { recursive: true, force: true });
    });

    it("generates command-based MCP servers with local type", async () => {
      const manifest = makeManifest({ mcpServers: ["github", "filesystem"] });
      const outputs = await adapter.generate(extendedDir, manifest);

      const opencodeJson = outputs.find((o) => o.path === "opencode.json")!;
      const parsed = JSON.parse(opencodeJson.content);
      expect(parsed.mcp.filesystem).toBeDefined();
      expect(parsed.mcp.filesystem.type).toBe("local");
      expect(parsed.mcp.filesystem.command).toContain("npx");
      expect(parsed.mcp.filesystem.enabled).toBe(true);
      expect(parsed.mcp.filesystem.environment).toBeDefined();
      expect(parsed.mcp.filesystem.environment.MCP_FS_ROOT).toBe("/tmp");
    });

    it("skips _disabled MCP servers", async () => {
      const manifest = makeManifest({ mcpServers: ["github", "disabled-server"] });
      const outputs = await adapter.generate(extendedDir, manifest);

      const opencodeJson = outputs.find((o) => o.path === "opencode.json")!;
      const parsed = JSON.parse(opencodeJson.content);
      expect(parsed.mcp["disabled-server"]).toBeUndefined();
    });
  });
});
