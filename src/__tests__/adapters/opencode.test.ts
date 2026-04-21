import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OpenCodeAdapter } from "../../adapters/opencode.js";
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

describe("OpenCodeAdapter", () => {
  const adapter = new OpenCodeAdapter();

  function makeManifest(
    overrides: Partial<Parameters<typeof createManifest>[0]> & { models?: HatchManifest["models"] } = {},
  ): HatchManifest {
    const { models, ...createOpts } = overrides;
    const base = createManifest({
      tools: ["opencode"],
      mcpServers: ["github"],
      ...createOpts,
    });
    return models ? { ...base, models } : base;
  }

  it("has correct name", () => {
    expect(adapter.name).toBe("opencode");
  });

  it("does not generate AGENTS.md (handled centrally by init/sync)", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agentsMd = outputs.find((o) => o.path === "AGENTS.md");
    expect(agentsMd).toBeUndefined();
  });

  it("generates valid opencode.json with expanded instructions", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const opencodeJson = outputs.find((o) => o.path === "opencode.json");
    expect(opencodeJson).toBeDefined();

    const parsed = JSON.parse(opencodeJson!.content);
    expect(parsed.instructions).toBeDefined();
    expect(Array.isArray(parsed.instructions)).toBe(true);
    expect(parsed.instructions).toContain(".agents/AGENTS.md");
    // Wave B4 (task #12): rules are expanded from a glob into explicit
    // precedence-ordered paths, so the glob is replaced by concrete
    // `.agents/rules/hatch3r-<id>.md` entries. The test fixtures contain
    // scoped-rule and test-rule (no precedence → both rank as normal),
    // tie-broken lexicographically by id.
    expect(parsed.instructions).toContain(".agents/rules/hatch3r-scoped-rule.md");
    expect(parsed.instructions).toContain(".agents/rules/hatch3r-test-rule.md");
    expect(parsed.instructions).not.toContain(".agents/rules/*.md");
    expect(parsed.instructions).toContain(".agents/agents/*.md");
    expect(parsed.instructions).toContain(".agents/skills/*/SKILL.md");
  });

  it("uses OpenCode native MCP format with type field", async () => {
    const manifest = makeManifest({ mcpServers: ["github"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const opencodeJson = outputs.find((o) => o.path === "opencode.json");
    const parsed = JSON.parse(opencodeJson!.content);
    expect(parsed.mcp).toBeDefined();
    expect(parsed.mcp.github).toBeDefined();
    expect(parsed.mcp.github.type).toBe("remote");
    expect(parsed.mcp.github.url).toBe("https://api.githubcopilot.com/mcp/");
    expect(parsed.mcp.github.enabled).toBe(true);
  });

  it("does not include MCP when no servers configured", async () => {
    const manifest = makeManifest({ mcpServers: [] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const opencodeJson = outputs.find((o) => o.path === "opencode.json");
    const parsed = JSON.parse(opencodeJson!.content);
    expect(parsed.mcp).toBeUndefined();
  });

  it("generates agent files in .opencode/agents/", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agents = outputs.filter((o) => o.path.startsWith(".opencode/agents/"));
    expect(agents.length).toBe(2);

    const agent = agents.find((o) => o.path === ".opencode/agents/hatch3r-test-agent.md")!;
    expect(agent).toBeDefined();
    expect(agent.content).toContain("description: A test agent for unit testing");
    expect(agent.content).toContain("You are a test agent");
    expect(agent.managedContent).toBeDefined();
  });

  it("skips agents when features.agents is false", async () => {
    const manifest = makeManifest({ features: { agents: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agents = outputs.filter((o) => o.path.startsWith(".opencode/agents/"));
    expect(agents.length).toBe(0);
  });

  it("produces opencode.json plus native skills and commands", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs[0]!.path).toBe("opencode.json");

    const skills = outputs.filter((o) => o.path.startsWith(".opencode/skills/"));
    expect(skills.length).toBe(1);
    expect(skills[0]!.path).toContain("hatch3r-");
    expect(skills[0]!.path).toMatch(/SKILL\.md$/);

    const commands = outputs.filter((o) => o.path.startsWith(".opencode/commands/"));
    expect(commands.length).toBe(1);
    expect(commands[0]!.path).toContain("hatch3r-");
    expect(commands[0]!.path).toMatch(/\.md$/);
  });

  it("emits model from customization file when present", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agentFile = outputs.find((o) => o.path === ".opencode/agents/hatch3r-test-agent.md");
    expect(agentFile).toBeDefined();
    expect(agentFile!.content).toContain("model: anthropic/claude-sonnet-4-6");
  });

  it("emits model with provider prefix when configured via manifest", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-opencode-model-"));
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

      const agentFile = outputs.find((o) => o.path === ".opencode/agents/hatch3r-test-agent.md");
      expect(agentFile).toBeDefined();
      expect(agentFile!.content).toContain("model: openai/gpt-4");
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

  // ── Finding 3.16: no empty content assertion ──
  it("produces no empty content in any output", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.content.length).toBeGreaterThan(0);
    }
  });

  it("does not include MCP when features.mcp is false", async () => {
    const manifest = makeManifest({ mcpServers: ["github"], features: { mcp: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const opencodeJson = outputs.find((o) => o.path === "opencode.json")!;
    const parsed = JSON.parse(opencodeJson.content);
    expect(parsed.mcp).toBeUndefined();
  });

  it("omits instructions for disabled features", async () => {
    const manifest = makeManifest({
      features: { rules: false, agents: false, skills: false, commands: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const opencodeJson = outputs.find((o) => o.path === "opencode.json")!;
    const parsed = JSON.parse(opencodeJson.content);
    expect(parsed.instructions).toContain(".agents/AGENTS.md");
    expect(parsed.instructions).not.toContain(".agents/rules/*.md");
    // Wave B4 (task #12): when rules feature is disabled, no explicit rule
    // paths should appear either.
    const ruleEntries = (parsed.instructions as string[]).filter((p) =>
      p.startsWith(".agents/rules/"),
    );
    expect(ruleEntries.length).toBe(0);
    expect(parsed.instructions).not.toContain(".agents/agents/*.md");
    expect(parsed.instructions).not.toContain(".agents/skills/*/SKILL.md");
    expect(parsed.instructions).not.toContain(".agents/commands/*.md");
  });

  it("skips skills when features.skills is false", async () => {
    const manifest = makeManifest({ features: { skills: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".opencode/skills/"));
    expect(skills.length).toBe(0);
  });

  it("skips commands when features.commands is false", async () => {
    const manifest = makeManifest({ features: { commands: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const commands = outputs.filter((o) => o.path.startsWith(".opencode/commands/"));
    expect(commands.length).toBe(0);
  });

  it("returns only opencode.json when all features are disabled and no MCP", async () => {
    const manifest = makeManifest({
      mcpServers: [],
      features: { skills: false, mcp: false, rules: false, agents: false, commands: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs.length).toBe(1);
    expect(outputs[0]!.path).toBe("opencode.json");
  });

  // ── Wave B4 (task #12): precedence-ordered instructions[] ──────
  describe("rule precedence ordering in opencode.json instructions[]", () => {
    let precedenceDir: string;

    beforeAll(async () => {
      // Build a dedicated fixture with three rules carrying distinct
      // precedence buckets (critical/normal/low) so the ordering assertion
      // cannot be satisfied by alphabetic filesystem order alone.
      precedenceDir = await mkdtemp(join(tmpdir(), "hatch3r-opencode-prec-"));
      const rulesDir = join(precedenceDir, "rules");
      await mkdir(rulesDir, { recursive: true });
      await writeFile(
        join(rulesDir, "zzz-low-rule.md"),
        `---
id: zzz-low-rule
type: rule
description: A low-precedence rule (alphabetically last so the test distinguishes filesystem order from precedence order)
precedence: low
---
# Low rule
`,
        "utf-8",
      );
      await writeFile(
        join(rulesDir, "aaa-normal-rule.md"),
        `---
id: aaa-normal-rule
type: rule
description: A normal-precedence rule (alphabetically first so filesystem order would put it ahead of critical)
precedence: normal
---
# Normal rule
`,
        "utf-8",
      );
      await writeFile(
        join(rulesDir, "mmm-critical-rule.md"),
        `---
id: mmm-critical-rule
type: rule
description: A critical-precedence rule (alphabetically in the middle, must appear first in instructions order)
precedence: critical
---
# Critical rule
`,
        "utf-8",
      );
      // Required companion directories — agents/ and skills/ are declared in
      // instructions when the feature flag is on; make them empty so the
      // adapter does not emit per-file outputs for them.
      await mkdir(join(precedenceDir, "agents"), { recursive: true });
      await mkdir(join(precedenceDir, "skills"), { recursive: true });
      await mkdir(join(precedenceDir, "commands"), { recursive: true });
    });

    afterAll(async () => {
      await rm(precedenceDir, { recursive: true, force: true });
    });

    it("orders rules critical → normal → low in instructions[]", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(precedenceDir, manifest);

      const opencodeJson = outputs.find((o) => o.path === "opencode.json")!;
      const parsed = JSON.parse(opencodeJson.content);
      const ruleEntries = (parsed.instructions as string[]).filter((p) =>
        p.startsWith(".agents/rules/"),
      );

      // Expect exactly three explicit rule paths — the glob must NOT appear.
      expect(ruleEntries).toEqual([
        ".agents/rules/hatch3r-mmm-critical-rule.md",
        ".agents/rules/hatch3r-aaa-normal-rule.md",
        ".agents/rules/hatch3r-zzz-low-rule.md",
      ]);
      expect(parsed.instructions).not.toContain(".agents/rules/*.md");
    });

    it("falls back to glob when no canonical rules are present", async () => {
      // Rules feature on, but the rules directory is empty.
      const emptyDir = await mkdtemp(join(tmpdir(), "hatch3r-opencode-empty-"));
      try {
        await mkdir(join(emptyDir, "rules"), { recursive: true });
        await mkdir(join(emptyDir, "agents"), { recursive: true });
        await mkdir(join(emptyDir, "skills"), { recursive: true });
        await mkdir(join(emptyDir, "commands"), { recursive: true });
        const manifest = makeManifest();
        const outputs = await adapter.generate(emptyDir, manifest);

        const opencodeJson = outputs.find((o) => o.path === "opencode.json")!;
        const parsed = JSON.parse(opencodeJson.content);
        // With zero canonical rules, the glob fallback preserves discoverability
        // for rules added after adapter generation.
        expect(parsed.instructions).toContain(".agents/rules/*.md");
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });
  });

  describe("extended MCP scenarios", () => {
    let extendedDir: string;

    beforeAll(async () => {
      extendedDir = await mkdtemp(join(tmpdir(), "hatch3r-opencode-mcp-"));
      await cp(FIXTURES_DIR, extendedDir, { recursive: true });
      await mkdir(join(extendedDir, "mcp"), { recursive: true });
      await writeFile(join(extendedDir, "mcp", "mcp.json"), JSON.stringify(EXTENDED_MCP, null, 2));
    });

    afterAll(async () => {
      await rm(extendedDir, { recursive: true, force: true });
    });

    it("generates command-based MCP servers with local type", async () => {
      const manifest = makeManifest({ mcpServers: ["github", "filesystem"] });
      const outputs = await adapter.generate(extendedDir, manifest);

      const opencodeJson = outputs.find((o) => o.path === "opencode.json")!;
      const parsed = JSON.parse(opencodeJson.content);
      expect(parsed.mcp.filesystem).toBeDefined();
      expect(parsed.mcp.filesystem.type).toBe("local");
      expect(parsed.mcp.filesystem.command).toContain("npx");
      expect(parsed.mcp.filesystem.enabled).toBe(true);
      expect(parsed.mcp.filesystem.environment).toBeDefined();
      expect(parsed.mcp.filesystem.environment.MCP_FS_ROOT).toBe("/tmp");
    });

    it("skips _disabled MCP servers", async () => {
      const manifest = makeManifest({ mcpServers: ["github", "disabled-server"] });
      const outputs = await adapter.generate(extendedDir, manifest);

      const opencodeJson = outputs.find((o) => o.path === "opencode.json")!;
      const parsed = JSON.parse(opencodeJson.content);
      expect(parsed.mcp["disabled-server"]).toBeUndefined();
    });
  });
});
