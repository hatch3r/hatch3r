import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { CursorAdapter } from "../../adapters/cursor.js";
import { createManifest } from "../../manifest/hatchJson.js";
import type { HatchManifest } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");
// Wave 5: fixture user repo root — parent of canonical fixtures, so
// `.hatch3r/{type}/{id}.customize.yaml` lookups resolve correctly.
const FIXTURES_USER_REPO = dirname(FIXTURES_DIR);

describe("CursorAdapter", () => {
  const adapter = new CursorAdapter();

  function makeManifest(
    overrides: Partial<Parameters<typeof createManifest>[0]> & { models?: HatchManifest["models"] } = {},
  ): HatchManifest {
    const { models, ...createOpts } = overrides;
    const base = createManifest({
      tools: ["cursor"],
      mcpServers: ["github"],
      ...createOpts,
    });
    return models ? { ...base, models } : base;
  }

  it("has correct name", () => {
    expect(adapter.name).toBe("cursor");
  });

  it("generates rule files with hatch3r prefix", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const rules = outputs.filter(
      (o) =>
        o.path.startsWith(".cursor/rules/") &&
        !o.path.includes("bridge") &&
        !o.path.includes("hook-") &&
        !o.path.includes("tool-allowlist"),
    );
    expect(rules.length).toBe(2);

    for (const rule of rules) {
      expect(rule.path).toMatch(/hatch3r-/);
      expect(rule.path).toMatch(/\.mdc$/);
      expect(rule.managedContent).toBeDefined();
    }
  });

  it("sets alwaysApply: true for always-scoped rules", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const alwaysRule = outputs.find((o) => o.path.includes("hatch3r-test-rule.mdc"));
    expect(alwaysRule).toBeDefined();
    expect(alwaysRule!.content).toContain("alwaysApply: true");
    expect(alwaysRule!.content).toContain("A test rule for unit testing");
  });

  it("sets globs for scoped rules", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const scopedRule = outputs.find((o) => o.path.includes("hatch3r-scoped-rule.mdc"));
    expect(scopedRule).toBeDefined();
    expect(scopedRule!.content).toContain("globs:");
    expect(scopedRule!.content).toContain("**/*.ts");
    expect(scopedRule!.content).not.toContain("alwaysApply: true");
  });

  it("generates agent files", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agents = outputs.filter((o) => o.path.startsWith(".cursor/agents/"));
    expect(agents.length).toBe(2);

    const agent = agents.find((o) => o.path === ".cursor/agents/hatch3r-test-agent.md")!;
    expect(agent).toBeDefined();
    expect(agent.content).toContain("name: test-agent");
    expect(agent.content).toContain("description: A test agent for unit testing");
    expect(agent.content).toContain("You are a test agent");
    expect(agent.managedContent).toBeDefined();
  });

  it("emits readonly and background in agent frontmatter when set", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const roAgent = outputs.find((o) => o.path === ".cursor/agents/hatch3r-readonly-agent.md");
    expect(roAgent).toBeDefined();
    expect(roAgent!.content).toContain("readonly: true");
    expect(roAgent!.content).toContain("is_background: true");
    expect(roAgent!.content).toContain("name: readonly-agent");
  });

  it("omits readonly and background when not set on agent", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agent = outputs.find((o) => o.path === ".cursor/agents/hatch3r-test-agent.md")!;
    expect(agent.content).not.toContain("readonly:");
    expect(agent.content).not.toContain("background:");
  });

  it("emits model from customization file when present", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest, FIXTURES_USER_REPO);

    const agentFile = outputs.find((o) => o.path === ".cursor/agents/hatch3r-test-agent.md");
    expect(agentFile).toBeDefined();
    expect(agentFile!.content).toContain("model: claude-sonnet-4-6");
  });

  it("emits model from manifest when no customization file", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-cursor-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await writeFile(
        join(agentsDir, "agents", "test-agent.md"),
        `---
id: test-agent
description: A test agent
---
# Test Agent

You are a test agent.`,
        "utf-8",
      );
      const manifest = makeManifest({
        models: { default: "opus", agents: { "test-agent": "codex" } },
      });
      const outputs = await adapter.generate(agentsDir, manifest);

      const agentFile = outputs.find((o) => o.path === ".cursor/agents/hatch3r-test-agent.md");
      expect(agentFile).toBeDefined();
      expect(agentFile!.content).toContain("model: gpt-5.3-codex");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("generates skill files", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".cursor/skills/"));
    expect(skills.length).toBe(1);

    const skill = skills[0]!;
    expect(skill.path).toBe(".cursor/skills/hatch3r-test-skill/SKILL.md");
    expect(skill.content).toContain("name: test-skill");
    expect(skill.content).toContain("A test skill for unit testing");
    expect(skill.managedContent).toBeDefined();
  });

  it("generates command files", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const commands = outputs.filter((o) => o.path.startsWith(".cursor/commands/"));
    expect(commands.length).toBe(1);

    const cmd = commands[0]!;
    expect(cmd.path).toBe(".cursor/commands/hatch3r-test-command.md");
    expect(cmd.content).toContain("test-command");
    expect(cmd.managedContent).toBeDefined();
  });

  it("generates mcp.json when MCP is enabled with servers", async () => {
    const manifest = makeManifest({ mcpServers: ["github"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcp = outputs.find((o) => o.path === ".cursor/mcp.json");
    expect(mcp).toBeDefined();

    const parsed = JSON.parse(mcp!.content);
    expect(parsed.mcpServers.github).toBeDefined();
    expect(parsed.mcpServers.github.url).toBe("https://api.githubcopilot.com/mcp/");
  });

  it("does not generate mcp.json when no servers configured", async () => {
    const manifest = makeManifest({ mcpServers: [] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcp = outputs.find((o) => o.path === ".cursor/mcp.json");
    expect(mcp).toBeUndefined();
  });

  it("always generates bridge rule", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const bridge = outputs.find((o) => o.path === ".cursor/rules/hatch3r-bridge.mdc");
    expect(bridge).toBeDefined();
    expect(bridge!.content).toContain("alwaysApply: true");
    expect(bridge!.content).toContain("Hatch3r Bridge");
    // W4: `.agents/AGENTS.md` orchestration root removed; bridge is itself the entry point.
    expect(bridge!.content).not.toContain("/.agents/AGENTS.md");
    expect(bridge!.content).toContain("Mandatory Behaviors");
    expect(bridge!.content).toContain("Agent Quick Reference");
    expect(bridge!.managedContent).toBeDefined();
  });

  it("bridge includes Cursor v2.5+ subagent configuration guidance", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const bridge = outputs.find((o) => o.path === ".cursor/rules/hatch3r-bridge.mdc");
    expect(bridge).toBeDefined();
    expect(bridge!.content).toContain("Cursor Subagent Configuration (v2.5+)");
    expect(bridge!.content).toContain("up to 4 subagents");
    expect(bridge!.content).toContain("readonly");
    expect(bridge!.content).toContain("background");
  });

  // C7.5-W2B2-H30 (D9-SA9.1.1): Cursor 3.0 /worktree and /best-of-n commands in bridge.
  // Source: https://cursor.com/changelog (accessed 2026-04-19, Cursor 3.0 released 2026-04-02).
  it("bridge includes Cursor 3.0 workflow commands", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const bridge = outputs.find((o) => o.path === ".cursor/rules/hatch3r-bridge.mdc");
    expect(bridge).toBeDefined();
    expect(bridge!.content).toContain("Cursor 3.0 Workflows");
    expect(bridge!.content).toContain("/worktree");
    expect(bridge!.content).toContain("/best-of-n");
  });

  it("skips rules when features.rules is false", async () => {
    const manifest = makeManifest({ features: { rules: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const rules = outputs.filter(
      (o) =>
        o.path.startsWith(".cursor/rules/") &&
        !o.path.includes("bridge") &&
        !o.path.includes("hook-") &&
        !o.path.includes("tool-allowlist"),
    );
    expect(rules.length).toBe(0);
  });

  it("skips agents when features.agents is false", async () => {
    const manifest = makeManifest({ features: { agents: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agents = outputs.filter((o) => o.path.startsWith(".cursor/agents/"));
    expect(agents.length).toBe(0);
  });

  it("skips skills when features.skills is false", async () => {
    const manifest = makeManifest({ features: { skills: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".cursor/skills/"));
    expect(skills.length).toBe(0);
  });

  it("skips commands when features.commands is false", async () => {
    const manifest = makeManifest({ features: { commands: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const commands = outputs.filter((o) => o.path.startsWith(".cursor/commands/"));
    expect(commands.length).toBe(0);
  });

  it("all outputs have action 'create'", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.action).toBe("create");
    }
  });

  // ── Finding 3.18: hooks feature assertion ──
  it("generates hook rules in .cursor/rules/ when hooks are enabled", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const hookRules = outputs.filter(
      (o) => o.path.startsWith(".cursor/rules/") && o.path.includes("hook-"),
    );
    expect(hookRules.length).toBeGreaterThan(0);

    for (const hook of hookRules) {
      expect(hook.content).toContain("HATCH3R_HOOK_ACTIVATED");
      expect(hook.content).toContain("Hook:");
    }
  });

  it("does not generate hook rules when hooks feature is disabled", async () => {
    const manifest = makeManifest({ features: { hooks: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const hookRules = outputs.filter(
      (o) => o.path.startsWith(".cursor/rules/") && o.path.includes("hook-"),
    );
    expect(hookRules.length).toBe(0);
  });

  // ── Finding 3.16: no empty content assertion ──
  it("produces no empty content in any output", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.content.length).toBeGreaterThan(0);
    }
  });

  // Wave B3: precedence-based NN- filename prefix on rule outputs.
  // Mapping: critical -> 10, high -> 30, normal -> 50, low -> 70.
  it("emits NN- numeric prefix derived from rule precedence", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-cursor-precedence-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "rules"), { recursive: true });
      await writeFile(
        join(agentsDir, "rules", "security.md"),
        `---
id: security
type: rule
description: Critical security rule
scope: always
precedence: critical
---
# Security

Critical security rule body.
`,
        "utf-8",
      );
      await writeFile(
        join(agentsDir, "rules", "testing.md"),
        `---
id: testing
type: rule
description: Normal testing rule
scope: always
precedence: normal
---
# Testing

Normal precedence rule body.
`,
        "utf-8",
      );
      await writeFile(
        join(agentsDir, "rules", "learning.md"),
        `---
id: learning
type: rule
description: Low priority learning rule
scope: always
precedence: low
---
# Learning

Low priority rule body.
`,
        "utf-8",
      );

      const outputs = await adapter.generate(agentsDir, makeManifest());

      const securityRule = outputs.find((o) => o.path === ".cursor/rules/10-hatch3r-security.mdc");
      const testingRule = outputs.find((o) => o.path === ".cursor/rules/50-hatch3r-testing.mdc");
      const learningRule = outputs.find((o) => o.path === ".cursor/rules/70-hatch3r-learning.mdc");

      expect(securityRule).toBeDefined();
      expect(testingRule).toBeDefined();
      expect(learningRule).toBeDefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // C7.5-W2B2-H41 (D15, P6): per-adapter tool allowlist emission.
  // Cursor's native primitive is `readonly: true`; the translator emits
  // it whenever the policy forbids both write and execute categories.
  describe("C7.5-W2B2-H41 policy-derived readonly emission", () => {
    async function runWithAgent(agentId: string) {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-cursor-readonly-"));
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await writeFile(
        join(agentsDir, "agents", `${agentId}.md`),
        `---\nid: ${agentId}\ntype: agent\ndescription: ${agentId} description\n---\n# ${agentId}\n`,
        "utf-8",
      );
      try {
        return await adapter.generate(agentsDir, makeManifest());
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }

    it("emits readonly: true for hatch3r-reviewer (read+search only)", async () => {
      const outputs = await runWithAgent("reviewer");
      const file = outputs.find((o) => o.path === ".cursor/agents/hatch3r-reviewer.md");
      expect(file).toBeDefined();
      expect(file!.content).toContain("readonly: true");
    });

    it("does not emit readonly for hatch3r-implementer (has write+execute)", async () => {
      const outputs = await runWithAgent("implementer");
      const file = outputs.find(
        (o) => o.path === ".cursor/agents/hatch3r-implementer.md",
      );
      expect(file).toBeDefined();
      const fmMatch = file!.content.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch).not.toBeNull();
      expect(fmMatch![1]).not.toContain("readonly: true");
    });

    it("policy-derived readonly applies to researcher even without explicit readonly flag", async () => {
      // Researcher has no write/execute per policy, so even without an
      // explicit canonical `readonly: true` flag the emitted cursor agent
      // is readonly — trust policy cannot be widened by omission.
      const outputs = await runWithAgent("researcher");
      const file = outputs.find(
        (o) => o.path === ".cursor/agents/hatch3r-researcher.md",
      );
      expect(file).toBeDefined();
      expect(file!.content).toContain("readonly: true");
    });
  });

  // C9-H49 (D15-SA15.2, P6): per-adapter MCP / tool gating emission.
  // Cursor has no PreToolUse hook primitive, so enforcement is
  // rule-delegated: an alwaysApply `.cursor/rules/hatch3r-tool-allowlist.mdc`
  // rule + machine-readable `.cursor/agents-policy.json` document.
  // Pairs with `readonly: true` frontmatter primitive emitted by
  // `toCursorReadonlyFrontmatter`.
  describe("C9-H49 tool allowlist rule + agents-policy.json emission", () => {
    it("emits .cursor/agents-policy.json with the canonical registry", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const policiesFile = outputs.find(
        (o) => o.path === ".cursor/agents-policy.json",
      );
      expect(policiesFile).toBeDefined();
      const parsed = JSON.parse(policiesFile!.content);
      expect(parsed.schema).toBe("hatch3r/agent-tool-policies/v1");
      expect(Array.isArray(parsed.policies)).toBe(true);
      const reviewer = parsed.policies.find(
        (p: { agentId: string }) => p.agentId === "hatch3r-reviewer",
      );
      const implementer = parsed.policies.find(
        (p: { agentId: string }) => p.agentId === "hatch3r-implementer",
      );
      expect(reviewer).toBeDefined();
      expect(reviewer.allowedTools).toEqual(["read", "search"]);
      expect(implementer).toBeDefined();
      expect(implementer.allowedTools).toContain("write");
      expect(implementer.allowedTools).toContain("execute");
      expect(parsed.allToolCategories).toContain("read");
      expect(parsed.allToolCategories).toContain("mcp");
    });

    it("emits .cursor/rules/hatch3r-tool-allowlist.mdc as alwaysApply", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const ruleFile = outputs.find(
        (o) => o.path === ".cursor/rules/hatch3r-tool-allowlist.mdc",
      );
      expect(ruleFile).toBeDefined();
      // Frontmatter must declare alwaysApply: true so the rule is loaded into every Cursor session.
      const fmMatch = ruleFile!.content.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch).not.toBeNull();
      const fm = fmMatch![1];
      expect(fm).toContain("alwaysApply: true");
      expect(fm).toContain("ASI02");
      // Body must contain the canonical per-agent table for human / agent inspection.
      expect(ruleFile!.content).toContain("Hatch3r Agent Tool Allowlist");
      expect(ruleFile!.content).toContain("hatch3r-reviewer");
      expect(ruleFile!.content).toContain("hatch3r-implementer");
      expect(ruleFile!.content).toContain("read, search");
      // References the sibling machine-readable JSON document.
      expect(ruleFile!.content).toContain(".cursor/agents-policy.json");
      // Body wrapped in a managed block per Cursor adapter convention.
      expect(ruleFile!.managedContent).toBeDefined();
    });

    it("emits rule + JSON regardless of features.rules state", async () => {
      // The allowlist is a trust artifact, not a user-content rule —
      // disabling `features.rules` must not remove it, otherwise the
      // ASI02 enforcement chain breaks at the Cursor boundary.
      const manifest = makeManifest({ features: { rules: false } });
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      expect(
        outputs.find((o) => o.path === ".cursor/rules/hatch3r-tool-allowlist.mdc"),
      ).toBeDefined();
      expect(
        outputs.find((o) => o.path === ".cursor/agents-policy.json"),
      ).toBeDefined();
    });
  });

  // ── Wave 5 (CLI-tooling pivot, plan §4.6) ───────────────────────
  //
  // Cursor's skills surface is filtered by `manifest.cliTools.selected` via
  // `readCliFilteredSkills` on BaseAdapter. Non-CLI skills always pass
  // through; CLI skills (id prefix `hatch3r-cli-`) only emit when their
  // suffix appears in the selected list AND `cliTools.enabled` is true.
  describe("CLI tools filter (Wave 5 plan §4.6)", () => {
    it("emits only the selected CLI skills when cliTools is enabled", async () => {
      const manifest: HatchManifest = {
        ...makeManifest(),
        cliTools: { enabled: true, selected: ["ripgrep", "jq"] },
      };
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const cliSkills = outputs.filter((o) =>
        o.path.startsWith(".cursor/skills/hatch3r-cli-"),
      );
      const cliSkillIds = cliSkills.map((o) => o.path);
      // Expect ripgrep + jq; fd is not in the selected list.
      expect(cliSkillIds).toContain(".cursor/skills/hatch3r-cli-ripgrep/SKILL.md");
      expect(cliSkillIds).toContain(".cursor/skills/hatch3r-cli-jq/SKILL.md");
      expect(cliSkillIds.some((p) => p.includes("hatch3r-cli-fd"))).toBe(false);
      // Non-CLI skill (test-skill) still passes through unchanged.
      expect(outputs.some((o) => o.path === ".cursor/skills/hatch3r-test-skill/SKILL.md")).toBe(true);
    });

    it("emits zero CLI skill files when cliTools.enabled is false", async () => {
      const manifest: HatchManifest = {
        ...makeManifest(),
        cliTools: { enabled: false, selected: ["ripgrep", "jq"] },
      };
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const cliSkills = outputs.filter((o) =>
        o.path.startsWith(".cursor/skills/hatch3r-cli-"),
      );
      expect(cliSkills).toEqual([]);
    });

    it("emits zero CLI skill files when cliTools.selected is empty (enabled=true)", async () => {
      const manifest: HatchManifest = {
        ...makeManifest(),
        cliTools: { enabled: true, selected: [] },
      };
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const cliSkills = outputs.filter((o) =>
        o.path.startsWith(".cursor/skills/hatch3r-cli-"),
      );
      expect(cliSkills).toEqual([]);
    });

    it("emits zero CLI skill files when manifest.cliTools is absent (pre-1.7.5 manifest)", async () => {
      // Absent cliTools should behave like enabled:false (pre-1.7.5 manifest
      // remains valid per plan §4.2 — no version bump required).
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const cliSkills = outputs.filter((o) =>
        o.path.startsWith(".cursor/skills/hatch3r-cli-"),
      );
      expect(cliSkills).toEqual([]);
    });
  });
});
