import { describe, it, expect } from "vitest";
import { ClaudeAdapter } from "../../adapters/claude.js";
import { createManifest } from "../../manifest/hatchJson.js";
import type { HatchManifest } from "../../types.js";
import { MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

describe("ClaudeAdapter", () => {
  const adapter = new ClaudeAdapter();

  function makeManifest(overrides: Partial<Parameters<typeof createManifest>[0]> = {}): HatchManifest {
    return createManifest({
      tools: ["claude"],

      mcpServers: ["github"],
      ...overrides,
    });
  }

  it("has correct name", () => {
    expect(adapter.name).toBe("claude");
  });

  it("generates CLAUDE.md as bridge reference with managed blocks", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
    expect(claudeMd).toBeDefined();
    expect(claudeMd!.content).toContain(MANAGED_BLOCK_START);
    expect(claudeMd!.content).toContain(MANAGED_BLOCK_END);
    expect(claudeMd!.content).toContain("Hatch3r Project Instructions");
    expect(claudeMd!.content).toContain(".agents/AGENTS.md");
    expect(claudeMd!.content).toContain(".claude/rules/");
    expect(claudeMd!.content).toContain("Mandatory Behaviors");
    expect(claudeMd!.content).toContain("Agent Quick Reference");
    expect(claudeMd!.managedContent).toBeDefined();
  });

  it("does not inline rules in CLAUDE.md", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
    expect(claudeMd!.content).not.toContain("test-rule");
    expect(claudeMd!.content).not.toContain("scoped-rule");
  });

  it("generates individual rule files in .claude/rules/", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const rules = outputs.filter((o) => o.path.startsWith(".claude/rules/"));
    expect(rules.length).toBe(2);

    for (const rule of rules) {
      expect(rule.path).toContain("hatch3r-");
      expect(rule.path).toMatch(/\.md$/);
      expect(rule.managedContent).toBeDefined();
    }

    const testRule = rules.find((r) => r.path.includes("test-rule"));
    expect(testRule).toBeDefined();
    expect(testRule!.content).toContain("A test rule for unit testing");
  });

  it("generates agent files in .claude/agents/", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agents = outputs.filter((o) => o.path.startsWith(".claude/agents/"));
    expect(agents.length).toBe(1);

    const agent = agents[0]!;
    expect(agent.path).toBe(".claude/agents/hatch3r-test-agent.md");
    expect(agent.content).toContain("description: A test agent for unit testing");
    expect(agent.content).toContain("You are a test agent");
    expect(agent.managedContent).toBeDefined();
  });

  it("includes Agent Teams section in CLAUDE.md", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
    expect(claudeMd!.content).toContain("Agent Teams (Experimental)");
    expect(claudeMd!.content).toContain("CLAUDE.local.md");
  });

  it("generates .claude/settings.json with permissions", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    expect(settings).toBeDefined();

    const parsed = JSON.parse(settings!.content);
    expect(parsed.permissions).toBeDefined();
    expect(parsed.permissions.allow).toContain("Read");
    expect(parsed.permissions.allow).toContain("Edit");
    expect(parsed.permissions.allow).toContain("Write");
    expect(parsed.permissions.allow).toContain("Grep");
    expect(parsed.permissions.deny).toEqual([]);
  });

  it("includes hooks config in settings.json when hooks are enabled", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    const parsed = JSON.parse(settings!.content);
    expect(parsed.hooks).toBeDefined();
    expect(parsed.hooks.PreToolUse).toBeDefined();
  });

  it("generates skill files in .claude/skills/", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".claude/skills/"));
    expect(skills.length).toBe(1);

    const skill = skills[0]!;
    expect(skill.path).toContain("hatch3r-test-skill");
    expect(skill.path).toMatch(/SKILL\.md$/);
    expect(skill.content).toContain("test-skill");
    expect(skill.managedContent).toBeDefined();
  });

  it("generates .mcp.json when MCP is enabled with servers", async () => {
    const manifest = makeManifest({ mcpServers: ["github"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcp = outputs.find((o) => o.path === ".mcp.json");
    expect(mcp).toBeDefined();

    const parsed = JSON.parse(mcp!.content);
    expect(parsed.mcpServers.github).toBeDefined();
  });

  it("does not generate .mcp.json when no servers configured", async () => {
    const manifest = makeManifest({ mcpServers: [] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcp = outputs.find((o) => o.path === ".mcp.json");
    expect(mcp).toBeUndefined();
  });

  it("skips rules when features.rules is false", async () => {
    const manifest = makeManifest({ features: { rules: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const rules = outputs.filter((o) => o.path.startsWith(".claude/rules/"));
    expect(rules.length).toBe(0);
  });

  it("skips agents when features.agents is false", async () => {
    const manifest = makeManifest({ features: { agents: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agents = outputs.filter((o) => o.path.startsWith(".claude/agents/"));
    expect(agents.length).toBe(0);
  });

  it("skips skills when features.skills is false", async () => {
    const manifest = makeManifest({ features: { skills: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".claude/skills/"));
    expect(skills.length).toBe(0);
  });

  it("all outputs have action 'create'", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.action).toBe("create");
    }
  });
});
