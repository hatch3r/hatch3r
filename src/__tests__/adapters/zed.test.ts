import { describe, it, expect } from "vitest";
import { ZedAdapter } from "../../adapters/zed.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

describe("ZedAdapter", () => {
  const adapter = new ZedAdapter();

  it("has correct name", () => {
    expect(adapter.name).toBe("zed");
  });

  it("generates .rules with rules and agents", async () => {
    const manifest = createManifest({
      tools: ["zed"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const rules = outputs.find((o) => o.path === ".rules");
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

  it("still generates .rules with orchestration when rules and agents are disabled", async () => {
    const manifest = createManifest({
      tools: ["zed"],
      features: { rules: false, agents: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const rules = outputs.find((o) => o.path === ".rules");
    expect(rules).toBeDefined();
    expect(rules!.content).toContain("Mandatory Behaviors");
    expect(rules!.content).not.toContain("Agent: test-agent");
    expect(rules!.content).not.toContain("test-rule");
  });

  it("produces exactly one output file", async () => {
    const manifest = createManifest({
      tools: ["zed"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs.length).toBe(1);
    expect(outputs[0]!.path).toBe(".rules");
  });

  it("all outputs have action 'create'", async () => {
    const manifest = createManifest({
      tools: ["zed"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.action).toBe("create");
    }
  });

  // ── Finding 3.17: model resolution assertion ──
  it("includes model annotation in .rules when agent has model configured", async () => {
    const manifest = createManifest({
      tools: ["zed"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const rules = outputs.find((o) => o.path === ".rules");
    expect(rules).toBeDefined();
    // test-agent fixture has model: sonnet -> resolves to claude-sonnet-4-6
    expect(rules!.content).toContain("Recommended model:");
    expect(rules!.content).toContain("claude-sonnet-4-6");
  });

  // ── Finding 3.16: no empty content assertion ──
  it("produces no empty content in any output", async () => {
    const manifest = createManifest({
      tools: ["zed"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.content.length).toBeGreaterThan(0);
    }
  });

  it("returns only .rules when all features are disabled", async () => {
    const manifest = createManifest({
      tools: ["zed"],
      features: { skills: false, rules: false, agents: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs.length).toBe(1);
    expect(outputs[0]!.path).toBe(".rules");
    expect(outputs[0]!.content).toContain("Mandatory Behaviors");
  });

  it("generates .zed/mcp.json when MCP servers are configured", async () => {
    const manifest = createManifest({
      tools: ["zed"],
      mcpServers: ["github"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcpFile = outputs.find((o) => o.path === ".zed/mcp.json");
    expect(mcpFile).toBeDefined();
    const parsed = JSON.parse(mcpFile!.content);
    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers.github).toBeDefined();
    expect(parsed.mcpServers.github.url).toBe("https://api.githubcopilot.com/mcp/");
  });

  it("does not generate MCP config when no servers are configured", async () => {
    const manifest = createManifest({
      tools: ["zed"],
      mcpServers: [],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcpFile = outputs.find((o) => o.path === ".zed/mcp.json");
    expect(mcpFile).toBeUndefined();
  });

  it("does not generate MCP config when features.mcp is false", async () => {
    const manifest = createManifest({
      tools: ["zed"],
      mcpServers: ["github"],
      features: { mcp: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcpFile = outputs.find((o) => o.path === ".zed/mcp.json");
    expect(mcpFile).toBeUndefined();
  });

  // C8-D9-M2-zed-spawn-agent: Zed 2026 platform capabilities must surface in
  // the .rules bridge body so the Zed Agent is aware of spawn_agent (ACP,
  // shipped in 0.227.1) and OAuth MCP authentication (shipped in 0.230.0).
  // Sources: https://zed.dev/releases/stable (accessed 2026-04-19).
  describe("Zed 2026 platform capability notes", () => {
    it("surfaces spawn_agent primitive in .rules bridge body", async () => {
      const manifest = createManifest({ tools: ["zed"] });
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const rules = outputs.find((o) => o.path === ".rules");
      expect(rules).toBeDefined();
      expect(rules!.content).toContain("spawn_agent");
      expect(rules!.content).toContain("Agent Control Protocol");
    });

    it("surfaces OAuth MCP authentication guidance in .rules bridge body", async () => {
      const manifest = createManifest({ tools: ["zed"] });
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const rules = outputs.find((o) => o.path === ".rules");
      expect(rules).toBeDefined();
      expect(rules!.content).toContain("OAuth");
      expect(rules!.content).toContain("Authenticate");
    });

    it("places platform capabilities section before inline rules", async () => {
      const manifest = createManifest({ tools: ["zed"] });
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const rules = outputs.find((o) => o.path === ".rules");
      expect(rules).toBeDefined();
      const caps = rules!.content.indexOf("Zed Platform Capabilities");
      const firstRule = rules!.content.indexOf("## test-rule");
      expect(caps).toBeGreaterThan(-1);
      expect(firstRule).toBeGreaterThan(-1);
      expect(caps).toBeLessThan(firstRule);
    });

    it("emits capabilities section even when rules and agents are disabled", async () => {
      const manifest = createManifest({
        tools: ["zed"],
        features: { rules: false, agents: false },
      });
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const rules = outputs.find((o) => o.path === ".rules");
      expect(rules).toBeDefined();
      expect(rules!.content).toContain("spawn_agent");
      expect(rules!.content).toContain("OAuth");
    });
  });

  // ── Wave 5 (CLI-tooling pivot, plan §4.6) ───────────────────────
  //
  // zed has `cliTools: false` in ADAPTER_CAPABILITIES because zed's skills
  // capability is also false (no SKILL.md surface in the .zed config). The
  // adapter MUST emit zero `hatch3r-cli-*` files regardless of
  // `manifest.cliTools` state.
  describe("CLI tools filter (Wave 5 plan §4.6)", () => {
    it("emits no CLI skill files even when cliTools is enabled", async () => {
      const manifest = createManifest({
        tools: ["zed"],
        cliTools: { enabled: true, selected: ["ripgrep", "jq", "fd"] },
      });
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const cliSkills = outputs.filter((o) => o.path.includes("hatch3r-cli-"));
      expect(cliSkills).toEqual([]);
    });

    it("emits no CLI skill files when cliTools is disabled", async () => {
      const manifest = createManifest({
        tools: ["zed"],
        cliTools: { enabled: false, selected: [] },
      });
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const cliSkills = outputs.filter((o) => o.path.includes("hatch3r-cli-"));
      expect(cliSkills).toEqual([]);
    });
  });
});
