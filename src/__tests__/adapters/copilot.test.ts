import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { CopilotAdapter } from "../../adapters/copilot.js";
import { createManifest } from "../../manifest/hatchJson.js";
import type { CopilotMcpSandboxConfig, HatchManifest } from "../../types.js";
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
    const { models, features, ...createOpts } = overrides;
    const base = createManifest({
      tools: ["copilot"],
      mcpServers: ["github"],
      // W3-mcp-optin: DEFAULT_FEATURES.mcp is now false (opt-in). This fixture
      // seeds mcpServers, so pin the feature on to keep exercising the MCP
      // emission paths; per-test feature overrides still win via the merge.
      features: { mcp: true, ...features },
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
    // D9-6 (P2): exact-value `applyTo`, not a value-blind `.toContain("applyTo:")`.
    // The legacy inline-CSV fixture `scope: "**/*.ts"` renders to a single-glob
    // CSV string. A value-blind substring passed even when the X4/CD4 GLOBS-DROP
    // bug emitted `applyTo: "conditional"`; pinning the rendered line closes it.
    expect(scoped.content).toContain('applyTo: "**/*.ts"');
    // Regression sentinel: the scope keyword must never leak into `applyTo`.
    // Target the exact bug signature (the X4/CD4 GLOBS-DROP form) rather than a
    // bare "conditional" substring, which a rule body could legitimately contain.
    expect(scoped.content).not.toContain('applyTo: "conditional"');
  });

  // D9-6 (P2): second scoped fixture in the canonical `scope: conditional` +
  // `globs:` two-line form (distinct from the legacy inline-CSV `scoped-rule.md`
  // fixture). Exercises the `resolveRuleGlobs` `scope === "conditional"` branch
  // the X4/CD4 GLOBS-DROP regression broke, which emitted `applyTo: "conditional"`
  // and silently never auto-attached the rule. VS Code `applyTo` is a single
  // comma-separated glob string per
  // https://code.visualstudio.com/docs/agent-customization/custom-instructions — pins the
  // exact rendered value and asserts the scope keyword never leaks. Isolated
  // temp dir keeps the shared `FIXTURES_DIR` scoped-count assertion untouched.
  it("emits the real conditional glob set in applyTo, never the scope keyword", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-copilot-conditional-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "rules"), { recursive: true });
      await writeFile(
        join(agentsDir, "rules", "conditional-rule.md"),
        `---
id: conditional-rule
type: rule
description: A conditional-scoped rule
scope: conditional
globs: "src/api/**,**/*.proto"
---
# Conditional Rule

Applies to API code and protobufs.`,
        "utf-8",
      );
      const outputs = await adapter.generate(agentsDir, makeManifest());

      const scoped = outputs.find((o) =>
        o.path.startsWith(".github/instructions/") && o.path.includes("conditional-rule"),
      );
      expect(scoped).toBeDefined();
      expect(scoped!.content).toContain('applyTo: "src/api/**, **/*.proto"');
      // The fixture body contains "conditional" (heading/id), so assert the
      // exact bug-signature frontmatter line rather than a bare substring.
      expect(scoped!.content).not.toContain('applyTo: "conditional"');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
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
    // Slash-command picker fix: the per-command prompt opens with YAML
    // frontmatter so the picker reads `description:`, not the HATCH3R:BEGIN
    // managed-block marker.
    expect(promptFromCommands!.content.startsWith("---")).toBe(true);
    expect(promptFromCommands!.content.startsWith(MANAGED_BLOCK_START)).toBe(false);
    expect(promptFromCommands!.content).toContain("description:");
    expect(promptFromCommands!.content).toContain("A test command for unit testing");
  });

  it("double-quotes command descriptions so `: `, `--`, and quotes never break the picker's YAML", async () => {
    // Real command descriptions carry `: ` and `--` (e.g. "from the project
    // board: dependency-aware selection") that make an UNQUOTED YAML plain
    // scalar ambiguous/invalid — which is what made the picker fall back to
    // showing the HATCH3R:BEGIN marker. Pin that the emitted frontmatter is a
    // double-quoted scalar that round-trips through a real YAML parser.
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-copilot-cmd-fm-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "commands"), { recursive: true });
      const nastyDesc =
        'Design a new capability -- draft user stories: acceptance criteria, "data model", and API surface';
      // Leading `[` would parse as a YAML flow sequence if emitted unquoted, so
      // the argument-hint exercises the same quoting path (D5-33 affordance).
      const nastyHint = "[target] | <id> -- mode: fast";
      await writeFile(
        join(agentsDir, "commands", "nasty-command.md"),
        `---\nid: nasty-command\ntype: command\ndescription: ${JSON.stringify(nastyDesc)}\nargument-hint: ${JSON.stringify(nastyHint)}\n---\n# Nasty Command\n\nBody.`,
        "utf-8",
      );
      const outputs = await adapter.generate(agentsDir, makeManifest());

      const cmd = outputs.find(
        (o) => o.path === ".github/prompts/hatch3r-nasty-command.prompt.md",
      );
      expect(cmd).toBeDefined();
      expect(cmd!.content.startsWith("---")).toBe(true);

      // The emitted frontmatter parses as YAML and round-trips the exact
      // description and argument-hint; an unquoted plain scalar would have
      // thrown or truncated at the first `: ` / `[`.
      const fmMatch = cmd!.content.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch).not.toBeNull();
      const parsed = parseYaml(fmMatch![1]) as {
        name?: string;
        description?: string;
        "argument-hint"?: string;
      };
      expect(parsed.name).toBe("nasty-command");
      expect(parsed.description).toBe(nastyDesc);
      expect(parsed.description).not.toContain("HATCH3R:BEGIN");
      // argument-hint survives at byte 0 so the picker affordance works (D5-33).
      expect(parsed["argument-hint"]).toBe(nastyHint);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("generates regular agent files from the agents path", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    // Top-level picker entries — companion subtrees (`.github/agents/modes/`,
    // `.github/agents/shared/`) are emitted but excluded from this count.
    const agentFiles = outputs.filter((o) => /^\.github\/agents\/[^/]+\.(agent\.md|md)$/.test(o.path));

    const regularAgent = agentFiles.find((a) => a.path.includes("test-agent"));
    expect(regularAgent).toBeDefined();
    expect(regularAgent!.content).toContain("name: test-agent");
    expect(regularAgent!.managedContent).toBeDefined();
  });

  // D5-41 (Cycle 11 Wave 3, D5, P4 / D16.3 add-vs-remove bias): github-agents
  // (`type: github-agent`) are simplified twins of regular agents and emit to
  // the SAME `.github/agents/` picker. When the full regular-agent path is
  // active (`features.agents = true`, the default) the weaker github-agent twin
  // is suppressed so the picker carries only the stronger regular variant — no
  // duplicate (`hatch3r-security` + `hatch3r-security-agent`) pairs.
  it("suppresses github-agent picker entries when the regular-agent path is active (D5-41)", async () => {
    const manifest = makeManifest(); // features.agents = true, githubAgents = true
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const ghAgent = outputs.find(
      (o) =>
        /^\.github\/agents\/[^/]+\.agent\.md$/.test(o.path) && o.path.includes("test-gh-agent"),
    );
    expect(ghAgent).toBeUndefined();
    // The regular-agent path is unaffected — it still populates the picker.
    const regularAgent = outputs.find((o) => o.path === ".github/agents/hatch3r-test-agent.agent.md");
    expect(regularAgent).toBeDefined();
  });

  // D5-41: github-agents are NOT removed — they remain the sole agent surface
  // when the regular-agent path is off (the Copilot-cloud-only / pack case).
  it("emits github-agent picker entries when the regular-agent path is off (D5-41)", async () => {
    const manifest = makeManifest({ features: { agents: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const ghAgentFiles = outputs.filter(
      (o) =>
        /^\.github\/agents\/[^/]+\.agent\.md$/.test(o.path) && o.path.includes("test-gh-agent"),
    );
    expect(ghAgentFiles.length).toBe(1);
    expect(ghAgentFiles[0]!.content).toContain("test-gh-agent");
    expect(ghAgentFiles[0]!.managedContent).toBeDefined();
    // The regular agent is gone (features.agents = false); only the twin ships.
    const regularAgent = outputs.find((o) => o.path === ".github/agents/test-agent.agent.md");
    expect(regularAgent).toBeUndefined();
  });

  // D9-5 (Cycle 11 D9, P3) + D5-39 (Cycle 11 Wave 3, D5, P6): the github-agent
  // frontmatter must stay at byte 0 so GitHub Copilot's
  // `.github/agents/*.agent.md` loader parses it — AND it must be NORMALIZED to
  // Copilot-recognized fields. D9-5 fixed the byte-0 placement (the prior
  // emission wrapped the whole `rawContent`, demoting frontmatter into the
  // body); D5-39 then re-serialized the fence to drop fields Copilot ignores
  // (`id`/`type`/`tags`/`quality_charter`/`efficiency_patterns`/`cache_friendly`)
  // and add the previously-missing `tools:` allowlist.
  it("emits NORMALIZED github-agent frontmatter at byte 0, body wrapped in the managed block (D9-5 + D5-39)", async () => {
    // D5-41: github-agents only emit when the regular-agent path is off.
    const manifest = makeManifest({ features: { agents: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const ghAgent = outputs.find(
      (o) =>
        /^\.github\/agents\/[^/]+\.agent\.md$/.test(o.path) &&
        o.path.includes("test-gh-agent"),
    );
    expect(ghAgent).toBeDefined();

    // Frontmatter fence opens on byte 0 — not the managed-block marker.
    expect(ghAgent!.content.startsWith("---")).toBe(true);
    expect(ghAgent!.content.startsWith(MANAGED_BLOCK_START)).toBe(false);

    // The frontmatter block precedes the managed block; the body (not the
    // YAML) is what gets wrapped.
    const fmEnd = ghAgent!.content.indexOf("\n---", 3);
    const markerStart = ghAgent!.content.indexOf(MANAGED_BLOCK_START);
    expect(fmEnd).toBeGreaterThan(0);
    expect(markerStart).toBeGreaterThan(fmEnd);
    expect(ghAgent!.content).toContain(MANAGED_BLOCK_END);

    // D5-39: the normalized frontmatter carries Copilot-recognized fields only.
    const frontmatter = ghAgent!.content.slice(0, markerStart);
    expect(frontmatter).toContain("name: test-gh-agent");
    expect(frontmatter).toContain("description: A test GitHub agent");
    // Default read-only allowlist (the fixture id is not in the role map).
    expect(frontmatter).toContain('tools: ["read", "search"]');
    // Unrecognized canonical fields are NOT shipped to Copilot.
    expect(frontmatter).not.toContain("id: test-gh-agent");
    expect(frontmatter).not.toContain("type: github-agent");
    expect(frontmatter).not.toContain(MANAGED_BLOCK_START);
    // managedContent is the body only (frontmatter stripped), matching the
    // regular-agent path's third `output()` arg.
    expect(ghAgent!.managedContent).not.toContain("type: github-agent");
    expect(ghAgent!.managedContent).toContain("Test GitHub Agent");
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
  // https://code.visualstudio.com/docs/agents/reference/mcp-configuration
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
  // against https://code.visualstudio.com/docs/agents/reference/mcp-configuration
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

  // D10-32 (Cycle 11 Wave 3, D10, P6/CQ4): a VS-Code-unexpandable bare
  // `$`-prefixed secret (e.g. `Bearer $GITHUB_PAT`) must never reach a header
  // value in `.vscode/mcp.json` — VS Code does not shell-expand `$VAR` in
  // header values, so it would authenticate with the literal string. The
  // adapter rewrites `${env:NAME}` to a VS Code `${input:NAME}` reference and
  // declares a matching top-level `inputs[]` entry. This regression test
  // asserts no bare `$`-prefixed token survives in any header value.
  it("rejects bare `$`-prefixed secrets in HTTP-transport headers, emits ${input:NAME} (D10-32)", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-copilot-mcp-hdr-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "mcp"), { recursive: true });
      await writeFile(
        join(agentsDir, "mcp", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            github: {
              _trust_bypass: true,
              url: "https://api.githubcopilot.com/mcp/",
              headers: {
                Authorization: "Bearer ${env:GITHUB_PAT}",
                "X-Static": "literal-value",
              },
            },
          },
        }),
        "utf-8",
      );
      const manifest = makeManifest({ mcpServers: ["github"] });
      const outputs = await adapter.generate(agentsDir, manifest);

      const mcp = outputs.find((o) => o.path === ".vscode/mcp.json");
      expect(mcp).toBeDefined();
      const parsed = JSON.parse(mcp!.content);

      const auth = parsed.servers.github.headers.Authorization as string;
      // The secret rides as a VS Code input reference, not a bare `$VAR`.
      expect(auth).toBe("Bearer ${input:GITHUB_PAT}");
      // No bare `$`-prefixed token (e.g. `$GITHUB_PAT`) anywhere in the file.
      // `${input:...}` / `${workspaceFolder}` use `${` and are not bare.
      expect(/(?<!\{)\$[A-Za-z_]/.test(mcp!.content)).toBe(false);
      // Static (non-secret) headers pass through unchanged.
      expect(parsed.servers.github.headers["X-Static"]).toBe("literal-value");
      // A matching top-level input variable is declared.
      const inputs = parsed.inputs as Array<Record<string, unknown>>;
      expect(inputs.some((i) => i.id === "GITHUB_PAT" && i.password === true)).toBe(true);

      // D15-28 (Cycle 11 Wave 3, D15, P6, SA15.5-F7): the Silent Failure
      // Contract requires an adapter warning when a secret-bearing HTTP header
      // is generated for Copilot — VS Code prompts for `${input:...}` at first
      // use rather than reading `.env.mcp`, so the operator must be told the
      // header is NOT resolved transparently like a STDIO env-file secret.
      const hdrWarning = adapter.warnings.find(
        (w) => w.includes("HTTP header secret") && w.includes("GITHUB_PAT"),
      );
      expect(hdrWarning).toBeDefined();
      expect(hdrWarning).toContain("does NOT expand");
      expect(hdrWarning).toContain(".env.mcp");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // D15-28 (Cycle 11 Wave 3, D15, P6): the inverse — an HTTP MCP server with NO
  // secret-bearing header generates NO `inputs[]` and therefore NO warning, so
  // the Silent Failure Contract warning fires only on the actual secret-header
  // case (no false-positive noise for static-header or env-file-secret servers).
  it("emits no HTTP-header-secret warning when no header carries a secret (D15-28)", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-copilot-mcp-nosecret-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "mcp"), { recursive: true });
      await writeFile(
        join(agentsDir, "mcp", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            github: {
              _trust_bypass: true,
              url: "https://api.githubcopilot.com/mcp/",
              headers: { "X-Static": "literal-value" },
            },
          },
        }),
        "utf-8",
      );
      const manifest = makeManifest({ mcpServers: ["github"] });
      const outputs = await adapter.generate(agentsDir, manifest);

      const mcp = outputs.find((o) => o.path === ".vscode/mcp.json");
      expect(mcp).toBeDefined();
      const parsed = JSON.parse(mcp!.content);
      // No inputs[] without a secret header.
      expect(parsed.inputs).toBeUndefined();
      // And no D15-28 warning.
      expect(adapter.warnings.some((w) => w.includes("HTTP header secret"))).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
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

  // D9-SA9.3-01 (Cycle 12, D9, P3): GitHub caps a custom-agent prompt (the
  // Markdown below the YAML frontmatter) at 30,000 characters. An over-cap
  // prompt is truncated or rejected with no signal, so the adapter emits an
  // audit-visible warning naming the agent, its measured size, and the cap
  // (Silent Failure Contract). The canonical-body trim that brings the four
  // over-cap production agents back under the cap routes through the content
  // lifecycle; this suite pins the adapter-side guard behavior.
  describe("agent prompt-size cap (D9-SA9.3-01)", () => {
    it("warns when an emitted .agent.md prompt exceeds the 30,000-char cap", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-copilot-cap-"));
      try {
        const agentsDir = join(tempDir, "agents");
        await mkdir(join(agentsDir, "agents"), { recursive: true });
        // ~34k chars of body → the below-frontmatter (managed-wrapped) prompt
        // clears the 30,000-char cap.
        const oversizedBody = "Oversized agent instruction body. ".repeat(1000);
        await writeFile(
          join(agentsDir, "agents", "big-agent.md"),
          `---\nid: big-agent\ntype: agent\ndescription: A deliberately oversized agent for the cap guard\n---\n# Big Agent\n\n${oversizedBody}`,
          "utf-8",
        );
        const outputs = await adapter.generate(agentsDir, makeManifest());

        const emitted = outputs.find((o) => o.path === ".github/agents/hatch3r-big-agent.agent.md");
        expect(emitted).toBeDefined();
        const capWarning = adapter.warnings.find(
          (w) => w.includes("hatch3r-big-agent.agent.md") && w.includes("30000"),
        );
        expect(capWarning).toBeDefined();
        expect(capWarning).toContain("custom-agent limit");
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("does not warn for an under-cap agent", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-copilot-cap-ok-"));
      try {
        const agentsDir = join(tempDir, "agents");
        await mkdir(join(agentsDir, "agents"), { recursive: true });
        await writeFile(
          join(agentsDir, "agents", "small-agent.md"),
          `---\nid: small-agent\ntype: agent\ndescription: A small agent\n---\n# Small Agent\n\nYou are a small agent.`,
          "utf-8",
        );
        const outputs = await adapter.generate(agentsDir, makeManifest());

        expect(
          outputs.find((o) => o.path === ".github/agents/hatch3r-small-agent.agent.md"),
        ).toBeDefined();
        expect(adapter.warnings.some((w) => w.includes("custom-agent limit"))).toBe(false);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  // D9-16 (Cycle 11 Wave 3, D9, P3/P5): the hatch3r-internal capacity tiers
  // `standard`/`fast` are not Copilot picker names — Copilot silently falls back
  // to its default and the emitted `model:` is a dead field. The adapter omits
  // `model:` for these tier words and keeps it only for a Copilot-recognizable
  // value (provider-dated ID or `(copilot)` display name).
  it("omits model: for the hatch3r tier words standard/fast (D9-16)", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-copilot-model-tier-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      for (const [slug, tier] of [["std-agent", "standard"], ["fast-agent", "fast"]]) {
        await writeFile(
          join(agentsDir, "agents", `${slug}.md`),
          `---\nid: ${slug}\ntype: agent\ndescription: A ${tier}-tier agent\nmodel: ${tier}\n---\n# ${slug}\n\nYou are a ${tier}-tier agent.`,
          "utf-8",
        );
      }
      const manifest = makeManifest();
      const outputs = await adapter.generate(agentsDir, manifest);

      const agentFiles = outputs.filter((o) => /^\.github\/agents\/[^/]+\.agent\.md$/.test(o.path));
      expect(agentFiles.length).toBeGreaterThanOrEqual(2);
      // The finding's required assertion: NO emitted .agent.md carries the tier
      // word as a `model:` value.
      for (const f of agentFiles) {
        const fm = f.content.slice(0, f.content.indexOf(MANAGED_BLOCK_START));
        expect(fm).not.toMatch(/^model:\s*(standard|fast)\s*$/m);
      }
      const std = agentFiles.find((o) => o.path.includes("std-agent"));
      expect(std!.content.slice(0, std!.content.indexOf(MANAGED_BLOCK_START))).not.toContain("model:");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps model: for a Copilot-recognizable provider-dated value (D9-16)", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-copilot-model-ok-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await writeFile(
        join(agentsDir, "agents", "ok-agent.md"),
        `---\nid: ok-agent\ntype: agent\ndescription: A pinned-model agent\nmodel: claude-sonnet-4-6\n---\n# ok-agent\n\nYou are a pinned-model agent.`,
        "utf-8",
      );
      const outputs = await adapter.generate(agentsDir, makeManifest());
      const agentFile = outputs.find((o) => o.path === ".github/agents/hatch3r-ok-agent.agent.md");
      expect(agentFile).toBeDefined();
      const fm = agentFile!.content.slice(0, agentFile!.content.indexOf(MANAGED_BLOCK_START));
      expect(fm).toContain("model: claude-sonnet-4-6");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // D9-SA9.3-06 (Cycle 12, D9, P1/P5): the D9-16 recognizable-value gate omits any
  // model outside the four provider prefixes — including valid non-prefix Copilot
  // picker models (Microsoft MAI-Code-1-Flash, Moonshot Kimi-K2.7-Code, etc., per
  // docs.github.com/en/copilot/reference/ai-models/supported-models, accessed
  // 2026-07-12). A user-configured such model was dropped with no signal; the
  // adapter now emits an audit-visible warning (Silent Failure Contract) while still
  // omitting the field (safe fallback preserved) and staying quiet on the intended
  // hatch3r tier-word omissions.
  describe("unrecognized configured-model warning (D9-SA9.3-06)", () => {
    it("warns and omits model: when a configured model is not Copilot-recognizable", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-copilot-model-drop-"));
      try {
        const agentsDir = join(tempDir, "agents");
        await mkdir(join(agentsDir, "agents"), { recursive: true });
        await writeFile(
          join(agentsDir, "agents", "drop-agent.md"),
          `---\nid: drop-agent\ntype: agent\ndescription: An agent pinned to a non-prefix Copilot model\n---\n# drop-agent\n\nYou are a test agent.`,
          "utf-8",
        );
        // A real current Copilot picker model (Microsoft) matching none of the four
        // provider prefixes, so the D9-16 gate drops it.
        const manifest = makeManifest({ models: { agents: { "drop-agent": "MAI-Code-1-Flash" } } });
        const outputs = await adapter.generate(agentsDir, manifest);

        const agentFile = outputs.find((o) => o.path === ".github/agents/hatch3r-drop-agent.agent.md");
        expect(agentFile).toBeDefined();
        // Safe fallback preserved: no dead model: field is shipped.
        const fm = agentFile!.content.slice(0, agentFile!.content.indexOf(MANAGED_BLOCK_START));
        expect(fm).not.toContain("model:");
        // But the drop is now audit-visible, naming the agent and the dropped value.
        const dropWarning = adapter.warnings.find(
          (w) => w.includes("hatch3r-drop-agent.agent.md") && w.includes("MAI-Code-1-Flash"),
        );
        expect(dropWarning).toBeDefined();
        expect(dropWarning).toContain("picker default");
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("does not warn for the intended hatch3r tier-word omissions (standard/fast)", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-copilot-model-tierquiet-"));
      try {
        const agentsDir = join(tempDir, "agents");
        await mkdir(join(agentsDir, "agents"), { recursive: true });
        for (const [slug, tier] of [["std-agent", "standard"], ["fast-agent", "fast"]]) {
          await writeFile(
            join(agentsDir, "agents", `${slug}.md`),
            `---\nid: ${slug}\ntype: agent\ndescription: A ${tier}-tier agent\nmodel: ${tier}\n---\n# ${slug}\n\nYou are a ${tier}-tier agent.`,
            "utf-8",
          );
        }
        const outputs = await adapter.generate(agentsDir, makeManifest());
        expect(
          outputs.filter((o) => /^\.github\/agents\/[^/]+\.agent\.md$/.test(o.path)).length,
        ).toBeGreaterThanOrEqual(2);
        // The tier words are hatch3r-internal placeholders, not user model choices —
        // no drop warning, or the shipped agent corpus would warn on every sync.
        expect(adapter.warnings.some((w) => w.includes("not a Copilot-recognizable"))).toBe(false);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  // release/2.2.0: commands→prompts model emission. Copilot documents a
  // string-form `model:` field on `.github/prompts/*.prompt.md` (no `inherit`
  // keyword — unset is expressed by omitting the field), gated to
  // Copilot-recognizable values per D9-16. Copilot SKILL.md model support is
  // unverified, so `.github/skills/**` never gains a model line even when
  // `models.skills` is configured.
  describe("prompt/skill model: frontmatter (release/2.2.0)", () => {
    async function setupCanonical(tempDir: string): Promise<string> {
      const canonicalRoot = join(tempDir, "agents");
      await mkdir(join(canonicalRoot, "skills", "my-skill"), { recursive: true });
      await writeFile(
        join(canonicalRoot, "skills", "my-skill", "SKILL.md"),
        `---\nname: my-skill\ndescription: A model-matrix test skill\n---\n# My Skill\n\nDo skill things.`,
        "utf-8",
      );
      await mkdir(join(canonicalRoot, "commands"), { recursive: true });
      await writeFile(
        join(canonicalRoot, "commands", "my-command.md"),
        `---\nid: my-command\ntype: command\ndescription: A model-matrix test command\n---\n# My Command\n\nDo command things.`,
        "utf-8",
      );
      return canonicalRoot;
    }

    it("emits model: on the generated .prompt.md for a Copilot-recognizable models.commands value", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-copilot-prompt-model-"));
      try {
        const canonicalRoot = await setupCanonical(tempDir);
        const manifest = makeManifest({ models: { commands: { "my-command": "gemini-flash" } } });
        const outputs = await adapter.generate(canonicalRoot, manifest);
        const prompt = outputs.find((o) => o.path === ".github/prompts/hatch3r-my-command.prompt.md");
        expect(prompt).toBeDefined();
        const fm = prompt!.content.slice(0, prompt!.content.indexOf(MANAGED_BLOCK_START));
        // Alias-expanded, single string scalar (the only form the Copilot CLI
        // accepts — github/copilot-cli#2133 rejects the array form).
        expect(fm).toMatch(/^model: gemini-3-flash$/m);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("omits model: on .prompt.md when unset and when the value is not Copilot-recognizable", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-copilot-prompt-model-gate-"));
      try {
        const canonicalRoot = await setupCanonical(tempDir);
        // Unset (models.default is agents-only and must not leak here).
        const unset = await adapter.generate(canonicalRoot, makeManifest({ models: { default: "opus" } }));
        const unsetPrompt = unset.find((o) => o.path === ".github/prompts/hatch3r-my-command.prompt.md");
        expect(unsetPrompt!.content.slice(0, unsetPrompt!.content.indexOf(MANAGED_BLOCK_START))).not.toContain("model:");
        // Unrecognizable tier word → omitted (D9-16 gate).
        const tier = await adapter.generate(canonicalRoot, makeManifest({ models: { commands: { "my-command": "fast" } } }));
        const tierPrompt = tier.find((o) => o.path === ".github/prompts/hatch3r-my-command.prompt.md");
        expect(tierPrompt!.content.slice(0, tierPrompt!.content.indexOf(MANAGED_BLOCK_START))).not.toContain("model:");
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("never emits model: into .github/skills/** even when models.skills is configured (unverified surface)", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-copilot-skill-model-"));
      try {
        const canonicalRoot = await setupCanonical(tempDir);
        const manifest = makeManifest({ models: { skills: { "my-skill": "claude-sonnet-4-6" } } });
        const outputs = await adapter.generate(canonicalRoot, manifest);
        const skill = outputs.find((o) => o.path === ".github/skills/hatch3r-my-skill/SKILL.md");
        expect(skill).toBeDefined();
        const fm = skill!.content.slice(0, skill!.content.indexOf(MANAGED_BLOCK_START));
        expect(fm).not.toContain("model:");
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  // D5-39 (Cycle 11 Wave 3, D5, P6): github-agents carry a per-role `tools:`
  // allowlist (they had none before — the security/lint cloud agents inherited
  // every tool). The role map keys on the emitted prefixed id; an unlisted
  // github-agent gets the read-only baseline.
  it("emits a per-role tools: allowlist on github-agents (D5-39)", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-copilot-gh-tools-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "github-agents"), { recursive: true });
      // Use the canonical prefixed ids so the role map matches after toPrefixedId.
      await writeFile(
        join(agentsDir, "github-agents", "hatch3r-security-agent.md"),
        `---\nname: hatch3r-security-agent\ntype: github-agent\ndescription: Security analyst\n---\nYou audit code.`,
        "utf-8",
      );
      await writeFile(
        join(agentsDir, "github-agents", "hatch3r-lint-agent.md"),
        `---\nname: hatch3r-lint-agent\ntype: github-agent\ndescription: Lint fixer\n---\nYou fix style.`,
        "utf-8",
      );
      // D5-41: github-agents only emit when the regular-agent path is off.
      const outputs = await adapter.generate(agentsDir, makeManifest({ features: { agents: false } }));

      const sec = outputs.find((o) => o.path === ".github/agents/hatch3r-security-agent.agent.md");
      expect(sec).toBeDefined();
      const secFm = sec!.content.slice(0, sec!.content.indexOf(MANAGED_BLOCK_START));
      // Read-only audit role.
      expect(secFm).toContain('tools: ["read", "search"]');
      expect(secFm).not.toContain('"edit"');
      expect(secFm).not.toContain('"execute"');

      const lint = outputs.find((o) => o.path === ".github/agents/hatch3r-lint-agent.agent.md");
      expect(lint).toBeDefined();
      const lintFm = lint!.content.slice(0, lint!.content.indexOf(MANAGED_BLOCK_START));
      // Lint fixer writes + runs linters.
      expect(lintFm).toContain('"read"');
      expect(lintFm).toContain('"edit"');
      expect(lintFm).toContain('"execute"');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // D5-29 (Cycle 11 Wave 3, D5, P6): a glob-scoped rule that declares
  // `copilot_exclude_agent:` renders an `excludeAgent:` line on its
  // `.instructions.md` so the named Copilot agent skips the path scope; a rule
  // without the field emits no such line (default = every agent uses the file).
  it("renders excludeAgent: on a scoped instruction file when copilot_exclude_agent is set (D5-29)", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-copilot-exclude-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "rules"), { recursive: true });
      await writeFile(
        join(agentsDir, "rules", "excluded-rule.md"),
        `---\nid: excluded-rule\ntype: rule\ndescription: A code-review-excluded rule\nscope: conditional\nglobs: "**/*.ts"\ncopilot_exclude_agent: "code-review"\n---\nThis rule scopes to TypeScript.`,
        "utf-8",
      );
      await writeFile(
        join(agentsDir, "rules", "plain-rule.md"),
        `---\nid: plain-rule\ntype: rule\ndescription: A plain scoped rule\nscope: conditional\nglobs: "**/*.js"\n---\nThis rule scopes to JavaScript.`,
        "utf-8",
      );
      const outputs = await adapter.generate(agentsDir, makeManifest());

      const excluded = outputs.find((o) => o.path.endsWith("excluded-rule.instructions.md"));
      expect(excluded).toBeDefined();
      const exFm = excluded!.content.slice(0, excluded!.content.indexOf(MANAGED_BLOCK_START));
      expect(exFm).toContain('applyTo: "**/*.ts"');
      expect(exFm).toContain('excludeAgent: "code-review"');

      const plain = outputs.find((o) => o.path.endsWith("plain-rule.instructions.md"));
      expect(plain).toBeDefined();
      const plFm = plain!.content.slice(0, plain!.content.indexOf(MANAGED_BLOCK_START));
      expect(plFm).toContain('applyTo: "**/*.js"');
      expect(plFm).not.toContain("excludeAgent");
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

  // D9-SA9.3-02 (Cycle 12, D9, P6): the copilot adapter's two P6 enforcement
  // controls carried zero assertions before this suite — (a) the D9-H-7
  // orchestrator-only invocation gate (`disable-model-invocation: true` +
  // `user-invocable: true` on the 5 orchestrator-driven agents, which stops
  // Copilot auto-spawning implementer/fixer/reviewer/testability/security and
  // bypassing the delegation protocol — the CHANGELOG #73 failure mode) and
  // (b) the `## Copilot Enforcement Model` addendum inlined into
  // copilot-instructions.md. A refactor that reordered the frontmatter builder,
  // renamed COPILOT_ORCHESTRATOR_ONLY_AGENTS, or dropped the addendum from
  // innerContent would remove a security control with a green suite; the
  // snapshot tests are byte-diff (routinely regenerated with -u), so only a
  // named assertion states the invariant. Field names verified against
  // https://docs.github.com/en/copilot/reference/custom-agents-configuration
  // (accessed 2026-07-10).
  describe("P6 enforcement controls (D9-SA9.3-02)", () => {
    async function runWithAgentId(
      agentId: string,
    ): Promise<Awaited<ReturnType<typeof adapter.generate>>> {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-copilot-p6gate-"));
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await writeFile(
        join(agentsDir, "agents", `${agentId}.md`),
        `---\nid: ${agentId}\ntype: agent\ndescription: ${agentId} description\n---\n# ${agentId}\n\nBody.`,
        "utf-8",
      );
      try {
        return await adapter.generate(agentsDir, makeManifest());
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }

    // (a) invocation gate — present on every orchestrator-only agent so Copilot
    // cannot auto-select it (both fields required: disable removes it from the
    // model pool, user-invocable keeps deliberate human selection).
    for (const agentId of ["reviewer", "implementer"] as const) {
      it(`gates auto-invocation on orchestrator-only agent ${agentId} (D9-H-7)`, async () => {
        const outputs = await runWithAgentId(agentId);
        const file = outputs.find(
          (o) => o.path === `.github/agents/hatch3r-${agentId}.agent.md`,
        );
        expect(file).toBeDefined();
        const fm = file!.content.slice(0, file!.content.indexOf(MANAGED_BLOCK_START));
        expect(fm).toContain("disable-model-invocation: true");
        expect(fm).toContain("user-invocable: true");
      });
    }

    // (a) negative — a non-orchestrator agent keeps neither gate field, so it
    // stays model-auto-invocable (the gate is scoped to the 5 roles, not blanket).
    it("does NOT gate a non-orchestrator agent (test-agent gets neither field)", async () => {
      const outputs = await runWithAgentId("test-agent");
      const file = outputs.find(
        (o) => o.path === ".github/agents/hatch3r-test-agent.agent.md",
      );
      expect(file).toBeDefined();
      const fm = file!.content.slice(0, file!.content.indexOf(MANAGED_BLOCK_START));
      expect(fm).not.toContain("disable-model-invocation");
      expect(fm).not.toContain("user-invocable");
    });

    // (b) enforcement addendum — the section header, its normative declaration,
    // and all three self-detectable drift indicators reach copilot-instructions.md.
    it("inlines the Copilot Enforcement Model addendum + all three drift indicators", async () => {
      const outputs = await adapter.generate(FIXTURES_DIR, makeManifest());
      const instructions = outputs.find(
        (o) => o.path === ".github/copilot-instructions.md",
      );
      expect(instructions).toBeDefined();
      const body = instructions!.content;
      expect(body).toContain("## Copilot Enforcement Model");
      expect(body).toContain("are normative, not advisory");
      expect(body).toContain("Self-detectable drift indicators");
      // Indicator 1: missing pipeline-state header on a tracked Tier 2+ task.
      expect(body).toContain("Missing pipeline-state header on a tracked Tier 2+ task");
      // Indicator 2: a code-writing tool call before the Tier 3 Pre-Impl Summary.
      expect(body).toContain("replace_string_in_file");
      expect(body).toContain("Pre-Implementation Summary on a Tier 3 task");
      // Indicator 3: an orchestrator Edit/Write not following an implementer SUCCESS.
      expect(body).toContain("did not immediately follow a SUCCESS report from");
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
  // contract (see src/adapters/base.ts::throwIfSignalAborted). Pin the contract here so any
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

  // F14.3-H2 (D14, P3): the copilot-instructions.md blockquote carries a
  // right-sizing calibration directive interpolating the live
  // `manifest.maturity` into `maturity=<tier>` and pointing at
  // `rules/hatch3r-right-sizing.md`. The directive is delivered at EVERY tier
  // (solo/team/scaleup/enterprise), not gated to enterprise — a regression that
  // dropped it at low tiers, hardcoded the tier, or lost the rule pointer would
  // silently strip the calibration signal for Copilot.
  describe("maturity right-sizing header (F14.3-H2)", () => {
    const tiers = ["solo", "team", "scaleup", "enterprise"] as const;

    for (const tier of tiers) {
      it(`emits right-size to maturity=${tier} + right-sizing rule pointer`, async () => {
        const manifest: HatchManifest = { ...makeManifest(), maturity: tier };
        const outputs = await adapter.generate(FIXTURES_DIR, manifest);

        const instructions = outputs.find((o) => o.path === ".github/copilot-instructions.md");
        expect(instructions).toBeDefined();
        expect(instructions!.content).toContain(`right-size to maturity=${tier}`);
        expect(instructions!.content).toContain("rules/hatch3r-right-sizing.md");
      });
    }
  });

  // D1-17 (Cycle 11 Wave 3, D1, P1): the copilot-instructions.md blockquote also
  // carries the resolved confidence floor. Pre-fix the persisted `confidenceFloor`
  // config key reached no adapter output. Explicit floor wins; absence resolves
  // to the maturity-aware default.
  describe("confidence-floor header (D1-17)", () => {
    for (const floor of ["any", "medium", "high"] as const) {
      it(`emits confidence floor=${floor} when set explicitly`, async () => {
        const manifest: HatchManifest = { ...makeManifest(), confidenceFloor: floor };
        const outputs = await adapter.generate(FIXTURES_DIR, manifest);

        const instructions = outputs.find((o) => o.path === ".github/copilot-instructions.md");
        expect(instructions).toBeDefined();
        expect(instructions!.content).toContain(`confidence floor=${floor}`);
      });
    }

    it("resolves an absent floor to the maturity-aware default (enterprise → high)", async () => {
      const manifest: HatchManifest = { ...makeManifest(), maturity: "enterprise" };
      expect(manifest.confidenceFloor).toBeUndefined();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const instructions = outputs.find((o) => o.path === ".github/copilot-instructions.md");
      expect(instructions!.content).toContain("confidence floor=high");
    });

    it("an explicit floor overrides the maturity-derived default", async () => {
      const manifest: HatchManifest = { ...makeManifest(), maturity: "enterprise", confidenceFloor: "any" };
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const instructions = outputs.find((o) => o.path === ".github/copilot-instructions.md");
      expect(instructions!.content).toContain("confidence floor=any");
      expect(instructions!.content).not.toContain("confidence floor=high");
    });
  });
});

/**
 * D2-SA2.4-01 (Cycle 12 Wave 2, D2, P3): an mcp-granted agent's emitted Copilot
 * `tools:` allowlist must carry a per-server `<server>/*` grant when MCP servers
 * are selected. Copilot has no `mcp-servers` frontmatter primitive in VS Code/IDE
 * custom agents, so the `tools:` list is the only MCP grant mechanism — an
 * enumerated list without `<server>/*` tokens excludes every MCP tool.
 */
describe("mcp-granted agent tools frontmatter carries per-server grants (D2-SA2.4-01)", () => {
  async function writeMcpAgentRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "hatch3r-copilot-mcp-tools-"));
    const agentsDir = join(root, "agents");
    await mkdir(agentsDir, { recursive: true });
    // id `researcher` → emitted id `hatch3r-researcher`, whose AGENT_TOOL_POLICIES
    // grant includes the `mcp` category (read+search+web+mcp).
    await writeFile(
      join(agentsDir, "researcher.md"),
      "---\nid: researcher\ntype: agent\ndescription: Read-only research agent.\n---\n# Researcher\n\nResearch body.\n",
      "utf-8",
    );
    const mcpDir = join(root, "mcp");
    await mkdir(mcpDir, { recursive: true });
    await writeFile(
      join(mcpDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          context7: { _description: "Test Context7 MCP", _trust_bypass: true, url: "https://mcp.context7.com/" },
          github: { _description: "Test GitHub MCP", _trust_bypass: true, url: "https://api.githubcopilot.com/mcp/" },
        },
      }),
      "utf-8",
    );
    return root;
  }

  it("emits <server>/* in the tools: array for each selected server", async () => {
    const root = await writeMcpAgentRoot();
    try {
      const manifest = createManifest({
        tools: ["copilot"],
        mcpServers: ["context7", "github"],
        features: { mcp: true },
      });
      const outputs = await new CopilotAdapter().generate(root, manifest);
      const agentOut = outputs.find((o) => o.path === ".github/agents/hatch3r-researcher.agent.md");
      expect(agentOut, "expected the researcher agent output").toBeDefined();
      const toolsLine = agentOut!.content.split("\n").find((l) => l.startsWith("tools:")) ?? "";
      expect(toolsLine).toContain("\"context7/*\"");
      expect(toolsLine).toContain("\"github/*\"");
      // Additive — the read-only base grant survives alongside the MCP tokens.
      expect(toolsLine).toContain("\"read\"");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("emits no <server>/* token when the MCP feature is off, even with servers listed (gate)", async () => {
    const root = await writeMcpAgentRoot();
    try {
      const manifest = createManifest({
        tools: ["copilot"],
        mcpServers: ["context7"],
        features: { mcp: false },
      });
      const outputs = await new CopilotAdapter().generate(root, manifest);
      const agentOut = outputs.find((o) => o.path === ".github/agents/hatch3r-researcher.agent.md");
      expect(agentOut).toBeDefined();
      const toolsLine = agentOut!.content.split("\n").find((l) => l.startsWith("tools:")) ?? "";
      expect(toolsLine).not.toContain("/*");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// D9-SA9.3-08 / CL-2 U11 (Cycle 12, D9, P6): opt-in VS Code MCP sandbox
// hardening — per-server `sandboxEnabled: true` (stdio-only) + the top-level
// `sandbox` rules object, per
// code.visualstudio.com/docs/agents/reference/mcp-configuration (accessed
// 2026-07-12). Default OFF: the sandbox is default-deny on fs/network, so
// blanket enablement would break network-reaching stdio servers.
describe("CopilotAdapter MCP sandbox (D9-SA9.3-08 / CL-2 U11)", () => {
  /**
   * Canonical root with one stdio server and one (pin-bypassed) HTTP server so
   * both transport branches of the sandbox gate are exercised.
   */
  async function writeSandboxRoot(): Promise<string> {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-copilot-u11-sandbox-"));
    const root = join(tempDir, "agents");
    await mkdir(join(root, "mcp"), { recursive: true });
    await writeFile(
      join(root, "mcp", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          "local-tools": {
            _description: "STDIO test server",
            command: "npx",
            args: ["-y", "local-tools-mcp"],
          },
          github: {
            _description: "HTTP test server",
            _trust_bypass: true,
            url: "https://api.githubcopilot.com/mcp/",
          },
        },
      }),
      "utf-8",
    );
    return root;
  }

  function sandboxManifest(mcpSandbox?: CopilotMcpSandboxConfig): HatchManifest {
    const manifest = createManifest({
      tools: ["copilot"],
      mcpServers: ["local-tools", "github"],
      features: { mcp: true },
    });
    if (mcpSandbox !== undefined) manifest.copilot = { mcpSandbox };
    return manifest;
  }

  async function emittedMcp(root: string, manifest: HatchManifest, adapter = new CopilotAdapter()) {
    const outputs = await adapter.generate(root, manifest);
    const mcpOut = outputs.find((o) => o.path === ".vscode/mcp.json");
    expect(mcpOut, "expected .vscode/mcp.json output").toBeDefined();
    return JSON.parse(mcpOut!.content) as {
      inputs?: Array<Record<string, unknown>>;
      servers: Record<string, Record<string, unknown>>;
      sandbox?: Record<string, unknown>;
    };
  }

  it("emits neither sandboxEnabled nor a top-level sandbox object by default (opt-in posture)", async () => {
    const root = await writeSandboxRoot();
    try {
      const parsed = await emittedMcp(root, sandboxManifest());
      expect(parsed.sandbox).toBeUndefined();
      for (const server of Object.values(parsed.servers as Record<string, Record<string, unknown>>)) {
        expect(server.sandboxEnabled).toBeUndefined();
      }
    } finally {
      await rm(dirname(root), { recursive: true, force: true });
    }
  });

  it('servers: "all" flags every stdio entry and never an HTTP entry', async () => {
    const root = await writeSandboxRoot();
    try {
      const parsed = await emittedMcp(root, sandboxManifest({ servers: "all" }));
      expect(parsed.servers["local-tools"].sandboxEnabled).toBe(true);
      // HTTP entries are outside the sandboxEnabled surface (stdio-only).
      expect(parsed.servers.github.sandboxEnabled).toBeUndefined();
      // No rules configured — no top-level sandbox object.
      expect(parsed.sandbox).toBeUndefined();
    } finally {
      await rm(dirname(root), { recursive: true, force: true });
    }
  });

  it("emits the top-level sandbox rules object when a named stdio server is sandboxed", async () => {
    const root = await writeSandboxRoot();
    try {
      const rules = {
        filesystem: { allowWrite: ["${workspaceFolder}"] },
        network: { allowedDomains: ["api.github.com"] },
      };
      const parsed = await emittedMcp(
        root,
        sandboxManifest({ servers: ["local-tools"], rules }),
      );
      expect(parsed.servers["local-tools"].sandboxEnabled).toBe(true);
      expect(parsed.sandbox).toEqual(rules);
      // Top-level key set stays schema-exact: inputs?/servers/sandbox only.
      for (const key of Object.keys(parsed)) {
        expect(["inputs", "servers", "sandbox"]).toContain(key);
      }
    } finally {
      await rm(dirname(root), { recursive: true, force: true });
    }
  });

  it("warns and skips a named HTTP server (sandboxEnabled is stdio-only)", async () => {
    const root = await writeSandboxRoot();
    try {
      const adapter = new CopilotAdapter();
      const parsed = await emittedMcp(root, sandboxManifest({ servers: ["github"] }), adapter);
      expect(parsed.servers.github.sandboxEnabled).toBeUndefined();
      expect(
        adapter.warnings.some((w) => w.includes("mcpSandbox") && w.includes("stdio servers only")),
      ).toBe(true);
    } finally {
      await rm(dirname(root), { recursive: true, force: true });
    }
  });

  it("warns on a named server that is not emitted at all", async () => {
    const root = await writeSandboxRoot();
    try {
      const adapter = new CopilotAdapter();
      const parsed = await emittedMcp(root, sandboxManifest({ servers: ["ghost-server"] }), adapter);
      expect(parsed.sandbox).toBeUndefined();
      expect(
        adapter.warnings.some((w) => w.includes('mcpSandbox names server "ghost-server"')),
      ).toBe(true);
    } finally {
      await rm(dirname(root), { recursive: true, force: true });
    }
  });

  it("omits the rules object with a warning when no server ended up sandboxed (no dead config)", async () => {
    const root = await writeSandboxRoot();
    try {
      const adapter = new CopilotAdapter();
      const parsed = await emittedMcp(
        root,
        sandboxManifest({
          servers: ["github"],
          rules: { network: { allowedDomains: ["api.github.com"] } },
        }),
        adapter,
      );
      expect(parsed.sandbox).toBeUndefined();
      expect(
        adapter.warnings.some((w) => w.includes("no emitted server was sandboxed")),
      ).toBe(true);
    } finally {
      await rm(dirname(root), { recursive: true, force: true });
    }
  });
});
