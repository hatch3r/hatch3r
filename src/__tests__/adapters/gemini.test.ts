import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GeminiAdapter } from "../../adapters/gemini.js";
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

describe("GeminiAdapter", () => {
  const adapter = new GeminiAdapter();

  function makeManifest(overrides: Partial<Parameters<typeof createManifest>[0]> = {}): HatchManifest {
    return createManifest({
      tools: ["gemini"],

      mcpServers: ["github"],
      ...overrides,
    });
  }

  it("has correct name", () => {
    expect(adapter.name).toBe("gemini");
  });

  it("generates GEMINI.md with managed block", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const geminiMd = outputs.find((o) => o.path === "GEMINI.md");
    expect(geminiMd).toBeDefined();
    expect(geminiMd!.content).toContain("<!-- HATCH3R:BEGIN -->");
    expect(geminiMd!.content).toContain("<!-- HATCH3R:END -->");
  });

  it("generates .gemini/settings.json with context config", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".gemini/settings.json");
    expect(settings).toBeDefined();

    const parsed = JSON.parse(settings!.content);
    expect(parsed.context).toBeDefined();
    expect(parsed.context.fileName).toContain("GEMINI.md");
    expect(parsed.context.fileName).toContain("AGENTS.md");
  });

  it("includes MCP servers in settings.json when MCP is enabled", async () => {
    const manifest = makeManifest({ mcpServers: ["github"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".gemini/settings.json");
    const parsed = JSON.parse(settings!.content);
    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers.github).toBeDefined();
    expect(parsed.mcpServers.github.url).toBe("https://api.githubcopilot.com/mcp/");
  });

  it("does not include MCP servers when no servers configured", async () => {
    const manifest = makeManifest({ mcpServers: [] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".gemini/settings.json");
    const parsed = JSON.parse(settings!.content);
    expect(parsed.mcpServers).toBeUndefined();
  });

  it("includes hooks config in settings.json when hooks are enabled", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".gemini/settings.json");
    const parsed = JSON.parse(settings!.content);
    expect(parsed.hooks).toBeDefined();
  });

  // ── Finding 3.18: hooks feature disabled assertion ──
  it("does not include hooks config when hooks feature is disabled", async () => {
    const manifest = makeManifest({ features: { hooks: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".gemini/settings.json");
    const parsed = JSON.parse(settings!.content);
    expect(parsed.hooks).toBeUndefined();
  });

  it("inlines agents into GEMINI.md when features.agents is enabled", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const geminiMd = outputs.find((o) => o.path === "GEMINI.md");
    expect(geminiMd).toBeDefined();
    expect(geminiMd!.content).toContain("Agent: test-agent");
    expect(geminiMd!.content).toContain("A test agent for unit testing");
  });

  it("omits agents from GEMINI.md when features.agents is disabled", async () => {
    const manifest = makeManifest({ features: { agents: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const geminiMd = outputs.find((o) => o.path === "GEMINI.md");
    expect(geminiMd).toBeDefined();
    expect(geminiMd!.content).not.toContain("Agent: test-agent");
  });

  it("produces outputs including skills and commands", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const paths = outputs.map((o) => o.path).sort();
    expect(paths).toContain("GEMINI.md");
    expect(paths).toContain(".gemini/settings.json");

    const skills = outputs.filter((o) => o.path.startsWith(".gemini/skills/"));
    expect(skills.length).toBe(1);
    expect(skills[0]!.path).toContain("hatch3r-");
    expect(skills[0]!.path).toMatch(/SKILL\.md$/);

    const commands = outputs.filter((o) => o.path.startsWith(".gemini/commands/"));
    expect(commands.length).toBe(1);
    expect(commands[0]!.path).toMatch(/\.toml$/);
    expect(commands[0]!.content).toContain("description =");
    expect(commands[0]!.content).toContain("prompt =");
  });

  it("inlines rules when features.rules is enabled", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const geminiMd = outputs.find((o) => o.path === "GEMINI.md");
    expect(geminiMd).toBeDefined();
    expect(geminiMd!.content).toContain("test-rule");
  });

  it("omits rules when features.rules is disabled", async () => {
    const manifest = makeManifest({ features: { rules: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const geminiMd = outputs.find((o) => o.path === "GEMINI.md");
    expect(geminiMd).toBeDefined();
    expect(geminiMd!.content).not.toContain("test-rule");
  });

  it("GEMINI.md references canonical AGENTS.md and includes orchestration", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const geminiMd = outputs.find((o) => o.path === "GEMINI.md");
    expect(geminiMd!.content).toContain(".agents/AGENTS.md");
    expect(geminiMd!.content).toContain("Mandatory Behaviors");
    expect(geminiMd!.content).toContain("Agent Quick Reference");
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

  // ── Finding 3.17: model resolution assertion ──
  it("includes model annotation in GEMINI.md when agent has model configured", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const geminiMd = outputs.find((o) => o.path === "GEMINI.md");
    expect(geminiMd).toBeDefined();
    // test-agent fixture has model: sonnet -> resolves to claude-sonnet-4-6
    expect(geminiMd!.content).toContain("Recommended model:");
    expect(geminiMd!.content).toContain("claude-sonnet-4-6");
  });

  it("escapes TOML triple-quote injection in command descriptions", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const commands = outputs.filter((o) => o.path.startsWith(".gemini/commands/"));
    for (const cmd of commands) {
      const descMatch = cmd.content.match(/description = "(.*?)"/s);
      const promptMatch = cmd.content.match(/prompt = "(.*?)"/s);
      if (descMatch) {
        expect(descMatch[1]).not.toContain('"""');
        expect(descMatch[1]).not.toContain('\n');
      }
      if (promptMatch) {
        expect(promptMatch[1]).not.toContain('"""');
      }
    }
  });

  it("does not generate MCP settings when features.mcp is false", async () => {
    const manifest = makeManifest({ mcpServers: ["github"], features: { mcp: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".gemini/settings.json");
    const parsed = JSON.parse(settings!.content);
    expect(parsed.mcpServers).toBeUndefined();
  });

  it("skips skills when features.skills is false", async () => {
    const manifest = makeManifest({ features: { skills: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".gemini/skills/"));
    expect(skills.length).toBe(0);
  });

  it("skips commands when features.commands is false", async () => {
    const manifest = makeManifest({ features: { commands: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const commands = outputs.filter((o) => o.path.startsWith(".gemini/commands/"));
    expect(commands.length).toBe(0);
  });

  it("filters companion command content from .gemini/commands/ output", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const commandPaths = outputs
      .filter((o) => o.path.startsWith(".gemini/commands/"))
      .map((o) => o.path);

    // Top-level primary command survives
    expect(commandPaths.some((p) => p.includes("test-command"))).toBe(true);
    // Sub-workflow file under commands/board/ is dropped
    expect(commandPaths.some((p) => p.includes("pickup-fake"))).toBe(false);
    // Top-level shared-context file is dropped by frontmatter-type check
    expect(commandPaths.some((p) => p.includes("fake-shared"))).toBe(false);
  });

  // ── Wave B4: rule precedence ordering ──
  describe("rule precedence ordering", () => {
    let precedenceDir: string;

    beforeAll(async () => {
      precedenceDir = await mkdtemp(join(tmpdir(), "hatch3r-gemini-precedence-"));
      await cp(FIXTURES_DIR, precedenceDir, { recursive: true });
      // Replace the default rules fixtures with 3 rules whose precedence
      // buckets (critical/normal/low) make sort order detectable from the
      // emitted content. Using distinct rule ids plus distinct body strings
      // lets the assertion check both id ordering and body ordering inside
      // the single inlined GEMINI.md file.
      const rulesDir = join(precedenceDir, "rules");
      await rm(rulesDir, { recursive: true, force: true });
      await mkdir(rulesDir, { recursive: true });
      await writeFile(
        join(rulesDir, "rule-low.md"),
        [
          "---",
          "id: rule-low",
          "type: rule",
          "description: low precedence rule",
          "scope: always",
          "precedence: low",
          "---",
          "# Rule Low",
          "",
          "LOW_PRECEDENCE_BODY_MARKER",
          "",
        ].join("\n"),
      );
      await writeFile(
        join(rulesDir, "rule-normal.md"),
        [
          "---",
          "id: rule-normal",
          "type: rule",
          "description: normal precedence rule",
          "scope: always",
          "precedence: normal",
          "---",
          "# Rule Normal",
          "",
          "NORMAL_PRECEDENCE_BODY_MARKER",
          "",
        ].join("\n"),
      );
      await writeFile(
        join(rulesDir, "rule-critical.md"),
        [
          "---",
          "id: rule-critical",
          "type: rule",
          "description: critical precedence rule",
          "scope: always",
          "precedence: critical",
          "---",
          "# Rule Critical",
          "",
          "CRITICAL_PRECEDENCE_BODY_MARKER",
          "",
        ].join("\n"),
      );
    });

    afterAll(async () => {
      await rm(precedenceDir, { recursive: true, force: true });
    });

    it("inlines rules into GEMINI.md in critical -> normal -> low precedence order", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(precedenceDir, manifest);

      const geminiMd = outputs.find((o) => o.path === "GEMINI.md");
      expect(geminiMd).toBeDefined();

      const criticalIdx = geminiMd!.content.indexOf("CRITICAL_PRECEDENCE_BODY_MARKER");
      const normalIdx = geminiMd!.content.indexOf("NORMAL_PRECEDENCE_BODY_MARKER");
      const lowIdx = geminiMd!.content.indexOf("LOW_PRECEDENCE_BODY_MARKER");

      expect(criticalIdx).toBeGreaterThan(-1);
      expect(normalIdx).toBeGreaterThan(-1);
      expect(lowIdx).toBeGreaterThan(-1);
      // Precedence sort places critical (rank 100) before normal (500) before
      // low (700), so the body markers must appear in that order inside the
      // single concatenated GEMINI.md output.
      expect(criticalIdx).toBeLessThan(normalIdx);
      expect(normalIdx).toBeLessThan(lowIdx);
    });
  });

  describe("extended MCP scenarios", () => {
    let extendedDir: string;

    beforeAll(async () => {
      extendedDir = await mkdtemp(join(tmpdir(), "hatch3r-gemini-mcp-"));
      await cp(FIXTURES_DIR, extendedDir, { recursive: true });
      await mkdir(join(extendedDir, "mcp"), { recursive: true });
      await writeFile(join(extendedDir, "mcp", "mcp.json"), JSON.stringify(EXTENDED_MCP, null, 2));
    });

    afterAll(async () => {
      await rm(extendedDir, { recursive: true, force: true });
    });

    it("generates command-based MCP server entries with env vars", async () => {
      const manifest = makeManifest({ mcpServers: ["github", "filesystem"] });
      const outputs = await adapter.generate(extendedDir, manifest);

      const settings = outputs.find((o) => o.path === ".gemini/settings.json")!;
      const parsed = JSON.parse(settings.content);
      expect(parsed.mcpServers.filesystem).toBeDefined();
      expect(parsed.mcpServers.filesystem.command).toBe("npx");
      expect(parsed.mcpServers.filesystem.args).toContain("-y");
      expect(parsed.mcpServers.filesystem.env).toBeDefined();
      expect(parsed.mcpServers.filesystem.env.MCP_FS_ROOT).toBe("/tmp");
    });

    it("skips _disabled MCP servers", async () => {
      const manifest = makeManifest({ mcpServers: ["github", "disabled-server"] });
      const outputs = await adapter.generate(extendedDir, manifest);

      const settings = outputs.find((o) => o.path === ".gemini/settings.json")!;
      const parsed = JSON.parse(settings.content);
      expect(parsed.mcpServers["disabled-server"]).toBeUndefined();
    });
  });
});
