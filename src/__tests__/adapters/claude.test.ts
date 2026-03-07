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
    expect(claudeMd!.content).toContain("Agent Teams (Experimental)");
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
        teammateMode: "full-trust",
      },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    expect(settings).toBeDefined();

    const parsed = JSON.parse(settings!.content);
    expect(parsed.permissions.allow).toEqual(["Read", "Grep"]);
    expect(parsed.permissions.deny).toEqual(["Bash"]);
    expect(parsed.teammateMode).toBe("full-trust");
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
    expect(parsed.teammateMode).toBe("tool-using");
  });

  it("includes hooks config in settings.json when hooks are enabled", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    const parsed = JSON.parse(settings!.content);
    expect(parsed.hooks).toBeDefined();
    expect(parsed.hooks.PreToolUse).toBeDefined();
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
});
