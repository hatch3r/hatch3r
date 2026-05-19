import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexAdapter } from "../../adapters/codex.js";
import { createManifest } from "../../manifest/hatchJson.js";
import type { HatchManifest } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

const EXTENDED_MCP = {
  mcpServers: {
    github: { _description: "Test GitHub MCP", url: "https://api.githubcopilot.com/mcp/" },
    filesystem: {
      _description: "Test filesystem MCP",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      env: { MCP_FS_ROOT: "/tmp" },
    },
    "disabled-server": {
      _description: "A disabled MCP server",
      _disabled: true,
      command: "npx",
      args: ["disabled-server"],
    },
  },
};

describe("CodexAdapter", () => {
  const adapter = new CodexAdapter();

  function makeManifest(
    overrides: Partial<Parameters<typeof createManifest>[0]> & { models?: HatchManifest["models"] } = {},
  ): HatchManifest {
    const { models, ...createOpts } = overrides;
    const base = createManifest({
      tools: ["codex"],
      mcpServers: ["github"],
      ...createOpts,
    });
    return models ? { ...base, models } : base;
  }

  it("has correct name", () => {
    expect(adapter.name).toBe("codex");
  });

  it("generates .codex/config.toml without legacy model_instructions_file", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const configToml = outputs.find((o) => o.path === ".codex/config.toml");
    expect(configToml).toBeDefined();
    expect(configToml!.content).toContain("hatch3r");
    expect(configToml!.content).not.toContain('model_instructions_file = ".agents/AGENTS.md"');
  });

  it("emits project_doc_fallback_filenames per Codex 2026 precedence chain", async () => {
    // D9-SA9.5.1 / C7.5-W2B2-H36: Codex checks AGENTS.override.md -> AGENTS.md
    // -> project_doc_fallback_filenames. Registering legacy names surfaces
    // hatch3r content for projects migrating from pre-2026 Codex layouts.
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const configToml = outputs.find((o) => o.path === ".codex/config.toml")!;
    expect(configToml.content).toContain(
      'project_doc_fallback_filenames = ["TEAM_GUIDE.md", ".agents.md"]',
    );
    // Discovery-precedence documentation is inlined as comments so users
    // understand why the fallback list is registered.
    expect(configToml.content).toContain("AGENTS.override.md");
  });

  it("includes rule references in config.toml when rules are enabled", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const configToml = outputs.find((o) => o.path === ".codex/config.toml");
    expect(configToml).toBeDefined();
    expect(configToml!.content).toContain("rule: test-rule");
    expect(configToml!.content).toContain("A test rule for unit testing");
  });

  it("skips rule references when features.rules is false", async () => {
    const manifest = makeManifest({ features: { rules: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const configToml = outputs.find((o) => o.path === ".codex/config.toml");
    expect(configToml).toBeDefined();
    expect(configToml!.content).not.toContain("rule: test-rule");
  });

  it("generates per-agent TOML files when agents are enabled", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agentFiles = outputs.filter((o) => o.path.startsWith(".codex/agents/"));
    expect(agentFiles.length).toBe(2);

    const agent = agentFiles.find((o) => o.path === ".codex/agents/hatch3r-test-agent.toml");
    expect(agent).toBeDefined();
    // Per the 2026 Codex subagents schema, required top-level keys are
    // `name`, `description`, `developer_instructions`.
    expect(agent!.content).toContain('name = "hatch3r-test-agent"');
    expect(agent!.content).toContain('description =');
    expect(agent!.content).toContain('developer_instructions = """');
    expect(agent!.content).toContain('"""');
    // Body of the agent is embedded as the instructions payload.
    expect(agent!.content).toContain("You are a test agent");
    // model_instructions_file is legacy/reserved — Codex discovers AGENTS.md natively
    expect(agent!.content).not.toContain('model_instructions_file');

    // config.toml should NOT contain agent sections
    const configToml = outputs.find((o) => o.path === ".codex/config.toml");
    expect(configToml).toBeDefined();
    expect(configToml!.content).not.toContain("[agents.");
  });

  it("skips per-agent TOML files when features.agents is false", async () => {
    const manifest = makeManifest({ features: { agents: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agentFiles = outputs.filter((o) => o.path.startsWith(".codex/agents/"));
    expect(agentFiles.length).toBe(0);
  });

  it("generates skill files in .codex/skills/", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".codex/skills/"));
    expect(skills.length).toBe(1);

    const skill = skills[0]!;
    expect(skill.path).toContain("hatch3r-");
    expect(skill.path).toMatch(/SKILL\.md$/);
    expect(skill.content).toContain("test-skill");
    expect(skill.managedContent).toBeDefined();
  });

  it("skips skills when features.skills is false", async () => {
    const manifest = makeManifest({ features: { skills: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".codex/skills/"));
    expect(skills.length).toBe(0);
  });

  it("emits model from customization file in per-agent TOML", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agentToml = outputs.find((o) => o.path === ".codex/agents/hatch3r-test-agent.toml");
    expect(agentToml).toBeDefined();
    expect(agentToml!.content).toContain('model = "claude-sonnet-4-6"');
  });

  it("emits model in per-agent TOML file when configured via manifest", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-codex-model-"));
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

      const agentToml = outputs.find((o) => o.path === ".codex/agents/hatch3r-test-agent.toml");
      expect(agentToml).toBeDefined();
      expect(agentToml!.content).toContain('model = "gpt-4"');
      // Per the 2026 Codex subagents schema, order is model before
      // developer_instructions so the instruction payload closes the file.
      const modelIdx = agentToml!.content.indexOf("model =");
      const instructionsIdx = agentToml!.content.indexOf("developer_instructions");
      expect(modelIdx).toBeGreaterThan(-1);
      expect(instructionsIdx).toBeGreaterThan(modelIdx);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("escapes triple-quote sequences inside agent developer_instructions", async () => {
    // C7.5-W2B2-H36: the multi-line basic string terminator is `"""`. Any
    // `"""` inside the instruction body must be broken so the TOML parser
    // does not terminate the string early.
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-codex-triplequote-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await writeFile(
        join(agentsDir, "agents", "triplequote-agent.md"),
        `---
id: triplequote-agent
type: agent
description: Agent body contains a TOML terminator sequence
---
This body has a literal """ triple-quote sequence.
Use a \\\\ backslash too.`,
        "utf-8",
      );
      const manifest = makeManifest();
      const outputs = await adapter.generate(agentsDir, manifest);
      const agentToml = outputs.find((o) => o.path === ".codex/agents/hatch3r-triplequote-agent.toml");
      expect(agentToml).toBeDefined();
      // Triple-quote must be broken by an escape so the TOML string does
      // not terminate early.
      expect(agentToml!.content).not.toContain('""" triple-quote');
      expect(agentToml!.content).toContain('""\\" triple-quote');
      // Double backslash in source markdown escapes to quadruple in TOML.
      expect(agentToml!.content).toContain("\\\\\\\\ backslash");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("always generates config.toml", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const configToml = outputs.find((o) => o.path === ".codex/config.toml");
    expect(configToml).toBeDefined();
  });

  it("all outputs have action 'create'", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.action).toBe("create");
    }
  });

  it("generates MCP section with URL-based servers", async () => {
    const manifest = makeManifest({ mcpServers: ["github"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const configToml = outputs.find((o) => o.path === ".codex/config.toml")!;
    expect(configToml.content).toContain("[mcp_servers.github]");
    expect(configToml.content).toContain('url = "https://api.githubcopilot.com/mcp/"');
  });

  it("does not include MCP when no servers configured", async () => {
    const manifest = makeManifest({ mcpServers: [] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const configToml = outputs.find((o) => o.path === ".codex/config.toml")!;
    expect(configToml.content).not.toContain("[mcp_servers.");
  });

  it("does not include MCP when features.mcp is false", async () => {
    const manifest = makeManifest({ mcpServers: ["github"], features: { mcp: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const configToml = outputs.find((o) => o.path === ".codex/config.toml")!;
    expect(configToml.content).not.toContain("[mcp_servers.");
  });

  it("returns only config.toml when all features are disabled and no MCP", async () => {
    const manifest = makeManifest({
      mcpServers: [],
      features: { skills: false, mcp: false, rules: false, agents: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs.length).toBe(1);
    expect(outputs[0]!.path).toBe(".codex/config.toml");
  });

  describe("extended MCP scenarios", () => {
    let extendedDir: string;

    beforeAll(async () => {
      extendedDir = await mkdtemp(join(tmpdir(), "hatch3r-codex-mcp-"));
      await cp(FIXTURES_DIR, extendedDir, { recursive: true });
      await mkdir(join(extendedDir, "mcp"), { recursive: true });
      await writeFile(join(extendedDir, "mcp", "mcp.json"), JSON.stringify(EXTENDED_MCP, null, 2));
    });

    afterAll(async () => {
      await rm(extendedDir, { recursive: true, force: true });
    });

    it("generates MCP section with command-based servers and env vars", async () => {
      const manifest = makeManifest({ mcpServers: ["github", "filesystem"] });
      const outputs = await adapter.generate(extendedDir, manifest);

      const configToml = outputs.find((o) => o.path === ".codex/config.toml")!;
      expect(configToml.content).toContain("[mcp_servers.filesystem]");
      expect(configToml.content).toContain('command = "npx"');
      expect(configToml.content).toContain('args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]');
      // Codex v0.114+: env uses TOML table sections, not inline dotted keys
      expect(configToml.content).toContain('[mcp_servers.filesystem.env]');
      expect(configToml.content).toContain('MCP_FS_ROOT = "/tmp"');
    });

    it("skips _disabled MCP servers", async () => {
      const manifest = makeManifest({ mcpServers: ["github", "disabled-server"] });
      const outputs = await adapter.generate(extendedDir, manifest);

      const configToml = outputs.find((o) => o.path === ".codex/config.toml")!;
      expect(configToml.content).not.toContain("disabled-server");
    });
  });

  // ── Branch gap tests: empty features, no MCP, empty tools ──

  it("generates only config.toml when all features are false and no MCP", async () => {
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

    expect(outputs.length).toBe(1);
    expect(outputs[0]!.path).toBe(".codex/config.toml");
    // No MCP, no agent files, no rule references
    expect(outputs[0]!.content).not.toContain("[mcp_servers.");
    expect(outputs[0]!.content).not.toContain("[agents.");
  });

  it("does not include MCP section when servers list is empty", async () => {
    const manifest = makeManifest({ mcpServers: [] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const configToml = outputs.find((o) => o.path === ".codex/config.toml")!;
    expect(configToml.content).not.toContain("[mcp_servers.");
  });

  it("produces no empty content in any output", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.content.length).toBeGreaterThan(0);
    }
  });

  it("includes hooks in config.toml when hooks are enabled", async () => {
    const manifest = makeManifest({ features: { hooks: true } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const configToml = outputs.find((o) => o.path === ".codex/config.toml")!;
    expect(configToml.content).toContain("# Hooks (v0.114+)");
    expect(configToml.content).toContain('[hooks."pre-commit"]');
    expect(configToml.content).toContain("HATCH3R_HOOK_ACTIVATED");
  });

  it("does not include hooks when features.hooks is false", async () => {
    const manifest = makeManifest({ features: { hooks: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const configToml = outputs.find((o) => o.path === ".codex/config.toml")!;
    expect(configToml.content).not.toContain("[hooks.");
  });

  // ── C9-H22 (D9-SA9.5.F1) — Codex 0.114 spawn_agent regression warning ──
  // openai/codex#14579 documents that per-agent TOML files in `.codex/agents/`
  // are not loaded by the live `spawn_agent` tool on Codex 0.114. The adapter
  // emits a generation-time warning whenever agent features are enabled so
  // operators see the regression note alongside the produced files.
  describe("Codex 0.114 spawn_agent regression warning (C9-H22)", () => {
    it("emits a spawn_agent regression warning when features.agents is true", async () => {
      const freshAdapter = new CodexAdapter();
      const manifest = makeManifest();
      await freshAdapter.generate(FIXTURES_DIR, manifest);

      const regressionWarnings = freshAdapter.warnings.filter((w) =>
        w.includes("spawn_agent regression"),
      );
      expect(regressionWarnings.length).toBe(1);
      const msg = regressionWarnings[0]!;
      // Cite the upstream issue so operators can verify the source.
      expect(msg).toContain("openai/codex#14579");
      // Name the affected version so operators know when an upgrade clears it.
      expect(msg).toContain("0.114");
      // Surface the documented workaround (CLI -c overrides).
      expect(msg).toContain("-c");
      // The codex adapter tag keeps warnings filterable by source.
      expect(msg).toMatch(/^\[codex\]/);
    });

    it("does not emit the spawn_agent warning when features.agents is false", async () => {
      const freshAdapter = new CodexAdapter();
      const manifest = makeManifest({ features: { agents: false } });
      await freshAdapter.generate(FIXTURES_DIR, manifest);

      const regressionWarnings = freshAdapter.warnings.filter((w) =>
        w.includes("spawn_agent regression"),
      );
      // No per-agent TOML files are generated when agents are disabled, so
      // the spawn_agent regression cannot affect this sync — suppress the
      // warning to avoid alarm fatigue.
      expect(regressionWarnings.length).toBe(0);
    });

    it("resets warnings between adapter.generate() invocations", async () => {
      // BaseAdapter.generate clears `this.warnings` at the top, so repeated
      // sync calls must not accumulate duplicate spawn_agent warnings.
      const freshAdapter = new CodexAdapter();
      const manifest = makeManifest();
      await freshAdapter.generate(FIXTURES_DIR, manifest);
      await freshAdapter.generate(FIXTURES_DIR, manifest);

      const regressionWarnings = freshAdapter.warnings.filter((w) =>
        w.includes("spawn_agent regression"),
      );
      expect(regressionWarnings.length).toBe(1);
    });
  });
});
