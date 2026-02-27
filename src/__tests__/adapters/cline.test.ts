import { describe, it, expect } from "vitest";
import { ClineAdapter } from "../../adapters/cline.js";
import { createManifest } from "../../manifest/hatchJson.js";
import type { HatchManifest } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

describe("ClineAdapter", () => {
  const adapter = new ClineAdapter();

  function makeManifest(overrides: Partial<Parameters<typeof createManifest>[0]> = {}): HatchManifest {
    return createManifest({
      tools: ["cline"],

      mcpServers: ["github"],
      ...overrides,
    });
  }

  it("has correct name", () => {
    expect(adapter.name).toBe("cline");
  });

  it("generates .roomodes with custom modes from agents", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const roomodes = outputs.find((o) => o.path === ".roomodes");
    expect(roomodes).toBeDefined();

    const parsed = JSON.parse(roomodes!.content);
    expect(parsed.customModes).toBeDefined();
    expect(Array.isArray(parsed.customModes)).toBe(true);
    expect(parsed.customModes.length).toBeGreaterThan(0);
  });

  it("custom modes have required Cline properties", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const roomodes = outputs.find((o) => o.path === ".roomodes");
    const parsed = JSON.parse(roomodes!.content);

    for (const mode of parsed.customModes) {
      expect(mode.slug).toBeDefined();
      expect(mode.slug).toMatch(/^[a-zA-Z0-9-]+$/);
      expect(mode.name).toBeDefined();
      expect(mode.roleDefinition).toBeDefined();
      expect(mode.groups).toBeDefined();
      expect(Array.isArray(mode.groups)).toBe(true);
    }
  });

  it("custom modes include all standard tool groups", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const roomodes = outputs.find((o) => o.path === ".roomodes");
    const parsed = JSON.parse(roomodes!.content);

    for (const mode of parsed.customModes) {
      expect(mode.groups).toContain("read");
      expect(mode.groups).toContain("edit");
      expect(mode.groups).toContain("command");
      expect(mode.groups).toContain("mcp");
    }
  });

  it("generates rule files in .roo/rules/", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const ruleFiles = outputs.filter(
      (o) => o.path.startsWith(".roo/rules/") && !o.path.includes("hook-"),
    );
    expect(ruleFiles.length).toBeGreaterThan(0);

    for (const rule of ruleFiles) {
      expect(rule.path).toMatch(/\.md$/);
      expect(rule.path).toContain("hatch3r-");
    }
  });

  it("skips .roomodes when features.agents is disabled", async () => {
    const manifest = makeManifest({ features: { agents: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const roomodes = outputs.find((o) => o.path === ".roomodes");
    expect(roomodes).toBeUndefined();
  });

  it("skips rule files when features.rules is disabled", async () => {
    const manifest = makeManifest({ features: { rules: false, hooks: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const ruleFiles = outputs.filter((o) => o.path.startsWith(".roo/rules/"));
    expect(ruleFiles).toEqual([]);
  });

  it("generates skill files in .cline/skills/", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skillFiles = outputs.filter((o) => o.path.startsWith(".cline/skills/"));
    expect(skillFiles.length).toBeGreaterThan(0);

    for (const skill of skillFiles) {
      expect(skill.path).toContain("hatch3r-");
      expect(skill.path).toMatch(/SKILL\.md$/);
    }
  });

  it("generates workflow files from commands in .clinerules/workflows/", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const workflows = outputs.filter((o) => o.path.startsWith(".clinerules/workflows/"));
    expect(workflows.length).toBe(1);

    const wf = workflows[0]!;
    expect(wf.path).toContain("hatch3r-");
    expect(wf.path).toMatch(/\.md$/);
    expect(wf.content).toContain("test-command");
    expect(wf.managedContent).toBeDefined();
  });

  it("skips workflows when features.commands is false", async () => {
    const manifest = makeManifest({ features: { commands: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const workflows = outputs.filter((o) => o.path.startsWith(".clinerules/workflows/"));
    expect(workflows.length).toBe(0);
  });

  it("generates hook rules in .roo/rules/", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const hookRules = outputs.filter((o) =>
      o.path.startsWith(".roo/rules/") && o.path.includes("hook-"),
    );
    expect(hookRules.length).toBeGreaterThan(0);

    for (const hook of hookRules) {
      expect(hook.content).toContain("**Event:**");
      expect(hook.content).toContain("**Agent:**");
    }
  });

  it("generates .roo/mcp.json when MCP is enabled with servers", async () => {
    const manifest = makeManifest({ mcpServers: ["github"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcp = outputs.find((o) => o.path === ".roo/mcp.json");
    expect(mcp).toBeDefined();

    const parsed = JSON.parse(mcp!.content);
    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers.github).toBeDefined();
    expect(parsed.mcpServers.github.url).toBe("https://api.githubcopilot.com/mcp/");
    expect(parsed.mcpServers.github.transport).toBe("streamable-http");
  });

  it("does not generate .roo/mcp.json when no servers configured", async () => {
    const manifest = makeManifest({ mcpServers: [] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcp = outputs.find((o) => o.path === ".roo/mcp.json");
    expect(mcp).toBeUndefined();
  });

  it("returns empty when all content features are disabled", async () => {
    const manifest = makeManifest({
      mcpServers: [],
      features: { agents: false, rules: false, skills: false, hooks: false, mcp: false, commands: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs).toEqual([]);
  });

  it("all outputs have action 'create'", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.action).toBe("create");
    }
  });
});
