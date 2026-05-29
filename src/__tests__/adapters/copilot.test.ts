import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
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
    expect(setupSteps!.managedContent).toBeDefined();

    // C9-SA9.3-L2 (D9, P5): parse the workflow payload as YAML and assert
    // its root structure rather than substring-matching the serialized text.
    // A regression that wrapped the steps under an extra key (or dropped the
    // `copilot-setup-steps` job GitHub Actions requires) could still satisfy
    // the old `toContain("jobs:")` check; parsing catches it. The `yaml`
    // 2.x core schema keeps `on` as a string key (not the YAML-1.1 boolean
    // coercion), so the GitHub Actions trigger key survives the round-trip.
    const workflow = parseYaml(setupSteps!.managedContent!) as {
      name?: unknown;
      on?: unknown;
      jobs?: Record<string, { steps?: Array<{ run?: string }> }>;
    };
    expect(workflow.name).toBe("Copilot Setup Steps");
    expect(Object.prototype.hasOwnProperty.call(workflow, "on")).toBe(true);
    expect(workflow.jobs).toBeDefined();
    const setupJob = workflow.jobs!["copilot-setup-steps"];
    expect(setupJob).toBeDefined();
    // The build job must keep its install + build run-steps (package-manager
    // agnostic): assert a build-running step exists rather than substring the
    // serialized text against a hardcoded `npm` command.
    const runSteps = (setupJob!.steps ?? []).map((s) => s.run).filter(Boolean);
    expect(runSteps.some((cmd) => /\brun build\b/.test(cmd!))).toBe(true);
  });

  // D9-H-5 (D9, P4): the dead canonical `prompts/` read branch was removed —
  // hatch3r ships no `prompts/hatch3r-*.prompt.md` content, so the only
  // `.github/prompts/*.prompt.md` top-level entries come from canonical
  // commands (which Copilot surfaces in its native prompts-file picker). The
  // fixture's `prompts/test-prompt.md` is therefore NOT emitted.
  it("generates prompt files from commands only (no canonical prompts/ source)", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    // Top-level picker entries — companion subtrees (`.github/prompts/board/`,
    // `.github/prompts/revision/`) are emitted but excluded from this count.
    const prompts = outputs.filter((o) => /^\.github\/prompts\/[^/]+\.md$/.test(o.path));
    // Only the command-derived prompt file remains (1), not the fixture's
    // prompts-dir entry.
    expect(prompts.length).toBe(1);

    // The fixture's prompts/test-prompt.md must NOT surface — the read branch
    // is gone.
    const promptFromPrompts = prompts.find((p) => p.path.includes("test-prompt"));
    expect(promptFromPrompts).toBeUndefined();

    const commands = prompts.filter((p) => p.path.includes("test-command"));
    expect(commands.length).toBe(1);
    const promptFromCommands = commands[0];
    expect(promptFromCommands).toBeDefined();
    expect(promptFromCommands!.path).toBe(".github/prompts/hatch3r-test-command.prompt.md");
    expect(promptFromCommands!.managedContent).toBeDefined();
  });

  it("generates agent files from agents and github-agents", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    // Top-level picker entries — companion subtrees (`.github/agents/modes/`,
    // `.github/agents/shared/`) are emitted but excluded from this count.
    const agentFiles = outputs.filter((o) => /^\.github\/agents\/[^/]+\.(agent\.md|md)$/.test(o.path));
    expect(agentFiles.length).toBe(3);

    const regularAgent = agentFiles.find((a) => a.path.includes("test-agent"));
    expect(regularAgent).toBeDefined();
    expect(regularAgent!.content).toContain("name: test-agent");
    expect(regularAgent!.managedContent).toBeDefined();

    const ghAgentFiles = agentFiles.filter((a) => a.path.includes("test-gh-agent"));
    expect(ghAgentFiles.length).toBe(1);
    const ghAgent = ghAgentFiles[0];
    expect(ghAgent).toBeDefined();
    expect(ghAgent!.content).toContain("test-gh-agent");
    expect(ghAgent!.managedContent).toBeDefined();
  });

  it("emits companion subtree files under `.github/` so canonical references resolve", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const pathSet = new Set(outputs.map((o) => o.path));
    // Agents companion subtrees follow `.github/agents/{modes,shared}/`
    expect(pathSet.has(".github/agents/modes/fake-mode.md")).toBe(true);
    expect(pathSet.has(".github/agents/shared/fake-reference.md")).toBe(true);
    // Commands route to `.github/prompts/`, so command companions land beside the per-command prompt files
    expect(pathSet.has(".github/prompts/board/pickup-fake.md")).toBe(true);

    // Companion paths must not surface in the top-level agent/prompt pickers.
    const topLevelAgentPaths = outputs
      .filter((o) => /^\.github\/agents\/[^/]+\.md$/.test(o.path))
      .map((o) => o.path);
    const topLevelPromptPaths = outputs
      .filter((o) => /^\.github\/prompts\/[^/]+\.md$/.test(o.path))
      .map((o) => o.path);
    expect(topLevelAgentPaths.some((p) => p.includes("fake-mode"))).toBe(false);
    expect(topLevelPromptPaths.some((p) => p.includes("pickup-fake"))).toBe(false);
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

  // D9-C-2 (Cycle 10, Pillar P3): VS Code's MCP schema requires per-server
  // `type` discriminator. Verified against
  // https://code.visualstudio.com/docs/copilot/reference/mcp-configuration
  // (accessed 2026-05-27). Every emitted server entry must carry
  // `type: "stdio"` or `type: "http"`.
  it("emits per-server `type` discriminator on every entry (D9-C-2)", async () => {
    const manifest = makeManifest({ mcpServers: ["github", "brave-search", "context7"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcp = outputs.find((o) => o.path === ".vscode/mcp.json");
    expect(mcp).toBeDefined();

    const parsed = JSON.parse(mcp!.content);
    expect(Object.keys(parsed.servers).length).toBeGreaterThan(0);

    for (const [, server] of Object.entries(parsed.servers as Record<string, Record<string, unknown>>)) {
      // Every server entry MUST declare its connection type.
      expect(server.type).toBeDefined();
      expect(["stdio", "http"]).toContain(server.type);
      // STDIO entries carry `command`; HTTP entries carry `url`.
      if (server.type === "stdio") {
        expect(server.command).toBeDefined();
      } else if (server.type === "http") {
        expect(server.url).toBeDefined();
      }
    }
  });

  // D11-C-2 (Cycle 10, Pillar P6): STDIO MCP servers must route secrets
  // through VS Code's native envFile loader because the MCP loader does
  // NOT perform shell expansion — the prior `${env:VAR}` → `$VAR`
  // (shell) transform silently shipped each placeholder as a literal
  // string, breaking every secret-bearing STDIO MCP server. Verified
  // against https://code.visualstudio.com/docs/copilot/reference/mcp-configuration
  // (accessed 2026-05-27). `${workspaceFolder}/.env.mcp` matches the
  // existing `TOOL_SECRET_NOTES.copilot` UX promise that `.env.mcp` is
  // auto-loaded.
  it("emits envFile on STDIO servers and drops broken shell env object (D11-C-2)", async () => {
    const manifest = makeManifest({ mcpServers: ["github", "brave-search", "context7"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcp = outputs.find((o) => o.path === ".vscode/mcp.json");
    expect(mcp).toBeDefined();

    const parsed = JSON.parse(mcp!.content);

    for (const [, server] of Object.entries(parsed.servers as Record<string, Record<string, unknown>>)) {
      if (server.type === "stdio") {
        // STDIO secrets ride on `envFile` (VS Code-native), never the
        // broken `env` object filled with `$VAR` literals.
        expect(server.envFile).toBe("${workspaceFolder}/.env.mcp");
        expect(server.env).toBeUndefined();
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

  it("skips prompts when features.commands is false", async () => {
    const manifest = makeManifest({ features: { prompts: false, commands: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const prompts = outputs.filter((o) => o.path.startsWith(".github/prompts/"));
    expect(prompts.length).toBe(0);
  });

  // D9-H-5 (D9, P4): with the dead `prompts/` read branch removed, the
  // `features.prompts` flag no longer drives any Copilot output. Toggling it
  // alone (commands still enabled) must produce byte-identical output — this
  // is the inverse of the capability matrix's `prompts: false` declaration and
  // the reason the drift test passes.
  it("treats features.prompts as a no-op for Copilot output (D9-H-5)", async () => {
    const withPrompts = await adapter.generate(
      FIXTURES_DIR,
      makeManifest({ features: { prompts: true } }),
    );
    const withoutPrompts = await adapter.generate(
      FIXTURES_DIR,
      makeManifest({ features: { prompts: false } }),
    );
    const digest = (outs: { path: string; content: string }[]) =>
      [...outs]
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((o) => `${o.path}\n${o.content}`)
        .join("\n---\n");
    expect(digest(withPrompts)).toBe(digest(withoutPrompts));
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

  // ── D9-H-6 (D9, P1): Copilot skill `allowed-tools` pre-approval ─────────────
  //
  // Source: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-skills
  // (accessed 2026-05-26). A skill that declares `allowed_tools` in its
  // canonical frontmatter must emit an `allowed-tools:` YAML array line on
  // `.github/skills/<id>/SKILL.md` so the runtime pre-approves the wrapped
  // shell binaries and skips per-invocation confirmation.
  describe("D9-H-6 allowed-tools skill pre-approval", () => {
    /**
     * Stage a temp canonical root with a single CLI skill whose frontmatter
     * carries the supplied `allowed_tools` line (or no line when omitted), then
     * generate with that skill selected.
     */
    async function runWithCliSkill(
      skillId: string,
      allowedToolsLine: string | null,
    ): Promise<Awaited<ReturnType<typeof adapter.generate>>> {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-copilot-allowedtools-"));
      const skillDir = join(tempDir, "skills", skillId);
      await mkdir(skillDir, { recursive: true });
      const fm = [
        "---",
        `id: ${skillId}`,
        `description: ${skillId} fixture`,
        ...(allowedToolsLine ? [allowedToolsLine] : []),
        "---",
      ].join("\n");
      await writeFile(join(skillDir, "SKILL.md"), `${fm}\n# ${skillId}\n\nbody\n`, "utf-8");
      const manifest: HatchManifest = {
        ...makeManifest(),
        cliTools: { enabled: true, selected: [skillId.replace(/^hatch3r-cli-/, "")] },
      };
      try {
        return await adapter.generate(tempDir, manifest);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }

    it("emits allowed-tools: array when the skill declares allowed_tools", async () => {
      const outputs = await runWithCliSkill("hatch3r-cli-ripgrep", 'allowed_tools: ["rg"]');
      const skill = outputs.find(
        (o) => o.path === ".github/skills/hatch3r-cli-ripgrep/SKILL.md",
      );
      expect(skill).toBeDefined();
      const fmMatch = skill!.content.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch).not.toBeNull();
      const fm = fmMatch![1];
      expect(fm).toContain("name: hatch3r-cli-ripgrep");
      expect(fm).toMatch(/allowed-tools:\s*\["rg"\]/);
    });

    it("accepts the hyphen spelling allowed-tools in canonical frontmatter", async () => {
      const outputs = await runWithCliSkill("hatch3r-cli-jq", 'allowed-tools: ["jq"]');
      const skill = outputs.find(
        (o) => o.path === ".github/skills/hatch3r-cli-jq/SKILL.md",
      );
      expect(skill).toBeDefined();
      const fm = skill!.content.match(/^---\n([\s\S]*?)\n---/)![1];
      expect(fm).toMatch(/allowed-tools:\s*\["jq"\]/);
    });

    it("omits allowed-tools: when the skill declares none", async () => {
      const outputs = await runWithCliSkill("hatch3r-cli-fd", null);
      const skill = outputs.find(
        (o) => o.path === ".github/skills/hatch3r-cli-fd/SKILL.md",
      );
      expect(skill).toBeDefined();
      const fm = skill!.content.match(/^---\n([\s\S]*?)\n---/)![1];
      expect(fm).not.toContain("allowed-tools:");
    });

    it("emits a multi-entry allowed-tools array verbatim", async () => {
      const outputs = await runWithCliSkill(
        "hatch3r-cli-gh",
        'allowed_tools: ["gh", "git"]',
      );
      const skill = outputs.find(
        (o) => o.path === ".github/skills/hatch3r-cli-gh/SKILL.md",
      );
      const fm = skill!.content.match(/^---\n([\s\S]*?)\n---/)![1];
      expect(fm).toMatch(/allowed-tools:\s*\["gh", "git"\]/);
    });
  });

  // D3-M1 (Cycle 10 Wave-3 Medium rollover): adapters had no documented
  // error-path coverage. Pipeline timeouts surface as a pre-aborted
  // AbortSignal; `BaseAdapter.throwIfSignalAborted` is the documented
  // contract (see src/adapters/base.ts:321). Pin the contract here so any
  // future change that silently swallows the signal cannot regress.
  describe("error paths", () => {
    it("rejects with the abort reason when the signal is pre-aborted", async () => {
      const manifest = makeManifest();
      const controller = new AbortController();
      const reason = new Error("copilot: pipeline timeout exceeded");
      controller.abort(reason);
      await expect(
        adapter.generate(FIXTURES_DIR, manifest, FIXTURES_USER_REPO, "standard", controller.signal),
      ).rejects.toThrow("copilot: pipeline timeout exceeded");
    });
  });
});
