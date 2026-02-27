import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CursorAdapter } from "../../adapters/cursor.js";
import { createManifest } from "../../manifest/hatchJson.js";
import type { HatchManifest } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

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
        !o.path.includes("hook-"),
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
    expect(agents.length).toBe(1);

    const agent = agents[0]!;
    expect(agent.path).toBe(".cursor/agents/hatch3r-test-agent.md");
    expect(agent.content).toContain("name: test-agent");
    expect(agent.content).toContain("description: A test agent for unit testing");
    expect(agent.content).toContain("You are a test agent");
    expect(agent.managedContent).toBeDefined();
  });

  it("emits model from customization file when present", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

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
    expect(bridge!.content).toContain("/.agents/AGENTS.md");
    expect(bridge!.content).toContain("Mandatory Behaviors");
    expect(bridge!.content).toContain("Agent Quick Reference");
    expect(bridge!.managedContent).toBeDefined();
  });

  it("skips rules when features.rules is false", async () => {
    const manifest = makeManifest({ features: { rules: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const rules = outputs.filter(
      (o) =>
        o.path.startsWith(".cursor/rules/") &&
        !o.path.includes("bridge") &&
        !o.path.includes("hook-"),
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
});
