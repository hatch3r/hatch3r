import { describe, it, expect } from "vitest";
import { WindsurfAdapter } from "../../adapters/windsurf.js";
import { createManifest } from "../../manifest/hatchJson.js";
import type { HatchManifest } from "../../types.js";
import { MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

describe("WindsurfAdapter", () => {
  const adapter = new WindsurfAdapter();

  function makeManifest(overrides: Partial<Parameters<typeof createManifest>[0]> = {}): HatchManifest {
    return createManifest({
      tools: ["windsurf"],

      ...overrides,
    });
  }

  it("has correct name", () => {
    expect(adapter.name).toBe("windsurf");
  });

  it("generates .windsurfrules bridge file", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const bridge = outputs.find((o) => o.path === ".windsurfrules");
    expect(bridge).toBeDefined();
    expect(bridge!.content).toContain(MANAGED_BLOCK_START);
    expect(bridge!.content).toContain(MANAGED_BLOCK_END);
    expect(bridge!.content).toContain("Hatch3r Agent Instructions");
    expect(bridge!.content).toContain("/.agents/AGENTS.md");
    expect(bridge!.content).toContain("Mandatory Behaviors");
    expect(bridge!.content).toContain("Agent Quick Reference");
    expect(bridge!.managedContent).toBeDefined();
  });

  it("generates rule files with correct trigger types", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const rules = outputs.filter((o) => o.path.startsWith(".windsurf/rules/"));
    expect(rules.length).toBe(2);

    for (const rule of rules) {
      expect(rule.path).toMatch(/hatch3r-/);
      expect(rule.path).toMatch(/\.md$/);
      expect(rule.managedContent).toBeDefined();
    }
  });

  it("sets always_on trigger for always-scoped rules", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const alwaysRule = outputs.find((o) =>
      o.path.includes("hatch3r-test-rule.md") && o.path.startsWith(".windsurf/rules/"),
    );
    expect(alwaysRule).toBeDefined();
    expect(alwaysRule!.content).toContain("trigger: always_on");
    expect(alwaysRule!.content).toContain("# test-rule");
    expect(alwaysRule!.content).toContain("A test rule for unit testing");
  });

  it("sets glob_pattern trigger for scoped rules", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const scopedRule = outputs.find((o) =>
      o.path.includes("hatch3r-scoped-rule.md") && o.path.startsWith(".windsurf/rules/"),
    );
    expect(scopedRule).toBeDefined();
    expect(scopedRule!.content).toContain("trigger: glob_pattern");
    expect(scopedRule!.content).toContain("**/*.ts");
  });

  it("generates skill files", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".windsurf/skills/"));
    expect(skills.length).toBe(1);

    const skill = skills[0]!;
    expect(skill.path).toBe(".windsurf/skills/hatch3r-test-skill/SKILL.md");
    expect(skill.content).toContain("name: test-skill");
    expect(skill.content).toContain("A test skill for unit testing");
    expect(skill.managedContent).toBeDefined();
  });

  it("inlines agents into .windsurfrules bridge", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const bridge = outputs.find((o) => o.path === ".windsurfrules");
    expect(bridge).toBeDefined();
    expect(bridge!.content).toContain("Agent: test-agent");
    expect(bridge!.content).toContain("A test agent for unit testing");
  });

  it("omits agents from .windsurfrules when features.agents is disabled", async () => {
    const manifest = makeManifest({ features: { agents: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const bridge = outputs.find((o) => o.path === ".windsurfrules");
    expect(bridge).toBeDefined();
    expect(bridge!.content).not.toContain("Agent: test-agent");
  });

  it("generates .windsurf/mcp.json when MCP is enabled with servers", async () => {
    const manifest = makeManifest({ mcpServers: ["github"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcp = outputs.find((o) => o.path === ".windsurf/mcp.json");
    expect(mcp).toBeDefined();
    const parsed = JSON.parse(mcp!.content);
    expect(parsed.mcpServers).toBeDefined();
  });

  it("does not generate hook rules (no documented Windsurf hook system)", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const hookRules = outputs.filter(
      (o) => o.path.startsWith(".windsurf/rules/") && o.path.includes("hook-"),
    );
    expect(hookRules.length).toBe(0);
  });

  it("generates workflow files from commands", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const workflows = outputs.filter((o) => o.path.startsWith(".windsurf/workflows/"));
    expect(workflows.length).toBe(1);

    const wf = workflows[0]!;
    expect(wf.path).toContain("hatch3r-");
    expect(wf.path).toMatch(/\.md$/);
    expect(wf.content).toContain("test-command");
  });

  it("skips canonical rules when features.rules is false", async () => {
    const manifest = makeManifest({ features: { rules: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const canonicalRules = outputs.filter(
      (o) => o.path.startsWith(".windsurf/rules/"),
    );
    expect(canonicalRules.length).toBe(0);
  });

  it("skips skills when features.skills is false", async () => {
    const manifest = makeManifest({ features: { skills: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".windsurf/skills/"));
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
