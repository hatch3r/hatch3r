import { describe, it, expect } from "vitest";
import { AmazonQAdapter } from "../../adapters/amazonq.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

describe("AmazonQAdapter", () => {
  const adapter = new AmazonQAdapter();

  it("has correct name", () => {
    expect(adapter.name).toBe("amazon-q");
  });

  it("generates .amazonq/rules/hatch3r-agents.md with rules, agents, and bridge", async () => {
    const manifest = createManifest({
      tools: ["amazon-q"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agents = outputs.find((o) => o.path === ".amazonq/rules/hatch3r-agents.md");
    expect(agents).toBeDefined();
    expect(agents!.content).toContain(MANAGED_BLOCK_START);
    expect(agents!.content).toContain(MANAGED_BLOCK_END);
    expect(agents!.content).toContain("Hatch3r Agent Instructions");
    expect(agents!.content).toContain("Mandatory Behaviors");
    expect(agents!.content).toContain("test-rule");
    expect(agents!.content).toContain("A test rule for unit testing");
    expect(agents!.content).toContain("Agent: test-agent");
    expect(agents!.content).toContain("A test agent for unit testing");
    expect(agents!.managedContent).toBeDefined();
  });

  it("still generates bridge with orchestration when rules and agents are disabled", async () => {
    const manifest = createManifest({
      tools: ["amazon-q"],
      features: { rules: false, agents: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agents = outputs.find((o) => o.path === ".amazonq/rules/hatch3r-agents.md");
    expect(agents).toBeDefined();
    expect(agents!.content).toContain("Mandatory Behaviors");
    expect(agents!.content).not.toContain("Agent: test-agent");
    expect(agents!.content).not.toContain("test-rule");
  });

  it("generates skill files in .amazonq/rules/", async () => {
    const manifest = createManifest({
      tools: ["amazon-q"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter(
      (o) => o.path.startsWith(".amazonq/rules/hatch3r-skill-"),
    );
    expect(skills.length).toBe(1);
    expect(skills[0]!.content).toContain("test-skill");
    expect(skills[0]!.managedContent).toBeDefined();
  });

  it("skips skills when features.skills is false", async () => {
    const manifest = createManifest({
      tools: ["amazon-q"],
      features: { skills: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter(
      (o) => o.path.startsWith(".amazonq/rules/hatch3r-skill-"),
    );
    expect(skills.length).toBe(0);
  });

  it("generates .amazonq/settings.json with MCP config when servers configured", async () => {
    const manifest = createManifest({
      tools: ["amazon-q"],
      mcpServers: ["github"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".amazonq/settings.json");
    expect(settings).toBeDefined();

    const parsed = JSON.parse(settings!.content);
    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers.github).toBeDefined();
    expect(parsed.mcpServers.github.url).toBe("https://api.githubcopilot.com/mcp/");
  });

  it("does not generate MCP settings when no servers configured", async () => {
    const manifest = createManifest({
      tools: ["amazon-q"],
      mcpServers: [],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".amazonq/settings.json");
    expect(settings).toBeUndefined();
  });

  it("returns only bridge when all features are disabled and no MCP", async () => {
    const manifest = createManifest({
      tools: ["amazon-q"],
      mcpServers: [],
      features: { skills: false, mcp: false, rules: false, agents: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs.length).toBe(1);
    expect(outputs[0]!.path).toBe(".amazonq/rules/hatch3r-agents.md");
    expect(outputs[0]!.content).toContain("Mandatory Behaviors");
  });

  it("all outputs have action 'create'", async () => {
    const manifest = createManifest({
      tools: ["amazon-q"],
      mcpServers: ["github"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.action).toBe("create");
    }
  });
});
