import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  ClaudeAdapter,
  CACHE_BREAKPOINT_SENTINEL,
  CACHE_BREAKPOINT_SENTINEL_START,
  CACHE_BREAKPOINT_SENTINEL_END,
  CLAUDE_SUBAGENT_MAX_TURNS_DEFAULT,
} from "../../adapters/claude.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { maxIterationsForClass } from "../../pipeline/reviewLoop.js";
import type { HatchManifest } from "../../types.js";
import { MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");
// Wave 5: fixture user repo root — parent of canonical fixtures, so
// `.hatch3r/{type}/{id}.customize.yaml` lookups (e.g. test-agent.customize.yaml)
// resolve correctly without needing a real CWD with .hatch3r/ staged.
const FIXTURES_USER_REPO = dirname(FIXTURES_DIR);

describe("ClaudeAdapter", () => {
  const adapter = new ClaudeAdapter();

  function makeManifest(
    overrides: Partial<Parameters<typeof createManifest>[0]> & { models?: HatchManifest["models"]; claude?: HatchManifest["claude"] } = {},
  ): HatchManifest {
    const { models, claude, features, ...createOpts } = overrides;
    const base = createManifest({
      tools: ["claude"],
      mcpServers: ["github"],
      // W3-mcp-optin: DEFAULT_FEATURES.mcp is now false (opt-in). This fixture
      // seeds mcpServers, so pin the feature on to keep exercising the MCP
      // emission paths; per-test feature overrides still win via the merge.
      features: { mcp: true, ...features },
      ...createOpts,
    });
    const result = { ...base };
    if (models) result.models = models;
    if (claude) result.claude = claude;
    return result;
  }

  it("has correct name", () => {
    expect(adapter.name).toBe("claude");
  });

  it("generates CLAUDE.md as bridge reference with managed blocks", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
    expect(claudeMd).toBeDefined();
    expect(claudeMd!.content).toContain(MANAGED_BLOCK_START);
    expect(claudeMd!.content).toContain(MANAGED_BLOCK_END);
    expect(claudeMd!.content).toContain("Hatch3r Project Instructions");
    // W4: root AGENTS.md removed — CLAUDE.md is itself the bridge. No `.agents/AGENTS.md` reference.
    expect(claudeMd!.content).not.toContain(".agents/AGENTS.md");
    expect(claudeMd!.content).toContain(".claude/rules/");
    expect(claudeMd!.content).toContain("Mandatory Behaviors");
    expect(claudeMd!.content).toContain("Agent Quick Reference");
    expect(claudeMd!.managedContent).toBeDefined();
  });

  it("does not inline rules in CLAUDE.md", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
    expect(claudeMd!.content).not.toContain("test-rule");
    expect(claudeMd!.content).not.toContain("scoped-rule");
  });

  it("generates individual rule files in .claude/rules/", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const rules = outputs.filter((o) => o.path.startsWith(".claude/rules/"));
    // 2 canonical rule files + 1 D9-2 advisory-hooks rule (FIXTURES_DIR ships a
    // ci-failure hook, which has no native Claude event and is surfaced as a
    // `.claude/rules/` advisory note).
    expect(rules.length).toBe(3);

    for (const rule of rules) {
      expect(rule.path).toContain("hatch3r-");
      expect(rule.path).toMatch(/\.md$/);
      expect(rule.managedContent).toBeDefined();
    }

    const testRule = rules.find((r) => r.path.includes("test-rule"));
    expect(testRule).toBeDefined();
    expect(testRule!.content).toContain("A test rule for unit testing");
  });

  // F6.6-H1 (D6, P7): Claude Code `.claude/rules/` `paths:` frontmatter so
  // glob-scoped rules lazy-load on matching file reads instead of loading
  // every scoped body at session start. The fixtures provide a glob-scoped
  // rule (`scoped-rule`, scope `**/*.ts`) and an always-scoped rule
  // (`test-rule`, scope `always`).
  it("emits paths: frontmatter on glob-scoped rules and omits it on scope:always", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const scopedRule = outputs.find((o) => o.path.includes("scoped-rule"));
    expect(scopedRule).toBeDefined();
    // Glob scope `**/*.ts` -> `paths:` frontmatter (documented block-sequence
    // form per code.claude.com/docs/en/memory, D9-SA9.1-02), placed above the
    // managed block (frontmatter is not managed content).
    expect(scopedRule!.content).toMatch(/^---\npaths:\n  - "\*\*\/\*\.ts"\n---\n/);
    // Regression guard (D9-SA9.1-02): must NOT revert to the docs-divergent
    // flow-array form (`paths: ["**/*.ts"]`) that matched a silent-load-failure
    // class on Claude Code.
    expect(scopedRule!.content).not.toMatch(/paths: \[/);
    expect(scopedRule!.content.indexOf("paths:")).toBeLessThan(
      scopedRule!.content.indexOf(MANAGED_BLOCK_START),
    );
    // The body stays inside the managed block for drift detection.
    expect(scopedRule!.managedContent).toBeDefined();
    expect(scopedRule!.managedContent).not.toContain("paths:");

    const alwaysRule = outputs.find((o) => o.path.includes("test-rule"));
    expect(alwaysRule).toBeDefined();
    // scope:always loads unconditionally -> no paths: frontmatter.
    expect(alwaysRule!.content).not.toContain("paths:");
    expect(alwaysRule!.content.startsWith(MANAGED_BLOCK_START)).toBe(true);
  });

  it("splits CSV scope into a multi-glob paths: array", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-paths-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "rules"), { recursive: true });
      await writeFile(
        join(agentsDir, "rules", "csv-rule.md"),
        `---
id: csv-rule
type: rule
description: A CSV-scoped rule
scope: "src/api/**,**/*.proto"
---
# CSV Rule

Applies to API code and protobufs.`,
        "utf-8",
      );
      const manifest = makeManifest();
      const outputs = await adapter.generate(agentsDir, manifest);

      const rule = outputs.find((o) => o.path.includes("csv-rule"));
      expect(rule).toBeDefined();
      expect(rule!.content).toMatch(
        /^---\npaths:\n  - "src\/api\/\*\*"\n  - "\*\*\/\*\.proto"\n---\n/,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // D9-6 (P2): canonical `scope: conditional` + `globs:` two-line form (the
  // companion to the inline-CSV test above). This exercises the
  // `resolveRuleGlobs` `scope === "conditional"` branch — the path the X4/CD4
  // GLOBS-DROP regression broke, where every conditional rule (incl.
  // `floor:security` `hatch3r-security-patterns`) emitted `paths: ["conditional"]`
  // and the real patterns in the `globs:` field were dropped, so no
  // `.claude/rules/` rule auto-loaded on its target files. Pins the exact
  // rendered `paths:` array and asserts the scope keyword never leaks.
  it("resolves conditional-scoped globs into the paths: array, never the scope keyword", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-conditional-"));
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

      const rule = outputs.find((o) => o.path.includes("conditional-rule"));
      expect(rule).toBeDefined();
      expect(rule!.content).toMatch(
        /^---\npaths:\n  - "src\/api\/\*\*"\n  - "\*\*\/\*\.proto"\n---\n/,
      );
      // The scope keyword must not survive into the resolved glob array.
      expect(rule!.content).not.toContain('"conditional"');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("generates agent files in .claude/agents/", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    // Top-level picker entries — companion subtrees (`.claude/agents/modes/`,
    // `.claude/agents/shared/`) are emitted but excluded from this count.
    const agents = outputs.filter((o) => /^\.claude\/agents\/[^/]+\.md$/.test(o.path));
    expect(agents.length).toBe(2);

    const agent = agents.find((o) => o.path === ".claude/agents/hatch3r-test-agent.md")!;
    expect(agent).toBeDefined();
    expect(agent.content).toContain("description: A test agent for unit testing");
    expect(agent.content).toContain("You are a test agent");
    expect(agent.managedContent).toBeDefined();
  });

  it("filters companion agent content (modes/shared) and command content (subdirectory/shared-context) from per-tool picker output", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    // Picker-level paths are top-level `.md` files only (no subdir segments)
    // — companion subtrees are emitted but live under `.claude/agents/modes/`,
    // `.claude/commands/board/`, etc. and must not surface in the picker.
    const topLevelAgentPaths = outputs
      .filter((o) => /^\.claude\/agents\/[^/]+\.md$/.test(o.path))
      .map((o) => o.path);
    const topLevelCommandPaths = outputs
      .filter((o) => /^\.claude\/commands\/[^/]+\.md$/.test(o.path))
      .map((o) => o.path);

    // Top-level primary fixtures survive
    expect(topLevelAgentPaths.some((p) => p.includes("test-agent"))).toBe(true);
    expect(topLevelCommandPaths.some((p) => p.includes("test-command"))).toBe(true);

    // Subdirectory companion fixtures are excluded from picker-level paths
    expect(topLevelAgentPaths.some((p) => p.includes("fake-mode"))).toBe(false);
    expect(topLevelAgentPaths.some((p) => p.includes("fake-reference"))).toBe(false);
    expect(topLevelCommandPaths.some((p) => p.includes("pickup-fake"))).toBe(false);

    // Top-level file with non-primary frontmatter type is excluded
    expect(topLevelCommandPaths.some((p) => p.includes("fake-shared"))).toBe(false);
  });

  it("emits companion subtree files under per-adapter native paths so canonical references resolve", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const pathSet = new Set(outputs.map((o) => o.path));

    // agents/modes/ fixture lands under `.claude/agents/modes/`
    expect(pathSet.has(".claude/agents/modes/fake-mode.md")).toBe(true);
    // agents/shared/ fixture lands under `.claude/agents/shared/`
    expect(pathSet.has(".claude/agents/shared/fake-reference.md")).toBe(true);
    // commands/board/ fixture lands under `.claude/commands/board/`
    expect(pathSet.has(".claude/commands/board/pickup-fake.md")).toBe(true);

    // Companion outputs are wrapped in managed blocks so orphan cleanup
    // and sync drift detection cover them.
    const companion = outputs.find((o) => o.path === ".claude/agents/modes/fake-mode.md");
    expect(companion).toBeDefined();
    expect(companion!.managedContent).toBeDefined();
    expect(companion!.content).toContain(MANAGED_BLOCK_START);
    expect(companion!.content).toContain(MANAGED_BLOCK_END);
  });

  // Slash-picker fix (release/2.6.0, S1c): command companions land under
  // `.claude/commands/board|revision|shared/`, where the namespaced picker
  // reads `description:` at byte 0 — they now carry the same byte-0 stub the
  // primary command emission does. Agent companions stay raw: `.claude/agents/**`
  // is parsed as agent definitions, and a stub would register reference
  // material as invocable agents.
  it("emits a byte-0 frontmatter stub on command companions but not agent companions", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const boardCompanion = outputs.find((o) => o.path === ".claude/commands/board/pickup-fake.md");
    expect(boardCompanion).toBeDefined();
    expect(boardCompanion!.content.startsWith("---\n")).toBe(true);
    expect(boardCompanion!.content.startsWith(MANAGED_BLOCK_START)).toBe(false);
    const stub = boardCompanion!.content.slice(0, boardCompanion!.content.indexOf(MANAGED_BLOCK_START));
    expect(stub).toContain("name: pickup-fake");
    expect(stub).toContain("description:");
    expect(stub).toContain("Subdirectory sub-workflow command fixture");
    expect(stub).not.toContain("HATCH3R:BEGIN");
    // The managed block still follows the stub (cache-breakpoint re-wrap
    // preserves the prefix per rewrapWithCacheBreakpoints).
    expect(boardCompanion!.content).toContain(MANAGED_BLOCK_START);
    expect(boardCompanion!.managedContent).toBeDefined();

    // Agent companions keep the marker at byte 0 (no stub).
    for (const path of [".claude/agents/modes/fake-mode.md", ".claude/agents/shared/fake-reference.md"]) {
      const agentCompanion = outputs.find((o) => o.path === path);
      expect(agentCompanion).toBeDefined();
      expect(agentCompanion!.content.startsWith(MANAGED_BLOCK_START)).toBe(true);
    }
  });

  it("includes Agent Teams section in CLAUDE.md", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
    expect(claudeMd!.content).toContain("## Agent Teams");
    expect(claudeMd!.content).toContain("CLAUDE.local.md");
  });

  // D9-12 (D9, P3): opt-in AGENTS.md interop — `@AGENTS.md` import line in the
  // CLAUDE.md managed block when claude.agentsMdInterop is on AND a repo-root
  // AGENTS.md exists.
  describe("AGENTS.md interop (D9-12)", () => {
    async function withTempRepo(
      files: Record<string, string>,
      run: (repoRoot: string) => Promise<void>,
    ): Promise<void> {
      const repoRoot = await mkdtemp(join(tmpdir(), "hatch3r-agentsmd-"));
      try {
        for (const [rel, body] of Object.entries(files)) {
          const abs = join(repoRoot, rel);
          await mkdir(dirname(abs), { recursive: true });
          await writeFile(abs, body, "utf8");
        }
        await run(repoRoot);
      } finally {
        await rm(repoRoot, { recursive: true, force: true });
      }
    }

    function claudeMdContent(outputs: Awaited<ReturnType<typeof adapter.generate>>): string {
      const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
      expect(claudeMd).toBeDefined();
      return claudeMd!.content;
    }

    it("emits @AGENTS.md import when interop is on and AGENTS.md exists", async () => {
      await withTempRepo({ "AGENTS.md": "# Cross-vendor agent rules\n" }, async (repoRoot) => {
        const manifest = makeManifest({ claude: { agentsMdInterop: true } });
        const outputs = await adapter.generate(FIXTURES_DIR, manifest, repoRoot);
        const content = claudeMdContent(outputs);
        // The bare import directive is on its own line so Claude Code parses it.
        expect(content).toMatch(/^@AGENTS\.md$/m);
        expect(content).toContain("AGENTS.md interop");
        // Import sits inside the managed block (between the markers).
        const start = content.indexOf(MANAGED_BLOCK_START);
        const importIdx = content.indexOf("@AGENTS.md");
        const end = content.indexOf(MANAGED_BLOCK_END);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(importIdx).toBeGreaterThan(start);
        expect(importIdx).toBeLessThan(end);
      });
    });

    it("emits no import when interop is on but no AGENTS.md exists", async () => {
      await withTempRepo({ "README.md": "no agents file here\n" }, async (repoRoot) => {
        const manifest = makeManifest({ claude: { agentsMdInterop: true } });
        const outputs = await adapter.generate(FIXTURES_DIR, manifest, repoRoot);
        const content = claudeMdContent(outputs);
        expect(content).not.toContain("@AGENTS.md");
        expect(content).not.toContain("AGENTS.md interop");
      });
    });

    it("emits no import when interop flag is absent even if AGENTS.md exists", async () => {
      await withTempRepo({ "AGENTS.md": "# present but interop off\n" }, async (repoRoot) => {
        const manifest = makeManifest(); // no claude.agentsMdInterop
        const outputs = await adapter.generate(FIXTURES_DIR, manifest, repoRoot);
        const content = claudeMdContent(outputs);
        expect(content).not.toContain("@AGENTS.md");
      });
    });

    it("emits no import when interop flag is explicitly false", async () => {
      await withTempRepo({ "AGENTS.md": "# present\n" }, async (repoRoot) => {
        const manifest = makeManifest({ claude: { agentsMdInterop: false } });
        const outputs = await adapter.generate(FIXTURES_DIR, manifest, repoRoot);
        expect(claudeMdContent(outputs)).not.toContain("@AGENTS.md");
      });
    });

    it("emits the import in minimal mode too", async () => {
      await withTempRepo({ "AGENTS.md": "# minimal-mode import\n" }, async (repoRoot) => {
        const manifest = makeManifest({ claude: { agentsMdInterop: true } });
        const outputs = await adapter.generate(FIXTURES_DIR, manifest, repoRoot, "minimal");
        expect(claudeMdContent(outputs)).toMatch(/^@AGENTS\.md$/m);
      });
    });
  });

  it("generates .claude/settings.json with permissions", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    expect(settings).toBeDefined();

    const parsed = JSON.parse(settings!.content);
    expect(parsed.permissions).toBeDefined();
    expect(parsed.permissions.allow).toContain("Read");
    expect(parsed.permissions.allow).toContain("Edit");
    expect(parsed.permissions.allow).toContain("Write");
    expect(parsed.permissions.allow).toContain("Grep");
    expect(parsed.permissions.deny).toEqual([]);
  });

  it("uses custom permissions from manifest.claude config", async () => {
    const manifest = makeManifest({
      claude: {
        permissions: {
          allow: ["Read", "Grep"],
          deny: ["Bash"],
        },
        teammateMode: "in-process",
      },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    expect(settings).toBeDefined();

    const parsed = JSON.parse(settings!.content);
    expect(parsed.permissions.allow).toEqual(["Read", "Grep"]);
    expect(parsed.permissions.deny).toEqual(["Bash"]);
    expect(parsed.teammateMode).toBe("in-process");
  });

  it("maps deprecated teammateMode values to 'auto'", async () => {
    const manifest = makeManifest({
      claude: {
        teammateMode: "full-trust",
      },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    expect(settings).toBeDefined();

    const parsed = JSON.parse(settings!.content);
    // "full-trust" is deprecated and should be mapped to "auto"
    expect(parsed.teammateMode).toBe("auto");
  });

  it("falls back to defaults when manifest.claude is partially configured", async () => {
    const manifest = makeManifest({
      claude: {
        permissions: { allow: ["Read", "Write"] },
      },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    const parsed = JSON.parse(settings!.content);
    expect(parsed.permissions.allow).toEqual(["Read", "Write"]);
    expect(parsed.permissions.deny).toEqual([]);
    expect(parsed.teammateMode).toBe("auto");
  });

  // D9-M4 (Cycle 10 D9 Wave-3, P3): Agent Teams remains EXPERIMENTAL per
  // https://code.claude.com/docs/en/agent-teams (accessed 2026-05-28) — the
  // feature is "disabled by default" and requires
  // CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS to be set. Default emission MUST
  // include the env var so Agent Teams actually functions; explicit opt-out
  // via `claude.agentTeams: false` suppresses it. The earlier D9-H-2 GA
  // reading was reversed after the docs re-verification pass found the
  // experimental warning unchanged.
  describe("D9-M4 Agent Teams experimental env-var emission", () => {
    function parsedSettings(outputs: Awaited<ReturnType<typeof adapter.generate>>) {
      const settings = outputs.find((o) => o.path === ".claude/settings.json");
      expect(settings).toBeDefined();
      return JSON.parse(settings!.content) as { env?: Record<string, string> };
    }

    it("emits the experimental env var by default (agentTeams unset)", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const parsed = parsedSettings(outputs);
      expect(parsed.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBe("1");
    });

    it("emits the experimental env var with an alias warning when agentTeams is 'ga'", async () => {
      const localAdapter = new ClaudeAdapter();
      const manifest = makeManifest({ claude: { agentTeams: "ga" } });
      const outputs = await localAdapter.generate(FIXTURES_DIR, manifest);
      const settings = outputs.find((o) => o.path === ".claude/settings.json");
      const parsed = JSON.parse(settings!.content);
      expect(parsed.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBe("1");
      expect(
        localAdapter.warnings.some((w) =>
          w.includes("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS") || w.includes("alias"),
        ),
      ).toBe(true);
    });

    it("omits the experimental env var when agentTeams is false (explicit opt-out)", async () => {
      const manifest = makeManifest({ claude: { agentTeams: false } });
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const parsed = parsedSettings(outputs);
      expect(parsed.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBeUndefined();
    });

    it("emits the experimental env var when agentTeams is true (explicit opt-in)", async () => {
      const manifest = makeManifest({ claude: { agentTeams: true } });
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const parsed = parsedSettings(outputs);
      expect(parsed.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBe("1");
    });
  });

  it("includes hooks config in settings.json when hooks are enabled", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    const parsed = JSON.parse(settings!.content);
    expect(parsed.hooks).toBeDefined();
    expect(parsed.hooks.PreToolUse).toBeDefined();
  });

  // C7-H17: Claude Code plugin-style hooks emission (D9, P3)
  // Source: https://code.claude.com/docs/en/plugins (accessed 2026-04-19)
  it("emits .claude/hooks/hatch3r-hooks.json with plugin-style hooks schema", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const pluginHooks = outputs.find((o) => o.path === ".claude/hooks/hatch3r-hooks.json");
    expect(pluginHooks).toBeDefined();

    const parsed = JSON.parse(pluginHooks!.content);
    expect(parsed.hooks).toBeDefined();
    // hooks/hooks.json uses the same {hooks: {EVENT: [{matcher, hooks:[...]}]}} schema as settings.json
    expect(parsed.hooks.PreToolUse).toBeDefined();
    expect(parsed.hooks.PreToolUse[0].matcher).toBeDefined();
    expect(Array.isArray(parsed.hooks.PreToolUse[0].hooks)).toBe(true);
    expect(parsed.hooks.PreToolUse[0].hooks[0].type).toBe("command");

    // Hatch3r metadata for managed-block tracking
    expect(parsed._hatch3r).toBeDefined();
    expect(parsed._hatch3r.managed).toBe(true);
    expect(parsed._hatch3r.schema).toBe("claude-code/plugin-hooks/v2.2");
  });

  it("does not emit plugin-style hooks file when hooks feature is disabled", async () => {
    const manifest = makeManifest({ features: { hooks: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const pluginHooks = outputs.find((o) => o.path === ".claude/hooks/hatch3r-hooks.json");
    expect(pluginHooks).toBeUndefined();
  });

  // C7.5-W2B2-H50 (D17-SA17.2-B, P3): Worktree events use Claude Code v2.1.x
  // native lifecycle names (WorktreeCreate / WorktreeRemove) per
  // code.claude.com/docs/en/plugins-reference (accessed 2026-04-19).
  it("maps worktree-create / worktree-remove to Claude Code v2.1.x native events", async () => {
    const manifest = makeManifest({
      worktree: { enabled: true },
    } as unknown as Parameters<typeof makeManifest>[0]);
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);
    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    expect(settings).toBeDefined();
    const parsed = JSON.parse(settings!.content);
    // When worktree is enabled, the adapter emits a native WorktreeCreate handler
    // in addition to the legacy PostToolUse+Bash fallback.
    expect(parsed.hooks.WorktreeCreate).toBeDefined();
    expect(Array.isArray(parsed.hooks.WorktreeCreate)).toBe(true);
    expect(parsed.hooks.WorktreeCreate[0].hooks[0].command).toContain("hatch3r worktree-setup --from-path");
  });

  it("plugin-style hooks file mirrors settings.json hooks (additive, both emitted)", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const pluginHooks = outputs.find((o) => o.path === ".claude/hooks/hatch3r-hooks.json");
    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    expect(pluginHooks).toBeDefined();
    expect(settings).toBeDefined();

    const pluginParsed = JSON.parse(pluginHooks!.content);
    const settingsParsed = JSON.parse(settings!.content);
    // Same hook event keys appear in both files
    const pluginEventKeys = Object.keys(pluginParsed.hooks).sort();
    const settingsEventKeys = Object.keys(settingsParsed.hooks).sort();
    expect(pluginEventKeys).toEqual(settingsEventKeys);
  });

  // D5-13 / D5-14 / D9-2 / D11-10 (Cycle 11, P3 + P5): hook event→matcher
  // mapping correctness. Claude Code matchers are event-specific
  // (code.claude.com/docs/en/hooks, accessed 2026-06-05): SessionStart matches
  // the session source; SubagentStart matches agent types; Stop ignores its
  // matcher; PostToolUse matches tool names. The FIXTURES_DIR ships ci-failure,
  // post-merge, and session-start hooks, so these assertions exercise the real
  // emission path.
  describe("hook event/matcher correctness (D5-13/D5-14/D9-2/D11-10)", () => {
    it("emits the SessionStart hook with a session-source matcher (startup), not a tool matcher", async () => {
      const outputs = await adapter.generate(FIXTURES_DIR, makeManifest());
      const settings = outputs.find((o) => o.path === ".claude/settings.json");
      const parsed = JSON.parse(settings!.content);
      expect(parsed.hooks.SessionStart).toBeDefined();
      // D5-13: SessionStart honors startup|resume|clear|compact — NOT ".*".
      const matchers = parsed.hooks.SessionStart.map((e: { matcher: string }) => e.matcher);
      expect(matchers).toContain("startup");
      expect(matchers).not.toContain(".*");
    });

    it("does NOT emit a SubagentStart hook for ci-failure (no native CI event); surfaces it as an advisory rule instead", async () => {
      const outputs = await adapter.generate(FIXTURES_DIR, makeManifest());
      const settings = outputs.find((o) => o.path === ".claude/settings.json");
      const parsed = JSON.parse(settings!.content);
      // D11-10/D9-2: the dead SubagentStart+"Bash" mapping is gone. SubagentStart
      // must not be emitted at all from the ci-failure fixture.
      expect(parsed.hooks.SubagentStart).toBeUndefined();
      // The ci-failure hook is re-surfaced as a managed advisory rule.
      const advisory = outputs.find(
        (o) => o.path === ".claude/rules/50-hatch3r-advisory-hooks.md",
      );
      expect(advisory).toBeDefined();
      expect(advisory!.content).toContain("ci-failure");
      expect(advisory!.content).toContain("no native Claude Code event");
    });

    it("gates the post-merge PostToolUse hook on a `git merge` detection, not every Bash call", async () => {
      const outputs = await adapter.generate(FIXTURES_DIR, makeManifest());
      const settings = outputs.find((o) => o.path === ".claude/settings.json");
      const parsed = JSON.parse(settings!.content);
      expect(parsed.hooks.PostToolUse).toBeDefined();
      // D5-14: the post-merge entry's command must guard on a `git merge`
      // substring so it does not fire on every shell command. The fixture's
      // post-merge agent is `deploy-agent`.
      const postMergeEntry = parsed.hooks.PostToolUse.find(
        (e: { matcher: string; hooks: Array<{ command: string }> }) =>
          e.matcher === "Bash" && e.hooks[0]!.command.includes("deploy-agent"),
      );
      expect(postMergeEntry).toBeDefined();
      expect(postMergeEntry.hooks[0].command).toContain('grep -q "git merge"');
    });

    // D5-40 (Cycle 11 Wave 3, D5, P3): the `file-save` hook's `globs` scope must
    // reach Claude. The matcher field is tool-name-only, so the scope is carried
    // by the per-handler `if` predicate (Claude Code v2.1.85+, permission-rule
    // syntax `Write(<glob>)` / `Edit(<glob>)`). Pre-fix the activation fired on
    // every Write regardless of file type. Isolated temp dir with a file-save
    // hook so the shared FIXTURES_DIR (no file-save hook) is untouched.
    it("scopes the file-save hook to its globs via per-handler `if` predicates", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-filesave-"));
      try {
        const agentsDir = join(tempDir, "agents");
        await mkdir(join(agentsDir, "hooks"), { recursive: true });
        await writeFile(
          join(agentsDir, "hooks", "file-save-ctx.md"),
          `---
id: file-save-ctx
type: hook
event: file-save
agent: context-rules
description: Activate context rules on save
globs: "**/*.ts, **/*.tsx"
---
# Hook: file-save

Body.`,
          "utf-8",
        );
        const outputs = await adapter.generate(agentsDir, makeManifest());
        const settings = outputs.find((o) => o.path === ".claude/settings.json");
        expect(settings).toBeDefined();
        const parsed = JSON.parse(settings!.content);
        expect(parsed.hooks.PostToolUse).toBeDefined();
        // The file-save entry widens the matcher to both file-modifying tools and
        // carries one `if`-scoped handler per (tool × glob). Find it by agent.
        const fileSaveEntry = parsed.hooks.PostToolUse.find(
          (e: { matcher: string; hooks: Array<{ command: string; if?: string }> }) =>
            e.matcher === "Write|Edit" &&
            e.hooks.some((h) => h.command.includes("context-rules")),
        );
        expect(fileSaveEntry).toBeDefined();
        const predicates = fileSaveEntry.hooks.map((h: { if?: string }) => h.if);
        // Both tools × both globs, scoped — never an unscoped (if-less) handler.
        expect(predicates).toContain("Write(**/*.ts)");
        expect(predicates).toContain("Edit(**/*.ts)");
        expect(predicates).toContain("Write(**/*.tsx)");
        expect(predicates).toContain("Edit(**/*.tsx)");
        expect(predicates).not.toContain(undefined);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    // D5-40 regression sentinel: a file-save hook with NO globs keeps the
    // single unscoped Write handler (no `if`, no matcher widening) — the
    // `if`-translation only triggers when a glob scope is declared.
    it("file-save hook without globs emits a single unscoped Write handler", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-filesave-noglob-"));
      try {
        const agentsDir = join(tempDir, "agents");
        await mkdir(join(agentsDir, "hooks"), { recursive: true });
        await writeFile(
          join(agentsDir, "hooks", "file-save-bare.md"),
          `---
id: file-save-bare
type: hook
event: file-save
agent: context-rules
description: Activate context rules on save
---
# Hook: file-save

Body.`,
          "utf-8",
        );
        const outputs = await adapter.generate(agentsDir, makeManifest());
        const settings = outputs.find((o) => o.path === ".claude/settings.json");
        const parsed = JSON.parse(settings!.content);
        const bareEntry = parsed.hooks.PostToolUse.find(
          (e: { matcher: string; hooks: Array<{ command: string; if?: string }> }) =>
            e.matcher === "Write" &&
            e.hooks.some((h) => h.command.includes("context-rules")),
        );
        expect(bareEntry).toBeDefined();
        expect(bareEntry.hooks).toHaveLength(1);
        expect(bareEntry.hooks[0].if).toBeUndefined();
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  it("generates skill files in .claude/skills/", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".claude/skills/"));
    expect(skills.length).toBe(1);

    const skill = skills[0]!;
    expect(skill.path).toContain("hatch3r-test-skill");
    expect(skill.path).toMatch(/SKILL\.md$/);
    expect(skill.content).toContain("test-skill");
    expect(skill.managedContent).toBeDefined();
    // Slash-command picker fix: the SKILL output now opens with YAML
    // frontmatter. It previously did not (raw managed block whose first line
    // was the HATCH3R:BEGIN marker, which the picker rendered as the
    // description). The Claude adapter switched skills to the with-fm helper.
    expect(skill.content.startsWith("---")).toBe(true);
    expect(skill.content.startsWith(MANAGED_BLOCK_START)).toBe(false);
    expect(skill.content).toContain("description:");
    expect(skill.content).toContain("A test skill for unit testing");
    const skillFm = skill.content.slice(0, skill.content.indexOf(MANAGED_BLOCK_START));
    expect(skillFm).not.toContain("HATCH3R:BEGIN");
  });

  it("emits per-command files with description frontmatter at byte 0 (slash-picker fix)", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    // The canonical command. The synthetic .claude/commands/hatch3r-agent-team.md
    // launcher is built inline (not via processCommandsWithFm), so target the
    // canonical command id explicitly.
    const cmd = outputs.find(
      (o) => o.path === ".claude/commands/hatch3r-test-command.md",
    );
    expect(cmd).toBeDefined();
    expect(cmd!.content.startsWith("---")).toBe(true);
    expect(cmd!.content.startsWith(MANAGED_BLOCK_START)).toBe(false);
    expect(cmd!.content).toContain("description:");
    expect(cmd!.content).toContain("A test command for unit testing");
    // The frontmatter block (before the managed block) carries the real
    // description, not the HATCH3R:BEGIN marker the picker used to show.
    const fmBlock = cmd!.content.slice(0, cmd!.content.indexOf(MANAGED_BLOCK_START));
    expect(fmBlock).toContain("description:");
    expect(fmBlock).not.toContain("HATCH3R:BEGIN");
    // Cache-breakpoint post-processing still wraps the managed body.
    expect(cmd!.managedContent).toBeDefined();
  });

  it("generates .mcp.json when MCP is enabled with servers", async () => {
    const manifest = makeManifest({ mcpServers: ["github"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcp = outputs.find((o) => o.path === ".mcp.json");
    expect(mcp).toBeDefined();

    const parsed = JSON.parse(mcp!.content);
    expect(parsed.mcpServers.github).toBeDefined();
  });

  // F17.2.3 (D17, P3) / D9-9 (Cycle 11, D9, P3): generated .mcp.json carries a
  // top-level `protocolVersion` ADVISORY marker (most-recent stable revision by
  // default) recording the revision the operator targets. It is not consumed by
  // the Claude MCP loader (top-level schema is `mcpServers` only,
  // code.claude.com/docs/en/mcp accessed 2026-06-09) — these tests pin that the
  // marker is emitted and honors the manifest override, not a handshake effect.
  it("emits protocolVersion (default stable revision) in .mcp.json", async () => {
    const manifest = makeManifest({ mcpServers: ["github"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcp = outputs.find((o) => o.path === ".mcp.json");
    expect(mcp).toBeDefined();
    const parsed = JSON.parse(mcp!.content);
    expect(parsed.protocolVersion).toBe("2025-11-25");
    // mcpServers still rides alongside the version field.
    expect(parsed.mcpServers.github).toBeDefined();
  });

  it("honors mcp.protocolVersion override from the manifest", async () => {
    const manifest = makeManifest({ mcpServers: ["github"] });
    manifest.mcp.protocolVersion = "2026-07-28";
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcp = outputs.find((o) => o.path === ".mcp.json");
    expect(mcp).toBeDefined();
    const parsed = JSON.parse(mcp!.content);
    expect(parsed.protocolVersion).toBe("2026-07-28");
  });

  it("does not generate .mcp.json when no servers configured", async () => {
    const manifest = makeManifest({ mcpServers: [] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcp = outputs.find((o) => o.path === ".mcp.json");
    expect(mcp).toBeUndefined();
  });

  it("transforms ${env:VAR} to ${VAR} in .mcp.json for Claude Code", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-mcp-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "mcp"), { recursive: true });
      await writeFile(
        join(agentsDir, "mcp", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            github: {
              // F15.5-H2: HTTP transport survives the readFilteredMcp pin gate
              // via _trust_bypass (mirrors production mcp.json — rotating API,
              // pinning impossible). Marker is stripped on emission.
              _trust_bypass: true,
              url: "https://api.githubcopilot.com/mcp/",
              headers: {
                Authorization: "Bearer ${env:GITHUB_PAT}",
                "X-Custom": "static-value",
              },
            },
            "brave-search": {
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-brave-search"],
              env: {
                BRAVE_API_KEY: "${env:BRAVE_API_KEY}",
              },
            },
          },
        }),
        "utf-8",
      );
      const manifest = makeManifest({ mcpServers: ["github", "brave-search"] });
      const outputs = await adapter.generate(agentsDir, manifest);

      const mcp = outputs.find((o) => o.path === ".mcp.json");
      expect(mcp).toBeDefined();
      const parsed = JSON.parse(mcp!.content);

      expect(parsed.mcpServers.github.headers.Authorization).toBe("Bearer ${GITHUB_PAT}");
      expect(parsed.mcpServers.github.headers["X-Custom"]).toBe("static-value");
      expect(parsed.mcpServers["brave-search"].env.BRAVE_API_KEY).toBe("${BRAVE_API_KEY}");
      expect(mcp!.content).not.toContain("${env:");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("adds type field to .mcp.json entries (stdio for command, http for url)", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-mcp-type-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "mcp"), { recursive: true });
      await writeFile(
        join(agentsDir, "mcp", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            "url-server": {
              // F15.5-H2: HTTP transport requires a pin or trust-bypass to
              // survive the readFilteredMcp emission gate.
              _trust_bypass: true,
              url: "https://example.com/mcp",
            },
            "cmd-server": {
              command: "npx",
              args: ["-y", "some-mcp-server"],
            },
          },
        }),
        "utf-8",
      );
      const manifest = makeManifest({ mcpServers: ["url-server", "cmd-server"] });
      const outputs = await adapter.generate(agentsDir, manifest);

      const mcp = outputs.find((o) => o.path === ".mcp.json");
      expect(mcp).toBeDefined();
      const parsed = JSON.parse(mcp!.content);

      expect(parsed.mcpServers["url-server"].type).toBe("http");
      expect(parsed.mcpServers["cmd-server"].type).toBe("stdio");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // F15.5-H2 (D15 / Pillar P6): an HTTP-transport MCP entry that is neither
  // SHA-256 pinned nor trust-bypassed is REFUSED at emission (dropped from the
  // generated config), not merely warned. A stdio entry in the same config is
  // unaffected, and the drop is surfaced as an auditable warning.
  it("refuses an unpinned HTTP MCP entry at emission and warns (does not emit it)", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-mcp-pin-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "mcp"), { recursive: true });
      await writeFile(
        join(agentsDir, "mcp", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            "unpinned-http": {
              // No _pinned_sha256 and no _trust_bypass → must be dropped.
              url: "https://untrusted.example.com/mcp",
            },
            "pinned-http": {
              _pinned_sha256: "b".repeat(64),
              url: "https://pinned.example.com/mcp",
            },
            "safe-stdio": {
              command: "npx",
              args: ["-y", "@scope/pkg@1.0.0"],
            },
          },
        }),
        "utf-8",
      );
      const localAdapter = new ClaudeAdapter();
      const manifest = makeManifest({
        mcpServers: ["unpinned-http", "pinned-http", "safe-stdio"],
      });
      const outputs = await localAdapter.generate(agentsDir, manifest);

      const mcp = outputs.find((o) => o.path === ".mcp.json");
      expect(mcp).toBeDefined();
      const parsed = JSON.parse(mcp!.content);

      // The unpinned HTTP entry is NOT emitted.
      expect(parsed.mcpServers["unpinned-http"]).toBeUndefined();
      // The pinned HTTP entry and the stdio entry survive.
      expect(parsed.mcpServers["pinned-http"]).toBeDefined();
      expect(parsed.mcpServers["safe-stdio"]).toBeDefined();

      // The drop is auditable.
      const dropWarn = localAdapter.warnings.find(
        (w) => w.includes("unpinned-http") && w.includes("omitted from generated config"),
      );
      expect(dropWarn).toBeDefined();
      expect(dropWarn).toMatch(/missing _pinned_sha256/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("strips _description from .mcp.json entries", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-mcp-desc-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "mcp"), { recursive: true });
      await writeFile(
        join(agentsDir, "mcp", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            "test-server": {
              _description: "Should be stripped",
              command: "npx",
              args: ["-y", "test-server"],
            },
          },
        }),
        "utf-8",
      );
      const manifest = makeManifest({ mcpServers: ["test-server"] });
      const outputs = await adapter.generate(agentsDir, manifest);

      const mcp = outputs.find((o) => o.path === ".mcp.json");
      expect(mcp).toBeDefined();
      const parsed = JSON.parse(mcp!.content);

      expect(parsed.mcpServers["test-server"]._description).toBeUndefined();
      expect(mcp!.content).not.toContain("_description");
      expect(parsed.mcpServers["test-server"].type).toBe("stdio");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // D9-C-1 (Pillar P6): the canonical schema stores the operator-configured
  // MCP tool timeout under the private `_timeout` field, but Claude Code's
  // MCP loader reads it from the public `timeout` field in milliseconds
  // (https://code.claude.com/docs/en/mcp, accessed 2026-05-27).
  // Regression test asserts that the Claude adapter translates `_timeout`
  // -> `timeout` on emission and does not leak the private key — without
  // this translation, operator timeouts are silently ignored and other
  // private-prefixed framework-internal markers (`_pinned_sha256`,
  // `_trust_bypass`) surface in the emitted artifact.
  it("translates _timeout to public timeout field and strips private framework markers in .mcp.json", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-mcp-timeout-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "mcp"), { recursive: true });
      await writeFile(
        join(agentsDir, "mcp", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            "stdio-server": {
              command: "npx",
              args: ["-y", "@scope/pkg@1.0.0"],
              _timeout: 60000,
            },
            "http-server": {
              url: "https://example.com/mcp",
              _timeout: 120000,
              _pinned_sha256: "a".repeat(64),
              _trust_bypass: false,
            },
            "no-timeout-server": {
              command: "npx",
              args: ["-y", "@scope/other@1.0.0"],
            },
            "invalid-timeout-server": {
              command: "npx",
              args: ["-y", "@scope/third@1.0.0"],
              _timeout: -1,
            },
          },
        }),
        "utf-8",
      );
      const manifest = makeManifest({
        mcpServers: [
          "stdio-server",
          "http-server",
          "no-timeout-server",
          "invalid-timeout-server",
        ],
      });
      const outputs = await adapter.generate(agentsDir, manifest);

      const mcp = outputs.find((o) => o.path === ".mcp.json");
      expect(mcp).toBeDefined();
      const parsed = JSON.parse(mcp!.content);

      // Valid positive _timeout is translated to public `timeout` field
      // (milliseconds preserved 1:1 per docs).
      expect(parsed.mcpServers["stdio-server"].timeout).toBe(60000);
      expect(parsed.mcpServers["http-server"].timeout).toBe(120000);

      // Private `_timeout` key never appears in the emitted JSON.
      expect(parsed.mcpServers["stdio-server"]._timeout).toBeUndefined();
      expect(parsed.mcpServers["http-server"]._timeout).toBeUndefined();
      expect(mcp!.content).not.toContain("_timeout");

      // Other private framework markers are stripped from emission.
      expect(parsed.mcpServers["http-server"]._pinned_sha256).toBeUndefined();
      expect(parsed.mcpServers["http-server"]._trust_bypass).toBeUndefined();
      expect(mcp!.content).not.toContain("_pinned_sha256");
      expect(mcp!.content).not.toContain("_trust_bypass");

      // No timeout source means no public timeout key on the emission.
      expect(parsed.mcpServers["no-timeout-server"].timeout).toBeUndefined();

      // Invalid (non-positive) _timeout is dropped, not coerced.
      expect(parsed.mcpServers["invalid-timeout-server"].timeout).toBeUndefined();
      expect(parsed.mcpServers["invalid-timeout-server"]._timeout).toBeUndefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("skips rules when features.rules is false", async () => {
    const manifest = makeManifest({ features: { rules: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const rules = outputs.filter((o) => o.path.startsWith(".claude/rules/"));
    expect(rules.length).toBe(0);
  });

  it("skips agents when features.agents is false", async () => {
    const manifest = makeManifest({ features: { agents: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agents = outputs.filter((o) => o.path.startsWith(".claude/agents/"));
    expect(agents.length).toBe(0);
  });

  it("skips skills when features.skills is false", async () => {
    const manifest = makeManifest({ features: { skills: false } });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".claude/skills/"));
    expect(skills.length).toBe(0);
  });

  it("emits model from customization file when present", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest, FIXTURES_USER_REPO);

    const agentFile = outputs.find((o) => o.path === ".claude/agents/hatch3r-test-agent.md");
    expect(agentFile).toBeDefined();
    // D9-H-1 (D9, P3): native subagent `model:` frontmatter is emitted and is
    // authoritative; the `## Recommended Model` prose is retained for the
    // per-session override path.
    expect(agentFile!.content).toMatch(/^---\n[\s\S]*\nmodel: claude-sonnet-5\n[\s\S]*?---/);
    expect(agentFile!.content).toContain("## Recommended Model");
    expect(agentFile!.content).toContain("Preferred: `claude-sonnet-5`");
    expect(agentFile!.content).toContain("CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-5");
  });

  it("omits native model: frontmatter for a non-Claude model, keeping only advisory prose", async () => {
    // D9-3 (Cycle 11, P3 + P5): Claude Code's subagent `model:` field accepts
    // ONLY a Claude-recognizable value (sonnet/opus/haiku, a `claude-*` ID, or
    // inherit). A non-Claude model (here `gpt-4`) MUST NOT be written into the
    // native field — Claude rejects an unknown ID (hard error or silent
    // default fallback). The preference is surfaced as `## Recommended Model`
    // prose only.
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-model-"));
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

      const agentFile = outputs.find((o) => o.path === ".claude/agents/hatch3r-test-agent.md");
      expect(agentFile).toBeDefined();
      // The native `model:` field must be ABSENT for a non-Claude model.
      const fmMatch = agentFile!.content.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch).not.toBeNull();
      expect(fmMatch![1]).not.toMatch(/^model:/m);
      // Advisory prose still documents the preference + override path.
      expect(agentFile!.content).toContain("## Recommended Model");
      expect(agentFile!.content).toContain("Preferred: `gpt-4`");
      expect(agentFile!.content).toContain("CLAUDE_CODE_SUBAGENT_MODEL=gpt-4");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("emits native model: frontmatter for a Claude alias / claude-* ID", async () => {
    // D9-3 (Cycle 11): the complement of the non-Claude case — a recognizable
    // value (alias `opus` or a `claude-*` ID) IS written into the native field.
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-model-ok-"));
    try {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await writeFile(
        join(agentsDir, "agents", "test-agent.md"),
        `---\nid: test-agent\ntype: agent\ndescription: A test agent\n---\n# Test Agent\n\nYou are a test agent.`,
        "utf-8",
      );
      // `opus` is a Claude alias → expands to `claude-opus-4-8` (a `claude-*` ID).
      const manifest = makeManifest({ models: { agents: { "test-agent": "opus" } } });
      const outputs = await adapter.generate(agentsDir, manifest);
      const agentFile = outputs.find((o) => o.path === ".claude/agents/hatch3r-test-agent.md");
      expect(agentFile).toBeDefined();
      expect(agentFile!.content).toMatch(/^---\n[\s\S]*\nmodel: claude-opus-4-8\n[\s\S]*?---/);
      expect(agentFile!.content).toContain("Preferred: `claude-opus-4-8`");
      // A user-set concrete model NEVER gets an `effort:` line — hatch3r
      // cannot assume effort semantics for an explicit model choice.
      const fmMatch = agentFile!.content.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch![1]).not.toMatch(/^effort:/m);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // Model classes (release/2.6.0): canonical `model:` frontmatter carries a
  // capability class (economy|default|strongest) that the Claude adapter maps
  // via models.tiers pin > CLAUDE_TIER_MODEL_MAP, with a paired `effort:` line
  // only on the adapter-map path (src/models/tiers.ts).
  describe("model-class emission (release/2.6.0)", () => {
    /** Temp canonical root with one agent whose frontmatter model is `model`. */
    async function setupAgentWithModel(tempDir: string, model: string): Promise<string> {
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await writeFile(
        join(agentsDir, "agents", "test-agent.md"),
        `---\nid: test-agent\ntype: agent\ndescription: A class-model test agent\nmodel: ${model}\n---\n# Test Agent\n\nYou are a test agent.`,
        "utf-8",
      );
      return agentsDir;
    }

    async function generateFm(model: string, manifestOverrides: Parameters<typeof makeManifest>[0] = {}): Promise<{ fm: string; content: string }> {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-class-"));
      try {
        const agentsDir = await setupAgentWithModel(tempDir, model);
        const outputs = await adapter.generate(agentsDir, makeManifest(manifestOverrides));
        const agentFile = outputs.find((o) => o.path === ".claude/agents/hatch3r-test-agent.md");
        expect(agentFile).toBeDefined();
        const fmMatch = agentFile!.content.match(/^---\n([\s\S]*?)\n---/);
        expect(fmMatch).not.toBeNull();
        return { fm: fmMatch![1], content: agentFile!.content };
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }

    it("strongest → model: opus + effort: high", async () => {
      const { fm, content } = await generateFm("strongest");
      expect(fm).toMatch(/^model: opus$/m);
      expect(fm).toMatch(/^effort: high$/m);
      expect(content).toContain("Model class: `strongest` (mapped: `opus`)");
      expect(content).toContain("CLAUDE_CODE_SUBAGENT_MODEL=opus");
    });

    it("economy → model: haiku + effort: medium", async () => {
      const { fm, content } = await generateFm("economy");
      expect(fm).toMatch(/^model: haiku$/m);
      expect(fm).toMatch(/^effort: medium$/m);
      expect(content).toContain("Model class: `economy` (mapped: `haiku`)");
    });

    it("default → model: sonnet with NO effort line", async () => {
      const { fm, content } = await generateFm("default");
      expect(fm).toMatch(/^model: sonnet$/m);
      expect(fm).not.toMatch(/^effort:/m);
      expect(content).toContain("Model class: `default` (mapped: `sonnet`)");
    });

    it("legacy synonyms fast/standard/reasoning map through the class path", async () => {
      const fast = await generateFm("fast");
      expect(fast.fm).toMatch(/^model: haiku$/m);
      const standard = await generateFm("standard");
      expect(standard.fm).toMatch(/^model: sonnet$/m);
      const reasoning = await generateFm("reasoning");
      expect(reasoning.fm).toMatch(/^model: opus$/m);
      expect(reasoning.fm).toMatch(/^effort: high$/m);
    });

    it("models.tiers pin wins over the class map, alias-expands, and suppresses effort", async () => {
      const { fm } = await generateFm("strongest", { models: { tiers: { strongest: "fable" } } });
      // Pin `fable` alias-expands to claude-fable-5 and passes the gate.
      expect(fm).toMatch(/^model: claude-fable-5$/m);
      // Operator-pinned model → no effort assumption.
      expect(fm).not.toMatch(/^effort:/m);
    });

    it("an unrecognizable models.tiers pin is omitted from the native field (gate preserved)", async () => {
      const { fm, content } = await generateFm("economy", { models: { tiers: { economy: "gpt-5.1-codex-mini" } } });
      expect(fm).not.toMatch(/^model:/m);
      expect(fm).not.toMatch(/^effort:/m);
      // Advisory prose still documents the class + mapped value.
      expect(content).toContain("Model class: `economy` (mapped: `gpt-5.1-codex-mini`)");
    });
  });

  // release/2.2.0: per-skill / per-command `model:` frontmatter. Claude Code
  // documents the field on skills and slash commands with the subagent value
  // set (sonnet/opus/haiku/fable, full ID, or `inherit`; omitted = inherit),
  // so emission reuses the D9-3 recognizable-value gate; `inherit` and
  // non-Claude values are omitted (omission IS the inherit/default semantic).
  // `models.default` deliberately does NOT feed skills/commands.
  describe("skill and command model: frontmatter (release/2.2.0)", () => {
    /** Temp canonical root with one skill (`my-skill`) and one command (`my-command`), neither carrying frontmatter `model:`. */
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

    function frontmatterOf(content: string): string {
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      expect(match).not.toBeNull();
      return match![1];
    }

    it("emits no model line when nothing is configured, even with models.default set (agents-only default)", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-sc-model-unset-"));
      try {
        const canonicalRoot = await setupCanonical(tempDir);
        const manifest = makeManifest({ models: { default: "opus" } });
        const outputs = await adapter.generate(canonicalRoot, manifest);
        const skill = outputs.find((o) => o.path === ".claude/skills/hatch3r-my-skill/SKILL.md");
        const command = outputs.find((o) => o.path === ".claude/commands/hatch3r-my-command.md");
        expect(skill).toBeDefined();
        expect(command).toBeDefined();
        expect(frontmatterOf(skill!.content)).not.toMatch(/^model:/m);
        expect(frontmatterOf(command!.content)).not.toMatch(/^model:/m);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("emits model: for models.skills / models.commands entries with a Claude-recognizable value (alias-expanded)", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-sc-model-set-"));
      try {
        const canonicalRoot = await setupCanonical(tempDir);
        const manifest = makeManifest({
          models: { skills: { "my-skill": "opus" }, commands: { "my-command": "claude-sonnet-4-6" } },
        });
        const outputs = await adapter.generate(canonicalRoot, manifest);
        const skill = outputs.find((o) => o.path === ".claude/skills/hatch3r-my-skill/SKILL.md");
        const command = outputs.find((o) => o.path === ".claude/commands/hatch3r-my-command.md");
        expect(frontmatterOf(skill!.content)).toMatch(/^model: claude-opus-4-8$/m);
        expect(frontmatterOf(command!.content)).toMatch(/^model: claude-sonnet-4-6$/m);
        // No `## Recommended Model` prose fallback on skills/commands — that
        // advisory surface stays agent-only.
        expect(skill!.content).not.toContain("## Recommended Model");
        expect(command!.content).not.toContain("## Recommended Model");
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("omits model: for a non-Claude value (gpt-4) and for inherit", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-sc-model-gate-"));
      try {
        const canonicalRoot = await setupCanonical(tempDir);
        const manifest = makeManifest({
          models: { skills: { "my-skill": "gpt-4" }, commands: { "my-command": "inherit" } },
        });
        const outputs = await adapter.generate(canonicalRoot, manifest);
        const skill = outputs.find((o) => o.path === ".claude/skills/hatch3r-my-skill/SKILL.md");
        const command = outputs.find((o) => o.path === ".claude/commands/hatch3r-my-command.md");
        expect(frontmatterOf(skill!.content)).not.toMatch(/^model:/m);
        expect(frontmatterOf(command!.content)).not.toMatch(/^model:/m);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("customize.yaml model beats the manifest map on skills and commands", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-sc-model-cust-"));
      try {
        const canonicalRoot = await setupCanonical(tempDir);
        await mkdir(join(tempDir, ".hatch3r", "skills"), { recursive: true });
        await writeFile(join(tempDir, ".hatch3r", "skills", "my-skill.customize.yaml"), "model: haiku", "utf-8");
        await mkdir(join(tempDir, ".hatch3r", "commands"), { recursive: true });
        await writeFile(join(tempDir, ".hatch3r", "commands", "my-command.customize.yaml"), "model: haiku", "utf-8");
        const manifest = makeManifest({
          models: { skills: { "my-skill": "opus" }, commands: { "my-command": "opus" } },
        });
        const outputs = await adapter.generate(canonicalRoot, manifest, tempDir);
        const skill = outputs.find((o) => o.path === ".claude/skills/hatch3r-my-skill/SKILL.md");
        const command = outputs.find((o) => o.path === ".claude/commands/hatch3r-my-command.md");
        expect(frontmatterOf(skill!.content)).toMatch(/^model: claude-haiku-4-5$/m);
        expect(frontmatterOf(command!.content)).toMatch(/^model: claude-haiku-4-5$/m);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  it("all outputs have action 'create'", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.action).toBe("create");
    }
  });

  // ── Branch gap tests: empty features, no MCP, empty tools ──

  it("generates minimal output when all features are false", async () => {
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

    // Should still produce CLAUDE.md bridge and settings.json at minimum
    const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
    expect(claudeMd).toBeDefined();
    expect(claudeMd!.content).toContain("Hatch3r");

    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    expect(settings).toBeDefined();

    // No rules, agents, skills, or MCP
    const rules = outputs.filter((o) => o.path.startsWith(".claude/rules/"));
    const agents = outputs.filter((o) => o.path.startsWith(".claude/agents/"));
    const skills = outputs.filter((o) => o.path.startsWith(".claude/skills/"));
    const mcp = outputs.find((o) => o.path === ".mcp.json");
    expect(rules.length).toBe(0);
    expect(agents.length).toBe(0);
    expect(skills.length).toBe(0);
    expect(mcp).toBeUndefined();
  });

  it("does not generate MCP config when no servers are configured", async () => {
    const manifest = makeManifest({ mcpServers: [] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const mcp = outputs.find((o) => o.path === ".mcp.json");
    expect(mcp).toBeUndefined();
  });

  it("produces no empty content in any output", async () => {
    const manifest = makeManifest();
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.content.length).toBeGreaterThan(0);
    }
  });

  it("warns about deprecated teammateMode values (#264, D9-9.35)", async () => {
    const deprecatedAdapter = new ClaudeAdapter();
    const manifest = makeManifest({
      claude: { teammateMode: "tool-using" },
    });
    const outputs = await deprecatedAdapter.generate(FIXTURES_DIR, manifest);

    expect(deprecatedAdapter.warnings).toContainEqual(
      expect.stringContaining("deprecated"),
    );
    expect(deprecatedAdapter.warnings).toContainEqual(
      expect.stringContaining("tool-using"),
    );

    // Should default to "auto" in settings.json output
    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    expect(settings).toBeDefined();
    const parsed = JSON.parse(settings!.content);
    expect(parsed.teammateMode).toBe("auto");
  });

  it("does not warn for GA teammateMode values (#264, D9-9.35)", async () => {
    const gaAdapter = new ClaudeAdapter();
    const manifest = makeManifest({
      claude: { teammateMode: "tmux" },
    });
    await gaAdapter.generate(FIXTURES_DIR, manifest);

    const deprecationWarnings = gaAdapter.warnings.filter((w) =>
      w.includes("deprecated"),
    );
    expect(deprecationWarnings).toHaveLength(0);
  });

  // ── Finding 3.10: generationMode "minimal" integration test ──
  it("produces shorter output in minimal mode than standard mode", async () => {
    const manifest = makeManifest();
    const standardOutputs = await adapter.generate(FIXTURES_DIR, manifest, undefined, "standard");
    const minimalAdapter = new ClaudeAdapter();
    const minimalOutputs = await minimalAdapter.generate(FIXTURES_DIR, manifest, undefined, "minimal");

    const stdBridge = standardOutputs.find((o) => o.path === "CLAUDE.md");
    const minBridge = minimalOutputs.find((o) => o.path === "CLAUDE.md");
    expect(stdBridge).toBeDefined();
    expect(minBridge).toBeDefined();
    expect(minBridge!.content.length).toBeLessThanOrEqual(stdBridge!.content.length);
  });

  it("minimal mode still produces valid non-empty output", async () => {
    const manifest = makeManifest();
    const minimalAdapter = new ClaudeAdapter();
    const outputs = await minimalAdapter.generate(FIXTURES_DIR, manifest, undefined, "minimal");

    for (const o of outputs) {
      expect(o.content.length).toBeGreaterThan(0);
    }
    const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
    expect(claudeMd).toBeDefined();
    expect(claudeMd!.content).toContain("Hatch3r");
  });

  // Wave B3: precedence-based NN- filename prefix on .claude/rules/ outputs.
  // Mapping: critical -> 10, high -> 30, normal -> 50, low -> 70. The
  // per-file adapter prepends the rank to the canonical `hatch3r-` prefix so
  // alphabetical load order reflects precedence.
  it("emits NN- numeric prefix derived from rule precedence", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-precedence-"));
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

      const securityRule = outputs.find((o) => o.path === ".claude/rules/10-hatch3r-security.md");
      const testingRule = outputs.find((o) => o.path === ".claude/rules/50-hatch3r-testing.md");
      const learningRule = outputs.find((o) => o.path === ".claude/rules/70-hatch3r-learning.md");

      expect(securityRule).toBeDefined();
      expect(testingRule).toBeDefined();
      expect(learningRule).toBeDefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // C7.5-W2B2-H41 (D15, P6): per-adapter `tools:` frontmatter emission.
  // Verify the Claude Code adapter emits a policy-derived `tools:` field
  // for canonical agents registered in AGENT_TOOL_POLICIES, and omits it
  // for custom/unknown agents (preserving the upstream inherit-from-parent
  // default).
  describe("C7.5-W2B2-H41 tools: frontmatter emission", () => {
    async function runWithAgent(
      agentId: string,
      body: string,
    ): Promise<Awaited<ReturnType<typeof adapter.generate>>> {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-tools-"));
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await writeFile(
        join(agentsDir, "agents", `${agentId}.md`),
        `---\nid: ${agentId}\ntype: agent\ndescription: ${agentId} description\n---\n${body}\n`,
        "utf-8",
      );
      try {
        return await adapter.generate(agentsDir, makeManifest());
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }

    it("emits tools: for hatch3r-reviewer restricted to Read/Grep/Glob", async () => {
      const outputs = await runWithAgent("reviewer", "# Reviewer");
      const file = outputs.find(
        (o) => o.path === ".claude/agents/hatch3r-reviewer.md",
      );
      expect(file).toBeDefined();
      expect(file!.content).toMatch(/^---\n[\s\S]*?tools: [\s\S]*?\n---/m);
      expect(file!.content).toContain("Read");
      expect(file!.content).toContain("Grep");
      expect(file!.content).toContain("Glob");
      // Monotonic privilege: reviewer is read+search only — no write, edit, bash.
      const fmMatch = file!.content.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch).not.toBeNull();
      const fm = fmMatch![1];
      expect(fm).not.toContain("Write");
      expect(fm).not.toContain("Edit");
      expect(fm).not.toContain("Bash");
    });

    it("emits tools: for hatch3r-implementer including Write and Bash", async () => {
      const outputs = await runWithAgent("implementer", "# Implementer");
      const file = outputs.find(
        (o) => o.path === ".claude/agents/hatch3r-implementer.md",
      );
      expect(file).toBeDefined();
      const fmMatch = file!.content.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch).not.toBeNull();
      const fm = fmMatch![1];
      expect(fm).toContain("tools:");
      expect(fm).toContain("Write");
      expect(fm).toContain("Bash");
      expect(fm).toContain("Edit");
    });

    it("omits tools: for custom agents without a registered policy", async () => {
      const outputs = await runWithAgent("custom-agent", "# Custom");
      const file = outputs.find(
        (o) => o.path === ".claude/agents/hatch3r-custom-agent.md",
      );
      expect(file).toBeDefined();
      const fmMatch = file!.content.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch).not.toBeNull();
      const fm = fmMatch![1];
      expect(fm).not.toContain("tools:");
      expect(fm).toContain("description:");
    });

    // D9-11 (Cycle 11 Wave 3, D9, P3): a read-only-role agent (policy lacks
    // write+execute) emits `permissionMode: plan` — the Claude analog of the
    // Cursor `readonly: true` primitive. Producer agents (write/execute) and
    // user agents (no policy) omit the field and inherit the parent mode.
    it("emits permissionMode: plan for the read-only hatch3r-reviewer", async () => {
      const outputs = await runWithAgent("reviewer", "# Reviewer");
      const file = outputs.find(
        (o) => o.path === ".claude/agents/hatch3r-reviewer.md",
      );
      expect(file).toBeDefined();
      const fm = file!.content.match(/^---\n([\s\S]*?)\n---/)![1];
      expect(fm).toContain("permissionMode: plan");
    });

    it("omits permissionMode for the writer hatch3r-implementer", async () => {
      const outputs = await runWithAgent("implementer", "# Implementer");
      const file = outputs.find(
        (o) => o.path === ".claude/agents/hatch3r-implementer.md",
      );
      expect(file).toBeDefined();
      const fm = file!.content.match(/^---\n([\s\S]*?)\n---/)![1];
      expect(fm).not.toContain("permissionMode");
    });

    it("omits permissionMode for a custom agent without a registered policy", async () => {
      const outputs = await runWithAgent("custom-agent", "# Custom");
      const file = outputs.find(
        (o) => o.path === ".claude/agents/hatch3r-custom-agent.md",
      );
      expect(file).toBeDefined();
      const fm = file!.content.match(/^---\n([\s\S]*?)\n---/)![1];
      expect(fm).not.toContain("permissionMode");
    });
  });

  // D15-3 (Cycle 11, P6 / ASI02-03): a canonical agent's short-form
  // `tools: { allow, deny }` deny envelope must SURVIVE into the generated
  // Claude agent file. Pre-fix the list was parsed and dropped — the file
  // rebuilt frontmatter from the coarse policy allowlist only (SA15.3-F1).
  // Top-level denies (Write/Edit/MultiEdit) → native `disallowedTools:`;
  // granular `Bash:<subcommand>` denies → `## Tool Restrictions` body block
  // (Claude subagent frontmatter cannot express per-subcommand Bash scope).
  describe("D15-3 short-form tools.deny round-trip", () => {
    async function runWithToolsAgent(): Promise<
      Awaited<ReturnType<typeof adapter.generate>>
    > {
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-deny-"));
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      // Mirror the dependency-drafter shape: top-level + granular Bash denies.
      await writeFile(
        join(agentsDir, "agents", "drafter.md"),
        [
          "---",
          "id: drafter",
          "type: agent",
          "description: A drafter agent",
          "tools:",
          '  allow: [Read, Grep, Glob, "Bash:git status", "Bash:git log"]',
          '  deny: [Write, Edit, MultiEdit, "Bash:git commit", "Bash:git push"]',
          "---",
          "# Drafter",
          "",
          "You draft proposals.",
          "",
        ].join("\n"),
        "utf-8",
      );
      try {
        return await adapter.generate(agentsDir, makeManifest());
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }

    it("re-emits top-level denies as native disallowedTools: frontmatter", async () => {
      const outputs = await runWithToolsAgent();
      const file = outputs.find((o) => o.path === ".claude/agents/hatch3r-drafter.md");
      expect(file).toBeDefined();
      const fmMatch = file!.content.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch).not.toBeNull();
      const fm = fmMatch![1];
      expect(fm).toMatch(/^disallowedTools:/m);
      // Every top-level deny survives into the native denylist field.
      expect(fm).toContain("Write");
      expect(fm).toContain("Edit");
      expect(fm).toContain("MultiEdit");
    });

    it("re-emits granular Bash subcommand denies as a Tool Restrictions block", async () => {
      const outputs = await runWithToolsAgent();
      const file = outputs.find((o) => o.path === ".claude/agents/hatch3r-drafter.md");
      expect(file).toBeDefined();
      expect(file!.content).toContain("## Tool Restrictions");
      // Every granular Bash:git* deny survives into the body block.
      expect(file!.content).toContain("Bash:git commit");
      expect(file!.content).toContain("Bash:git push");
      // The granular allows are documented too.
      expect(file!.content).toContain("Bash:git status");
    });

    it("does not emit disallowedTools or a restrictions block for an agent without a tools grant", async () => {
      // Regression guard: agents with no short-form tools.deny stay unchanged.
      const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-noden-"));
      const agentsDir = join(tempDir, "agents");
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await writeFile(
        join(agentsDir, "agents", "plain-agent.md"),
        `---\nid: plain-agent\ntype: agent\ndescription: A plain agent\n---\n# Plain\n\nPlain body.`,
        "utf-8",
      );
      try {
        const outputs = await adapter.generate(agentsDir, makeManifest());
        const file = outputs.find((o) => o.path === ".claude/agents/hatch3r-plain-agent.md");
        expect(file).toBeDefined();
        const fmMatch = file!.content.match(/^---\n([\s\S]*?)\n---/);
        expect(fmMatch![1]).not.toContain("disallowedTools:");
        expect(file!.content).not.toContain("## Tool Restrictions");
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  // C9-H49 (D15-SA15.2, P6): per-adapter PreToolUse / MCP-gating hook
  // emission. Reclassifies the agent tool allowlist as Hybrid in
  // SECURITY.md — the canonical policy registry is the source of
  // truth, and the Claude adapter emits a runtime PreToolUse hook
  // (`.claude/hooks/pretooluse-allowlist.mjs`) + machine-readable
  // policy document (`.claude/hooks/agent-tool-policies.json`) so the
  // allowlist survives into the Claude Code runtime.
  describe("C9-H49 PreToolUse allowlist hook emission", () => {
    it("emits .claude/hooks/agent-tool-policies.json with the canonical registry", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const policiesFile = outputs.find(
        (o) => o.path === ".claude/hooks/agent-tool-policies.json",
      );
      expect(policiesFile).toBeDefined();
      const parsed = JSON.parse(policiesFile!.content);
      expect(parsed.schema).toBe("hatch3r/agent-tool-policies/v1");
      expect(Array.isArray(parsed.policies)).toBe(true);
      // Registry must contain the canonical hatch3r-reviewer + hatch3r-implementer entries.
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
      // Top-level discriminator for downstream consumers.
      expect(parsed.allToolCategories).toContain("read");
      expect(parsed.allToolCategories).toContain("mcp");
    });

    it("emits .claude/hooks/pretooluse-allowlist.mjs Node ESM script", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const hookScript = outputs.find(
        (o) => o.path === ".claude/hooks/pretooluse-allowlist.mjs",
      );
      expect(hookScript).toBeDefined();
      expect(hookScript!.content.startsWith("#!/usr/bin/env node")).toBe(true);
      // Hook contract per https://code.claude.com/docs/en/hooks:
      // - reads sibling policy file
      // - reads payload as JSON on stdin (not env vars)
      // - identifies sub-agent via `agent_type` from the payload
      // - deny via stdout JSON with permissionDecision: "deny"
      expect(hookScript!.content).toContain("agent-tool-policies.json");
      expect(hookScript!.content).toContain("readFileSync(0,");
      expect(hookScript!.content).toContain("payload.tool_name");
      expect(hookScript!.content).toContain("payload.agent_type");
      expect(hookScript!.content).toContain("payload.agent_id");
      expect(hookScript!.content).toContain("hookSpecificOutput");
      expect(hookScript!.content).toContain('"PreToolUse"');
      expect(hookScript!.content).toContain('"deny"');
      expect(hookScript!.content).toContain("permissionDecisionReason");
      // Regression guard: the env-var contract was wrong; never reintroduce.
      expect(hookScript!.content).not.toContain("CLAUDE_TOOL_NAME");
      expect(hookScript!.content).not.toContain("CLAUDE_SUBAGENT_ID");
      expect(hookScript!.content).not.toContain("process.exit(2)");
      // Scope filter: only hatch3r-* sub-agents are governed.
      expect(hookScript!.content).toContain('"hatch3r-"');
      // Structured deny reason codes for failure-log persistence.
      expect(hookScript!.content).toContain("UNKNOWN_TOOL");
      expect(hookScript!.content).toContain("NO_POLICY");
      expect(hookScript!.content).toContain("TOOL_NOT_ALLOWED");
      // Claude Code → hatch3r category map (reverse of CLAUDE_CATEGORY_MAP).
      expect(hookScript!.content).toContain('Read: "read"');
      expect(hookScript!.content).toContain('Bash: "execute"');
      expect(hookScript!.content).toContain('Edit: "write"');
      // MCP tool prefix handling.
      expect(hookScript!.content).toContain('mcp__');
    });

    // Runtime tests: write the emitted script + policy file to a temp
    // directory, invoke with `node`, pipe a JSON payload on stdin, and
    // assert the documented Claude Code contract. These catch the
    // class of bug fixed by re-reading the hook spec (env-vars → stdin
    // JSON, exit 2 → stdout JSON with permissionDecision: "deny").
    describe("hook script runtime contract", () => {
      const setupHookDir = async () => {
        const { mkdtemp, writeFile } = await import("node:fs/promises");
        const { tmpdir } = await import("node:os");
        const path = await import("node:path");
        const manifest = makeManifest();
        const outputs = await adapter.generate(FIXTURES_DIR, manifest);
        const hookScript = outputs.find(
          (o) => o.path === ".claude/hooks/pretooluse-allowlist.mjs",
        );
        const policies = outputs.find(
          (o) => o.path === ".claude/hooks/agent-tool-policies.json",
        );
        const dir = await mkdtemp(path.join(tmpdir(), "hatch3r-hook-"));
        const hookPath = path.join(dir, "pretooluse-allowlist.mjs");
        const policyPath = path.join(dir, "agent-tool-policies.json");
        await writeFile(hookPath, hookScript!.content);
        await writeFile(policyPath, policies!.content);
        return { dir, hookPath };
      };

      const runHook = async (hookPath: string, payload: unknown) => {
        const { spawn } = await import("node:child_process");
        return await new Promise<{
          code: number | null;
          stdout: string;
          stderr: string;
        }>((resolve, reject) => {
          const proc = spawn("node", [hookPath], { stdio: "pipe" });
          let stdout = "";
          let stderr = "";
          proc.stdout.on("data", (b) => (stdout += b.toString()));
          proc.stderr.on("data", (b) => (stderr += b.toString()));
          proc.on("error", reject);
          proc.on("close", (code) => resolve({ code, stdout, stderr }));
          proc.stdin.end(JSON.stringify(payload));
        });
      };

      it("passes through main-thread calls (no agent_type) with empty stdout", async () => {
        const { hookPath } = await setupHookDir();
        const result = await runHook(hookPath, {
          session_id: "s",
          transcript_path: "/tmp/t",
          cwd: "/tmp",
          permission_mode: "default",
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command: "ls" },
        });
        expect(result.code).toBe(0);
        expect(result.stdout).toBe("");
      });

      it("passes through non-hatch3r sub-agents (e.g. general-purpose) with empty stdout", async () => {
        const { hookPath } = await setupHookDir();
        const result = await runHook(hookPath, {
          session_id: "s",
          transcript_path: "/tmp/t",
          cwd: "/tmp",
          permission_mode: "default",
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command: "ls" },
          agent_id: "abc123",
          agent_type: "general-purpose",
        });
        expect(result.code).toBe(0);
        expect(result.stdout).toBe("");
      });

      it("allows in-policy tool for a hatch3r-* sub-agent (empty stdout)", async () => {
        const { hookPath } = await setupHookDir();
        // hatch3r-implementer policy includes "execute".
        const result = await runHook(hookPath, {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command: "npm test" },
          agent_id: "abc123",
          agent_type: "hatch3r-implementer",
        });
        expect(result.code).toBe(0);
        expect(result.stdout).toBe("");
      });

      it("denies out-of-policy tool for a hatch3r-* sub-agent via stdout JSON + exit 0", async () => {
        const { hookPath } = await setupHookDir();
        // hatch3r-researcher policy: read/search/web/mcp — no execute.
        const result = await runHook(hookPath, {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command: "rm -rf /" },
          agent_id: "abc123",
          agent_type: "hatch3r-researcher",
        });
        expect(result.code).toBe(0);
        const parsed = JSON.parse(result.stdout);
        expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
        expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
        expect(parsed.hookSpecificOutput.permissionDecisionReason).toMatch(
          /hatch3r-researcher/,
        );
        expect(result.stderr).toContain("TOOL_NOT_ALLOWED");
      });

      it("denies unregistered hatch3r-* sub-agent (NO_POLICY)", async () => {
        const { hookPath } = await setupHookDir();
        const result = await runHook(hookPath, {
          hook_event_name: "PreToolUse",
          tool_name: "Read",
          tool_input: {},
          agent_id: "abc123",
          agent_type: "hatch3r-unknown-agent",
        });
        expect(result.code).toBe(0);
        const parsed = JSON.parse(result.stdout);
        expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
        expect(result.stderr).toContain("NO_POLICY");
      });

      it("denies unknown Claude tool for a hatch3r-* sub-agent (UNKNOWN_TOOL)", async () => {
        const { hookPath } = await setupHookDir();
        const result = await runHook(hookPath, {
          hook_event_name: "PreToolUse",
          tool_name: "SomeFutureTool",
          tool_input: {},
          agent_id: "abc123",
          agent_type: "hatch3r-implementer",
        });
        expect(result.code).toBe(0);
        const parsed = JSON.parse(result.stdout);
        expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
        expect(result.stderr).toContain("UNKNOWN_TOOL");
      });

      it("allows mcp__ prefixed tools for sub-agents granted the mcp category", async () => {
        const { hookPath } = await setupHookDir();
        // hatch3r-researcher has mcp in allowedTools.
        const result = await runHook(hookPath, {
          hook_event_name: "PreToolUse",
          tool_name: "mcp__some_server__some_tool",
          tool_input: {},
          agent_id: "abc123",
          agent_type: "hatch3r-researcher",
        });
        expect(result.code).toBe(0);
        expect(result.stdout).toBe("");
      });
    });

    it("registers the PreToolUse hook in settings.json", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const settings = outputs.find((o) => o.path === ".claude/settings.json");
      expect(settings).toBeDefined();
      const parsed = JSON.parse(settings!.content);
      expect(parsed.hooks.PreToolUse).toBeDefined();
      // The allowlist hook fires on every tool call (matcher ".*"), so it
      // appears as one of the PreToolUse entries.
      // The script path rides in the `command` string, anchored to
      // $CLAUDE_PROJECT_DIR so Node resolves the entry point regardless of
      // the hook's working directory (the cwd-relative path was the source
      // of the cjs/loader:1386 Cannot-find-module error when the hook fired
      // from an Agent-spawned sub-agent).
      const allowlistEntry = parsed.hooks.PreToolUse.find(
        (e: { hooks: Array<{ command: string; args?: string[] }> }) =>
          e.hooks.some((h) => h.command.includes("pretooluse-allowlist.mjs")),
      );
      expect(allowlistEntry).toBeDefined();
      expect(allowlistEntry.matcher).toBe(".*");
      expect(allowlistEntry.hooks[0].type).toBe("command");
      // Shell form anchored to the project root. `node` comes from PATH
      // (portable across Node upgrades / machines — not the generation-time
      // process.execPath), and $CLAUDE_PROJECT_DIR makes the path absolute
      // at hook-fire time so cwd-relative resolution can never fail.
      expect(allowlistEntry.hooks[0].command).toBe(
        'node "$CLAUDE_PROJECT_DIR/.claude/hooks/pretooluse-allowlist.mjs"',
      );
      expect(allowlistEntry.hooks[0].command).toContain("$CLAUDE_PROJECT_DIR");
      expect(allowlistEntry.hooks[0].args).toBeUndefined();
      // The old inline-guard markers must be gone.
      expect(allowlistEntry.hooks[0].command).not.toMatch(/node -e /);
      expect(allowlistEntry.hooks[0].command).not.toContain("fs.statSync");
    });

    it("emits policies.json + hook script independently of features.hooks", async () => {
      // The PreToolUse allowlist is the runtime tail of ASI02 — it
      // must ship regardless of whether the project opts out of the
      // hook *content* feature, otherwise the trust chain breaks.
      const manifest = makeManifest({ features: { hooks: false } });
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      expect(
        outputs.find((o) => o.path === ".claude/hooks/agent-tool-policies.json"),
      ).toBeDefined();
      expect(
        outputs.find((o) => o.path === ".claude/hooks/pretooluse-allowlist.mjs"),
      ).toBeDefined();
    });
  });

  // ── Wave 5 (CLI-tooling pivot, plan §4.6) ───────────────────────
  //
  // Claude's skills surface is filtered by `manifest.cliTools.selected` via
  // `readCliFilteredSkills` on BaseAdapter — non-CLI skills always pass
  // through; `hatch3r-cli-*` skills only emit when their suffix is in the
  // selected list AND `cliTools.enabled` is true.
  describe("CLI tools filter (Wave 5 plan §4.6)", () => {
    it("emits only the selected CLI skills when cliTools is enabled", async () => {
      const manifest: HatchManifest = {
        ...makeManifest(),
        cliTools: { enabled: true, selected: ["ripgrep", "jq"] },
      };
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const cliSkills = outputs.filter((o) =>
        o.path.startsWith(".claude/skills/hatch3r-cli-"),
      );
      const paths = cliSkills.map((o) => o.path);
      expect(paths).toContain(".claude/skills/hatch3r-cli-ripgrep/SKILL.md");
      expect(paths).toContain(".claude/skills/hatch3r-cli-jq/SKILL.md");
      expect(paths.some((p) => p.includes("hatch3r-cli-fd"))).toBe(false);
    });

    it("emits zero CLI skill files when cliTools.enabled is false", async () => {
      const manifest: HatchManifest = {
        ...makeManifest(),
        cliTools: { enabled: false, selected: ["ripgrep", "jq"] },
      };
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      expect(
        outputs.filter((o) => o.path.startsWith(".claude/skills/hatch3r-cli-")),
      ).toEqual([]);
    });

    it("emits zero CLI skill files when cliTools.selected is empty", async () => {
      const manifest: HatchManifest = {
        ...makeManifest(),
        cliTools: { enabled: true, selected: [] },
      };
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      expect(
        outputs.filter((o) => o.path.startsWith(".claude/skills/hatch3r-cli-")),
      ).toEqual([]);
    });
  });

  // C9-M47 (D6-SA6.4, P7): cache-breakpoint sentinel coverage. The Claude
  // adapter emits a paired sentinel (`<!-- HATCH3R-CACHE-BREAKPOINT-START -->` /
  // `<!-- HATCH3R-CACHE-BREAKPOINT-END -->`) inside every managed block so
  // the Claude Code prompt-cache layer can fingerprint the deterministic
  // hatch3r-managed prefix across syncs. The cases below pin the sentinel
  // emission contract for each managed-block-bearing output the adapter
  // produces and prove the constants are exported for downstream tooling.
  describe("cache-breakpoint sentinel (C9-M47)", () => {
    it("exports a balanced sentinel-name family", () => {
      expect(CACHE_BREAKPOINT_SENTINEL).toBe("<!-- HATCH3R-CACHE-BREAKPOINT -->");
      expect(CACHE_BREAKPOINT_SENTINEL_START).toBe("<!-- HATCH3R-CACHE-BREAKPOINT-START -->");
      expect(CACHE_BREAKPOINT_SENTINEL_END).toBe("<!-- HATCH3R-CACHE-BREAKPOINT-END -->");
    });

    it("emits start + end sentinels inside CLAUDE.md managed block", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
      expect(claudeMd).toBeDefined();
      expect(claudeMd!.content).toContain(CACHE_BREAKPOINT_SENTINEL_START);
      expect(claudeMd!.content).toContain(CACHE_BREAKPOINT_SENTINEL_END);
      // Sentinels live inside the managed block.
      const startIdx = claudeMd!.content.indexOf(MANAGED_BLOCK_START);
      const endIdx = claudeMd!.content.indexOf(MANAGED_BLOCK_END);
      const sentStartIdx = claudeMd!.content.indexOf(CACHE_BREAKPOINT_SENTINEL_START);
      const sentEndIdx = claudeMd!.content.indexOf(CACHE_BREAKPOINT_SENTINEL_END);
      expect(startIdx).toBeLessThan(sentStartIdx);
      expect(sentStartIdx).toBeLessThan(sentEndIdx);
      expect(sentEndIdx).toBeLessThan(endIdx);
      // managedContent (the inner payload) also carries the sentinels.
      expect(claudeMd!.managedContent).toContain(CACHE_BREAKPOINT_SENTINEL_START);
      expect(claudeMd!.managedContent).toContain(CACHE_BREAKPOINT_SENTINEL_END);
    });

    it("emits sentinels in every .claude/rules/ output", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const rules = outputs.filter((o) => o.path.startsWith(".claude/rules/"));
      expect(rules.length).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(rule.content).toContain(CACHE_BREAKPOINT_SENTINEL_START);
        expect(rule.content).toContain(CACHE_BREAKPOINT_SENTINEL_END);
        expect(rule.managedContent).toContain(CACHE_BREAKPOINT_SENTINEL_START);
        expect(rule.managedContent).toContain(CACHE_BREAKPOINT_SENTINEL_END);
      }
    });

    it("emits sentinels in every .claude/agents/ output (standard mode)", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const agents = outputs.filter((o) => o.path.startsWith(".claude/agents/"));
      expect(agents.length).toBeGreaterThan(0);
      for (const agent of agents) {
        expect(agent.content).toContain(CACHE_BREAKPOINT_SENTINEL_START);
        expect(agent.content).toContain(CACHE_BREAKPOINT_SENTINEL_END);
        // The agent file format is `---FM---\n\n<managed block>` so the
        // sentinels must sit inside the managed block, not in the frontmatter.
        const fmEndIdx = agent.content.indexOf("---\n\n");
        const sentIdx = agent.content.indexOf(CACHE_BREAKPOINT_SENTINEL_START);
        expect(sentIdx).toBeGreaterThan(fmEndIdx);
      }
    });

    it("emits sentinels in every .claude/agents/ output (minimal mode)", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest, undefined, "minimal");
      const agents = outputs.filter((o) => o.path.startsWith(".claude/agents/"));
      expect(agents.length).toBeGreaterThan(0);
      for (const agent of agents) {
        expect(agent.content).toContain(CACHE_BREAKPOINT_SENTINEL_START);
        expect(agent.content).toContain(CACHE_BREAKPOINT_SENTINEL_END);
      }
    });

    it("emits sentinels in skill SKILL.md outputs", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const skills = outputs.filter((o) => o.path.startsWith(".claude/skills/"));
      expect(skills.length).toBeGreaterThan(0);
      for (const skill of skills) {
        expect(skill.content).toContain(CACHE_BREAKPOINT_SENTINEL_START);
        expect(skill.content).toContain(CACHE_BREAKPOINT_SENTINEL_END);
        expect(skill.managedContent).toContain(CACHE_BREAKPOINT_SENTINEL_START);
        expect(skill.managedContent).toContain(CACHE_BREAKPOINT_SENTINEL_END);
      }
    });

    it("emits sentinels in .claude/commands/ outputs", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const commands = outputs.filter((o) => o.path.startsWith(".claude/commands/"));
      expect(commands.length).toBeGreaterThan(0);
      for (const cmd of commands) {
        expect(cmd.content).toContain(CACHE_BREAKPOINT_SENTINEL_START);
        expect(cmd.content).toContain(CACHE_BREAKPOINT_SENTINEL_END);
        expect(cmd.managedContent).toContain(CACHE_BREAKPOINT_SENTINEL_START);
        expect(cmd.managedContent).toContain(CACHE_BREAKPOINT_SENTINEL_END);
      }
    });

    it("emits sentinels in hatch3r-agent-team.md", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const agentTeam = outputs.find(
        (o) => o.path === ".claude/commands/hatch3r-agent-team.md",
      );
      expect(agentTeam).toBeDefined();
      expect(agentTeam!.content).toContain(CACHE_BREAKPOINT_SENTINEL_START);
      expect(agentTeam!.content).toContain(CACHE_BREAKPOINT_SENTINEL_END);
      expect(agentTeam!.managedContent).toContain(CACHE_BREAKPOINT_SENTINEL_START);
      expect(agentTeam!.managedContent).toContain(CACHE_BREAKPOINT_SENTINEL_END);
      // Slash-command picker fix: the synthetic launcher now opens with YAML
      // frontmatter (byte 0) so the picker reads a real `description:` instead
      // of the HATCH3R:BEGIN managed-block marker.
      expect(agentTeam!.content.startsWith("---")).toBe(true);
      expect(agentTeam!.content.startsWith(MANAGED_BLOCK_START)).toBe(false);
      expect(agentTeam!.content).toContain("description:");
      const agentTeamFm = agentTeam!.content.slice(0, agentTeam!.content.indexOf(MANAGED_BLOCK_START));
      expect(agentTeamFm).toContain("description:");
      expect(agentTeamFm).not.toContain("HATCH3R:BEGIN");
    });

    it("does not duplicate sentinels on re-emission (idempotent helper)", async () => {
      // Same adapter instance, two sequential generates → sentinels must
      // appear exactly once per managed block (no double-wrap from nested
      // calls or from `processSkillsWithFmCliFiltered` -> `rewrapWithCacheBreakpoints`).
      const manifest = makeManifest();
      await adapter.generate(FIXTURES_DIR, manifest);
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      for (const out of outputs) {
        if (!out.managedContent) continue;
        const startMatches = out.content.match(
          new RegExp(CACHE_BREAKPOINT_SENTINEL_START.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "g"),
        );
        const endMatches = out.content.match(
          new RegExp(CACHE_BREAKPOINT_SENTINEL_END.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "g"),
        );
        expect(startMatches?.length ?? 0).toBe(1);
        expect(endMatches?.length ?? 0).toBe(1);
      }
    });

    it("preserves managedContent-is-substring-of-content invariant", async () => {
      // The BaseAdapter Output-invariant gate (C9-H4 in base.ts) drops any
      // output whose `managedContent` is not a substring of `content`.
      // Confirm the sentinel-bearing managedContent still satisfies that
      // invariant — otherwise outputs would silently disappear from sync.
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const managed = outputs.filter((o) => o.managedContent);
      expect(managed.length).toBeGreaterThan(0);
      for (const out of managed) {
        expect(out.content.includes(out.managedContent!.trim())).toBe(true);
      }
    });
  });

  // D15-SA15.2-04 (Cycle 12, D15/D9, P5): the reviewer-loop cap in the generated
  // .claude/commands/hatch3r-agent-team.md is DERIVED from the review-loop
  // code-class cap (maxIterationsForClass("code")), not a hardcoded literal.
  // Pre-fix the "up to 3 iterations" string was a bare literal outside the
  // CAP_SURFACE_REGISTRY parity guard (reviewLoop.test.ts scans canonical .md
  // prose dirs, not adapter TS), so it could silently drift from the code
  // constant. This block is the missing CI signal: it pins the rendered cap to
  // the code-class cap and asserts the default/spec cap does not leak into this
  // CODE-review surface — so a wrong-class wiring or a divergent literal fails.
  describe("Agent-Teams reviewer-loop cap derivation (D15-SA15.2-04)", () => {
    it("renders the review-loop code-class cap, not the default/spec cap or a stray literal", async () => {
      const manifest = makeManifest();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const agentTeam = outputs.find(
        (o) => o.path === ".claude/commands/hatch3r-agent-team.md",
      );
      expect(agentTeam).toBeDefined();

      const codeClassCap = maxIterationsForClass("code");
      const defaultCap = maxIterationsForClass("default");
      // The Agent-Teams reviewer↔fixer round runs over a CODE diff, so it opts
      // down to the code-class cap — strictly below the default/spec cap. This
      // relationship is the non-vacuous core: it documents why the surface
      // states 3, not 4, and anchors the leak assertion below.
      expect(codeClassCap).toBeLessThan(defaultCap);

      // Every "up to N iterations" cap the command states equals the code cap.
      // With the render interpolated the values move in lockstep with the
      // constant; the loop still catches a stated cap that diverges from it.
      const statedCaps = [
        ...agentTeam!.content.matchAll(/up to (\d+) iterations/g),
      ].map((m) => Number(m[1]));
      expect(statedCaps.length).toBeGreaterThan(0);
      for (const cap of statedCaps) {
        expect(cap).toBe(codeClassCap);
      }
      // Genuinely non-vacuous guard: fails if the adapter is wired to the
      // default class / DEFAULT_MAX_REVIEW_ITERATIONS, or a "up to 4 iterations"
      // literal creeps back into this code-review surface.
      expect(agentTeam!.content).not.toContain(`up to ${defaultCap} iterations`);
    });
  });

  // D3-M1 (Cycle 10 Wave-3 Medium rollover): adapters had no documented
  // error-path coverage. Pipeline timeouts surface as a pre-aborted
  // AbortSignal; `BaseAdapter.throwIfSignalAborted` is the documented
  // contract (see src/adapters/base.ts::throwIfSignalAborted). Pin the contract here so any
  // future change that silently swallows the signal cannot regress.
  // D14-9 (D14, P3 / Decision 16): `claudeMaturityHeader` stamps the resolved
  // maturity tier atop the CLAUDE.md managed block. Pre-fix CLAUDE.md was
  // byte-identical across tiers (an enterprise install matched a solo install),
  // so the declared tier never reached the agent that reads CLAUDE.md as
  // memory. The directive is delivered at EVERY tier (solo→enterprise), in both
  // standard and minimal modes, and always points at
  // `rules/hatch3r-right-sizing.md` — parity with cursor.ts/copilot.ts.
  describe("maturity right-sizing header (D14-9)", () => {
    const tiers = ["solo", "team", "scaleup", "enterprise"] as const;

    for (const tier of tiers) {
      it(`stamps right-size to maturity=${tier} + rule pointer atop CLAUDE.md`, async () => {
        const manifest: HatchManifest = { ...makeManifest(), maturity: tier };
        const outputs = await adapter.generate(FIXTURES_DIR, manifest);

        const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
        expect(claudeMd).toBeDefined();
        expect(claudeMd!.content).toContain(`right-size to maturity=${tier}`);
        expect(claudeMd!.content).toContain("rules/hatch3r-right-sizing.md");
        // The stamp lives inside the hatch3r-managed block.
        const startIdx = claudeMd!.content.indexOf(MANAGED_BLOCK_START);
        const stampIdx = claudeMd!.content.indexOf(`right-size to maturity=${tier}`);
        const endIdx = claudeMd!.content.indexOf(MANAGED_BLOCK_END);
        expect(startIdx).toBeLessThan(stampIdx);
        expect(stampIdx).toBeLessThan(endIdx);
      });
    }

    it("collapses an absent maturity field to solo (DEFAULT_MATURITY_TIER)", async () => {
      const manifest = makeManifest();
      expect(manifest.maturity).toBeUndefined();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);

      const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
      expect(claudeMd!.content).toContain("right-size to maturity=solo");
    });

    it("stamps the tier in minimal mode too", async () => {
      const manifest: HatchManifest = { ...makeManifest(), maturity: "enterprise" };
      const outputs = await adapter.generate(FIXTURES_DIR, manifest, FIXTURES_USER_REPO, "minimal");

      const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
      expect(claudeMd!.content).toContain("right-size to maturity=enterprise");
      expect(claudeMd!.content).toContain("rules/hatch3r-right-sizing.md");
    });

    // D9-SA9.1-01 (Cycle 12): the tier directive must ship as a VISIBLE
    // blockquote, not an HTML comment. Claude Code strips block-level HTML
    // comments from CLAUDE.md before injecting the file into context
    // (code.claude.com/docs/en/memory), so a comment-wrapped directive reaches
    // the on-disk bytes but never the model — the exact calibration gap D14-9
    // set out to close. Guards against a regression back to the `<!-- ... -->`
    // form. Covers both standard and minimal modes.
    for (const mode of ["standard", "minimal"] as const) {
      it(`emits the maturity directive as a visible blockquote, not a stripped HTML comment (${mode})`, async () => {
        const manifest: HatchManifest = { ...makeManifest(), maturity: "enterprise" };
        const outputs = await adapter.generate(FIXTURES_DIR, manifest, FIXTURES_USER_REPO, mode);
        const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
        const line = claudeMd!.content
          .split("\n")
          .find((l) => l.includes("right-size to maturity=enterprise"));
        expect(line).toBeDefined();
        // Visible blockquote line (`> hatch3r: ...`), never inside an HTML comment.
        expect(line!.startsWith("> ")).toBe(true);
        expect(line).not.toContain("<!--");
        expect(claudeMd!.content).not.toContain("<!-- hatch3r: right-size to maturity=");
      });
    }
  });

  // D1-17 (Cycle 11 Wave 3, D1, P1): `claudeConfidenceFloorHeader` stamps the
  // resolved confidence floor atop CLAUDE.md alongside the maturity marker.
  // Pre-fix the persisted `confidenceFloor` config key reached no adapter output
  // (write-only key). An explicit floor wins; an absent floor resolves to the
  // maturity-aware default (solo/team → any, scaleup/enterprise → high).
  describe("confidence-floor header (D1-17)", () => {
    for (const floor of ["any", "medium", "high"] as const) {
      it(`stamps an explicit confidence floor=${floor} inside the managed block`, async () => {
        const manifest: HatchManifest = { ...makeManifest(), confidenceFloor: floor };
        const outputs = await adapter.generate(FIXTURES_DIR, manifest);

        const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
        expect(claudeMd).toBeDefined();
        expect(claudeMd!.content).toContain(`confidence floor=${floor}`);
        const startIdx = claudeMd!.content.indexOf(MANAGED_BLOCK_START);
        const stampIdx = claudeMd!.content.indexOf(`confidence floor=${floor}`);
        const endIdx = claudeMd!.content.indexOf(MANAGED_BLOCK_END);
        expect(startIdx).toBeLessThan(stampIdx);
        expect(stampIdx).toBeLessThan(endIdx);
      });
    }

    it("an explicit floor overrides the maturity-derived default", async () => {
      // enterprise would default to "high"; explicit "any" must win.
      const manifest: HatchManifest = { ...makeManifest(), maturity: "enterprise", confidenceFloor: "any" };
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
      expect(claudeMd!.content).toContain("confidence floor=any");
      expect(claudeMd!.content).not.toContain("confidence floor=high");
    });

    it("resolves an absent floor to the maturity-aware default (enterprise → high)", async () => {
      const manifest: HatchManifest = { ...makeManifest(), maturity: "enterprise" };
      expect(manifest.confidenceFloor).toBeUndefined();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
      expect(claudeMd!.content).toContain("confidence floor=high");
    });

    it("resolves an absent floor to any on solo (the default tier)", async () => {
      const manifest = makeManifest();
      expect(manifest.confidenceFloor).toBeUndefined();
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
      expect(claudeMd!.content).toContain("confidence floor=any");
    });

    it("stamps the floor in minimal mode too", async () => {
      const manifest: HatchManifest = { ...makeManifest(), confidenceFloor: "high" };
      const outputs = await adapter.generate(FIXTURES_DIR, manifest, FIXTURES_USER_REPO, "minimal");
      const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
      expect(claudeMd!.content).toContain("confidence floor=high");
    });

    // D9-SA9.1-01 (Cycle 12): the confidence-floor directive must ship as a
    // VISIBLE blockquote, not an HTML comment Claude Code strips before context
    // injection (code.claude.com/docs/en/memory). Regression guard for the
    // `<!-- ... -->` form.
    it("emits the confidence-floor directive as a visible blockquote, not a stripped HTML comment", async () => {
      const manifest: HatchManifest = { ...makeManifest(), confidenceFloor: "high" };
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
      const line = claudeMd!.content
        .split("\n")
        .find((l) => l.includes("confidence floor=high"));
      expect(line).toBeDefined();
      expect(line!.startsWith("> ")).toBe(true);
      expect(line).not.toContain("<!--");
      expect(claudeMd!.content).not.toContain("<!-- hatch3r: confidence floor=");
    });
  });

  describe("error paths", () => {
    it("rejects with the abort reason when the signal is pre-aborted", async () => {
      const manifest = makeManifest();
      const controller = new AbortController();
      const reason = new Error("claude: pipeline timeout exceeded");
      controller.abort(reason);
      await expect(
        adapter.generate(FIXTURES_DIR, manifest, FIXTURES_USER_REPO, "standard", controller.signal),
      ).rejects.toThrow("claude: pipeline timeout exceeded");
    });
  });
});

/**
 * D2-SA2.4-01 (Cycle 12 Wave 2, D2, P3): an mcp-granted agent's emitted Claude
 * `tools:` frontmatter must carry a per-server `mcp__<server>` grant when MCP
 * servers are selected. An enumerated `tools:` list otherwise EXCLUDES every MCP
 * tool platform-side (code.claude.com/docs/en/sub-agents), so an agent whose
 * body mandates an MCP workflow (e.g. hatch3r-researcher's Context7 tier) reaches
 * no MCP server at runtime even when the operator configured one.
 */
describe("mcp-granted agent tools frontmatter carries per-server grants (D2-SA2.4-01)", () => {
  async function writeMcpAgentRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "hatch3r-claude-mcp-tools-"));
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

  it("emits mcp__<server> in the tools: line for each selected server", async () => {
    const root = await writeMcpAgentRoot();
    try {
      const manifest = createManifest({
        tools: ["claude"],
        mcpServers: ["context7", "github"],
        features: { mcp: true },
      });
      const outputs = await new ClaudeAdapter().generate(root, manifest);
      const agentOut = outputs.find((o) => o.path === ".claude/agents/hatch3r-researcher.md");
      expect(agentOut, "expected the researcher agent output").toBeDefined();
      const toolsLine = agentOut!.content.split("\n").find((l) => l.startsWith("tools:")) ?? "";
      expect(toolsLine).toContain("mcp__context7");
      expect(toolsLine).toContain("mcp__github");
      // Additive — the read-only base grant survives alongside the MCP tokens.
      expect(toolsLine).toContain("Read");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("emits no mcp__ token when the MCP feature is off, even with servers listed (gate)", async () => {
    const root = await writeMcpAgentRoot();
    try {
      // Explicit features.mcp=false wins over the server-list derivation, and the
      // adapter suppresses the grant set when the feature is off.
      const manifest = createManifest({
        tools: ["claude"],
        mcpServers: ["context7"],
        features: { mcp: false },
      });
      const outputs = await new ClaudeAdapter().generate(root, manifest);
      const agentOut = outputs.find((o) => o.path === ".claude/agents/hatch3r-researcher.md");
      expect(agentOut).toBeDefined();
      const toolsLine = agentOut!.content.split("\n").find((l) => l.startsWith("tools:")) ?? "";
      expect(toolsLine).not.toContain("mcp__");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// D9-SA9.1-05 / CL-2 U11 (Cycle 12, D9, P6/P7/CQ9): enforcement-parity cohort —
// the native `maxTurns:` runaway-cost ceiling (default
// CLAUDE_SUBAGENT_MAX_TURNS_DEFAULT on every emitted subagent) and the
// `memory:` scope map (default: hatch3r-learnings-loader → project, coexisting
// with its `permissionMode: plan`). Field contracts per
// code.claude.com/docs/en/sub-agents (accessed 2026-07-12).
describe("ClaudeAdapter subagent maxTurns + memory (D9-SA9.1-05 / CL-2 U11)", () => {
  function u11Manifest(claude?: HatchManifest["claude"]): HatchManifest {
    const base = createManifest({ tools: ["claude"] });
    if (claude !== undefined) base.claude = claude;
    return base;
  }

  /** Frontmatter fence at byte 0 (the block Claude Code parses). */
  function fmOf(content: string): string {
    const match = content.match(/^---\n[\s\S]*?\n---/);
    return match ? match[0] : "";
  }

  function topLevelAgents(outputs: Awaited<ReturnType<ClaudeAdapter["generate"]>>) {
    return outputs.filter((o) => /^\.claude\/agents\/[^/]+\.md$/.test(o.path));
  }

  it("emits maxTurns with the default ceiling on every generated agent", async () => {
    const outputs = await new ClaudeAdapter().generate(FIXTURES_DIR, u11Manifest());
    const agents = topLevelAgents(outputs);
    expect(agents.length).toBeGreaterThan(0);
    for (const agent of agents) {
      expect(fmOf(agent.content)).toContain(`maxTurns: ${CLAUDE_SUBAGENT_MAX_TURNS_DEFAULT}`);
      // The ceiling is frontmatter, not managed body content.
      expect(agent.managedContent).not.toContain("maxTurns:");
    }
  });

  it("honors a configured integer ceiling via claude.subagentMaxTurns", async () => {
    const outputs = await new ClaudeAdapter().generate(
      FIXTURES_DIR,
      u11Manifest({ subagentMaxTurns: 40 }),
    );
    for (const agent of topLevelAgents(outputs)) {
      expect(fmOf(agent.content)).toContain("maxTurns: 40");
      expect(fmOf(agent.content)).not.toContain(`maxTurns: ${CLAUDE_SUBAGENT_MAX_TURNS_DEFAULT}`);
    }
  });

  it("omits maxTurns entirely when subagentMaxTurns is false (opt-out)", async () => {
    const adapter = new ClaudeAdapter();
    const outputs = await adapter.generate(FIXTURES_DIR, u11Manifest({ subagentMaxTurns: false }));
    for (const agent of topLevelAgents(outputs)) {
      expect(agent.content).not.toContain("maxTurns:");
    }
    // Deliberate opt-out is not a misconfiguration — no warning.
    expect(adapter.warnings.some((w) => w.includes("subagentMaxTurns"))).toBe(false);
  });

  it("omits maxTurns and warns exactly once on an invalid ceiling value", async () => {
    const adapter = new ClaudeAdapter();
    const outputs = await adapter.generate(FIXTURES_DIR, u11Manifest({ subagentMaxTurns: 0 }));
    for (const agent of topLevelAgents(outputs)) {
      expect(agent.content).not.toContain("maxTurns:");
    }
    const warnings = adapter.warnings.filter((w) => w.includes("subagentMaxTurns"));
    // Resolved once per generate, not once per agent — a bad value warns once.
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("integer >= 1");
  });

  /**
   * Canonical root with the learnings-loader (a real canonical id, so the
   * readonly policy derives `permissionMode: plan`) plus a control agent.
   */
  async function writeMemoryRoot(): Promise<string> {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-u11-memory-"));
    const root = join(tempDir, "agents");
    await mkdir(join(root, "agents"), { recursive: true });
    await writeFile(
      join(root, "agents", "learnings-loader.md"),
      `---
id: learnings-loader
type: agent
description: Loads prior learnings into context
---

You load prior learnings before the pipeline starts.`,
      "utf-8",
    );
    await writeFile(
      join(root, "agents", "control-agent.md"),
      `---
id: control-agent
type: agent
description: A control agent with no memory row
---

You are a control agent.`,
      "utf-8",
    );
    return root;
  }

  it("emits memory: project on hatch3r-learnings-loader by default, coexisting with permissionMode: plan, and on no other agent", async () => {
    const root = await writeMemoryRoot();
    try {
      const outputs = await new ClaudeAdapter().generate(root, u11Manifest());
      const loader = outputs.find((o) => o.path === ".claude/agents/hatch3r-learnings-loader.md");
      expect(loader, "expected the learnings-loader agent output").toBeDefined();
      const loaderFm = fmOf(loader!.content);
      expect(loaderFm).toContain("memory: project");
      // Plan-mode coexistence by design: the readonly policy keeps its plan
      // derivation; memory tools are platform-auto-enabled (docs, 2026-07-12).
      expect(loaderFm).toContain("permissionMode: plan");
      const control = outputs.find((o) => o.path === ".claude/agents/hatch3r-control-agent.md");
      expect(control).toBeDefined();
      expect(control!.content).not.toContain("memory:");
    } finally {
      await rm(dirname(root), { recursive: true, force: true });
    }
  });

  it("an explicit subagentMemory map replaces the default map (unprefixed keys normalize)", async () => {
    const root = await writeMemoryRoot();
    try {
      const outputs = await new ClaudeAdapter().generate(
        root,
        u11Manifest({ subagentMemory: { "control-agent": "local" } }),
      );
      const control = outputs.find((o) => o.path === ".claude/agents/hatch3r-control-agent.md");
      expect(fmOf(control!.content)).toContain("memory: local");
      // Replaced, not merged: the default learnings-loader row is gone.
      const loader = outputs.find((o) => o.path === ".claude/agents/hatch3r-learnings-loader.md");
      expect(loader!.content).not.toContain("memory:");
    } finally {
      await rm(dirname(root), { recursive: true, force: true });
    }
  });

  it("subagentMemory: false disables all memory emission", async () => {
    const root = await writeMemoryRoot();
    try {
      const outputs = await new ClaudeAdapter().generate(
        root,
        u11Manifest({ subagentMemory: false }),
      );
      for (const agent of topLevelAgents(outputs)) {
        expect(agent.content).not.toContain("memory:");
      }
    } finally {
      await rm(dirname(root), { recursive: true, force: true });
    }
  });

  it("skips an invalid memory scope with a warning instead of emitting it", async () => {
    const root = await writeMemoryRoot();
    try {
      const adapter = new ClaudeAdapter();
      const outputs = await adapter.generate(
        root,
        u11Manifest({
          subagentMemory: { "learnings-loader": "everywhere" },
        } as unknown as HatchManifest["claude"]),
      );
      const loader = outputs.find((o) => o.path === ".claude/agents/hatch3r-learnings-loader.md");
      expect(loader!.content).not.toContain("memory:");
      const warnings = adapter.warnings.filter((w) => w.includes("subagentMemory"));
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain("user, project, local");
    } finally {
      await rm(dirname(root), { recursive: true, force: true });
    }
  });
});
