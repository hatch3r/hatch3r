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

  it("generates .amazonq/mcp.json with MCP config when servers configured", async () => {
    const manifest = createManifest({
      tools: ["amazon-q"],
      mcpServers: ["github"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".amazonq/mcp.json");
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

    const settings = outputs.find((o) => o.path === ".amazonq/mcp.json");
    expect(settings).toBeUndefined();
  });

  it("returns only bridge when all features are disabled and no MCP", async () => {
    const manifest = createManifest({
      tools: ["amazon-q"],
      mcpServers: [],
      features: { skills: false, mcp: false, rules: false, agents: false, hooks: false },
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

  // ── Finding 3.17: model resolution assertion ──
  it("includes model annotation in bridge when agent has model configured", async () => {
    const manifest = createManifest({
      tools: ["amazon-q"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const bridge = outputs.find((o) => o.path === ".amazonq/rules/hatch3r-agents.md");
    expect(bridge).toBeDefined();
    // test-agent fixture has model: sonnet -> resolves to claude-sonnet-4-6
    expect(bridge!.content).toContain("Recommended model:");
    expect(bridge!.content).toContain("claude-sonnet-4-6");
  });

  // ── Finding 3.16: no empty content assertion ──
  it("produces no empty content in any output", async () => {
    const manifest = createManifest({
      tools: ["amazon-q"],
      mcpServers: ["github"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.content.length).toBeGreaterThan(0);
    }
  });

  it("generates native custom agent descriptors in .amazonq/cli-agents/", async () => {
    const manifest = createManifest({
      tools: ["amazon-q"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agentFiles = outputs.filter((o) => o.path.startsWith(".amazonq/cli-agents/"));
    expect(agentFiles.length).toBeGreaterThanOrEqual(1);

    const testAgent = agentFiles.find((o) => o.path.includes("test-agent"));
    expect(testAgent).toBeDefined();

    const parsed = JSON.parse(testAgent!.content);
    expect(parsed.name).toContain("test-agent");
    expect(parsed.description).toBeDefined();
    expect(parsed.instructions).toBeDefined();
  });

  it("skips custom agent descriptors when agents feature is disabled", async () => {
    const manifest = createManifest({
      tools: ["amazon-q"],
      features: { agents: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agentFiles = outputs.filter((o) => o.path.startsWith(".amazonq/cli-agents/"));
    expect(agentFiles.length).toBe(0);
  });

  it("generates hook rules when hooks are enabled", async () => {
    const manifest = createManifest({
      tools: ["amazon-q"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const hookFile = outputs.find((o) => o.path === ".amazonq/rules/hatch3r-hooks.md");
    expect(hookFile).toBeDefined();
    expect(hookFile!.content).toContain("Hatch3r Hooks");
    expect(hookFile!.content).toContain("HATCH3R_HOOK_ACTIVATED");
  });

  // ── Finding C7-H1: canonical Amazon Q event names ──
  // Reference: https://aws.github.io/amazon-q-developer-cli/agent-format.html (accessed 2026-04-19)
  it("uses canonical Amazon Q hook event names (agentSpawn/preToolUse/postToolUse/stop)", async () => {
    const manifest = createManifest({
      tools: ["amazon-q"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const hookFile = outputs.find((o) => o.path === ".amazonq/rules/hatch3r-hooks.md");
    expect(hookFile).toBeDefined();

    // Canonical event names appear in the rules markdown for any mapped event.
    // Test fixtures include at least one hook whose event maps to a canonical name.
    const canonicalEvents = ["agentSpawn", "preToolUse", "postToolUse", "userPromptSubmit", "stop"];
    const hasCanonical = canonicalEvents.some((e) => hookFile!.content.includes(e));
    expect(hasCanonical).toBe(true);

    // Negative assertion: legacy non-canonical names must not appear.
    expect(hookFile!.content).not.toContain("onPreCommit");
    expect(hookFile!.content).not.toContain("onFileSave");
    expect(hookFile!.content).not.toContain("onSessionStart");
    expect(hookFile!.content).not.toContain("onPostMerge");
    expect(hookFile!.content).not.toContain("onCIFailure");
  });

  it("skips hooks when hooks feature is disabled", async () => {
    const manifest = createManifest({
      tools: ["amazon-q"],
      features: { hooks: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const hookFile = outputs.find((o) => o.path === ".amazonq/rules/hatch3r-hooks.md");
    expect(hookFile).toBeUndefined();
  });
});
