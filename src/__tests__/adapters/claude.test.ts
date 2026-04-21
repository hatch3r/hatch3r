import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClaudeAdapter } from "../../adapters/claude.js";
import { createManifest } from "../../manifest/hatchJson.js";
import type { HatchManifest } from "../../types.js";
import { MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

describe("ClaudeAdapter", () => {
  const adapter = new ClaudeAdapter();

  function makeManifest(
    overrides: Partial<Parameters<typeof createManifest>[0]> & { models?: HatchManifest["models"]; claude?: HatchManifest["claude"] } = {},
  ): HatchManifest {
    const { models, claude, ...createOpts } = overrides;
    const base = createManifest({
      tools: ["claude"],
      mcpServers: ["github"],
      ...createOpts,
    });
    const result = { ...base };
    if (models) result.models = models;
    if (claude) result.claude = claude;
    return result;
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
    expect(agents.length).toBe(2);

    const agent = agents.find((o) => o.path === ".claude/agents/hatch3r-test-agent.md")!;
    expect(agent).toBeDefined();
    expect(agent.content).toContain("description: A test agent for unit testing");
    expect(agent.content).toContain("You are a test agent");
    expect(agent.managedContent).toBeDefined();
  });

  it("includes Agent Teams section in CLAUDE.md", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
    expect(claudeMd!.content).toContain("## Agent Teams");
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

  it("uses custom permissions from manifest.claude config", async () => {
    const manifest = makeManifest({
      claude: {
        permissions: {
          allow: ["Read", "Grep"],
          deny: ["Bash"],
        },
        teammateMode: "in-process",
      },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    expect(settings).toBeDefined();

    const parsed = JSON.parse(settings!.content);
    expect(parsed.permissions.allow).toEqual(["Read", "Grep"]);
    expect(parsed.permissions.deny).toEqual(["Bash"]);
    expect(parsed.teammateMode).toBe("in-process");
  });

  it("maps deprecated teammateMode values to 'auto'", async () => {
    const manifest = makeManifest({
      claude: {
        teammateMode: "full-trust",
      },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    expect(settings).toBeDefined();

    const parsed = JSON.parse(settings!.content);
    // "full-trust" is deprecated and should be mapped to "auto"
    expect(parsed.teammateMode).toBe("auto");
  });

  it("falls back to defaults when manifest.claude is partially configured", async () => {
    const manifest = makeManifest({
      claude: {
        permissions: { allow: ["Read", "Write"] },
      },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    const parsed = JSON.parse(settings!.content);
    expect(parsed.permissions.allow).toEqual(["Read", "Write"]);
    expect(parsed.permissions.deny).toEqual([]);
    expect(parsed.teammateMode).toBe("auto");
  });

  it("includes hooks config in settings.json when hooks are enabled", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    const parsed = JSON.parse(settings!.content);
    expect(parsed.hooks).toBeDefined();
    expect(parsed.hooks.PreToolUse).toBeDefined();
  });

  // C7-H17: Claude Code plugin-style hooks emission (D9, P3)
  // Source: https://code.claude.com/docs/en/plugins (accessed 2026-04-19)
  it("emits .claude/hooks/hatch3r-hooks.json with plugin-style hooks schema", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const pluginHooks = outputs.find((o) => o.path === ".claude/hooks/hatch3r-hooks.json");
    expect(pluginHooks).toBeDefined();

    const parsed = JSON.parse(pluginHooks!.content);
    expect(parsed.hooks).toBeDefined();
    // hooks/hooks.json uses the same {hooks: {EVENT: [{matcher, hooks:[...]}]}} schema as settings.json
    expect(parsed.hooks.PreToolUse).toBeDefined();
    expect(parsed.hooks.PreToolUse[0].matcher).toBeDefined();
    expect(Array.isArray(parsed.hooks.PreToolUse[0].hooks)).toBe(true);
    expect(parsed.hooks.PreToolUse[0].hooks[0].type).toBe("command");

    // Hatch3r metadata for managed-block tracking
    expect(parsed._hatch3r).toBeDefined();
    expect(parsed._hatch3r.managed).toBe(true);
    expect(parsed._hatch3r.schema).toBe("claude-code/plugin-hooks/v2.1");
  });

  it("does not emit plugin-style hooks file when hooks feature is disabled", async () => {
    const manifest = makeManifest({ features: { hooks: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const pluginHooks = outputs.find((o) => o.path === ".claude/hooks/hatch3r-hooks.json");
    expect(pluginHooks).toBeUndefined();
  });

  // C7.5-W2B2-H50 (D17-SA17.2-B, P3): Worktree events use Claude Code v2.1.x
  // native lifecycle names (WorktreeCreate / WorktreeRemove) per
  // code.claude.com/docs/en/plugins-reference (accessed 2026-04-19).
  it("maps worktree-create / worktree-remove to Claude Code v2.1.x native events", async () => {
    const manifest = makeManifest({
      worktree: { enabled: true },
    } as unknown as Parameters<typeof makeManifest>[0]);
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);
    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    expect(settings).toBeDefined();
    const parsed = JSON.parse(settings!.content);
    // When worktree is enabled, the adapter emits a native WorktreeCreate handler
    // in addition to the legacy PostToolUse+Bash fallback.
    expect(parsed.hooks.WorktreeCreate).toBeDefined();
    expect(Array.isArray(parsed.hooks.WorktreeCreate)).toBe(true);
    expect(parsed.hooks.WorktreeCreate[0].hooks[0].command).toContain("hatch3r worktree-setup");
  });

  it("plugin-style hooks file mirrors settings.json hooks (additive, both emitted)", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const pluginHooks = outputs.find((o) => o.path === ".claude/hooks/hatch3r-hooks.json");
    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    expect(pluginHooks).toBeDefined();
    expect(settings).toBeDefined();

    const pluginParsed = JSON.parse(pluginHooks!.content);
    const settingsParsed = JSON.parse(settings!.content);
    // Same hook event keys appear in both files
    const pluginEventKeys = Object.keys(pluginParsed.hooks).sort();
    const settingsEventKeys = Object.keys(settingsParsed.hooks).sort();
    expect(pluginEventKeys).toEqual(settingsEventKeys);
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

  it("transforms ${env:VAR} to ${VAR} in .mcp.json for Claude Code", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-mcp-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "mcp"), { recursive: true });
      await writeFile(
        join(agentsDir, "mcp", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            github: {
              url: "https://api.githubcopilot.com/mcp/",
              headers: {
                Authorization: "Bearer ${env:GITHUB_PAT}",
                "X-Custom": "static-value",
              },
            },
            "brave-search": {
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-brave-search"],
              env: {
                BRAVE_API_KEY: "${env:BRAVE_API_KEY}",
              },
            },
          },
        }),
        "utf-8",
      );
      const manifest = makeManifest({ mcpServers: ["github", "brave-search"] });
      const outputs = await adapter.generate(agentsDir, manifest);

      const mcp = outputs.find((o) => o.path === ".mcp.json");
      expect(mcp).toBeDefined();
      const parsed = JSON.parse(mcp!.content);

      expect(parsed.mcpServers.github.headers.Authorization).toBe("Bearer ${GITHUB_PAT}");
      expect(parsed.mcpServers.github.headers["X-Custom"]).toBe("static-value");
      expect(parsed.mcpServers["brave-search"].env.BRAVE_API_KEY).toBe("${BRAVE_API_KEY}");
      expect(mcp!.content).not.toContain("${env:");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("adds type field to .mcp.json entries (stdio for command, http for url)", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-mcp-type-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "mcp"), { recursive: true });
      await writeFile(
        join(agentsDir, "mcp", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            "url-server": {
              url: "https://example.com/mcp",
            },
            "cmd-server": {
              command: "npx",
              args: ["-y", "some-mcp-server"],
            },
          },
        }),
        "utf-8",
      );
      const manifest = makeManifest({ mcpServers: ["url-server", "cmd-server"] });
      const outputs = await adapter.generate(agentsDir, manifest);

      const mcp = outputs.find((o) => o.path === ".mcp.json");
      expect(mcp).toBeDefined();
      const parsed = JSON.parse(mcp!.content);

      expect(parsed.mcpServers["url-server"].type).toBe("http");
      expect(parsed.mcpServers["cmd-server"].type).toBe("stdio");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("strips _description from .mcp.json entries", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-mcp-desc-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "mcp"), { recursive: true });
      await writeFile(
        join(agentsDir, "mcp", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            "test-server": {
              _description: "Should be stripped",
              command: "npx",
              args: ["-y", "test-server"],
            },
          },
        }),
        "utf-8",
      );
      const manifest = makeManifest({ mcpServers: ["test-server"] });
      const outputs = await adapter.generate(agentsDir, manifest);

      const mcp = outputs.find((o) => o.path === ".mcp.json");
      expect(mcp).toBeDefined();
      const parsed = JSON.parse(mcp!.content);

      expect(parsed.mcpServers["test-server"]._description).toBeUndefined();
      expect(mcp!.content).not.toContain("_description");
      expect(parsed.mcpServers["test-server"].type).toBe("stdio");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
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

  it("emits model from customization file when present", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agentFile = outputs.find((o) => o.path === ".claude/agents/hatch3r-test-agent.md");
    expect(agentFile).toBeDefined();
    expect(agentFile!.content).toContain("## Recommended Model");
    expect(agentFile!.content).toContain("Preferred: `claude-sonnet-4-6`");
    expect(agentFile!.content).toContain("CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-4-6");
  });

  it("emits model as recommended model guidance when configured via manifest", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-model-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await writeFile(
        join(agentsDir, "agents", "test-agent.md"),
        `---
id: test-agent
type: agent
description: A test agent
---
# Test Agent

You are a test agent.`,
        "utf-8",
      );
      const manifest = makeManifest({
        models: { agents: { "test-agent": "gpt-4" } },
      });
      const outputs = await adapter.generate(agentsDir, manifest);

      const agentFile = outputs.find((o) => o.path === ".claude/agents/hatch3r-test-agent.md");
      expect(agentFile).toBeDefined();
      expect(agentFile!.content).toContain("## Recommended Model");
      expect(agentFile!.content).toContain("Preferred: `gpt-4`");
      expect(agentFile!.content).toContain("CLAUDE_CODE_SUBAGENT_MODEL=gpt-4");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("all outputs have action 'create'", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.action).toBe("create");
    }
  });

  // ── Branch gap tests: empty features, no MCP, empty tools ──

  it("generates minimal output when all features are false", async () => {
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

    // Should still produce CLAUDE.md bridge and settings.json at minimum
    const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
    expect(claudeMd).toBeDefined();
    expect(claudeMd!.content).toContain("Hatch3r");

    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    expect(settings).toBeDefined();

    // No rules, agents, skills, or MCP
    const rules = outputs.filter((o) => o.path.startsWith(".claude/rules/"));
    const agents = outputs.filter((o) => o.path.startsWith(".claude/agents/"));
    const skills = outputs.filter((o) => o.path.startsWith(".claude/skills/"));
    const mcp = outputs.find((o) => o.path === ".mcp.json");
    expect(rules.length).toBe(0);
    expect(agents.length).toBe(0);
    expect(skills.length).toBe(0);
    expect(mcp).toBeUndefined();
  });

  it("does not generate MCP config when no servers are configured", async () => {
    const manifest = makeManifest({ mcpServers: [] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcp = outputs.find((o) => o.path === ".mcp.json");
    expect(mcp).toBeUndefined();
  });

  it("produces no empty content in any output", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.content.length).toBeGreaterThan(0);
    }
  });

  it("warns about deprecated teammateMode values (#264, D9-9.35)", async () => {
    const deprecatedAdapter = new ClaudeAdapter();
    const manifest = makeManifest({
      claude: { teammateMode: "tool-using" },
    });
    const outputs = await deprecatedAdapter.generate(FIXTURES_DIR, manifest);

    expect(deprecatedAdapter.warnings).toContainEqual(
      expect.stringContaining("deprecated"),
    );
    expect(deprecatedAdapter.warnings).toContainEqual(
      expect.stringContaining("tool-using"),
    );

    // Should default to "auto" in settings.json output
    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    expect(settings).toBeDefined();
    const parsed = JSON.parse(settings!.content);
    expect(parsed.teammateMode).toBe("auto");
  });

  it("does not warn for GA teammateMode values (#264, D9-9.35)", async () => {
    const gaAdapter = new ClaudeAdapter();
    const manifest = makeManifest({
      claude: { teammateMode: "tmux" },
    });
    await gaAdapter.generate(FIXTURES_DIR, manifest);

    const deprecationWarnings = gaAdapter.warnings.filter((w) =>
      w.includes("deprecated"),
    );
    expect(deprecationWarnings).toHaveLength(0);
  });

  // ── Finding 3.10: generationMode "minimal" integration test ──
  it("produces shorter output in minimal mode than standard mode", async () => {
    const manifest = makeManifest();
    const standardOutputs = await adapter.generate(FIXTURES_DIR, manifest, "standard");
    const minimalAdapter = new ClaudeAdapter();
    const minimalOutputs = await minimalAdapter.generate(FIXTURES_DIR, manifest, "minimal");

    const stdBridge = standardOutputs.find((o) => o.path === "CLAUDE.md");
    const minBridge = minimalOutputs.find((o) => o.path === "CLAUDE.md");
    expect(stdBridge).toBeDefined();
    expect(minBridge).toBeDefined();
    expect(minBridge!.content.length).toBeLessThanOrEqual(stdBridge!.content.length);
  });

  it("minimal mode still produces valid non-empty output", async () => {
    const manifest = makeManifest();
    const minimalAdapter = new ClaudeAdapter();
    const outputs = await minimalAdapter.generate(FIXTURES_DIR, manifest, "minimal");

    for (const o of outputs) {
      expect(o.content.length).toBeGreaterThan(0);
    }
    const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
    expect(claudeMd).toBeDefined();
    expect(claudeMd!.content).toContain("Hatch3r");
  });

  // Wave B3: precedence-based NN- filename prefix on .claude/rules/ outputs.
  // Mapping: critical -> 10, high -> 30, normal -> 50, low -> 70. The
  // per-file adapter prepends the rank to the canonical `hatch3r-` prefix so
  // alphabetical load order reflects precedence.
  it("emits NN- numeric prefix derived from rule precedence", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-precedence-"));
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

      const securityRule = outputs.find((o) => o.path === ".claude/rules/10-hatch3r-security.md");
      const testingRule = outputs.find((o) => o.path === ".claude/rules/50-hatch3r-testing.md");
      const learningRule = outputs.find((o) => o.path === ".claude/rules/70-hatch3r-learning.md");

      expect(securityRule).toBeDefined();
      expect(testingRule).toBeDefined();
      expect(learningRule).toBeDefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // C7.5-W2B2-H41 (D15, P6): per-adapter `tools:` frontmatter emission.
  // Verify the Claude Code adapter emits a policy-derived `tools:` field
  // for canonical agents registered in AGENT_TOOL_POLICIES, and omits it
  // for custom/unknown agents (preserving the upstream inherit-from-parent
  // default).
  describe("C7.5-W2B2-H41 tools: frontmatter emission", () => {
    async function runWithAgent(
      agentId: string,
      body: string,
    ): Promise<Awaited<ReturnType<typeof adapter.generate>>> {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-tools-"));
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await writeFile(
        join(agentsDir, "agents", `${agentId}.md`),
        `---\nid: ${agentId}\ntype: agent\ndescription: ${agentId} description\n---\n${body}\n`,
        "utf-8",
      );
      try {
        return await adapter.generate(agentsDir, makeManifest());
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }

    it("emits tools: for hatch3r-reviewer restricted to Read/Grep/Glob", async () => {
      const outputs = await runWithAgent("reviewer", "# Reviewer");
      const file = outputs.find(
        (o) => o.path === ".claude/agents/hatch3r-reviewer.md",
      );
      expect(file).toBeDefined();
      expect(file!.content).toMatch(/^---\n[\s\S]*?tools: [\s\S]*?\n---/m);
      expect(file!.content).toContain("Read");
      expect(file!.content).toContain("Grep");
      expect(file!.content).toContain("Glob");
      // Monotonic privilege: reviewer is read+search only — no write, edit, bash.
      const fmMatch = file!.content.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch).not.toBeNull();
      const fm = fmMatch![1];
      expect(fm).not.toContain("Write");
      expect(fm).not.toContain("Edit");
      expect(fm).not.toContain("Bash");
    });

    it("emits tools: for hatch3r-implementer including Write and Bash", async () => {
      const outputs = await runWithAgent("implementer", "# Implementer");
      const file = outputs.find(
        (o) => o.path === ".claude/agents/hatch3r-implementer.md",
      );
      expect(file).toBeDefined();
      const fmMatch = file!.content.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch).not.toBeNull();
      const fm = fmMatch![1];
      expect(fm).toContain("tools:");
      expect(fm).toContain("Write");
      expect(fm).toContain("Bash");
      expect(fm).toContain("Edit");
    });

    it("omits tools: for custom agents without a registered policy", async () => {
      const outputs = await runWithAgent("custom-agent", "# Custom");
      const file = outputs.find(
        (o) => o.path === ".claude/agents/hatch3r-custom-agent.md",
      );
      expect(file).toBeDefined();
      const fmMatch = file!.content.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch).not.toBeNull();
      const fm = fmMatch![1];
      expect(fm).not.toContain("tools:");
      expect(fm).toContain("description:");
    });
  });
});
