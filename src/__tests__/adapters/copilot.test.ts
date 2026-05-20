import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { CopilotAdapter } from "../../adapters/copilot.js";
import { createManifest } from "../../manifest/hatchJson.js";
import type { HatchManifest } from "../../types.js";
import {
  MANAGED_BLOCK_START,
  MANAGED_BLOCK_END,
  MANAGED_BLOCK_START_YAML,
  MANAGED_BLOCK_END_YAML,
} from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");
// Wave 5: fixture user repo root so `.hatch3r/{type}/{id}.customize.yaml` resolves.
const FIXTURES_USER_REPO = dirname(FIXTURES_DIR);

describe("CopilotAdapter", () => {
  const adapter = new CopilotAdapter();

  function makeManifest(
    overrides: Partial<Parameters<typeof createManifest>[0]> & { models?: HatchManifest["models"] } = {},
  ): HatchManifest {
    const { models, ...createOpts } = overrides;
    const base = createManifest({
      tools: ["copilot"],
      mcpServers: ["github"],
      ...createOpts,
    });
    return models ? { ...base, models } : base;
  }

  it("has correct name", () => {
    expect(adapter.name).toBe("copilot");
  });

  it("generates copilot-instructions.md with managed blocks", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const instructions = outputs.find((o) => o.path === ".github/copilot-instructions.md");
    expect(instructions).toBeDefined();
    expect(instructions!.content).toContain(MANAGED_BLOCK_START);
    expect(instructions!.content).toContain(MANAGED_BLOCK_END);
    expect(instructions!.content).toContain("Hatch3r Project Instructions");
    expect(instructions!.content).toContain("Mandatory Behaviors");
    expect(instructions!.content).toContain("Agent Quick Reference");
    expect(instructions!.content).toContain("Hatch3r Rules");
    expect(instructions!.managedContent).toBeDefined();
  });

  it("includes always-scoped rules in copilot-instructions.md", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const instructions = outputs.find((o) => o.path === ".github/copilot-instructions.md");
    expect(instructions!.content).toContain("test-rule");
    expect(instructions!.content).toContain("A test rule for unit testing");
  });

  it("generates scoped .instructions.md files for glob-scoped rules", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const scopedInstructions = outputs.filter((o) =>
      o.path.startsWith(".github/instructions/"),
    );
    expect(scopedInstructions.length).toBe(1);

    const scoped = scopedInstructions[0]!;
    expect(scoped.path).toContain("hatch3r-scoped-rule");
    expect(scoped.path).toMatch(/\.instructions\.md$/);
    expect(scoped.content).toContain("applyTo:");
    expect(scoped.content).toContain("**/*.ts");
  });

  it("does not generate AGENTS.md (handled centrally by init/sync)", async () => {
    const manifest = makeManifest({ tools: ["copilot"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agentsMd = outputs.find((o) => o.path === "AGENTS.md");
    expect(agentsMd).toBeUndefined();
  });

  it("generates copilot-setup-steps.yml with YAML-syntax managed-block markers (issue #76)", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const setupSteps = outputs.find((o) => o.path === ".github/workflows/copilot-setup-steps.yml");
    expect(setupSteps).toBeDefined();
    // Issue #76: HTML markers inside a YAML file produced
    // "Invalid workflow file ... line 2" in GitHub Actions. The workflow
    // file must use YAML `#`-prefixed markers so the file parses as YAML.
    expect(setupSteps!.content).toContain(MANAGED_BLOCK_START_YAML);
    expect(setupSteps!.content).toContain(MANAGED_BLOCK_END_YAML);
    expect(setupSteps!.content).not.toContain(MANAGED_BLOCK_START);
    expect(setupSteps!.content).not.toContain(MANAGED_BLOCK_END);
    expect(setupSteps!.content).not.toContain("<!--");
    // The first non-comment line must be the YAML payload, not a marker.
    const firstLine = setupSteps!.content.split("\n", 1)[0];
    expect(firstLine).toBe(MANAGED_BLOCK_START_YAML);
    expect(setupSteps!.content).toContain("jobs:");
    expect(setupSteps!.content).toContain("npm install");
    expect(setupSteps!.content).toContain("npm run build");
    expect(setupSteps!.managedContent).toBeDefined();
  });

  it("generates prompt files from prompts and commands", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const prompts = outputs.filter((o) => o.path.startsWith(".github/prompts/"));
    expect(prompts.length).toBe(2);

    const promptFromPrompts = prompts.find((p) => p.path.includes("test-prompt"));
    expect(promptFromPrompts).toBeDefined();
    expect(promptFromPrompts!.path).toBe(".github/prompts/hatch3r-test-prompt.prompt.md");
    expect(promptFromPrompts!.content).toContain("test-prompt");
    expect(promptFromPrompts!.managedContent).toBeDefined();

    const commands = outputs.filter((o) => o.path.startsWith(".github/prompts/") && o.path.includes("test-command"));
    expect(commands.length).toBe(1);
    const promptFromCommands = commands[0];
    expect(promptFromCommands).toBeDefined();
    expect(promptFromCommands!.managedContent).toBeDefined();
  });

  it("generates agent files from agents and github-agents", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agentFiles = outputs.filter((o) => o.path.startsWith(".github/agents/"));
    expect(agentFiles.length).toBe(3);

    const regularAgent = agentFiles.find((a) => a.path.includes("test-agent"));
    expect(regularAgent).toBeDefined();
    expect(regularAgent!.content).toContain("name: test-agent");
    expect(regularAgent!.managedContent).toBeDefined();

    const ghAgentFiles = outputs.filter((o) => o.path.startsWith(".github/agents/") && o.path.includes("test-gh-agent"));
    expect(ghAgentFiles.length).toBe(1);
    const ghAgent = ghAgentFiles[0];
    expect(ghAgent).toBeDefined();
    expect(ghAgent!.content).toContain("test-gh-agent");
    expect(ghAgent!.managedContent).toBeDefined();
  });

  it("generates skill files in .github/skills/", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".github/skills/"));
    expect(skills.length).toBe(1);

    const skill = skills[0]!;
    expect(skill.path).toBe(".github/skills/hatch3r-test-skill/SKILL.md");
    expect(skill.content).toContain("name: test-skill");
    expect(skill.content).toContain("A test skill for unit testing");
    expect(skill.managedContent).toBeDefined();
  });

  it("skips skills when features.skills is false", async () => {
    const manifest = makeManifest({ features: { skills: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".github/skills/"));
    expect(skills.length).toBe(0);
  });

  it("generates .vscode/mcp.json when MCP is enabled with servers", async () => {
    const manifest = makeManifest({ mcpServers: ["github"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcp = outputs.find((o) => o.path === ".vscode/mcp.json");
    expect(mcp).toBeDefined();

    const parsed = JSON.parse(mcp!.content);
    expect(parsed.servers.github).toBeDefined();
  });

  it("uses env object (not envFile) on STDIO servers in .vscode/mcp.json", async () => {
    const manifest = makeManifest({ mcpServers: ["github", "brave-search", "context7"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcp = outputs.find((o) => o.path === ".vscode/mcp.json");
    expect(mcp).toBeDefined();

    const parsed = JSON.parse(mcp!.content);

    for (const [, server] of Object.entries(parsed.servers as Record<string, Record<string, unknown>>)) {
      // envFile is no longer used; env vars are passed via env object
      expect(server.envFile).toBeUndefined();
    }
  });

  it("does not generate MCP config when no servers configured", async () => {
    const manifest = makeManifest({ mcpServers: [] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcp = outputs.find((o) => o.path === ".vscode/mcp.json");
    expect(mcp).toBeUndefined();
  });

  it("skips rules when features.rules is false", async () => {
    const manifest = makeManifest({ features: { rules: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const instructions = outputs.find((o) => o.path === ".github/copilot-instructions.md");
    expect(instructions).toBeDefined();
    expect(instructions!.content).not.toContain("test-rule");

    const scopedInstructions = outputs.filter((o) =>
      o.path.startsWith(".github/instructions/"),
    );
    expect(scopedInstructions.length).toBe(0);
  });

  it("skips prompts when features.prompts and features.commands are false", async () => {
    const manifest = makeManifest({ features: { prompts: false, commands: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const prompts = outputs.filter((o) => o.path.startsWith(".github/prompts/"));
    expect(prompts.length).toBe(0);
  });

  it("skips agent files when features.agents and features.githubAgents are false", async () => {
    const manifest = makeManifest({ features: { agents: false, githubAgents: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agentFiles = outputs.filter((o) => o.path.startsWith(".github/agents/"));
    expect(agentFiles.length).toBe(0);
  });

  it("emits model from customization file when present", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest, FIXTURES_USER_REPO);

    const agentFile = outputs.find((o) => o.path === ".github/agents/hatch3r-test-agent.agent.md");
    expect(agentFile).toBeDefined();
    expect(agentFile!.content).toContain("model: claude-sonnet-4-6");
  });

  it("emits model in agent YAML frontmatter when configured via manifest", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-copilot-model-"));
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

      const agentFile = outputs.find((o) => o.path === ".github/agents/hatch3r-test-agent.agent.md");
      expect(agentFile).toBeDefined();
      expect(agentFile!.content).toContain("model: gpt-4");
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

  // C7.5-W2B2-H41 (D15, P6): per-adapter tools: allowlist emission.
  // Source: https://docs.github.com/en/copilot/reference/custom-agents-configuration
  describe("C7.5-W2B2-H41 Copilot tools: YAML array emission", () => {
    async function runWithAgent(agentId: string) {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-copilot-tools-"));
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

    it("emits tools: array for hatch3r-reviewer restricted to read/search", async () => {
      const outputs = await runWithAgent("reviewer");
      const file = outputs.find(
        (o) => o.path === ".github/agents/hatch3r-reviewer.agent.md",
      );
      expect(file).toBeDefined();
      const fmMatch = file!.content.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch).not.toBeNull();
      const fm = fmMatch![1];
      expect(fm).toMatch(/tools:\s*\[/);
      expect(fm).toContain('"read"');
      expect(fm).toContain('"search"');
      expect(fm).not.toContain('"edit"');
      expect(fm).not.toContain('"execute"');
    });

    it("emits edit and execute for hatch3r-implementer", async () => {
      const outputs = await runWithAgent("implementer");
      const file = outputs.find(
        (o) => o.path === ".github/agents/hatch3r-implementer.agent.md",
      );
      expect(file).toBeDefined();
      const fmMatch = file!.content.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch).not.toBeNull();
      const fm = fmMatch![1];
      expect(fm).toContain('"edit"');
      expect(fm).toContain('"execute"');
      expect(fm).toContain('"read"');
      expect(fm).toContain('"search"');
    });

    it("omits tools: for custom agents without a registered policy", async () => {
      const outputs = await runWithAgent("custom-agent");
      const file = outputs.find(
        (o) => o.path === ".github/agents/hatch3r-custom-agent.agent.md",
      );
      expect(file).toBeDefined();
      const fmMatch = file!.content.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch).not.toBeNull();
      expect(fmMatch![1]).not.toContain("tools:");
    });
  });

  // ── Wave 5 (CLI-tooling pivot, plan §4.6) ───────────────────────
  //
  // Copilot's skills surface is filtered by `manifest.cliTools.selected` via
  // `readCliFilteredSkills` on BaseAdapter. Output path:
  // `.github/skills/hatch3r-cli-{id}/SKILL.md`.
  describe("CLI tools filter (Wave 5 plan §4.6)", () => {
    it("emits only the selected CLI skills when cliTools is enabled", async () => {
      const manifest: HatchManifest = {
        ...makeManifest(),
        cliTools: { enabled: true, selected: ["ripgrep", "jq"] },
      };
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const cliSkills = outputs.filter((o) =>
        o.path.startsWith(".github/skills/hatch3r-cli-"),
      );
      const paths = cliSkills.map((o) => o.path);
      expect(paths).toContain(".github/skills/hatch3r-cli-ripgrep/SKILL.md");
      expect(paths).toContain(".github/skills/hatch3r-cli-jq/SKILL.md");
      expect(paths.some((p) => p.includes("hatch3r-cli-fd"))).toBe(false);
    });

    it("emits zero CLI skill files when cliTools.enabled is false", async () => {
      const manifest: HatchManifest = {
        ...makeManifest(),
        cliTools: { enabled: false, selected: ["ripgrep", "jq"] },
      };
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      expect(
        outputs.filter((o) => o.path.startsWith(".github/skills/hatch3r-cli-")),
      ).toEqual([]);
    });

    it("emits zero CLI skill files when cliTools.selected is empty", async () => {
      const manifest: HatchManifest = {
        ...makeManifest(),
        cliTools: { enabled: true, selected: [] },
      };
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      expect(
        outputs.filter((o) => o.path.startsWith(".github/skills/hatch3r-cli-")),
      ).toEqual([]);
    });
  });
});
