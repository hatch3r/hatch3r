import { describe, it, expect } from "vitest";
import { AmpAdapter } from "../../adapters/amp.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

describe("AmpAdapter", () => {
  const adapter = new AmpAdapter();

  it("has correct name", () => {
    expect(adapter.name).toBe("amp");
  });

  it("generates .amp/AGENTS.md bridge with rules and agents", async () => {
    const manifest = createManifest({
      tools: ["amp"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const bridge = outputs.find((o) => o.path === ".amp/AGENTS.md");
    expect(bridge).toBeDefined();
    expect(bridge!.content).toContain(MANAGED_BLOCK_START);
    expect(bridge!.content).toContain(MANAGED_BLOCK_END);
    expect(bridge!.content).toContain("Hatch3r Agent Instructions");
    expect(bridge!.content).toContain("Mandatory Behaviors");
    expect(bridge!.content).toContain("Agent Quick Reference");
    expect(bridge!.content).toContain("test-rule");
    expect(bridge!.content).toContain("A test rule for unit testing");
    expect(bridge!.content).toContain("Agent: test-agent");
    expect(bridge!.content).toContain("A test agent for unit testing");
    expect(bridge!.managedContent).toBeDefined();
  });

  it("still generates .amp/AGENTS.md with orchestration when rules and agents are disabled", async () => {
    const manifest = createManifest({
      tools: ["amp"],
      features: { rules: false, agents: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const bridge = outputs.find((o) => o.path === ".amp/AGENTS.md");
    expect(bridge).toBeDefined();
    expect(bridge!.content).toContain("Mandatory Behaviors");
    expect(bridge!.content).not.toContain("Agent: test-agent");
    expect(bridge!.content).not.toContain("test-rule");
  });

  it("generates skill files in .amp/skills/", async () => {
    const manifest = createManifest({
      tools: ["amp"],

    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".amp/skills/"));
    expect(skills.length).toBe(1);

    const skill = skills[0]!;
    expect(skill.path).toContain("hatch3r-");
    expect(skill.path).toMatch(/SKILL\.md$/);
    expect(skill.content).toContain("test-skill");
    expect(skill.managedContent).toBeDefined();
  });

  it("generates .amp/settings.json with MCP config when servers configured", async () => {
    const manifest = createManifest({
      tools: ["amp"],

      mcpServers: ["github"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".amp/settings.json");
    expect(settings).toBeDefined();

    const parsed = JSON.parse(settings!.content);
    expect(parsed["amp.mcpServers"]).toBeDefined();
    expect(parsed["amp.mcpServers"].github).toBeDefined();
    expect(parsed["amp.mcpServers"].github.url).toBe("https://api.githubcopilot.com/mcp/");
  });

  it("does not generate MCP settings when no servers configured", async () => {
    const manifest = createManifest({
      tools: ["amp"],

      mcpServers: [],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".amp/settings.json");
    expect(settings).toBeUndefined();
  });

  it("skips skills when features.skills is false", async () => {
    const manifest = createManifest({
      tools: ["amp"],

      features: { skills: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".amp/skills/"));
    expect(skills.length).toBe(0);
  });

  it("returns only bridge when all features are disabled and no MCP", async () => {
    const manifest = createManifest({
      tools: ["amp"],

      mcpServers: [],
      features: { skills: false, mcp: false, rules: false, agents: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs.length).toBe(1);
    expect(outputs[0]!.path).toBe(".amp/AGENTS.md");
    expect(outputs[0]!.content).toContain("Mandatory Behaviors");
  });

  it("all outputs have action 'create'", async () => {
    const manifest = createManifest({
      tools: ["amp"],

      mcpServers: ["github"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.action).toBe("create");
    }
  });
});
