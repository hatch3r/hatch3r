import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  ClaudeAdapter,
  CACHE_BREAKPOINT_SENTINEL,
  CACHE_BREAKPOINT_SENTINEL_START,
  CACHE_BREAKPOINT_SENTINEL_END,
} from "../../adapters/claude.js";
import { createManifest } from "../../manifest/hatchJson.js";
import type { HatchManifest } from "../../types.js";
import { MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");
// Wave 5: fixture user repo root — parent of canonical fixtures, so
// `.hatch3r/{type}/{id}.customize.yaml` lookups (e.g. test-agent.customize.yaml)
// resolve correctly without needing a real CWD with .hatch3r/ staged.
const FIXTURES_USER_REPO = dirname(FIXTURES_DIR);

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
    // W4: root AGENTS.md removed — CLAUDE.md is itself the bridge. No `.agents/AGENTS.md` reference.
    expect(claudeMd!.content).not.toContain(".agents/AGENTS.md");
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

    // Top-level picker entries — companion subtrees (`.claude/agents/modes/`,
    // `.claude/agents/shared/`) are emitted but excluded from this count.
    const agents = outputs.filter((o) => /^\.claude\/agents\/[^/]+\.md$/.test(o.path));
    expect(agents.length).toBe(2);

    const agent = agents.find((o) => o.path === ".claude/agents/hatch3r-test-agent.md")!;
    expect(agent).toBeDefined();
    expect(agent.content).toContain("description: A test agent for unit testing");
    expect(agent.content).toContain("You are a test agent");
    expect(agent.managedContent).toBeDefined();
  });

  it("filters companion agent content (modes/shared) and command content (subdirectory/shared-context) from per-tool picker output", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    // Picker-level paths are top-level `.md` files only (no subdir segments)
    // — companion subtrees are emitted but live under `.claude/agents/modes/`,
    // `.claude/commands/board/`, etc. and must not surface in the picker.
    const topLevelAgentPaths = outputs
      .filter((o) => /^\.claude\/agents\/[^/]+\.md$/.test(o.path))
      .map((o) => o.path);
    const topLevelCommandPaths = outputs
      .filter((o) => /^\.claude\/commands\/[^/]+\.md$/.test(o.path))
      .map((o) => o.path);

    // Top-level primary fixtures survive
    expect(topLevelAgentPaths.some((p) => p.includes("test-agent"))).toBe(true);
    expect(topLevelCommandPaths.some((p) => p.includes("test-command"))).toBe(true);

    // Subdirectory companion fixtures are excluded from picker-level paths
    expect(topLevelAgentPaths.some((p) => p.includes("fake-mode"))).toBe(false);
    expect(topLevelAgentPaths.some((p) => p.includes("fake-reference"))).toBe(false);
    expect(topLevelCommandPaths.some((p) => p.includes("pickup-fake"))).toBe(false);

    // Top-level file with non-primary frontmatter type is excluded
    expect(topLevelCommandPaths.some((p) => p.includes("fake-shared"))).toBe(false);
  });

  it("emits companion subtree files under per-adapter native paths so canonical references resolve", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const pathSet = new Set(outputs.map((o) => o.path));

    // agents/modes/ fixture lands under `.claude/agents/modes/`
    expect(pathSet.has(".claude/agents/modes/fake-mode.md")).toBe(true);
    // agents/shared/ fixture lands under `.claude/agents/shared/`
    expect(pathSet.has(".claude/agents/shared/fake-reference.md")).toBe(true);
    // commands/board/ fixture lands under `.claude/commands/board/`
    expect(pathSet.has(".claude/commands/board/pickup-fake.md")).toBe(true);

    // Companion outputs are wrapped in managed blocks so orphan cleanup
    // and sync drift detection cover them.
    const companion = outputs.find((o) => o.path === ".claude/agents/modes/fake-mode.md");
    expect(companion).toBeDefined();
    expect(companion!.managedContent).toBeDefined();
    expect(companion!.content).toContain(MANAGED_BLOCK_START);
    expect(companion!.content).toContain(MANAGED_BLOCK_END);
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
    expect(parsed._hatch3r.schema).toBe("claude-code/plugin-hooks/v2.2");
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
    expect(parsed.hooks.WorktreeCreate[0].hooks[0].command).toContain("hatch3r worktree-setup --from-path");
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
    const outputs = await adapter.generate(FIXTURES_DIR, manifest, FIXTURES_USER_REPO);

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
    const standardOutputs = await adapter.generate(FIXTURES_DIR, manifest, undefined, "standard");
    const minimalAdapter = new ClaudeAdapter();
    const minimalOutputs = await minimalAdapter.generate(FIXTURES_DIR, manifest, undefined, "minimal");

    const stdBridge = standardOutputs.find((o) => o.path === "CLAUDE.md");
    const minBridge = minimalOutputs.find((o) => o.path === "CLAUDE.md");
    expect(stdBridge).toBeDefined();
    expect(minBridge).toBeDefined();
    expect(minBridge!.content.length).toBeLessThanOrEqual(stdBridge!.content.length);
  });

  it("minimal mode still produces valid non-empty output", async () => {
    const manifest = makeManifest();
    const minimalAdapter = new ClaudeAdapter();
    const outputs = await minimalAdapter.generate(FIXTURES_DIR, manifest, undefined, "minimal");

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

  // C9-H49 (D15-SA15.2, P6): per-adapter PreToolUse / MCP-gating hook
  // emission. Reclassifies the agent tool allowlist as Hybrid in
  // SECURITY.md — the canonical policy registry is the source of
  // truth, and the Claude adapter emits a runtime PreToolUse hook
  // (`.claude/hooks/pretooluse-allowlist.mjs`) + machine-readable
  // policy document (`.claude/hooks/agent-tool-policies.json`) so the
  // allowlist survives into the Claude Code runtime.
  describe("C9-H49 PreToolUse allowlist hook emission", () => {
    it("emits .claude/hooks/agent-tool-policies.json with the canonical registry", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const policiesFile = outputs.find(
        (o) => o.path === ".claude/hooks/agent-tool-policies.json",
      );
      expect(policiesFile).toBeDefined();
      const parsed = JSON.parse(policiesFile!.content);
      expect(parsed.schema).toBe("hatch3r/agent-tool-policies/v1");
      expect(Array.isArray(parsed.policies)).toBe(true);
      // Registry must contain the canonical hatch3r-reviewer + hatch3r-implementer entries.
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
      // Top-level discriminator for downstream consumers.
      expect(parsed.allToolCategories).toContain("read");
      expect(parsed.allToolCategories).toContain("mcp");
    });

    it("emits .claude/hooks/pretooluse-allowlist.mjs Node ESM script", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const hookScript = outputs.find(
        (o) => o.path === ".claude/hooks/pretooluse-allowlist.mjs",
      );
      expect(hookScript).toBeDefined();
      expect(hookScript!.content.startsWith("#!/usr/bin/env node")).toBe(true);
      // Hook contract: reads sibling policy file, gates on category match.
      expect(hookScript!.content).toContain("agent-tool-policies.json");
      expect(hookScript!.content).toContain("CLAUDE_TOOL_NAME");
      expect(hookScript!.content).toContain("CLAUDE_SUBAGENT_ID");
      // Deny-by-default: exit 2 blocks the tool call.
      expect(hookScript!.content).toContain("process.exit(2)");
      // Structured deny reason codes for failure-log persistence.
      expect(hookScript!.content).toContain("UNKNOWN_TOOL");
      expect(hookScript!.content).toContain("NO_POLICY");
      expect(hookScript!.content).toContain("TOOL_NOT_ALLOWED");
      // Claude Code → hatch3r category map (reverse of CLAUDE_CATEGORY_MAP).
      expect(hookScript!.content).toContain('Read: "read"');
      expect(hookScript!.content).toContain('Bash: "execute"');
      expect(hookScript!.content).toContain('Edit: "write"');
      // MCP tool prefix handling.
      expect(hookScript!.content).toContain('mcp__');
    });

    it("registers the PreToolUse hook in settings.json", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const settings = outputs.find((o) => o.path === ".claude/settings.json");
      expect(settings).toBeDefined();
      const parsed = JSON.parse(settings!.content);
      expect(parsed.hooks.PreToolUse).toBeDefined();
      // The allowlist hook fires on every tool call (matcher ".*"), so it
      // appears as one of the PreToolUse entries.
      const allowlistEntry = parsed.hooks.PreToolUse.find(
        (e: { hooks: Array<{ command: string }> }) =>
          e.hooks.some((h) =>
            h.command.includes("pretooluse-allowlist.mjs"),
          ),
      );
      expect(allowlistEntry).toBeDefined();
      expect(allowlistEntry.matcher).toBe(".*");
      expect(allowlistEntry.hooks[0].type).toBe("command");
      expect(allowlistEntry.hooks[0].command).toContain(
        "node .claude/hooks/pretooluse-allowlist.mjs",
      );
    });

    it("emits policies.json + hook script independently of features.hooks", async () => {
      // The PreToolUse allowlist is the runtime tail of ASI02 — it
      // must ship regardless of whether the project opts out of the
      // hook *content* feature, otherwise the trust chain breaks.
      const manifest = makeManifest({ features: { hooks: false } });
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      expect(
        outputs.find((o) => o.path === ".claude/hooks/agent-tool-policies.json"),
      ).toBeDefined();
      expect(
        outputs.find((o) => o.path === ".claude/hooks/pretooluse-allowlist.mjs"),
      ).toBeDefined();
    });
  });

  // ── Wave 5 (CLI-tooling pivot, plan §4.6) ───────────────────────
  //
  // Claude's skills surface is filtered by `manifest.cliTools.selected` via
  // `readCliFilteredSkills` on BaseAdapter — non-CLI skills always pass
  // through; `hatch3r-cli-*` skills only emit when their suffix is in the
  // selected list AND `cliTools.enabled` is true.
  describe("CLI tools filter (Wave 5 plan §4.6)", () => {
    it("emits only the selected CLI skills when cliTools is enabled", async () => {
      const manifest: HatchManifest = {
        ...makeManifest(),
        cliTools: { enabled: true, selected: ["ripgrep", "jq"] },
      };
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const cliSkills = outputs.filter((o) =>
        o.path.startsWith(".claude/skills/hatch3r-cli-"),
      );
      const paths = cliSkills.map((o) => o.path);
      expect(paths).toContain(".claude/skills/hatch3r-cli-ripgrep/SKILL.md");
      expect(paths).toContain(".claude/skills/hatch3r-cli-jq/SKILL.md");
      expect(paths.some((p) => p.includes("hatch3r-cli-fd"))).toBe(false);
    });

    it("emits zero CLI skill files when cliTools.enabled is false", async () => {
      const manifest: HatchManifest = {
        ...makeManifest(),
        cliTools: { enabled: false, selected: ["ripgrep", "jq"] },
      };
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      expect(
        outputs.filter((o) => o.path.startsWith(".claude/skills/hatch3r-cli-")),
      ).toEqual([]);
    });

    it("emits zero CLI skill files when cliTools.selected is empty", async () => {
      const manifest: HatchManifest = {
        ...makeManifest(),
        cliTools: { enabled: true, selected: [] },
      };
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      expect(
        outputs.filter((o) => o.path.startsWith(".claude/skills/hatch3r-cli-")),
      ).toEqual([]);
    });
  });

  // C9-M47 (D6-SA6.4, P7): cache-breakpoint sentinel coverage. The Claude
  // adapter emits a paired sentinel (`<!-- HATCH3R-CACHE-BREAKPOINT-START -->` /
  // `<!-- HATCH3R-CACHE-BREAKPOINT-END -->`) inside every managed block so
  // the Claude Code prompt-cache layer can fingerprint the deterministic
  // hatch3r-managed prefix across syncs. The cases below pin the sentinel
  // emission contract for each managed-block-bearing output the adapter
  // produces and prove the constants are exported for downstream tooling.
  describe("cache-breakpoint sentinel (C9-M47)", () => {
    it("exports a balanced sentinel-name family", () => {
      expect(CACHE_BREAKPOINT_SENTINEL).toBe("<!-- HATCH3R-CACHE-BREAKPOINT -->");
      expect(CACHE_BREAKPOINT_SENTINEL_START).toBe("<!-- HATCH3R-CACHE-BREAKPOINT-START -->");
      expect(CACHE_BREAKPOINT_SENTINEL_END).toBe("<!-- HATCH3R-CACHE-BREAKPOINT-END -->");
    });

    it("emits start + end sentinels inside CLAUDE.md managed block", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
      expect(claudeMd).toBeDefined();
      expect(claudeMd!.content).toContain(CACHE_BREAKPOINT_SENTINEL_START);
      expect(claudeMd!.content).toContain(CACHE_BREAKPOINT_SENTINEL_END);
      // Sentinels live inside the managed block.
      const startIdx = claudeMd!.content.indexOf(MANAGED_BLOCK_START);
      const endIdx = claudeMd!.content.indexOf(MANAGED_BLOCK_END);
      const sentStartIdx = claudeMd!.content.indexOf(CACHE_BREAKPOINT_SENTINEL_START);
      const sentEndIdx = claudeMd!.content.indexOf(CACHE_BREAKPOINT_SENTINEL_END);
      expect(startIdx).toBeLessThan(sentStartIdx);
      expect(sentStartIdx).toBeLessThan(sentEndIdx);
      expect(sentEndIdx).toBeLessThan(endIdx);
      // managedContent (the inner payload) also carries the sentinels.
      expect(claudeMd!.managedContent).toContain(CACHE_BREAKPOINT_SENTINEL_START);
      expect(claudeMd!.managedContent).toContain(CACHE_BREAKPOINT_SENTINEL_END);
    });

    it("emits sentinels in every .claude/rules/ output", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const rules = outputs.filter((o) => o.path.startsWith(".claude/rules/"));
      expect(rules.length).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(rule.content).toContain(CACHE_BREAKPOINT_SENTINEL_START);
        expect(rule.content).toContain(CACHE_BREAKPOINT_SENTINEL_END);
        expect(rule.managedContent).toContain(CACHE_BREAKPOINT_SENTINEL_START);
        expect(rule.managedContent).toContain(CACHE_BREAKPOINT_SENTINEL_END);
      }
    });

    it("emits sentinels in every .claude/agents/ output (standard mode)", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const agents = outputs.filter((o) => o.path.startsWith(".claude/agents/"));
      expect(agents.length).toBeGreaterThan(0);
      for (const agent of agents) {
        expect(agent.content).toContain(CACHE_BREAKPOINT_SENTINEL_START);
        expect(agent.content).toContain(CACHE_BREAKPOINT_SENTINEL_END);
        // The agent file format is `---FM---\n\n<managed block>` so the
        // sentinels must sit inside the managed block, not in the frontmatter.
        const fmEndIdx = agent.content.indexOf("---\n\n");
        const sentIdx = agent.content.indexOf(CACHE_BREAKPOINT_SENTINEL_START);
        expect(sentIdx).toBeGreaterThan(fmEndIdx);
      }
    });

    it("emits sentinels in every .claude/agents/ output (minimal mode)", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest, undefined, "minimal");
      const agents = outputs.filter((o) => o.path.startsWith(".claude/agents/"));
      expect(agents.length).toBeGreaterThan(0);
      for (const agent of agents) {
        expect(agent.content).toContain(CACHE_BREAKPOINT_SENTINEL_START);
        expect(agent.content).toContain(CACHE_BREAKPOINT_SENTINEL_END);
      }
    });

    it("emits sentinels in skill SKILL.md outputs", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const skills = outputs.filter((o) => o.path.startsWith(".claude/skills/"));
      expect(skills.length).toBeGreaterThan(0);
      for (const skill of skills) {
        expect(skill.content).toContain(CACHE_BREAKPOINT_SENTINEL_START);
        expect(skill.content).toContain(CACHE_BREAKPOINT_SENTINEL_END);
        expect(skill.managedContent).toContain(CACHE_BREAKPOINT_SENTINEL_START);
        expect(skill.managedContent).toContain(CACHE_BREAKPOINT_SENTINEL_END);
      }
    });

    it("emits sentinels in .claude/commands/ outputs", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const commands = outputs.filter((o) => o.path.startsWith(".claude/commands/"));
      expect(commands.length).toBeGreaterThan(0);
      for (const cmd of commands) {
        expect(cmd.content).toContain(CACHE_BREAKPOINT_SENTINEL_START);
        expect(cmd.content).toContain(CACHE_BREAKPOINT_SENTINEL_END);
        expect(cmd.managedContent).toContain(CACHE_BREAKPOINT_SENTINEL_START);
        expect(cmd.managedContent).toContain(CACHE_BREAKPOINT_SENTINEL_END);
      }
    });

    it("emits sentinels in hatch3r-agent-team.md", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const agentTeam = outputs.find(
        (o) => o.path === ".claude/commands/hatch3r-agent-team.md",
      );
      expect(agentTeam).toBeDefined();
      expect(agentTeam!.content).toContain(CACHE_BREAKPOINT_SENTINEL_START);
      expect(agentTeam!.content).toContain(CACHE_BREAKPOINT_SENTINEL_END);
      expect(agentTeam!.managedContent).toContain(CACHE_BREAKPOINT_SENTINEL_START);
      expect(agentTeam!.managedContent).toContain(CACHE_BREAKPOINT_SENTINEL_END);
    });

    it("does not duplicate sentinels on re-emission (idempotent helper)", async () => {
      // Same adapter instance, two sequential generates → sentinels must
      // appear exactly once per managed block (no double-wrap from nested
      // calls or from `processSkillsRawCliFiltered` -> `rewrapWithCacheBreakpoints`).
      const manifest = makeManifest();
      await adapter.generate(FIXTURES_DIR, manifest);
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      for (const out of outputs) {
        if (!out.managedContent) continue;
        const startMatches = out.content.match(
          new RegExp(CACHE_BREAKPOINT_SENTINEL_START.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "g"),
        );
        const endMatches = out.content.match(
          new RegExp(CACHE_BREAKPOINT_SENTINEL_END.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "g"),
        );
        expect(startMatches?.length ?? 0).toBe(1);
        expect(endMatches?.length ?? 0).toBe(1);
      }
    });

    it("preserves managedContent-is-substring-of-content invariant", async () => {
      // The BaseAdapter Output-invariant gate (C9-H4 in base.ts) drops any
      // output whose `managedContent` is not a substring of `content`.
      // Confirm the sentinel-bearing managedContent still satisfies that
      // invariant — otherwise outputs would silently disappear from sync.
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const managed = outputs.filter((o) => o.managedContent);
      expect(managed.length).toBeGreaterThan(0);
      for (const out of managed) {
        expect(out.content.includes(out.managedContent!.trim())).toBe(true);
      }
    });
  });
});
