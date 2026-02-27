import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GeminiAdapter } from "../../adapters/gemini.js";
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

describe("GeminiAdapter", () => {
  const adapter = new GeminiAdapter();

  function makeManifest(overrides: Partial<Parameters<typeof createManifest>[0]> = {}): HatchManifest {
    return createManifest({
      tools: ["gemini"],

      mcpServers: ["github"],
      ...overrides,
    });
  }

  it("has correct name", () => {
    expect(adapter.name).toBe("gemini");
  });

  it("generates GEMINI.md with managed block", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const geminiMd = outputs.find((o) => o.path === "GEMINI.md");
    expect(geminiMd).toBeDefined();
    expect(geminiMd!.content).toContain("<!-- HATCH3R:BEGIN -->");
    expect(geminiMd!.content).toContain("<!-- HATCH3R:END -->");
  });

  it("generates .gemini/settings.json with context config", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".gemini/settings.json");
    expect(settings).toBeDefined();

    const parsed = JSON.parse(settings!.content);
    expect(parsed.context).toBeDefined();
    expect(parsed.context.fileName).toContain("GEMINI.md");
    expect(parsed.context.fileName).toContain("AGENTS.md");
  });

  it("includes MCP servers in settings.json when MCP is enabled", async () => {
    const manifest = makeManifest({ mcpServers: ["github"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".gemini/settings.json");
    const parsed = JSON.parse(settings!.content);
    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers.github).toBeDefined();
    expect(parsed.mcpServers.github.url).toBe("https://api.githubcopilot.com/mcp/");
  });

  it("does not include MCP servers when no servers configured", async () => {
    const manifest = makeManifest({ mcpServers: [] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".gemini/settings.json");
    const parsed = JSON.parse(settings!.content);
    expect(parsed.mcpServers).toBeUndefined();
  });

  it("includes hooks config in settings.json when hooks are enabled", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".gemini/settings.json");
    const parsed = JSON.parse(settings!.content);
    expect(parsed.hooks).toBeDefined();
  });

  it("inlines agents into GEMINI.md when features.agents is enabled", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const geminiMd = outputs.find((o) => o.path === "GEMINI.md");
    expect(geminiMd).toBeDefined();
    expect(geminiMd!.content).toContain("Agent: test-agent");
    expect(geminiMd!.content).toContain("A test agent for unit testing");
  });

  it("omits agents from GEMINI.md when features.agents is disabled", async () => {
    const manifest = makeManifest({ features: { agents: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const geminiMd = outputs.find((o) => o.path === "GEMINI.md");
    expect(geminiMd).toBeDefined();
    expect(geminiMd!.content).not.toContain("Agent: test-agent");
  });

  it("produces outputs including skills and commands", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const paths = outputs.map((o) => o.path).sort();
    expect(paths).toContain("GEMINI.md");
    expect(paths).toContain(".gemini/settings.json");

    const skills = outputs.filter((o) => o.path.startsWith(".gemini/skills/"));
    expect(skills.length).toBe(1);
    expect(skills[0]!.path).toContain("hatch3r-");
    expect(skills[0]!.path).toMatch(/SKILL\.md$/);

    const commands = outputs.filter((o) => o.path.startsWith(".gemini/commands/"));
    expect(commands.length).toBe(1);
    expect(commands[0]!.path).toMatch(/\.toml$/);
    expect(commands[0]!.content).toContain("description =");
    expect(commands[0]!.content).toContain("prompt =");
  });

  it("inlines rules when features.rules is enabled", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const geminiMd = outputs.find((o) => o.path === "GEMINI.md");
    expect(geminiMd).toBeDefined();
    expect(geminiMd!.content).toContain("test-rule");
  });

  it("omits rules when features.rules is disabled", async () => {
    const manifest = makeManifest({ features: { rules: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const geminiMd = outputs.find((o) => o.path === "GEMINI.md");
    expect(geminiMd).toBeDefined();
    expect(geminiMd!.content).not.toContain("test-rule");
  });

  it("GEMINI.md references canonical AGENTS.md and includes orchestration", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const geminiMd = outputs.find((o) => o.path === "GEMINI.md");
    expect(geminiMd!.content).toContain(".agents/AGENTS.md");
    expect(geminiMd!.content).toContain("Mandatory Behaviors");
    expect(geminiMd!.content).toContain("Agent Quick Reference");
  });

  it("all outputs have action 'create'", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.action).toBe("create");
    }
  });

  it("escapes TOML triple-quote injection in command descriptions", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const commands = outputs.filter((o) => o.path.startsWith(".gemini/commands/"));
    for (const cmd of commands) {
      const descMatch = cmd.content.match(/description = "(.*?)"/s);
      const promptMatch = cmd.content.match(/prompt = "(.*?)"/s);
      if (descMatch) {
        expect(descMatch[1]).not.toContain('"""');
        expect(descMatch[1]).not.toContain('\n');
      }
      if (promptMatch) {
        expect(promptMatch[1]).not.toContain('"""');
      }
    }
  });

  it("does not generate MCP settings when features.mcp is false", async () => {
    const manifest = makeManifest({ mcpServers: ["github"], features: { mcp: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".gemini/settings.json");
    const parsed = JSON.parse(settings!.content);
    expect(parsed.mcpServers).toBeUndefined();
  });

  it("skips skills when features.skills is false", async () => {
    const manifest = makeManifest({ features: { skills: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".gemini/skills/"));
    expect(skills.length).toBe(0);
  });

  it("skips commands when features.commands is false", async () => {
    const manifest = makeManifest({ features: { commands: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const commands = outputs.filter((o) => o.path.startsWith(".gemini/commands/"));
    expect(commands.length).toBe(0);
  });

  describe("extended MCP scenarios", () => {
    let extendedDir: string;

    beforeAll(async () => {
      extendedDir = await mkdtemp(join(tmpdir(), "hatch3r-gemini-mcp-"));
      await cp(FIXTURES_DIR, extendedDir, { recursive: true });
      await mkdir(join(extendedDir, "mcp"), { recursive: true });
      await writeFile(join(extendedDir, "mcp", "mcp.json"), JSON.stringify(EXTENDED_MCP, null, 2));
    });

    afterAll(async () => {
      await rm(extendedDir, { recursive: true, force: true });
    });

    it("generates command-based MCP server entries with env vars", async () => {
      const manifest = makeManifest({ mcpServers: ["github", "filesystem"] });
      const outputs = await adapter.generate(extendedDir, manifest);

      const settings = outputs.find((o) => o.path === ".gemini/settings.json")!;
      const parsed = JSON.parse(settings.content);
      expect(parsed.mcpServers.filesystem).toBeDefined();
      expect(parsed.mcpServers.filesystem.command).toBe("npx");
      expect(parsed.mcpServers.filesystem.args).toContain("-y");
      expect(parsed.mcpServers.filesystem.env).toBeDefined();
      expect(parsed.mcpServers.filesystem.env.MCP_FS_ROOT).toBe("/tmp");
    });

    it("skips _disabled MCP servers", async () => {
      const manifest = makeManifest({ mcpServers: ["github", "disabled-server"] });
      const outputs = await adapter.generate(extendedDir, manifest);

      const settings = outputs.find((o) => o.path === ".gemini/settings.json")!;
      const parsed = JSON.parse(settings.content);
      expect(parsed.mcpServers["disabled-server"]).toBeUndefined();
    });
  });
});
