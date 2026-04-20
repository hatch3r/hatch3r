import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KiroAdapter } from "../../adapters/kiro.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../../types.js";
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

describe("KiroAdapter", () => {
  const adapter = new KiroAdapter();

  it("has correct name", () => {
    expect(adapter.name).toBe("kiro");
  });

  it("generates .kiro/steering/hatch3r-agents.md with rules and agents", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const steering = outputs.find((o) => o.path === ".kiro/steering/hatch3r-agents.md");
    expect(steering).toBeDefined();
    expect(steering!.content).toContain(MANAGED_BLOCK_START);
    expect(steering!.content).toContain(MANAGED_BLOCK_END);
    expect(steering!.content).toContain("Hatch3r Agent Instructions");
    expect(steering!.content).toContain("Mandatory Behaviors");
    expect(steering!.content).toContain("test-rule");
    expect(steering!.content).toContain("Agent: test-agent");
    expect(steering!.managedContent).toBeDefined();
  });

  it("mentions Kiro Powers bundling in the steering bridge", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const steering = outputs.find((o) => o.path === ".kiro/steering/hatch3r-agents.md");
    expect(steering).toBeDefined();
    expect(steering!.content).toContain("Kiro Power");
  });

  it("generates scoped rules as separate steering files with frontmatter", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const scopedRule = outputs.find(
      (o) => o.path.startsWith(".kiro/steering/hatch3r-rule-scoped-rule"),
    );
    expect(scopedRule).toBeDefined();
    expect(scopedRule!.content).toContain("inclusion: fileMatch");
    expect(scopedRule!.content).toContain("fileMatchPattern:");
    expect(scopedRule!.content).toContain("Scoped Rule");
  });

  it("still generates steering file with orchestration when rules and agents are disabled", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
      features: { rules: false, agents: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const steering = outputs.find((o) => o.path === ".kiro/steering/hatch3r-agents.md");
    expect(steering).toBeDefined();
    expect(steering!.content).toContain("Mandatory Behaviors");
    expect(steering!.content).not.toContain("Agent: test-agent");
  });

  it("generates skill files in .kiro/steering/", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter(
      (o) =>
        o.path.startsWith(".kiro/steering/") &&
        o.path !== ".kiro/steering/hatch3r-agents.md" &&
        !o.path.includes("scoped-rule"),
    );
    expect(skills.length).toBeGreaterThanOrEqual(1);
    const skill = skills.find((s) => s.content.includes("test-skill"));
    expect(skill).toBeDefined();
    expect(skill!.managedContent).toBeDefined();
  });

  it("skips skills when features.skills is false", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
      features: { skills: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const hasSkillOutput = outputs.some(
      (o) =>
        o.path.startsWith(".kiro/steering/hatch3r-skill-") &&
        o.content.includes("test-skill"),
    );
    expect(hasSkillOutput).toBe(false);
  });

  it("generates MCP settings when MCP servers are configured", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
      mcpServers: ["github"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcpSettings = outputs.find((o) => o.path === ".kiro/settings/mcp.json");
    expect(mcpSettings).toBeDefined();

    const parsed = JSON.parse(mcpSettings!.content);
    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers.github).toBeDefined();
    expect(parsed.mcpServers.github.url).toBe("https://api.githubcopilot.com/mcp/");
  });

  it("does not generate MCP settings when no servers configured", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
      mcpServers: [],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcpSettings = outputs.find((o) => o.path === ".kiro/settings/mcp.json");
    expect(mcpSettings).toBeUndefined();
  });

  it("all outputs have action 'create'", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
      mcpServers: ["github"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.action).toBe("create");
    }
  });

  // ── Finding 3.17: model resolution assertion ──
  it("includes model annotation in steering file when agent has model configured", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const steering = outputs.find((o) => o.path === ".kiro/steering/hatch3r-agents.md");
    expect(steering).toBeDefined();
    // test-agent fixture has model: sonnet -> resolves to claude-sonnet-4-6
    expect(steering!.content).toContain("Recommended model:");
    expect(steering!.content).toContain("claude-sonnet-4-6");
  });

  // ── Finding 3.16: no empty content assertion ──
  it("produces no empty content in any output", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
      mcpServers: ["github"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.content.length).toBeGreaterThan(0);
    }
  });

  it("generates native hook files in .kiro/hooks/", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const hookFiles = outputs.filter((o) => o.path.startsWith(".kiro/hooks/"));
    expect(hookFiles.length).toBeGreaterThanOrEqual(1);

    // Check that hooks use native format with YAML frontmatter using
    // Kiro 2026 trigger identifiers (https://kiro.dev/docs/hooks/types/).
    const preCommitHook = hookFiles.find((o) => o.path.includes("pre-commit"));
    expect(preCommitHook).toBeDefined();
    expect(preCommitHook!.content).toContain("trigger: pre-tool-use");
    expect(preCommitHook!.content).toContain("HATCH3R_HOOK_ACTIVATED");
  });

  it("maps each hatch3r hook event to a Kiro 2026 trigger identifier", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);
    const hookFiles = outputs.filter((o) => o.path.startsWith(".kiro/hooks/"));

    // Every emitted hook must use a documented Kiro 2026 trigger identifier.
    const validTriggers = new Set([
      "prompt-submit",
      "agent-stop",
      "pre-tool-use",
      "post-tool-use",
      "file-create",
      "file-save",
      "file-delete",
      "pre-task-execution",
      "post-task-execution",
      "manual-trigger",
    ]);
    for (const hook of hookFiles) {
      const match = hook.content.match(/^trigger:\s*(\S+)/m);
      expect(match).not.toBeNull();
      expect(validTriggers.has(match![1])).toBe(true);
    }

    // Specific mappings verified:
    //   pre-commit      -> pre-tool-use
    //   post-merge      -> post-tool-use
    //   ci-failure      -> manual-trigger
    //   session-start   -> prompt-submit
    const postMerge = hookFiles.find((o) => o.path.includes("post-merge"));
    expect(postMerge!.content).toContain("trigger: post-tool-use");
    const ciFailure = hookFiles.find((o) => o.path.includes("ci-failure"));
    expect(ciFailure!.content).toContain("trigger: manual-trigger");
    const sessionStart = hookFiles.find((o) => o.path.includes("session-start"));
    expect(sessionStart!.content).toContain("trigger: prompt-submit");
  });

  it("hook files include condition frontmatter when globs present", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const preCommitHook = outputs.find((o) =>
      o.path.startsWith(".kiro/hooks/") && o.path.includes("pre-commit"),
    );
    expect(preCommitHook).toBeDefined();
    // pre-commit-lint-fixer fixture has globs
    expect(preCommitHook!.content).toContain("filePattern:");
  });

  it("hook files include branch conditions when present", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const postMergeHook = outputs.find((o) =>
      o.path.startsWith(".kiro/hooks/") && o.path.includes("post-merge"),
    );
    expect(postMergeHook).toBeDefined();
    // post-merge-deploy fixture has branches
    expect(postMergeHook!.content).toContain("branches:");
  });

  it("does not generate hooks when hooks feature is disabled", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
      features: { hooks: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const hookFiles = outputs.filter((o) => o.path.startsWith(".kiro/hooks/"));
    expect(hookFiles.length).toBe(0);
  });

  it("no longer emits generic bridge hooks markdown", async () => {
    const manifest = createManifest({
      tools: ["kiro"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    // The old generic format wrote a single .kiro/steering/hatch3r-hooks.md file.
    // Native hooks use .kiro/hooks/ directory instead.
    const oldHooksFile = outputs.find((o) => o.path === ".kiro/steering/hatch3r-hooks.md");
    expect(oldHooksFile).toBeUndefined();
  });

  describe("extended MCP scenarios", () => {
    let extendedDir: string;

    beforeAll(async () => {
      extendedDir = await mkdtemp(join(tmpdir(), "hatch3r-kiro-mcp-"));
      await cp(FIXTURES_DIR, extendedDir, { recursive: true });
      await mkdir(join(extendedDir, "mcp"), { recursive: true });
      await writeFile(join(extendedDir, "mcp", "mcp.json"), JSON.stringify(EXTENDED_MCP, null, 2));
    });

    afterAll(async () => {
      await rm(extendedDir, { recursive: true, force: true });
    });

    it("generates command-based MCP server entries", async () => {
      const manifest = createManifest({
        tools: ["kiro"],
        mcpServers: ["github", "filesystem"],
      });
      const outputs = await adapter.generate(extendedDir, manifest);

      const mcpSettings = outputs.find((o) => o.path === ".kiro/settings/mcp.json")!;
      const parsed = JSON.parse(mcpSettings.content);
      expect(parsed.mcpServers.filesystem).toBeDefined();
      expect(parsed.mcpServers.filesystem.command).toBe("npx");
      expect(parsed.mcpServers.filesystem.args).toContain("-y");
      expect(parsed.mcpServers.filesystem.env).toBeDefined();
      expect(parsed.mcpServers.filesystem.env.MCP_FS_ROOT).toBe("/tmp");
    });

    it("skips _disabled MCP servers", async () => {
      const manifest = createManifest({
        tools: ["kiro"],
        mcpServers: ["github", "disabled-server"],
      });
      const outputs = await adapter.generate(extendedDir, manifest);

      const mcpSettings = outputs.find((o) => o.path === ".kiro/settings/mcp.json");
      if (mcpSettings) {
        const parsed = JSON.parse(mcpSettings.content);
        expect(parsed.mcpServers["disabled-server"]).toBeUndefined();
      }
    });
  });
});
