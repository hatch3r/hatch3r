import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { CursorAdapter } from "../../adapters/cursor.js";
import { createManifest } from "../../manifest/hatchJson.js";
import type { HatchManifest } from "../../types.js";
import { MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");
// Wave 5: fixture user repo root — parent of canonical fixtures, so
// `.hatch3r/{type}/{id}.customize.yaml` lookups resolve correctly.
const FIXTURES_USER_REPO = dirname(FIXTURES_DIR);

describe("CursorAdapter", () => {
  const adapter = new CursorAdapter();

  function makeManifest(
    overrides: Partial<Parameters<typeof createManifest>[0]> & { models?: HatchManifest["models"] } = {},
  ): HatchManifest {
    const { models, features, ...createOpts } = overrides;
    const base = createManifest({
      tools: ["cursor"],
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
    expect(adapter.name).toBe("cursor");
  });

  it("generates rule files with hatch3r prefix", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const rules = outputs.filter(
      (o) =>
        o.path.startsWith(".cursor/rules/") &&
        !o.path.includes("bridge") &&
        !o.path.includes("hook-") &&
        !o.path.includes("tool-allowlist"),
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
    // D9-6 (P2): exact-value frontmatter, not a value-blind `.toContain("globs:")`.
    // The legacy inline-CSV fixture `scope: "**/*.ts"` resolves to a single glob.
    // A value-blind substring assertion passed even when the X4/CD4 GLOBS-DROP
    // bug emitted `globs: conditional`; pinning the rendered line closes that
    // false-negative.
    // D9-13 (Cycle 11 Wave 3): the rendered form is an unquoted comma-separated
    // string (NOT a bracketed array), per cursor.com/docs/context/rules.
    expect(scopedRule!.content).toContain("globs: **/*.ts");
    expect(scopedRule!.content).not.toContain("globs: [");
    // Regression sentinel: the literal scope keyword must never leak into the
    // emitted glob value (the D9-1 cross-adapter failure mode). Scoped to the
    // `globs:` line so the test survives a description that mentions the word.
    expect(scopedRule!.content).not.toContain("globs: conditional");
    expect(scopedRule!.content).not.toContain("alwaysApply: true");
  });

  // D9-6 (P2): second scoped fixture in the canonical `scope: conditional` +
  // `globs:` two-line form (distinct from the legacy inline-CSV `scoped-rule.md`
  // fixture). This exercises the `resolveRuleGlobs` `scope === "conditional"`
  // branch — the one the X4/CD4 GLOBS-DROP regression broke, emitting
  // `globs: conditional` and silently never auto-attaching the rule. Pins the
  // exact rendered multi-glob string (D9-13: unquoted comma-separated, no space
  // after the comma) per https://cursor.com/docs/context/rules and asserts no
  // glob value is the literal scope keyword. Isolated temp dir so the shared
  // `FIXTURES_DIR` rule-count assertions are untouched.
  it("emits the real conditional glob set, never the literal scope keyword", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-cursor-conditional-"));
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

      const rule = outputs.find((o) => o.path.includes("conditional-rule.mdc"));
      expect(rule).toBeDefined();
      // D9-13: unquoted comma-separated string, no space after the comma.
      expect(rule!.content).toContain("globs: src/api/**,**/*.proto");
      expect(rule!.content).not.toContain("globs: [");
      // The scope keyword must not survive into the glob value. Scoped to the
      // `globs:` line — the fixture description contains the word "conditional".
      expect(rule!.content).not.toContain("globs: conditional");
      expect(rule!.content).not.toContain("alwaysApply: true");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // F3.1.3 (D3 Cycle 10 Wave 2): cursor.test.ts previously asserted
  // `managedContent` field presence 6 times but never asserted the rendered
  // `content` string actually contains the literal HATCH3R:BEGIN/END markers
  // (unlike claude.test.ts / copilot.test.ts). A regression where the adapter
  // populates managedContent but stops wrapping output in markers would have
  // passed every prior assertion while silently breaking `hatch3r sync`
  // managed-block round-tripping for every Cursor project. This test closes
  // the false-negative gap by asserting marker containment on representative
  // rule output paths (`mdcOutput` wraps body via `wrapInManagedBlock`,
  // src/adapters/cursor.ts:120).
  it("wraps rule output in managed-block markers", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    // Representative per-file rule emissions: a normal canonical rule and the
    // always-emitted bridge rule. Both flow through `mdcOutput`, so both must
    // carry the marker pair around the body while keeping the YAML frontmatter
    // outside the managed block (frontmatter is appended before the wrap).
    const ruleProbes = [
      outputs.find((o) => o.path.includes("hatch3r-test-rule.mdc")),
      outputs.find((o) => o.path === ".cursor/rules/hatch3r-bridge.mdc"),
    ];

    for (const probe of ruleProbes) {
      expect(probe).toBeDefined();
      const content = probe!.content;
      const startIdx = content.indexOf(MANAGED_BLOCK_START);
      const endIdx = content.indexOf(MANAGED_BLOCK_END);
      expect(startIdx).toBeGreaterThanOrEqual(0);
      expect(endIdx).toBeGreaterThan(startIdx);
      // Frontmatter precedes the managed block — the `description:` key must
      // appear before the BEGIN marker, never inside the managed body.
      expect(content.indexOf("description:")).toBeLessThan(startIdx);
    }
  });

  // F3.1.3 companion: agent and skill per-file emissions also wrap their body
  // in managed-block markers (same `output()` 3-arg contract). Asserting
  // containment here guards the non-rule emission paths against the same
  // false-negative class.
  it("wraps agent and skill output in managed-block markers", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agent = outputs.find((o) => o.path === ".cursor/agents/hatch3r-test-agent.md");
    const skill = outputs.find((o) => o.path.includes("hatch3r-test-skill"));

    for (const probe of [agent, skill]) {
      expect(probe).toBeDefined();
      expect(probe!.content).toContain(MANAGED_BLOCK_START);
      expect(probe!.content).toContain(MANAGED_BLOCK_END);
      expect(probe!.content.indexOf(MANAGED_BLOCK_END)).toBeGreaterThan(
        probe!.content.indexOf(MANAGED_BLOCK_START),
      );
    }
  });

  it("generates agent files", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    // Top-level picker entries — companion subtrees (`.cursor/agents/modes/`,
    // `.cursor/agents/shared/`) are emitted but excluded from this count.
    const agents = outputs.filter((o) => /^\.cursor\/agents\/[^/]+\.md$/.test(o.path));
    expect(agents.length).toBe(2);

    const agent = agents.find((o) => o.path === ".cursor/agents/hatch3r-test-agent.md")!;
    expect(agent).toBeDefined();
    expect(agent.content).toContain("name: test-agent");
    expect(agent.content).toContain("description: A test agent for unit testing");
    expect(agent.content).toContain("You are a test agent");
    expect(agent.managedContent).toBeDefined();
  });

  it("emits readonly and background in agent frontmatter when set", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const roAgent = outputs.find((o) => o.path === ".cursor/agents/hatch3r-readonly-agent.md");
    expect(roAgent).toBeDefined();
    expect(roAgent!.content).toContain("readonly: true");
    expect(roAgent!.content).toContain("is_background: true");
    expect(roAgent!.content).toContain("name: readonly-agent");
  });

  it("omits readonly and background when not set on agent", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agent = outputs.find((o) => o.path === ".cursor/agents/hatch3r-test-agent.md")!;
    expect(agent.content).not.toContain("readonly:");
    expect(agent.content).not.toContain("background:");
  });

  it("emits model from customization file when present", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest, FIXTURES_USER_REPO);

    const agentFile = outputs.find((o) => o.path === ".cursor/agents/hatch3r-test-agent.md");
    expect(agentFile).toBeDefined();
    expect(agentFile!.content).toContain("model: claude-sonnet-5");
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

  // Model classes (release/2.6.0, dead-value fix): Cursor natively understands
  // only `fast`, `inherit`, or a concrete model id, so class words never ship
  // verbatim — economy maps to `fast`, default omits the field, strongest gets
  // an advisory body line (unless a models.tiers pin supplies a concrete id).
  describe("model-class emission (release/2.6.0)", () => {
    async function generateAgentWithModel(
      model: string,
      manifestOverrides: Parameters<typeof makeManifest>[0] = {},
    ): Promise<{ content: string; fm: string }> {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-cursor-class-"));
      try {
        const agentsDir = join(tempDir, "agents");
        await mkdir(join(agentsDir, "agents"), { recursive: true });
        await writeFile(
          join(agentsDir, "agents", "test-agent.md"),
          `---\nid: test-agent\ntype: agent\ndescription: A class-model test agent\nmodel: ${model}\n---\n# Test Agent\n\nYou are a test agent.`,
          "utf-8",
        );
        const outputs = await adapter.generate(agentsDir, makeManifest(manifestOverrides));
        const agentFile = outputs.find((o) => o.path === ".cursor/agents/hatch3r-test-agent.md");
        expect(agentFile).toBeDefined();
        const fmMatch = agentFile!.content.match(/^---\n([\s\S]*?)\n---/);
        expect(fmMatch).not.toBeNull();
        return { content: agentFile!.content, fm: fmMatch![1] };
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }

    it("economy → model: fast (Cursor's native cost keyword)", async () => {
      const { fm } = await generateAgentWithModel("economy");
      expect(fm).toMatch(/^model: fast$/m);
    });

    it("default → NO model line (inherit-by-omission)", async () => {
      const { fm } = await generateAgentWithModel("default");
      expect(fm).not.toMatch(/^model:/m);
    });

    it("strongest → no native field + one advisory body line", async () => {
      const { content, fm } = await generateAgentWithModel("strongest");
      expect(fm).not.toMatch(/^model:/m);
      expect(content).toContain(
        "Model class: strongest — pin this agent to the highest-capability model in the Cursor model picker.",
      );
    });

    it("models.tiers.strongest concrete id → emitted (alias-expanded), no advisory line", async () => {
      const { content, fm } = await generateAgentWithModel("strongest", {
        models: { tiers: { strongest: "fable" } },
      });
      expect(fm).toMatch(/^model: claude-fable-5$/m);
      expect(content).not.toContain("pin this agent to the highest-capability model");
    });

    it("non-class values still emit verbatim (concrete id, inherit, user fast)", async () => {
      const concrete = await generateAgentWithModel("claude-opus-4-8");
      expect(concrete.fm).toMatch(/^model: claude-opus-4-8$/m);
      const inherit = await generateAgentWithModel("inherit");
      expect(inherit.fm).toMatch(/^model: inherit$/m);
    });

    it("REGRESSION: `model: standard` can never ship (legacy word maps through the class path)", async () => {
      // The pre-2.6.0 emission wrote the tier word verbatim, shipping a dead
      // `model: standard` field on 23 agents. `standard` now normalizes to the
      // `default` class -> the field is OMITTED entirely.
      const { content } = await generateAgentWithModel("standard");
      expect(content).not.toContain("model: standard");
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch![1]).not.toMatch(/^model:/m);
    });
  });

  // release/2.2.0: Cursor documents no per-file model field on skills or
  // `.cursor/commands/*.md` — only `.cursor/agents/*.md` carries one. The
  // adapter passes no `emitModel` opt-in to the shared base helpers, so
  // configuring models.skills / models.commands must leave every cursor
  // skill/command output byte-identical to the unconfigured run.
  it("skill and command outputs are byte-unchanged when models.skills/commands are configured", async () => {
    const baseline = await adapter.generate(FIXTURES_DIR, makeManifest());
    const configured = await adapter.generate(FIXTURES_DIR, makeManifest({
      models: {
        skills: { "test-skill": "claude-sonnet-4-6" },
        commands: { "test-command": "claude-sonnet-4-6" },
      },
    }));
    const pick = (outputs: typeof baseline) =>
      outputs
        .filter((o) => o.path.startsWith(".cursor/skills/") || o.path.startsWith(".cursor/commands/"))
        .map((o) => ({ path: o.path, content: o.content }))
        .sort((a, b) => a.path.localeCompare(b.path));
    const baselinePicked = pick(baseline);
    expect(baselinePicked.length).toBeGreaterThan(0);
    expect(pick(configured)).toEqual(baselinePicked);
    for (const o of pick(configured)) {
      expect(o.content).not.toContain("model:");
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

  it("emits companion subtree files under `.cursor/` so canonical references resolve", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const pathSet = new Set(outputs.map((o) => o.path));
    expect(pathSet.has(".cursor/agents/modes/fake-mode.md")).toBe(true);
    expect(pathSet.has(".cursor/agents/shared/fake-reference.md")).toBe(true);
    expect(pathSet.has(".cursor/commands/board/pickup-fake.md")).toBe(true);

    // Companion paths must not surface in the top-level agent/command pickers.
    const topLevelAgentPaths = outputs
      .filter((o) => /^\.cursor\/agents\/[^/]+\.md$/.test(o.path))
      .map((o) => o.path);
    const topLevelCommandPaths = outputs
      .filter((o) => /^\.cursor\/commands\/[^/]+\.md$/.test(o.path))
      .map((o) => o.path);
    expect(topLevelAgentPaths.some((p) => p.includes("fake-mode"))).toBe(false);
    expect(topLevelCommandPaths.some((p) => p.includes("pickup-fake"))).toBe(false);
  });

  // Slash-picker fix (release/2.6.0, S1c): command companions under
  // `.cursor/commands/board|revision|shared/` carry the byte-0 stub the
  // primary command emission uses (Cursor's picker reads `description:` at
  // byte 0); agent companions stay raw — `.cursor/agents/**` is parsed as
  // subagent definitions and a stub would register reference files as agents.
  it("emits a byte-0 frontmatter stub on command companions but not agent companions", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const boardCompanion = outputs.find((o) => o.path === ".cursor/commands/board/pickup-fake.md");
    expect(boardCompanion).toBeDefined();
    expect(boardCompanion!.content.startsWith("---\n")).toBe(true);
    expect(boardCompanion!.content.startsWith(MANAGED_BLOCK_START)).toBe(false);
    const stub = boardCompanion!.content.slice(0, boardCompanion!.content.indexOf(MANAGED_BLOCK_START));
    expect(stub).toContain("name: pickup-fake");
    expect(stub).toContain("description:");
    expect(stub).not.toContain("HATCH3R:BEGIN");
    expect(boardCompanion!.content).toContain(MANAGED_BLOCK_START);

    const agentCompanion = outputs.find((o) => o.path === ".cursor/agents/modes/fake-mode.md");
    expect(agentCompanion).toBeDefined();
    expect(agentCompanion!.content.startsWith(MANAGED_BLOCK_START)).toBe(true);
  });

  it("generates command files", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    // Top-level picker entries — companion subtrees (`.cursor/commands/board/`,
    // `.cursor/commands/revision/`) are emitted but excluded from this count.
    const commands = outputs.filter((o) => /^\.cursor\/commands\/[^/]+\.md$/.test(o.path));
    expect(commands.length).toBe(1);

    const cmd = commands[0]!;
    expect(cmd.path).toBe(".cursor/commands/hatch3r-test-command.md");
    expect(cmd.content).toContain("test-command");
    expect(cmd.managedContent).toBeDefined();
    // Slash-command picker fix: frontmatter at byte 0 so the picker reads
    // `description:` rather than the HATCH3R:BEGIN managed-block marker.
    expect(cmd.content.startsWith("---")).toBe(true);
    expect(cmd.content.startsWith(MANAGED_BLOCK_START)).toBe(false);
    expect(cmd.content).toContain("description:");
    expect(cmd.content).toContain("A test command for unit testing");
    const fmBlock = cmd.content.slice(0, cmd.content.indexOf(MANAGED_BLOCK_START));
    expect(fmBlock).toContain("description:");
    expect(fmBlock).not.toContain("HATCH3R:BEGIN");
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

  // D2-13 (Cycle 11 Wave 3, D2, P6): no `_`-prefixed framework marker may leak
  // into the committed `.cursor/mcp.json`. Before the fix, `_pinned_sha256`,
  // `_trust_bypass`, and `_timeout` survived `readFilteredMcp` (which strips
  // only `_disabled`/`_description`) and were emitted verbatim by the cursor
  // adapter. The shared `stripPrivateMcpFields` helper now removes every
  // underscore-prefixed key per entry before emission.
  it("strips all `_`-prefixed private fields from .cursor/mcp.json (D2-13)", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-cursor-mcp-priv-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "mcp"), { recursive: true });
      await writeFile(
        join(agentsDir, "mcp", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            "pinned-http": {
              _description: "private description",
              _trust_bypass: true,
              _timeout: 45000,
              _pinned_sha256:
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
              url: "https://example.com/mcp",
              headers: { Authorization: "Bearer ${env:API_TOKEN}" },
            },
            "stdio-server": {
              _timeout: 1000,
              command: "npx",
              args: ["-y", "@scope/some-mcp@1.0.0"],
            },
          },
        }),
        "utf-8",
      );
      const manifest = makeManifest({ mcpServers: ["pinned-http", "stdio-server"] });
      const outputs = await adapter.generate(agentsDir, manifest);

      const mcp = outputs.find((o) => o.path === ".cursor/mcp.json");
      expect(mcp).toBeDefined();
      // No underscore-prefixed key may appear anywhere in the serialized file.
      expect(mcp!.content).not.toContain("_trust_bypass");
      expect(mcp!.content).not.toContain("_pinned_sha256");
      expect(mcp!.content).not.toContain("_timeout");
      expect(mcp!.content).not.toContain("_description");

      const parsed = JSON.parse(mcp!.content);
      for (const server of Object.values(
        parsed.mcpServers as Record<string, Record<string, unknown>>,
      )) {
        for (const key of Object.keys(server)) {
          expect(key.startsWith("_")).toBe(false);
        }
      }
      // Public fields survive untouched.
      expect(parsed.mcpServers["pinned-http"].url).toBe("https://example.com/mcp");
      expect(parsed.mcpServers["stdio-server"].command).toBe("npx");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
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
    // W4: `.agents/AGENTS.md` orchestration root removed; bridge is itself the entry point.
    expect(bridge!.content).not.toContain("/.agents/AGENTS.md");
    expect(bridge!.content).toContain("Mandatory Behaviors");
    expect(bridge!.content).toContain("Agent Quick Reference");
    expect(bridge!.managedContent).toBeDefined();
  });

  it("bridge includes Cursor v2.5+ subagent configuration guidance", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const bridge = outputs.find((o) => o.path === ".cursor/rules/hatch3r-bridge.mdc");
    expect(bridge).toBeDefined();
    expect(bridge!.content).toContain("Cursor Subagent Configuration (v2.5+)");
    expect(bridge!.content).toContain("many subagents in parallel");
    expect(bridge!.content).toContain("readonly");
    // D9-SA9.2-06: field name is `is_background` (matches the emitted frontmatter
    // at cursor.ts and Cursor docs), not the silently-ignored `background`.
    expect(bridge!.content).toContain("is_background");
    // D9-SA9.2-06: the stale Cursor-2.5-era "up to 4" cap is removed —
    // Cursor 3.0 documents no fixed parallelism cap.
    expect(bridge!.content).not.toContain("up to 4 subagents");
    expect(bridge!.content).not.toContain("up to 4 in parallel");
  });

  // C7.5-W2B2-H30 (D9-SA9.1.1): Cursor 3.0 /worktree and /best-of-n commands in bridge.
  // Source: https://cursor.com/changelog (accessed 2026-04-19, Cursor 3.0 released 2026-04-02).
  it("bridge includes Cursor 3.0 workflow commands", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const bridge = outputs.find((o) => o.path === ".cursor/rules/hatch3r-bridge.mdc");
    expect(bridge).toBeDefined();
    expect(bridge!.content).toContain("Cursor 3.0 Workflows");
    expect(bridge!.content).toContain("/worktree");
    expect(bridge!.content).toContain("/best-of-n");
  });

  it("skips rules when features.rules is false", async () => {
    const manifest = makeManifest({ features: { rules: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const rules = outputs.filter(
      (o) =>
        o.path.startsWith(".cursor/rules/") &&
        !o.path.includes("bridge") &&
        !o.path.includes("hook-") &&
        !o.path.includes("tool-allowlist"),
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

  // ── Finding 3.18: hooks feature assertion ──
  it("generates hook rules in .cursor/rules/ when hooks are enabled", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const hookRules = outputs.filter(
      (o) => o.path.startsWith(".cursor/rules/") && o.path.includes("hook-"),
    );
    expect(hookRules.length).toBeGreaterThan(0);

    for (const hook of hookRules) {
      expect(hook.content).toContain("HATCH3R_HOOK_ACTIVATED");
      expect(hook.content).toContain("Hook:");
    }
  });

  it("does not generate hook rules when hooks feature is disabled", async () => {
    const manifest = makeManifest({ features: { hooks: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const hookRules = outputs.filter(
      (o) => o.path.startsWith(".cursor/rules/") && o.path.includes("hook-"),
    );
    expect(hookRules.length).toBe(0);
  });

  // ── Finding 3.16: no empty content assertion ──
  it("produces no empty content in any output", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.content.length).toBeGreaterThan(0);
    }
  });

  // Wave B3: precedence-based NN- filename prefix on rule outputs.
  // Mapping: critical -> 10, high -> 30, normal -> 50, low -> 70.
  it("emits NN- numeric prefix derived from rule precedence", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-cursor-precedence-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "rules"), { recursive: true });
      await writeFile(
        join(agentsDir, "rules", "security.md"),
        `---
id: security
type: rule
description: Critical security rule
scope: always
precedence: critical
---
# Security

Critical security rule body.
`,
        "utf-8",
      );
      await writeFile(
        join(agentsDir, "rules", "testing.md"),
        `---
id: testing
type: rule
description: Normal testing rule
scope: always
precedence: normal
---
# Testing

Normal precedence rule body.
`,
        "utf-8",
      );
      await writeFile(
        join(agentsDir, "rules", "learning.md"),
        `---
id: learning
type: rule
description: Low priority learning rule
scope: always
precedence: low
---
# Learning

Low priority rule body.
`,
        "utf-8",
      );

      const outputs = await adapter.generate(agentsDir, makeManifest());

      const securityRule = outputs.find((o) => o.path === ".cursor/rules/10-hatch3r-security.mdc");
      const testingRule = outputs.find((o) => o.path === ".cursor/rules/50-hatch3r-testing.mdc");
      const learningRule = outputs.find((o) => o.path === ".cursor/rules/70-hatch3r-learning.mdc");

      expect(securityRule).toBeDefined();
      expect(testingRule).toBeDefined();
      expect(learningRule).toBeDefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // C7.5-W2B2-H41 (D15, P6): per-adapter tool allowlist emission.
  // Cursor's native primitive is `readonly: true`; the translator emits
  // it whenever the policy forbids both write and execute categories.
  describe("C7.5-W2B2-H41 policy-derived readonly emission", () => {
    async function runWithAgent(agentId: string) {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-cursor-readonly-"));
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

    it("emits readonly: true for hatch3r-reviewer (read+search only)", async () => {
      const outputs = await runWithAgent("reviewer");
      const file = outputs.find((o) => o.path === ".cursor/agents/hatch3r-reviewer.md");
      expect(file).toBeDefined();
      expect(file!.content).toContain("readonly: true");
    });

    it("does not emit readonly for hatch3r-implementer (has write+execute)", async () => {
      const outputs = await runWithAgent("implementer");
      const file = outputs.find(
        (o) => o.path === ".cursor/agents/hatch3r-implementer.md",
      );
      expect(file).toBeDefined();
      const fmMatch = file!.content.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch).not.toBeNull();
      expect(fmMatch![1]).not.toContain("readonly: true");
    });

    it("policy-derived readonly applies to researcher even without explicit readonly flag", async () => {
      // Researcher has no write/execute per policy, so even without an
      // explicit canonical `readonly: true` flag the emitted cursor agent
      // is readonly — trust policy cannot be widened by omission.
      const outputs = await runWithAgent("researcher");
      const file = outputs.find(
        (o) => o.path === ".cursor/agents/hatch3r-researcher.md",
      );
      expect(file).toBeDefined();
      expect(file!.content).toContain("readonly: true");
    });
  });

  // C9-H49 (D15-SA15.2, P6): per-adapter MCP / tool gating emission.
  // Cursor has no PreToolUse hook primitive, so enforcement is
  // rule-delegated: an alwaysApply `.cursor/rules/hatch3r-tool-allowlist.mdc`
  // rule + machine-readable `.cursor/agents-policy.json` document.
  // Pairs with `readonly: true` frontmatter primitive emitted by
  // `toCursorReadonlyFrontmatter`.
  describe("C9-H49 tool allowlist rule + agents-policy.json emission", () => {
    it("emits .cursor/agents-policy.json with the canonical registry", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const policiesFile = outputs.find(
        (o) => o.path === ".cursor/agents-policy.json",
      );
      expect(policiesFile).toBeDefined();
      const parsed = JSON.parse(policiesFile!.content);
      expect(parsed.schema).toBe("hatch3r/agent-tool-policies/v1");
      expect(Array.isArray(parsed.policies)).toBe(true);
      const reviewer = parsed.policies.find(
        (p: { agentId: string }) => p.agentId === "hatch3r-reviewer",
      );
      const implementer = parsed.policies.find(
        (p: { agentId: string }) => p.agentId === "hatch3r-implementer",
      );
      expect(reviewer).toBeDefined();
      expect(reviewer.allowedTools).toEqual(["read", "search"]);
      expect(implementer).toBeDefined();
      expect(implementer.allowedTools).toContain("write");
      expect(implementer.allowedTools).toContain("execute");
      expect(parsed.allToolCategories).toContain("read");
      expect(parsed.allToolCategories).toContain("mcp");
    });

    it("emits .cursor/rules/hatch3r-tool-allowlist.mdc as alwaysApply", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const ruleFile = outputs.find(
        (o) => o.path === ".cursor/rules/hatch3r-tool-allowlist.mdc",
      );
      expect(ruleFile).toBeDefined();
      // Frontmatter must declare alwaysApply: true so the rule is loaded into every Cursor session.
      const fmMatch = ruleFile!.content.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch).not.toBeNull();
      const fm = fmMatch![1];
      expect(fm).toContain("alwaysApply: true");
      expect(fm).toContain("ASI02");
      // Body must contain the canonical per-agent table for human / agent inspection.
      expect(ruleFile!.content).toContain("Hatch3r Agent Tool Allowlist");
      expect(ruleFile!.content).toContain("hatch3r-reviewer");
      expect(ruleFile!.content).toContain("hatch3r-implementer");
      expect(ruleFile!.content).toContain("read, search");
      // References the sibling machine-readable JSON document.
      expect(ruleFile!.content).toContain(".cursor/agents-policy.json");
      // Body wrapped in a managed block per Cursor adapter convention.
      expect(ruleFile!.managedContent).toBeDefined();
    });

    it("emits rule + JSON regardless of features.rules state", async () => {
      // The allowlist is a trust artifact, not a user-content rule —
      // disabling `features.rules` must not remove it, otherwise the
      // ASI02 enforcement chain breaks at the Cursor boundary.
      const manifest = makeManifest({ features: { rules: false } });
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      expect(
        outputs.find((o) => o.path === ".cursor/rules/hatch3r-tool-allowlist.mdc"),
      ).toBeDefined();
      expect(
        outputs.find((o) => o.path === ".cursor/agents-policy.json"),
      ).toBeDefined();
    });
  });

  // D9-4 (Cycle 11 D9, P6): the `subagentStart` deny hook is the hard runtime
  // ASI02 block for Cursor, at parity with the Claude PreToolUse NO_POLICY
  // deny. cursor.com/docs/agent/hooks (accessed 2026-06-06) confirms
  // `subagentStart` exposes `subagent_type` and denies with
  // `{permission: "deny"}`; the prior "Cursor has no PreToolUse hook
  // primitive" premise was false against current docs.
  describe("D9-4 subagentStart guard hook + hooks.json wiring", () => {
    it("emits .cursor/hooks/subagent-guard.mjs that reads ../agents-policy.json and denies NO_POLICY", async () => {
      const outputs = await adapter.generate(FIXTURES_DIR, makeManifest());
      const guard = outputs.find((o) => o.path === ".cursor/hooks/subagent-guard.mjs");
      expect(guard).toBeDefined();
      expect(guard!.content).toContain("subagentStart");
      expect(guard!.content).toContain('join(__dirname, "..", "agents-policy.json")');
      expect(guard!.content).toContain('permission: "deny"');
      expect(guard!.content).toContain('reasonCode: "NO_POLICY"');
      expect(guard!.content).toContain('if (!subagentType.startsWith("hatch3r-"))');
    });

    it("wires the guard into .cursor/hooks.json under the subagentStart event with failClosed", async () => {
      const outputs = await adapter.generate(FIXTURES_DIR, makeManifest());
      const hooksFile = outputs.find((o) => o.path === ".cursor/hooks.json");
      expect(hooksFile).toBeDefined();
      const parsed = JSON.parse(hooksFile!.content);
      expect(parsed.version).toBe(1);
      expect(Array.isArray(parsed.hooks.subagentStart)).toBe(true);
      const entry = parsed.hooks.subagentStart[0];
      expect(entry.type).toBe("command");
      expect(entry.command).toBe("node ./.cursor/hooks/subagent-guard.mjs");
      // failClosed: a crash/timeout blocks the spawn rather than failing open.
      expect(entry.failClosed).toBe(true);
    });

    it("emits the guard + hooks.json even when no canonical lifecycle hooks map (features.hooks off)", async () => {
      // The guard is a trust artifact: it must ship even when no
      // pre-commit/file-save/session-start hook produced a hooks.json entry,
      // otherwise the Cursor ASI02 runtime block silently disappears.
      const manifest = makeManifest({ features: { hooks: false } });
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const hooksFile = outputs.find((o) => o.path === ".cursor/hooks.json");
      expect(hooksFile).toBeDefined();
      const parsed = JSON.parse(hooksFile!.content);
      expect(parsed.hooks.subagentStart[0].command).toBe(
        "node ./.cursor/hooks/subagent-guard.mjs",
      );
      expect(
        outputs.find((o) => o.path === ".cursor/hooks/subagent-guard.mjs"),
      ).toBeDefined();
    });
  });

  // D9-14 (Cycle 11 Wave 3, D9, P3): behavioral coverage for the
  // CURSOR_HOOK_EVENT_MAP -> buildCursorHookEntry -> hooks.json path
  // (cursor.ts CURSOR_HOOK_EVENT_MAP + buildCursorHookEntry). The prior
  // hooks.json coverage was path-level only (D9-4 asserted the subagentStart
  // guard entry); no test pinned the canonical-event -> lifecycle-event keys,
  // the printf-prefixed command, or the `git commit` matcher. The shared
  // FIXTURES_DIR already carries pre-commit-lint-fixer.md (event pre-commit ->
  // beforeShellExecution + matcher "git commit", agent lint-fixer) and
  // session-start-ci-watcher.md (event session-start -> sessionStart), so this
  // exercises both a matcher-bearing and a matcher-less mapping.
  describe("D9-14 hooks.json lifecycle-event wiring (CURSOR_HOOK_EVENT_MAP)", () => {
    it("maps pre-commit to beforeShellExecution with a git-commit matcher and printf-prefixed command", async () => {
      const outputs = await adapter.generate(FIXTURES_DIR, makeManifest());
      const hooksFile = outputs.find((o) => o.path === ".cursor/hooks.json");
      expect(hooksFile).toBeDefined();
      const parsed = JSON.parse(hooksFile!.content);
      expect(Array.isArray(parsed.hooks.beforeShellExecution)).toBe(true);
      const entry = parsed.hooks.beforeShellExecution[0];
      expect(entry.type).toBe("command");
      expect(entry.matcher).toBe("git commit");
      // The command is a printf that surfaces the activation directive to the
      // agent transcript (Cursor runs the command, it does not spawn an agent).
      expect(entry.command).toMatch(/^printf '%s\\n' '/);
      expect(entry.command).toContain("spawn the lint-fixer agent");
    });

    it("maps session-start to sessionStart with a printf-prefixed command and no matcher", async () => {
      const outputs = await adapter.generate(FIXTURES_DIR, makeManifest());
      const hooksFile = outputs.find((o) => o.path === ".cursor/hooks.json");
      const parsed = JSON.parse(hooksFile!.content);
      expect(Array.isArray(parsed.hooks.sessionStart)).toBe(true);
      const entry = parsed.hooks.sessionStart[0];
      expect(entry.type).toBe("command");
      // session-start has no command-text matcher (afterFileEdit/sessionStart
      // carry none in CURSOR_HOOK_EVENT_MAP).
      expect(entry.matcher).toBeUndefined();
      expect(entry.command).toMatch(/^printf '%s\\n' '/);
      expect(entry.command).toContain("spawn the ci-watcher agent");
    });

    it("does not emit a hooks.json lifecycle entry for the advisory-only review-loop-cap event (D9-15)", async () => {
      // review-loop-cap is intentionally absent from CURSOR_HOOK_EVENT_MAP: it
      // is advisory-only on Cursor (no per-issue counter context at any Cursor
      // hook payload), so the only Cursor surface is the `.mdc` rule, never a
      // hooks.json runtime entry. Pin the decision so a future re-wire is a
      // deliberate test change, not a silent regression.
      const outputs = await adapter.generate(FIXTURES_DIR, makeManifest());
      const hooksFile = outputs.find((o) => o.path === ".cursor/hooks.json");
      const parsed = JSON.parse(hooksFile!.content);
      // No lifecycle key carries a review-loop-cap directive; the subagentStart
      // key holds only the NO_POLICY guard command (asserted in the D9-4 block).
      const allCommands = Object.values(
        parsed.hooks as Record<string, Array<{ command: string }>>,
      )
        .flat()
        .map((e) => e.command);
      expect(allCommands.some((c) => c.includes("review-loop-cap"))).toBe(false);
    });
  });

  // D9-SA9.2-01 (Cycle 12, D9, P3/P6): two additive project-global Cursor hook
  // guards that need no agent identity — `beforeMCPExecution` (mcp-guard.mjs, a
  // hard allowlist over the resolved `.cursor/mcp.json` set) and a
  // `beforeReadFile`+`beforeShellExecution` working-directory boundary
  // (workdir-guard.mjs). Closes the currency gap where Cursor documented both
  // events but the adapter left them unwired (cursor.com/docs/hooks +
  // cursor.com/docs/agent/hooks, accessed 2026-07-10). Both fail open on
  // ambiguity and ship with failClosed:false so a guard crash on these
  // high-frequency events cannot brick the session.
  describe("D9-SA9.2-01 project-global MCP + working-directory hook guards", () => {
    it("emits .cursor/hooks/mcp-guard.mjs wired to beforeMCPExecution (failClosed:false)", async () => {
      const outputs = await adapter.generate(FIXTURES_DIR, makeManifest());
      const guard = outputs.find((o) => o.path === ".cursor/hooks/mcp-guard.mjs");
      expect(guard).toBeDefined();
      expect(guard!.content).toContain("beforeMCPExecution");
      expect(guard!.content).toContain('permission: "deny"');
      expect(guard!.content).toContain("mcp.json");
      expect(guard!.content).toContain("MCP_SERVER_NOT_IN_MANIFEST");
      // Fails open when no manifest is readable, so a configured server is
      // never blocked — pin the guard clause so the fail-open posture cannot
      // silently flip to fail-closed.
      expect(guard!.content).toContain("if (!manifestSeen) allow();");

      const hooksFile = outputs.find((o) => o.path === ".cursor/hooks.json");
      const parsed = JSON.parse(hooksFile!.content);
      expect(Array.isArray(parsed.hooks.beforeMCPExecution)).toBe(true);
      const entry = parsed.hooks.beforeMCPExecution.find(
        (e: { command: string }) => e.command === "node ./.cursor/hooks/mcp-guard.mjs",
      );
      expect(entry).toBeDefined();
      expect(entry.failClosed).toBe(false);
    });

    it("emits .cursor/hooks/workdir-guard.mjs wired to beforeReadFile and beforeShellExecution", async () => {
      const outputs = await adapter.generate(FIXTURES_DIR, makeManifest());
      const guard = outputs.find((o) => o.path === ".cursor/hooks/workdir-guard.mjs");
      expect(guard).toBeDefined();
      expect(guard!.content).toContain("realpathSync");
      expect(guard!.content).toContain("PATH_ESCAPES_PROJECT_ROOT");
      expect(guard!.content).toContain('permission: "deny"');
      // Reads file_path (beforeReadFile) and cwd (beforeShellExecution).
      expect(guard!.content).toContain("payload.file_path");
      expect(guard!.content).toContain("payload.cwd");

      const hooksFile = outputs.find((o) => o.path === ".cursor/hooks.json");
      const parsed = JSON.parse(hooksFile!.content);
      const cmd = "node ./.cursor/hooks/workdir-guard.mjs";
      const onReadFile = parsed.hooks.beforeReadFile.find(
        (e: { command: string }) => e.command === cmd,
      );
      const onShell = parsed.hooks.beforeShellExecution.find(
        (e: { command: string }) => e.command === cmd,
      );
      expect(onReadFile).toBeDefined();
      expect(onReadFile.failClosed).toBe(false);
      expect(onShell).toBeDefined();
      expect(onShell.failClosed).toBe(false);
    });

    it("appends the workdir guard after the mapped lifecycle entries on beforeShellExecution (D9-14 [0]-index preserved)", async () => {
      const outputs = await adapter.generate(FIXTURES_DIR, makeManifest());
      const parsed = JSON.parse(
        outputs.find((o) => o.path === ".cursor/hooks.json")!.content,
      );
      // The mapped lifecycle entries (printf directives) precede the appended
      // guard, so the D9-14 `beforeShellExecution[0]` assertions stay valid.
      expect(parsed.hooks.beforeShellExecution[0].command).toMatch(/^printf /);
      expect(parsed.hooks.beforeShellExecution.at(-1).command).toBe(
        "node ./.cursor/hooks/workdir-guard.mjs",
      );
    });

    it("ships both guards even when no canonical lifecycle hooks map (features.hooks off)", async () => {
      // Same trust-artifact posture as the subagentStart guard: the guards must
      // ship even when no pre-commit/session-start hook produced a lifecycle
      // entry, otherwise the runtime block silently disappears.
      const outputs = await adapter.generate(
        FIXTURES_DIR,
        makeManifest({ features: { hooks: false } }),
      );
      expect(outputs.find((o) => o.path === ".cursor/hooks/mcp-guard.mjs")).toBeDefined();
      expect(outputs.find((o) => o.path === ".cursor/hooks/workdir-guard.mjs")).toBeDefined();
      const parsed = JSON.parse(
        outputs.find((o) => o.path === ".cursor/hooks.json")!.content,
      );
      expect(
        parsed.hooks.beforeMCPExecution.some((e: { command: string }) =>
          e.command.includes("mcp-guard.mjs"),
        ),
      ).toBe(true);
      expect(
        parsed.hooks.beforeReadFile.some((e: { command: string }) =>
          e.command.includes("workdir-guard.mjs"),
        ),
      ).toBe(true);
    });
  });

  // D2-SA2.4-10 (Cycle 12, D2, P6): doc-parity guard for SECURITY.md's ASI02
  // enforcement surface. Operators size compensating controls and auditors
  // grade enforcement classifications from that document; a control surface
  // added to the code but not to SECURITY.md leaves it describing a weaker
  // system than the one shipped. The Cursor `subagentStart` hard guard
  // (buildCursorSubagentGuardHookScript) was absent from SECURITY.md pre-fix
  // while cursor.ts emitted it. Pin every ASI02 adapter emission helper into
  // SECURITY.md so the next helper that skips the doc fails here.
  describe("D2-SA2.4-10 SECURITY.md ASI02 emission-helper doc-parity", () => {
    const SECURITY_MD = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "SECURITY.md",
    );
    const EMISSION_HELPERS = [
      "buildAgentToolPoliciesJson",
      "buildClaudePreToolUseHookScript",
      "buildCursorAllowlistRule",
      "buildCursorSubagentGuardHookScript",
    ];

    it("names every ASI02 adapter emission helper", async () => {
      const doc = await readFile(SECURITY_MD, "utf-8");
      for (const helper of EMISSION_HELPERS) {
        expect(doc, `SECURITY.md must reference ${helper}`).toContain(helper);
      }
    });

    it("documents the Cursor subagentStart hard deny (not 'no PreToolUse -> rule-delegated only')", async () => {
      const doc = await readFile(SECURITY_MD, "utf-8");
      expect(doc).toContain("subagent-guard.mjs");
      expect(doc).toContain("subagentStart");
      // The retracted absolute framing must not resurface for Cursor.
      expect(doc).not.toContain("Cursor lacks a PreToolUse hook surface");
      expect(doc).not.toContain("Cursor has no PreToolUse hook surface");
      expect(doc).not.toContain("Cursor exposes no PreToolUse hook surface");
    });
  });

  // ── Wave 5 (CLI-tooling pivot, plan §4.6) ───────────────────────
  //
  // Cursor's skills surface is filtered by `manifest.cliTools.selected` via
  // `readCliFilteredSkills` on BaseAdapter. Non-CLI skills always pass
  // through; CLI skills (id prefix `hatch3r-cli-`) only emit when their
  // suffix appears in the selected list AND `cliTools.enabled` is true.
  describe("CLI tools filter (Wave 5 plan §4.6)", () => {
    it("emits only the selected CLI skills when cliTools is enabled", async () => {
      const manifest: HatchManifest = {
        ...makeManifest(),
        cliTools: { enabled: true, selected: ["ripgrep", "jq"] },
      };
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const cliSkills = outputs.filter((o) =>
        o.path.startsWith(".cursor/skills/hatch3r-cli-"),
      );
      const cliSkillIds = cliSkills.map((o) => o.path);
      // Expect ripgrep + jq; fd is not in the selected list.
      expect(cliSkillIds).toContain(".cursor/skills/hatch3r-cli-ripgrep/SKILL.md");
      expect(cliSkillIds).toContain(".cursor/skills/hatch3r-cli-jq/SKILL.md");
      expect(cliSkillIds.some((p) => p.includes("hatch3r-cli-fd"))).toBe(false);
      // Non-CLI skill (test-skill) still passes through unchanged.
      expect(outputs.some((o) => o.path === ".cursor/skills/hatch3r-test-skill/SKILL.md")).toBe(true);
    });

    it("emits zero CLI skill files when cliTools.enabled is false", async () => {
      const manifest: HatchManifest = {
        ...makeManifest(),
        cliTools: { enabled: false, selected: ["ripgrep", "jq"] },
      };
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const cliSkills = outputs.filter((o) =>
        o.path.startsWith(".cursor/skills/hatch3r-cli-"),
      );
      expect(cliSkills).toEqual([]);
    });

    it("emits zero CLI skill files when cliTools.selected is empty (enabled=true)", async () => {
      const manifest: HatchManifest = {
        ...makeManifest(),
        cliTools: { enabled: true, selected: [] },
      };
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const cliSkills = outputs.filter((o) =>
        o.path.startsWith(".cursor/skills/hatch3r-cli-"),
      );
      expect(cliSkills).toEqual([]);
    });

    it("emits zero CLI skill files when manifest.cliTools is absent (pre-1.7.5 manifest)", async () => {
      // Absent cliTools should behave like enabled:false (pre-1.7.5 manifest
      // remains valid per plan §4.2 — no version bump required).
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const cliSkills = outputs.filter((o) =>
        o.path.startsWith(".cursor/skills/hatch3r-cli-"),
      );
      expect(cliSkills).toEqual([]);
    });
  });

  // D3-M1 (Cycle 10 Wave-3 Medium rollover): adapters had no documented
  // error-path coverage. Pipeline timeouts (`hatch3r sync`'s circuit breaker)
  // surface as a pre-aborted AbortSignal; `BaseAdapter.throwIfSignalAborted`
  // is the documented contract. Pin the contract here so any future change
  // that silently swallows the signal (e.g. a try/catch wrapping the loop)
  // is caught by a failing test rather than a CI timeout regression.
  describe("error paths", () => {
    it("rejects with the abort reason when the signal is pre-aborted", async () => {
      const manifest = makeManifest();
      const controller = new AbortController();
      const reason = new Error("pipeline timeout exceeded");
      controller.abort(reason);
      await expect(
        adapter.generate(FIXTURES_DIR, manifest, FIXTURES_USER_REPO, "standard", controller.signal),
      ).rejects.toThrow("pipeline timeout exceeded");
    });
  });

  // F14.3-H2 (D14, P3): `cursorMaturityHeader` prepends a right-sizing
  // calibration directive to every per-rule body. The directive is delivered
  // at EVERY tier (solo/team/scaleup/enterprise) — not gated to enterprise —
  // and it interpolates the live `manifest.maturity` into `maturity=<tier>`
  // while always pointing at `rules/hatch3r-right-sizing.md`. A regression that
  // dropped the header at low tiers, hardcoded the tier, or lost the rule
  // pointer would silently strip the calibration signal for that adapter.
  describe("maturity right-sizing header (F14.3-H2)", () => {
    const tiers = ["solo", "team", "scaleup", "enterprise"] as const;

    for (const tier of tiers) {
      it(`emits right-size to maturity=${tier} + right-sizing rule pointer on rule bodies`, async () => {
        const manifest: HatchManifest = { ...makeManifest(), maturity: tier };
        const outputs = await adapter.generate(FIXTURES_DIR, manifest);

        const rule = outputs.find((o) => o.path.includes("hatch3r-test-rule.mdc"));
        expect(rule).toBeDefined();
        expect(rule!.content).toContain(`right-size to maturity=${tier}`);
        expect(rule!.content).toContain("rules/hatch3r-right-sizing.md");
      });
    }
  });

  // D1-17 (Cycle 11 Wave 3, D1, P1): `cursorConfidenceFloorHeader` stamps the
  // resolved confidence floor on every per-rule body alongside the maturity
  // marker. Pre-fix the persisted `confidenceFloor` config key reached no
  // adapter output. Explicit floor wins; absence resolves to the maturity-aware
  // default.
  describe("confidence-floor header (D1-17)", () => {
    for (const floor of ["any", "medium", "high"] as const) {
      it(`emits confidence floor=${floor} on rule bodies when set explicitly`, async () => {
        const manifest: HatchManifest = { ...makeManifest(), confidenceFloor: floor };
        const outputs = await adapter.generate(FIXTURES_DIR, manifest);

        const rule = outputs.find((o) => o.path.includes("hatch3r-test-rule.mdc"));
        expect(rule).toBeDefined();
        expect(rule!.content).toContain(`confidence floor=${floor}`);
      });
    }

    it("resolves an absent floor to the maturity-aware default (enterprise → high)", async () => {
      const manifest: HatchManifest = { ...makeManifest(), maturity: "enterprise" };
      expect(manifest.confidenceFloor).toBeUndefined();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const rule = outputs.find((o) => o.path.includes("hatch3r-test-rule.mdc"));
      expect(rule!.content).toContain("confidence floor=high");
    });

    it("an explicit floor overrides the maturity-derived default", async () => {
      const manifest: HatchManifest = { ...makeManifest(), maturity: "enterprise", confidenceFloor: "any" };
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const rule = outputs.find((o) => o.path.includes("hatch3r-test-rule.mdc"));
      expect(rule!.content).toContain("confidence floor=any");
      expect(rule!.content).not.toContain("confidence floor=high");
    });
  });
});
