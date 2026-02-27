import { describe, it, expect } from "vitest";
import { CopilotAdapter } from "../../adapters/copilot.js";
import { createManifest } from "../../manifest/hatchJson.js";
import type { HatchManifest } from "../../types.js";
import { MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

describe("CopilotAdapter", () => {
  const adapter = new CopilotAdapter();

  function makeManifest(overrides: Partial<Parameters<typeof createManifest>[0]> = {}): HatchManifest {
    return createManifest({
      tools: ["copilot"],

      mcpServers: ["github"],
      ...overrides,
    });
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

  it("generates copilot-setup-steps.yml", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const setupSteps = outputs.find((o) => o.path === ".github/workflows/copilot-setup-steps.yml");
    expect(setupSteps).toBeDefined();
    expect(setupSteps!.content).toContain("jobs:");
    expect(setupSteps!.content).toContain("npm ci");
    expect(setupSteps!.content).toContain("npm run build");
  });

  it("generates prompt files from prompts and commands", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const prompts = outputs.filter((o) => o.path.startsWith(".github/prompts/"));
    expect(prompts.length).toBe(1);

    const promptFromPrompts = prompts.find((p) => p.path.includes("test-prompt"));
    expect(promptFromPrompts).toBeDefined();
    expect(promptFromPrompts!.path).toBe(".github/prompts/hatch3r-test-prompt.prompt.md");
    expect(promptFromPrompts!.content).toContain("test-prompt");
    expect(promptFromPrompts!.managedContent).toBeDefined();

    const commands = outputs.filter((o) => o.path.startsWith(".github/copilot/commands/"));
    expect(commands.length).toBe(1);
    const promptFromCommands = commands.find((p) => p.path.includes("test-command"));
    expect(promptFromCommands).toBeDefined();
    expect(promptFromCommands!.managedContent).toBeDefined();
  });

  it("generates agent files from agents and github-agents", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agentFiles = outputs.filter((o) => o.path.startsWith(".github/agents/"));
    expect(agentFiles.length).toBe(1);

    const regularAgent = agentFiles.find((a) => a.path.includes("test-agent"));
    expect(regularAgent).toBeDefined();
    expect(regularAgent!.content).toContain("name: test-agent");
    expect(regularAgent!.managedContent).toBeDefined();

    const ghAgentFiles = outputs.filter((o) => o.path.startsWith(".github/copilot/agents/"));
    expect(ghAgentFiles.length).toBe(1);
    const ghAgent = ghAgentFiles.find((a) => a.path.includes("test-gh-agent"));
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
    expect(parsed.mcpServers.github).toBeDefined();
  });

  it("injects envFile on STDIO servers in .vscode/mcp.json", async () => {
    const manifest = makeManifest({ mcpServers: ["github", "brave-search", "context7"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcp = outputs.find((o) => o.path === ".vscode/mcp.json");
    expect(mcp).toBeDefined();

    const parsed = JSON.parse(mcp!.content);

    for (const [, server] of Object.entries(parsed.mcpServers as Record<string, Record<string, unknown>>)) {
      if (server.command) {
        expect(server.envFile).toBe("${workspaceFolder}/.env.mcp");
      } else {
        expect(server.envFile).toBeUndefined();
      }
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

  it("all outputs have action 'create'", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.action).toBe("create");
    }
  });
});
