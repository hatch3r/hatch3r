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

  // ── Finding C7.5-W2B2-H33: useLegacyMcpJson flag on cli-agent descriptors ──
  // Reference: https://aws.github.io/amazon-q-developer-cli/agent-format.html (accessed 2026-04-19)
  it("sets useLegacyMcpJson: true on every cli-agent descriptor", async () => {
    const manifest = createManifest({
      tools: ["amazon-q"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agentFiles = outputs.filter((o) => o.path.startsWith(".amazonq/cli-agents/"));
    expect(agentFiles.length).toBeGreaterThanOrEqual(1);

    for (const file of agentFiles) {
      const parsed = JSON.parse(file.content);
      expect(parsed.useLegacyMcpJson).toBe(true);
    }
  });

  // ── Finding C7.5-W2B2-H33 / D9-SA9.14.1: hooks field populated in descriptor ──
  // Reference: https://aws.github.io/amazon-q-developer-cli/agent-format.html (accessed 2026-04-19)
  it("populates hooks field on cli-agent descriptors with canonical AWS event keys", async () => {
    const manifest = createManifest({
      tools: ["amazon-q"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agentFiles = outputs.filter((o) => o.path.startsWith(".amazonq/cli-agents/"));
    expect(agentFiles.length).toBeGreaterThanOrEqual(1);

    for (const file of agentFiles) {
      const parsed = JSON.parse(file.content);
      expect(parsed.hooks).toBeDefined();
      // Every key must be one of the 5 canonical AWS events.
      const canonicalEvents = new Set([
        "agentSpawn",
        "userPromptSubmit",
        "preToolUse",
        "postToolUse",
        "stop",
      ]);
      for (const key of Object.keys(parsed.hooks)) {
        expect(canonicalEvents.has(key)).toBe(true);
      }
      // Each entry must be an array of { command } objects per AWS schema.
      for (const entries of Object.values(parsed.hooks) as Array<Array<{ command: string }>>) {
        expect(Array.isArray(entries)).toBe(true);
        expect(entries.length).toBeGreaterThan(0);
        for (const entry of entries) {
          expect(typeof entry.command).toBe("string");
          expect(entry.command.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("groups multiple hatch3r hooks sharing an AWS event under one array", async () => {
    const manifest = createManifest({
      tools: ["amazon-q"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    // Fixtures include `post-merge-deploy` (post-merge -> postToolUse) and
    // `pre-commit-lint-fixer` (pre-commit -> preToolUse). At least one
    // AWS event key must hold >=1 entries; the post-merge-deploy hook
    // must appear under postToolUse.
    const agentFiles = outputs.filter((o) => o.path.startsWith(".amazonq/cli-agents/"));
    const first = JSON.parse(agentFiles[0]!.content);
    expect(first.hooks.postToolUse).toBeDefined();
    const postToolCommands = first.hooks.postToolUse.map((e: { command: string }) => e.command);
    const hasPostMerge = postToolCommands.some((c: string) => c.includes("post-merge"));
    expect(hasPostMerge).toBe(true);
  });

  it("omits hooks field from descriptor when no hooks are present", async () => {
    const manifest = createManifest({
      tools: ["amazon-q"],
      features: { hooks: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agentFiles = outputs.filter((o) => o.path.startsWith(".amazonq/cli-agents/"));
    expect(agentFiles.length).toBeGreaterThanOrEqual(1);

    for (const file of agentFiles) {
      const parsed = JSON.parse(file.content);
      expect(parsed.hooks).toBeUndefined();
      // useLegacyMcpJson still emitted -- it's independent of hooks feature.
      expect(parsed.useLegacyMcpJson).toBe(true);
    }
  });

  it("hook entry commands carry HATCH3R_HOOK_ACTIVATED marker for rules-bridge dispatch", async () => {
    const manifest = createManifest({
      tools: ["amazon-q"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agentFiles = outputs.filter((o) => o.path.startsWith(".amazonq/cli-agents/"));
    const parsed = JSON.parse(agentFiles[0]!.content);
    const allCommands: string[] = [];
    for (const entries of Object.values(parsed.hooks) as Array<Array<{ command: string }>>) {
      for (const entry of entries) allCommands.push(entry.command);
    }
    expect(allCommands.length).toBeGreaterThan(0);
    const hasMarker = allCommands.every((c) => c.includes("HATCH3R_HOOK_ACTIVATED"));
    expect(hasMarker).toBe(true);
  });
});
