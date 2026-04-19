import { describe, it, expect } from "vitest";
import { AntigravityAdapter } from "../../adapters/antigravity.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

describe("AntigravityAdapter", () => {
  const adapter = new AntigravityAdapter();

  it("has correct name", () => {
    expect(adapter.name).toBe("antigravity");
  });

  it("generates .antigravity/rules.md with rules, agents, and bridge", async () => {
    const manifest = createManifest({
      tools: ["antigravity"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const rules = outputs.find((o) => o.path === ".antigravity/rules.md");
    expect(rules).toBeDefined();
    expect(rules!.content).toContain(MANAGED_BLOCK_START);
    expect(rules!.content).toContain(MANAGED_BLOCK_END);
    expect(rules!.content).toContain("Hatch3r Agent Instructions");
    expect(rules!.content).toContain("Mandatory Behaviors");
    expect(rules!.content).toContain("test-rule");
    expect(rules!.content).toContain("A test rule for unit testing");
    expect(rules!.content).toContain("Agent: test-agent");
    expect(rules!.content).toContain("A test agent for unit testing");
    expect(rules!.managedContent).toBeDefined();
  });

  it("references canonical .agents/AGENTS.md in bridge header", async () => {
    const manifest = createManifest({
      tools: ["antigravity"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const rules = outputs.find((o) => o.path === ".antigravity/rules.md");
    expect(rules!.content).toContain(".agents/AGENTS.md");
  });

  it("still generates rules.md with orchestration when rules and agents are disabled", async () => {
    const manifest = createManifest({
      tools: ["antigravity"],
      features: { rules: false, agents: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const rules = outputs.find((o) => o.path === ".antigravity/rules.md");
    expect(rules).toBeDefined();
    expect(rules!.content).toContain("Mandatory Behaviors");
    expect(rules!.content).not.toContain("Agent: test-agent");
    expect(rules!.content).not.toContain("test-rule");
  });

  it("generates skill files in .agent/skills/ (canonical Antigravity workspace path)", async () => {
    const manifest = createManifest({
      tools: ["antigravity"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".agent/skills/"));
    expect(skills.length).toBe(1);

    const skill = skills[0]!;
    expect(skill.path).toContain("hatch3r-");
    expect(skill.path).toMatch(/SKILL\.md$/);
    expect(skill.content).toContain("test-skill");
    expect(skill.managedContent).toBeDefined();

    // Negative assertion: legacy path no longer used.
    const legacySkills = outputs.filter((o) => o.path.startsWith(".antigravity/skills/"));
    expect(legacySkills.length).toBe(0);
  });

  it("skips skills when features.skills is false", async () => {
    const manifest = createManifest({
      tools: ["antigravity"],
      features: { skills: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".agent/skills/"));
    expect(skills.length).toBe(0);
  });

  it("generates .antigravity/settings.json with MCP config when servers configured", async () => {
    const manifest = createManifest({
      tools: ["antigravity"],
      mcpServers: ["github"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".antigravity/settings.json");
    expect(settings).toBeDefined();

    const parsed = JSON.parse(settings!.content);
    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers.github).toBeDefined();
    expect(parsed.mcpServers.github.url).toBe("https://api.githubcopilot.com/mcp/");
  });

  it("does not generate MCP settings when no servers configured", async () => {
    const manifest = createManifest({
      tools: ["antigravity"],
      mcpServers: [],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".antigravity/settings.json");
    expect(settings).toBeUndefined();
  });

  it("returns only rules.md when all features are disabled and no MCP", async () => {
    const manifest = createManifest({
      tools: ["antigravity"],
      mcpServers: [],
      features: { skills: false, mcp: false, rules: false, agents: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs.length).toBe(1);
    expect(outputs[0]!.path).toBe(".antigravity/rules.md");
    expect(outputs[0]!.content).toContain("Mandatory Behaviors");
  });

  it("all outputs have action 'create'", async () => {
    const manifest = createManifest({
      tools: ["antigravity"],
      mcpServers: ["github"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.action).toBe("create");
    }
  });

  // ── Finding 3.17: model resolution assertion ──
  it("includes model annotation in rules.md when agent has model configured", async () => {
    const manifest = createManifest({
      tools: ["antigravity"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const rules = outputs.find((o) => o.path === ".antigravity/rules.md");
    expect(rules).toBeDefined();
    // test-agent fixture has model: sonnet -> resolves to claude-sonnet-4-6
    expect(rules!.content).toContain("Recommended model:");
    expect(rules!.content).toContain("claude-sonnet-4-6");
  });

  it("produces no empty content in any output", async () => {
    const manifest = createManifest({
      tools: ["antigravity"],
      mcpServers: ["github"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.content.length).toBeGreaterThan(0);
    }
  });
});
