import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
    expect(scopedRule!.content).toContain("trigger: glob");
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

  it("does not generate hook rules in .windsurf/rules/ (hooks emitted to hooks.json)", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const hookRules = outputs.filter(
      (o) => o.path.startsWith(".windsurf/rules/") && o.path.includes("hook-"),
    );
    expect(hookRules.length).toBe(0);
  });

  // C7.5-W2B2-H31 (D9-SA9.7.1, P3): Windsurf Cascade Hooks support.
  // Source: https://docs.windsurf.com/windsurf/cascade/hooks.md (accessed 2026-04-19).
  // Schema: `.windsurf/hooks.json` with { hooks: { <event>: [{ command, show_output }] } }.
  it("emits .windsurf/hooks.json when hook features are enabled", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const hooksFile = outputs.find((o) => o.path === ".windsurf/hooks.json");
    expect(hooksFile).toBeDefined();

    const parsed = JSON.parse(hooksFile!.content);
    expect(parsed._hatch3r).toBeDefined();
    expect(parsed._hatch3r.managed).toBe(true);
    expect(parsed._hatch3r.schema).toBe("windsurf/cascade-hooks/v1");
    expect(parsed.hooks).toBeDefined();
    // The test fixture has at least one hook, which should appear under one of Windsurf's 12 events.
    const eventNames = Object.keys(parsed.hooks);
    expect(eventNames.length).toBeGreaterThan(0);
    // Every event name must be a valid Windsurf Cascade event.
    const VALID_WINDSURF_EVENTS = new Set([
      "pre_read_code", "post_read_code",
      "pre_write_code", "post_write_code",
      "pre_run_command", "post_run_command",
      "pre_mcp_tool_use", "post_mcp_tool_use",
      "pre_user_prompt",
      "post_cascade_response",
      "post_cascade_response_with_transcript",
      "post_setup_worktree",
    ]);
    for (const event of eventNames) {
      expect(VALID_WINDSURF_EVENTS.has(event)).toBe(true);
    }
    // Each entry has the required `command` field and boolean `show_output`.
    for (const entries of Object.values(parsed.hooks) as Array<Array<{ command: string; show_output: boolean }>>) {
      expect(Array.isArray(entries)).toBe(true);
      for (const entry of entries) {
        expect(typeof entry.command).toBe("string");
        expect(entry.command.length).toBeGreaterThan(0);
        expect(entry.command).toContain("HATCH3R_HOOK_ACTIVATED");
        expect(typeof entry.show_output).toBe("boolean");
      }
    }
  });

  it("does not emit .windsurf/hooks.json when features.hooks is false", async () => {
    const manifest = makeManifest({ features: { hooks: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const hooksFile = outputs.find((o) => o.path === ".windsurf/hooks.json");
    expect(hooksFile).toBeUndefined();
  });

  it("bridge mentions Windsurf worktree support", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const bridge = outputs.find((o) => o.path === ".windsurfrules");
    expect(bridge).toBeDefined();
    expect(bridge!.content).toContain("worktree");
    expect(bridge!.content).toContain("v1.13.3");
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

  // ── Branch gap tests: empty features, no MCP, empty tools ──

  it("generates only .windsurfrules bridge when all features are false and no MCP", async () => {
    const manifest = makeManifest({
      mcpServers: [],
      features: {
        agents: false,
        skills: false,
        rules: false,
        commands: false,
        mcp: false,
        hooks: false,
        prompts: false,
        githubAgents: false,
      },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    // Should still produce the bridge file
    const bridge = outputs.find((o) => o.path === ".windsurfrules");
    expect(bridge).toBeDefined();
    expect(bridge!.content).toContain("Hatch3r");

    // No rules, skills, workflows, or MCP
    const rules = outputs.filter((o) => o.path.startsWith(".windsurf/rules/"));
    const skills = outputs.filter((o) => o.path.startsWith(".windsurf/skills/"));
    const workflows = outputs.filter((o) => o.path.startsWith(".windsurf/workflows/"));
    const mcp = outputs.find((o) => o.path === ".windsurf/mcp.json");
    expect(rules.length).toBe(0);
    expect(skills.length).toBe(0);
    expect(workflows.length).toBe(0);
    expect(mcp).toBeUndefined();
  });

  it("does not generate MCP config when no servers are configured", async () => {
    const manifest = makeManifest({ mcpServers: [] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcp = outputs.find((o) => o.path === ".windsurf/mcp.json");
    expect(mcp).toBeUndefined();
  });

  it("produces no empty content in any output", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.content.length).toBeGreaterThan(0);
    }
  });

  // ── Finding 3.17: model resolution assertion ──
  it("includes model annotation in .windsurfrules when agent has model configured", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const bridge = outputs.find((o) => o.path === ".windsurfrules");
    expect(bridge).toBeDefined();
    // test-agent fixture has model: sonnet -> resolves to claude-sonnet-4-6
    expect(bridge!.content).toContain("Recommended model:");
    expect(bridge!.content).toContain("claude-sonnet-4-6");
  });

  // C7.5-W2B2-H41 (D15, P6): per-adapter tool allowlist emission.
  // Windsurf does not emit separate subagent files; the allowlist is
  // rendered into .windsurfrules as an "Agent Tool Policies" table.
  describe("C7.5-W2B2-H41 Agent Tool Policies section", () => {
    async function runWithPolicyAgents(agentIds: string[]) {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-windsurf-tools-"));
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      for (const id of agentIds) {
        await writeFile(
          join(agentsDir, "agents", `${id}.md`),
          `---\nid: ${id}\ntype: agent\ndescription: ${id} description\n---\n# ${id}\n`,
          "utf-8",
        );
      }
      try {
        return await adapter.generate(agentsDir, makeManifest());
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }

    it("emits Agent Tool Policies section listing policy-registered agents", async () => {
      const outputs = await runWithPolicyAgents(["reviewer", "implementer"]);
      const bridge = outputs.find((o) => o.path === ".windsurfrules");
      expect(bridge).toBeDefined();
      expect(bridge!.content).toContain("## Agent Tool Policies");
      // Slice the section that follows the "## Agent Tool Policies"
      // heading so we exclude unrelated bridge-orchestration tables
      // that reference the same agent ids.
      const sectionStart = bridge!.content.indexOf("## Agent Tool Policies");
      expect(sectionStart).toBeGreaterThan(-1);
      const afterSection = bridge!.content.slice(sectionStart);
      const sectionEnd = afterSection.indexOf("\n## ", 1);
      const section = sectionEnd > -1 ? afterSection.slice(0, sectionEnd) : afterSection;

      expect(section).toContain("| `hatch3r-reviewer` |");
      expect(section).toContain("| `hatch3r-implementer` |");
      const reviewerRow = section
        .split("\n")
        .find((l) => l.startsWith("| `hatch3r-reviewer` |"));
      expect(reviewerRow).toBeDefined();
      expect(reviewerRow!).not.toContain("Write");
      expect(reviewerRow!).not.toContain("Edit");
      expect(reviewerRow!).toContain("Read");
      const implementerRow = section
        .split("\n")
        .find((l) => l.startsWith("| `hatch3r-implementer` |"));
      expect(implementerRow).toBeDefined();
      expect(implementerRow!).toContain("Write");
      expect(implementerRow!).toContain("Bash");
    });

    it("omits Agent Tool Policies section when no canonical agent has a policy match", async () => {
      const outputs = await runWithPolicyAgents(["custom-agent-foo", "custom-agent-bar"]);
      const bridge = outputs.find((o) => o.path === ".windsurfrules");
      expect(bridge).toBeDefined();
      expect(bridge!.content).not.toContain("## Agent Tool Policies");
    });
  });
});
