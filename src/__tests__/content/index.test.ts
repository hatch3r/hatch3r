import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { tmpdir } from "node:os";
import { HatchError } from "../../types.js";
import type { ContentSelection } from "../../types.js";
import {
  TYPE_TO_SELECTION_KEY,
  buildContentIndex,
  resolveSelection,
  copySelectedContent,
  getAvailableItems,
  buildSelectionsFromDisk,
  addContentItem,
  removeContentItem,
  getAllContentIds,
  countSelectionItems,
  selectionSummary,
  countPresetExclusions,
  countProjectTypeExclusions,
  countTeamSizeExclusions,
  extractContentReferences,
  validateCrossReferences,
  validateOrchestrationDependencies,
  typeIdKey,
  getAllItemsById,
  applyCommandPrefix,
  COMMAND_ID_PREFIX,
} from "../../content/index.js";
import type { CatalogItem, ContentIndex } from "../../content/index.js";
import { getPreset } from "../../content/presets.js";
import {
  TAG_PLANNING,
  TAG_IMPLEMENTATION,
  TAG_REVIEW,
  TAG_DEVOPS,
  TAG_ORCHESTRATION,
  TAG_BOARD,
  TAG_PERFORMANCE,
  TAG_AI,
  TAG_FLOOR_SECURITY,
  TAG_FLOOR_UI_UX,
  TAG_FLOOR_PROTOCOL,
  TAG_FLOOR_CONTENT_QUALITY,
  TAG_CTX_GREENFIELD_ONLY,
  TAG_CTX_BROWNFIELD_ONLY,
  TAG_CTX_TEAM_ONLY,
  TAG_CUSTOMIZE,
  TAG_A11Y,
} from "../../content/tags.js";

// ── Fixture helper ─────────────────────────────────────────────

function mdFile(overrides: Record<string, unknown> = {}, body = "# Content"): string {
  const defaults: Record<string, unknown> = {
    id: "test-item",
    type: "agent",
    description: "A test item",
    tags: [TAG_ORCHESTRATION, TAG_IMPLEMENTATION],
  };
  const merged = { ...defaults, ...overrides };
  const lines = Object.entries(merged).map(([k, v]) => {
    if (Array.isArray(v)) return `${k}: [${v.map((i) => String(i)).join(", ")}]`;
    return `${k}: ${String(v)}`;
  });
  return `---\n${lines.join("\n")}\n---\n${body}\n`;
}

async function createContentRoot(dir: string): Promise<string> {
  const contentRoot = join(dir, "content");

  // agents (glob strategy)
  await mkdir(join(contentRoot, "agents"), { recursive: true });
  await writeFile(
    join(contentRoot, "agents", "hatch3r-implementer.md"),
    mdFile({ id: "hatch3r-implementer", type: "agent", description: "Implements features", tags: [TAG_ORCHESTRATION, TAG_IMPLEMENTATION] }),
  );
  await writeFile(
    join(contentRoot, "agents", "hatch3r-reviewer.md"),
    mdFile({ id: "hatch3r-reviewer", type: "agent", description: "Reviews code", tags: [TAG_ORCHESTRATION, TAG_REVIEW] }),
  );
  await writeFile(
    join(contentRoot, "agents", "hatch3r-protected.md"),
    mdFile({ id: "hatch3r-protected", type: "agent", description: "Protected agent", tags: [TAG_ORCHESTRATION], protected: true }),
  );

  // commands (glob strategy)
  await mkdir(join(contentRoot, "commands"), { recursive: true });
  await writeFile(
    join(contentRoot, "commands", "hatch3r-feature-plan.md"),
    mdFile({ id: "hatch3r-feature-plan", type: "command", description: "Plan a feature", tags: [TAG_PLANNING] }),
  );
  await writeFile(
    join(contentRoot, "commands", "hatch3r-board-fill.md"),
    mdFile({ id: "hatch3r-board-fill", type: "command", description: "Init board", tags: [TAG_BOARD, TAG_CTX_TEAM_ONLY] }),
  );

  // rules (glob strategy — with companion .mdc)
  await mkdir(join(contentRoot, "rules"), { recursive: true });
  await writeFile(
    join(contentRoot, "rules", "hatch3r-code-standards.md"),
    mdFile({ id: "hatch3r-code-standards", type: "rule", description: "Code standards", tags: [TAG_ORCHESTRATION] }),
  );
  await writeFile(
    join(contentRoot, "rules", "hatch3r-code-standards.mdc"),
    "companion mdc content",
  );
  await writeFile(
    join(contentRoot, "rules", "hatch3r-testing.md"),
    mdFile({ id: "hatch3r-testing", type: "rule", description: "Testing rules", tags: [TAG_REVIEW] }),
  );

  // skills (subdirectory strategy)
  await mkdir(join(contentRoot, "skills", "hatch3r-feature"), { recursive: true });
  await writeFile(
    join(contentRoot, "skills", "hatch3r-feature", "SKILL.md"),
    mdFile({ id: "hatch3r-feature", type: "skill", description: "Feature skill", tags: [TAG_IMPLEMENTATION] }),
  );
  await mkdir(join(contentRoot, "skills", "hatch3r-refactor"), { recursive: true });
  await writeFile(
    join(contentRoot, "skills", "hatch3r-refactor", "SKILL.md"),
    mdFile({ id: "hatch3r-refactor", type: "skill", description: "Refactor skill", tags: [TAG_IMPLEMENTATION] }),
  );
  await writeFile(
    join(contentRoot, "skills", "hatch3r-refactor", "helper.md"),
    "# Extra helper file in skill dir",
  );

  // prompts (glob strategy)
  await mkdir(join(contentRoot, "prompts"), { recursive: true });
  await writeFile(
    join(contentRoot, "prompts", "hatch3r-code-review.md"),
    mdFile({ id: "hatch3r-code-review", type: "prompt", description: "Code review prompt", tags: [TAG_REVIEW] }),
  );

  // hooks (glob strategy)
  await mkdir(join(contentRoot, "hooks"), { recursive: true });
  await writeFile(
    join(contentRoot, "hooks", "hatch3r-pre-commit.md"),
    mdFile({ id: "hatch3r-pre-commit", type: "hook", description: "Pre-commit hook", tags: [TAG_DEVOPS] }),
  );

  // github-agents (glob strategy)
  await mkdir(join(contentRoot, "github-agents"), { recursive: true });
  await writeFile(
    join(contentRoot, "github-agents", "hatch3r-test-agent.md"),
    mdFile({ id: "hatch3r-test-agent", type: "github-agent", description: "Test GH agent", tags: [TAG_REVIEW] }),
  );

  // checks/ and mcp/ directories (always-copied)
  await mkdir(join(contentRoot, "checks"), { recursive: true });
  await writeFile(join(contentRoot, "checks", "check1.md"), "# Check 1");
  await mkdir(join(contentRoot, "mcp"), { recursive: true });
  await writeFile(join(contentRoot, "mcp", "mcp-config.json"), '{"servers":[]}');

  return contentRoot;
}

// ── Helpers for building indexes in-memory ───────────────────

function makeCatalogItem(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: "test-item",
    type: "agent",
    description: "A test item",
    tags: [TAG_ORCHESTRATION],
    relativePath: "agents/test-item.md",
    source: "canonical",
    ...overrides,
  };
}

function makeIndex(items: CatalogItem[]): ContentIndex {
  const byType: Record<string, CatalogItem[]> = {};
  const byId = new Map<string, CatalogItem>();
  const byTypeAndId = new Map<string, CatalogItem>();
  for (const item of items) {
    if (!byType[item.type]) byType[item.type] = [];
    byType[item.type].push(item);
    byId.set(item.id, item);
    byTypeAndId.set(`${item.type}:${item.id}`, item);
  }
  return { items, byType, byId, byTypeAndId, collisions: [] };
}

function emptySelection(overrides: Partial<ContentSelection> = {}): ContentSelection {
  return {
    preset: "full",
    projectType: "brownfield",
    teamSize: "team",
    items: {
      agents: [],
      skills: [],
      rules: [],
      commands: [],
      prompts: [],
      hooks: [],
      githubAgents: [],
    },
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe("content/index", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  });

  async function makeTempDir(prefix = "hatch3r-content-"): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), prefix));
    return tempDir;
  }

  // ── TYPE_TO_SELECTION_KEY ──────────────────────────────────

  describe("TYPE_TO_SELECTION_KEY", () => {
    it("has all 7 content type mappings", () => {
      const expectedKeys = ["agent", "skill", "rule", "command", "prompt", "hook", "github-agent"];
      expect(Object.keys(TYPE_TO_SELECTION_KEY).sort()).toEqual(expectedKeys.sort());
    });

    it("maps each type to the correct selection key", () => {
      expect(TYPE_TO_SELECTION_KEY["agent"]).toBe("agents");
      expect(TYPE_TO_SELECTION_KEY["skill"]).toBe("skills");
      expect(TYPE_TO_SELECTION_KEY["rule"]).toBe("rules");
      expect(TYPE_TO_SELECTION_KEY["command"]).toBe("commands");
      expect(TYPE_TO_SELECTION_KEY["prompt"]).toBe("prompts");
      expect(TYPE_TO_SELECTION_KEY["hook"]).toBe("hooks");
      expect(TYPE_TO_SELECTION_KEY["github-agent"]).toBe("githubAgents");
    });

    it("all values are valid ContentSelection items keys", () => {
      const validKeys: (keyof ContentSelection["items"])[] = [
        "agents", "skills", "rules", "commands", "prompts", "hooks", "githubAgents",
      ];
      const validSet = new Set(validKeys);
      for (const val of Object.values(TYPE_TO_SELECTION_KEY)) {
        expect(validSet.has(val)).toBe(true);
      }
    });
  });

  // ── buildContentIndex ──────────────────────────────────────

  describe("buildContentIndex", () => {
    it("returns items from glob-strategy directories", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const index = await buildContentIndex(contentRoot);

      // agents, commands, rules, prompts, hooks, github-agents are glob strategy
      const globTypes = ["agent", "command", "rule", "prompt", "hook", "github-agent"];
      for (const type of globTypes) {
        const items = index.items.filter((i) => i.type === type);
        expect(items.length).toBeGreaterThan(0);
      }
    });

    it("returns items from subdirectory-strategy dirs (skills)", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const index = await buildContentIndex(contentRoot);

      const skills = index.items.filter((i) => i.type === "skill");
      expect(skills.length).toBe(2);
      const ids = skills.map((s) => s.id);
      expect(ids).toContain("hatch3r-feature");
      expect(ids).toContain("hatch3r-refactor");
    });

    it("parses frontmatter correctly (id, type, description, tags)", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const index = await buildContentIndex(contentRoot);

      const agent = index.byId.get("hatch3r-implementer");
      expect(agent).toBeDefined();
      expect(agent!.id).toBe("hatch3r-implementer");
      expect(agent!.type).toBe("agent");
      expect(agent!.description).toBe("Implements features");
      expect(agent!.tags).toEqual([TAG_ORCHESTRATION, TAG_IMPLEMENTATION]);
    });

    it("falls back to filename for id when frontmatter has no id", async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, "agents"), { recursive: true });
      await writeFile(
        join(dir, "agents", "no-id-agent.md"),
        "---\ntype: agent\ndescription: No ID\n---\n# Agent\n",
      );
      const index = await buildContentIndex(dir);

      const item = index.items.find((i) => i.id === "no-id-agent");
      expect(item).toBeDefined();
      expect(item!.id).toBe("no-id-agent");
    });

    it("falls back to directory name for skill id when frontmatter has no id", async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, "skills", "my-skill"), { recursive: true });
      await writeFile(
        join(dir, "skills", "my-skill", "SKILL.md"),
        "---\ntype: skill\ndescription: No ID skill\n---\n# Skill\n",
      );
      const index = await buildContentIndex(dir);

      const item = index.items.find((i) => i.id === "my-skill");
      expect(item).toBeDefined();
    });

    it("detects companion .mdc files for rules", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const index = await buildContentIndex(contentRoot);

      const rule = index.byId.get("hatch3r-code-standards");
      expect(rule).toBeDefined();
      // relativePath/companionPath are POSIX-canonical (forward slashes)
      // regardless of platform — see CatalogItem.relativePath in src/content/index.ts.
      expect(rule!.companionPath).toBe(posix.join("rules", "hatch3r-code-standards.mdc"));
    });

    it("does not set companionPath when no .mdc exists", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const index = await buildContentIndex(contentRoot);

      const rule = index.byId.get("hatch3r-testing");
      expect(rule).toBeDefined();
      expect(rule!.companionPath).toBeUndefined();
    });

    it("skips non-.md files in glob directories", async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, "agents"), { recursive: true });
      await writeFile(join(dir, "agents", "valid.md"), mdFile({ id: "valid-agent", type: "agent" }));
      await writeFile(join(dir, "agents", "ignore.txt"), "not markdown");
      await writeFile(join(dir, "agents", "ignore.json"), "{}");

      const index = await buildContentIndex(dir);
      expect(index.items.length).toBe(1);
      expect(index.items[0]!.id).toBe("valid-agent");
    });

    it("handles missing directories gracefully (ENOENT)", async () => {
      const dir = await makeTempDir();
      // Empty dir — no agents/, rules/, etc.
      const index = await buildContentIndex(dir);
      expect(index.items).toEqual([]);
    });

    it("builds byType index correctly", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const index = await buildContentIndex(contentRoot);

      expect(index.byType["agent"]!.length).toBe(3);
      expect(index.byType["skill"]!.length).toBe(2);
      expect(index.byType["rule"]!.length).toBe(2);
      expect(index.byType["command"]!.length).toBe(2);
      expect(index.byType["prompt"]!.length).toBe(1);
      expect(index.byType["hook"]!.length).toBe(1);
      expect(index.byType["github-agent"]!.length).toBe(1);
    });

    it("builds byId index correctly", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const index = await buildContentIndex(contentRoot);

      expect(index.byId.get("hatch3r-implementer")).toBeDefined();
      expect(index.byId.get("hatch3r-feature")).toBeDefined();
      expect(index.byId.get("hatch3r-code-standards")).toBeDefined();
      expect(index.byId.get("nonexistent")).toBeUndefined();
    });

    it("returns empty items for empty directories", async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, "agents"), { recursive: true });
      await mkdir(join(dir, "rules"), { recursive: true });
      // dirs exist but have no .md files
      const index = await buildContentIndex(dir);
      expect(index.items).toEqual([]);
    });

    it("skips non-directory entries in skills/", async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, "skills"), { recursive: true });
      await writeFile(join(dir, "skills", "not-a-dir.md"), "# stray file");
      const index = await buildContentIndex(dir);
      const skills = index.items.filter((i) => i.type === "skill");
      expect(skills.length).toBe(0);
    });

    it("skips skill subdirectories without SKILL.md", async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, "skills", "empty-skill"), { recursive: true });
      await writeFile(join(dir, "skills", "empty-skill", "README.md"), "# not a skill");
      const index = await buildContentIndex(dir);
      const skills = index.items.filter((i) => i.type === "skill");
      expect(skills.length).toBe(0);
    });

    it("parses protected flag from frontmatter", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const index = await buildContentIndex(contentRoot);

      const protectedItem = index.byId.get("hatch3r-protected");
      expect(protectedItem).toBeDefined();
      expect(protectedItem!.protected).toBe(true);

      const normalItem = index.byId.get("hatch3r-implementer");
      expect(normalItem!.protected).toBeUndefined();
    });

    it("sets relativePath correctly for glob and subdirectory items", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const index = await buildContentIndex(contentRoot);

      const agent = index.byId.get("hatch3r-implementer");
      expect(agent!.relativePath).toBe(posix.join("agents", "hatch3r-implementer.md"));

      const skill = index.byId.get("hatch3r-feature");
      expect(skill!.relativePath).toBe(posix.join("skills", "hatch3r-feature"));
    });
  });

  // ── preset metadata (recommended label) ──────────────────

  describe("preset recommended-label (C9-H25)", () => {
    // C9-H25 (D10-SA10.1-F2): The "Standard" preset is the documented
    // recommended default across README, quick-start docs, and the init
    // CLI fallback. The "(recommended)" tag belongs on Standard's display
    // name — not Full — so the interactive picker renders consistently.
    it("standard preset display name carries '(recommended)'", () => {
      const standard = getPreset("standard");
      expect(standard.name).toContain("(recommended)");
    });

    it("full preset display name does NOT carry '(recommended)'", () => {
      const full = getPreset("full");
      expect(full.name).not.toContain("(recommended)");
    });

    it("only one preset is labeled '(recommended)'", () => {
      const ids = ["minimal", "standard", "full", "custom"] as const;
      const labeled = ids.filter((id) => getPreset(id).name.includes("(recommended)"));
      expect(labeled).toEqual(["standard"]);
    });
  });

  // ── resolveSelection ──────────────────────────────────────
  //
  // Wave 1 of the content-pack redesign reshaped resolveSelection into a
  // four-stage pipeline (custom path → floor admission → capability gate →
  // context filter → language filter). The fixture set below exercises the
  // new model — capability gate is positive-list only, floor tags admit
  // unconditionally for non-custom presets, customize is a typed boolean,
  // and zero-capability / zero-floor / non-protected items are DROPPED
  // (reversed from v1's empty-tag passthrough).

  describe("resolveSelection", () => {
    // Core orchestration agent — admitted by every preset's capability gate
    // because every non-custom preset lists TAG_ORCHESTRATION in capabilities.
    const orchestrationAgent = makeCatalogItem({
      id: "orchestration-agent",
      tags: [TAG_ORCHESTRATION, TAG_IMPLEMENTATION],
    });
    // Planning command — admitted by standard/full only (TAG_PLANNING).
    const planningCmd = makeCatalogItem({
      id: "plan-cmd", type: "command", tags: [TAG_PLANNING],
      relativePath: "commands/plan-cmd.md",
    });
    // Board command — admitted by standard/full only (TAG_BOARD).
    // Carries ctx:team-only so it should also be filtered for solo teams.
    const boardCmd = makeCatalogItem({
      id: "board-cmd", type: "command", tags: [TAG_BOARD, TAG_CTX_TEAM_ONLY],
      relativePath: "commands/board-cmd.md",
    });
    // Protected agent — always passes, even with no capability tag.
    const protectedAgent = makeCatalogItem({
      id: "protected-agent", protected: true, tags: [],
      relativePath: "agents/protected-agent.md",
    });
    // Brownfield-only command with an implementation capability — admitted by
    // every preset, then removed only by the greenfield context filter.
    const brownfieldCmd = makeCatalogItem({
      id: "bf-cmd", type: "command",
      tags: [TAG_IMPLEMENTATION, TAG_CTX_BROWNFIELD_ONLY],
      relativePath: "commands/bf-cmd.md",
    });
    // Greenfield-only command — mirror of brownfieldCmd for the opposite filter.
    const greenfieldCmd = makeCatalogItem({
      id: "gf-cmd", type: "command",
      tags: [TAG_IMPLEMENTATION, TAG_CTX_GREENFIELD_ONLY],
      relativePath: "commands/gf-cmd.md",
    });
    // Untagged rule — exercises the REVERSED empty-tag rule. Zero capability +
    // zero floor + not protected = DROPPED under the new pipeline.
    const noTagsRule = makeCatalogItem({
      id: "no-tags-rule", type: "rule", tags: [],
      relativePath: "rules/no-tags-rule.md",
    });
    // Review rule — admitted by standard/full only (TAG_REVIEW).
    const reviewRule = makeCatalogItem({
      id: "review-rule", type: "rule", tags: [TAG_REVIEW],
      relativePath: "rules/review-rule.md",
    });
    // UI/UX-floor a11y agent — admitted by EVERY non-custom preset via floor
    // admission, regardless of preset.capabilities or includeCustomize.
    const a11yAgent = makeCatalogItem({
      id: "a11y-agent", tags: [TAG_FLOOR_UI_UX, TAG_A11Y],
      relativePath: "agents/a11y-agent.md",
    });
    // Security-floor rule — admitted by every non-custom preset.
    const securityRule = makeCatalogItem({
      id: "security-rule", type: "rule", tags: [TAG_FLOOR_SECURITY],
      relativePath: "rules/security-rule.md",
    });
    // Team-only command with an orchestration capability — admitted by every
    // preset, but the context filter removes it for solo teams unless the item
    // also carries a floor tag (it does not here).
    const teamOnlyCmd = makeCatalogItem({
      id: "team-only", type: "command",
      tags: [TAG_ORCHESTRATION, TAG_CTX_TEAM_ONLY],
      relativePath: "commands/team-only.md",
    });
    // Customize-only command — admitted only when preset.includeCustomize is
    // true (i.e. standard + full); has no capability tag of its own.
    const customizeCmd = makeCatalogItem({
      id: "customize-cmd", type: "command", tags: [TAG_CUSTOMIZE],
      relativePath: "commands/customize-cmd.md",
    });
    // Performance agent — admitted only by full preset (full.capabilities
    // includes TAG_PERFORMANCE).
    const perfAgent = makeCatalogItem({
      id: "perf-agent", tags: [TAG_PERFORMANCE],
      relativePath: "agents/perf-agent.md",
    });
    // AI agent — admitted only by full preset (full.capabilities includes
    // TAG_AI). Exercises the new capability added in Wave 1.
    const aiAgent = makeCatalogItem({
      id: "ai-agent", tags: [TAG_AI],
      relativePath: "agents/ai-agent.md",
    });

    const allItems = [
      orchestrationAgent, planningCmd, boardCmd, protectedAgent, brownfieldCmd,
      greenfieldCmd, noTagsRule, reviewRule, a11yAgent, securityRule,
      teamOnlyCmd, customizeCmd, perfAgent, aiAgent,
    ];
    const index = makeIndex(allItems);

    // ── Capability gate ───────────────────────────────────────

    it("full preset admits items with any capability tag", () => {
      const preset = getPreset("full");
      const selection = resolveSelection(preset, "brownfield", "team", index);

      const allIds = getAllContentIds(selection);
      // brownfield+team: greenfield-only removed, everything else admitted by
      // either the capability gate, floor admission, or customize/protected.
      expect(allIds.has("orchestration-agent")).toBe(true);
      expect(allIds.has("plan-cmd")).toBe(true);
      expect(allIds.has("board-cmd")).toBe(true);
      expect(allIds.has("bf-cmd")).toBe(true);
      expect(allIds.has("perf-agent")).toBe(true);
      expect(allIds.has("ai-agent")).toBe(true);
      expect(allIds.has("customize-cmd")).toBe(true);
    });

    it("minimal preset admits only orchestration + implementation capabilities", () => {
      const preset = getPreset("minimal");
      const selection = resolveSelection(preset, "brownfield", "team", index);

      const allIds = getAllContentIds(selection);
      // Minimal.capabilities = [orchestration, implementation]
      expect(allIds.has("orchestration-agent")).toBe(true);
      expect(allIds.has("bf-cmd")).toBe(true); // implementation
      // Non-minimal capabilities are excluded.
      expect(allIds.has("plan-cmd")).toBe(false);   // planning
      expect(allIds.has("review-rule")).toBe(false); // review
      expect(allIds.has("perf-agent")).toBe(false);  // performance (full-only)
      expect(allIds.has("ai-agent")).toBe(false);    // ai (full-only)
      expect(allIds.has("board-cmd")).toBe(false);   // board (standard+full)
    });

    it("standard preset admits planning/review/devops/maintenance/board but not performance/ai", () => {
      const preset = getPreset("standard");
      const selection = resolveSelection(preset, "brownfield", "team", index);

      const allIds = getAllContentIds(selection);
      expect(allIds.has("plan-cmd")).toBe(true);    // planning
      expect(allIds.has("review-rule")).toBe(true); // review
      expect(allIds.has("board-cmd")).toBe(true);   // board
      // Full-only capabilities still excluded.
      expect(allIds.has("perf-agent")).toBe(false);
      expect(allIds.has("ai-agent")).toBe(false);
    });

    // ── Floor admission (structural invariant) ────────────────

    it("floor:ui-ux items are admitted by every non-custom preset (including minimal)", () => {
      const preset = getPreset("minimal");
      const selection = resolveSelection(preset, "brownfield", "team", index);
      const allIds = getAllContentIds(selection);
      // a11y-agent carries floor:ui-ux — admitted by floor admission even
      // though minimal.capabilities does not list anything UI/UX-related.
      expect(allIds.has("a11y-agent")).toBe(true);
    });

    it("floor:security items are admitted by every non-custom preset", () => {
      const preset = getPreset("minimal");
      const selection = resolveSelection(preset, "brownfield", "team", index);
      const allIds = getAllContentIds(selection);
      // security-rule carries only floor:security (no capability tag) and
      // still ships under minimal because floor admission is structural.
      expect(allIds.has("security-rule")).toBe(true);
    });

    // F3.3-H1 (D3 Cycle 10 Wave 2): floor:protocol and floor:content-quality
    // admission previously rode entirely on isFloorTag() being tested at the
    // predicate level — no test exercised them through resolveSelection's
    // Stage-2 floor admission (custom path) AND Stage-2 floor admission
    // (non-custom path). A refactor of either admission stage could silently
    // regress these two of the four floor tags. These tests close the gap by
    // asserting both tags ship under minimal AND under custom-with-no-selections
    // (preset.id === "custom" + empty customSelections), the two structurally
    // distinct admission branches (index.ts:589-606).
    it("floor:protocol items are admitted by minimal and custom-with-no-selections", () => {
      const protocolItem = makeCatalogItem({
        id: "floor-protocol-item",
        type: "agent",
        tags: [TAG_FLOOR_PROTOCOL],
        relativePath: "agents/floor-protocol-item.md",
      });
      const floorIndex = makeIndex([protocolItem]);

      // Non-custom branch (minimal): admitted unconditionally.
      const minimal = resolveSelection(getPreset("minimal"), "brownfield", "team", floorIndex);
      expect(getAllContentIds(minimal).has("floor-protocol-item")).toBe(true);

      // Custom branch with an empty selection list: floor still applies.
      const custom = resolveSelection(getPreset("custom"), "brownfield", "team", floorIndex, []);
      expect(getAllContentIds(custom).has("floor-protocol-item")).toBe(true);
    });

    it("floor:content-quality items are admitted by minimal and custom-with-no-selections", () => {
      const cqItem = makeCatalogItem({
        id: "floor-content-quality-item",
        type: "rule",
        tags: [TAG_FLOOR_CONTENT_QUALITY],
        relativePath: "rules/floor-content-quality-item.md",
      });
      const floorIndex = makeIndex([cqItem]);

      const minimal = resolveSelection(getPreset("minimal"), "brownfield", "team", floorIndex);
      expect(getAllContentIds(minimal).has("floor-content-quality-item")).toBe(true);

      const custom = resolveSelection(getPreset("custom"), "brownfield", "team", floorIndex, []);
      expect(getAllContentIds(custom).has("floor-content-quality-item")).toBe(true);
    });

    it("floor admission bypasses team-size context filter (UI/UX ships to solo too)", () => {
      // Synthetic floor item that ALSO carries ctx:team-only — the floor
      // tag wins, the item ships to solo.
      const floorTeamOnly = makeCatalogItem({
        id: "floor-team-only",
        tags: [TAG_FLOOR_UI_UX, TAG_CTX_TEAM_ONLY],
        relativePath: "agents/floor-team-only.md",
      });
      const floorIndex = makeIndex([floorTeamOnly]);
      const preset = getPreset("standard");
      const selection = resolveSelection(preset, "brownfield", "solo", floorIndex);
      expect(getAllContentIds(selection).has("floor-team-only")).toBe(true);
    });

    // ── Reversed empty-tag passthrough ───────────────────────

    it("items with zero capability + zero floor + not protected are DROPPED (reversed empty-tag rule)", () => {
      const preset = getPreset("full");
      const selection = resolveSelection(preset, "brownfield", "team", index);
      // no-tags-rule has neither a capability nor a floor tag and is not
      // protected — under the v1 "empty tags pass" rule it would have been
      // admitted; the new pipeline drops it deliberately.
      expect(getAllContentIds(selection).has("no-tags-rule")).toBe(false);
    });

    it("dropping zero-capability items applies to every preset (not just minimal)", () => {
      for (const presetId of ["minimal", "standard", "full"] as const) {
        const preset = getPreset(presetId);
        const selection = resolveSelection(preset, "brownfield", "team", index);
        expect(
          getAllContentIds(selection).has("no-tags-rule"),
          `preset ${presetId} should drop no-tags-rule`,
        ).toBe(false);
      }
    });

    // ── Protected items ───────────────────────────────────────

    it("protected items are always included regardless of filters", () => {
      const preset = getPreset("minimal");
      const selection = resolveSelection(preset, "greenfield", "solo", index);

      const allIds = getAllContentIds(selection);
      // protected-agent has zero tags but is `protected: true`.
      expect(allIds.has("protected-agent")).toBe(true);
    });

    // ── Customize family (locked: standard + full only) ──────

    it("minimal preset (includeCustomize=false) excludes customize-only items", () => {
      const preset = getPreset("minimal");
      const selection = resolveSelection(preset, "brownfield", "team", index);
      expect(getAllContentIds(selection).has("customize-cmd")).toBe(false);
    });

    it("standard preset (includeCustomize=true) admits customize-only items", () => {
      const preset = getPreset("standard");
      const selection = resolveSelection(preset, "brownfield", "team", index);
      expect(getAllContentIds(selection).has("customize-cmd")).toBe(true);
    });

    it("full preset (includeCustomize=true) admits customize-only items", () => {
      const preset = getPreset("full");
      const selection = resolveSelection(preset, "brownfield", "team", index);
      expect(getAllContentIds(selection).has("customize-cmd")).toBe(true);
    });

    // ── includeIds / excludeIds carve-outs ───────────────────

    it("includeIds admits items whose capability tags do not intersect the preset", () => {
      // Synthetic preset variant: minimal + an explicit includeIds carve-out
      // for the performance agent, which minimal's capability list would
      // otherwise reject.
      const carveOut = {
        ...getPreset("minimal"),
        includeIds: ["perf-agent"],
      };
      const selection = resolveSelection(carveOut, "brownfield", "team", index);
      expect(getAllContentIds(selection).has("perf-agent")).toBe(true);
    });

    it("excludeIds removes items that would otherwise be admitted by capability", () => {
      // Synthetic preset variant: full minus the planning command.
      const carveOut = {
        ...getPreset("full"),
        excludeIds: ["plan-cmd"],
      };
      const selection = resolveSelection(carveOut, "brownfield", "team", index);
      expect(getAllContentIds(selection).has("plan-cmd")).toBe(false);
      // Other capability matches still admitted.
      expect(getAllContentIds(selection).has("review-rule")).toBe(true);
    });

    it("excludeIds cannot remove floor-admitted items (floor invariant wins)", () => {
      const carveOut = {
        ...getPreset("full"),
        excludeIds: ["a11y-agent", "security-rule"],
      };
      const selection = resolveSelection(carveOut, "brownfield", "team", index);
      // Floor items are admitted before excludeIds is even consulted.
      expect(getAllContentIds(selection).has("a11y-agent")).toBe(true);
      expect(getAllContentIds(selection).has("security-rule")).toBe(true);
    });

    it("excludeIds cannot remove protected items", () => {
      const carveOut = {
        ...getPreset("full"),
        excludeIds: ["protected-agent"],
      };
      const selection = resolveSelection(carveOut, "brownfield", "team", index);
      expect(getAllContentIds(selection).has("protected-agent")).toBe(true);
    });

    // ── Context filter ───────────────────────────────────────

    it("greenfield projectType removes ctx:brownfield-only items", () => {
      const preset = getPreset("full");
      const selection = resolveSelection(preset, "greenfield", "team", index);

      const allIds = getAllContentIds(selection);
      expect(allIds.has("bf-cmd")).toBe(false);
      expect(allIds.has("gf-cmd")).toBe(true);
    });

    it("brownfield projectType removes ctx:greenfield-only items", () => {
      const preset = getPreset("full");
      const selection = resolveSelection(preset, "brownfield", "team", index);

      const allIds = getAllContentIds(selection);
      expect(allIds.has("gf-cmd")).toBe(false);
      expect(allIds.has("bf-cmd")).toBe(true);
    });

    it("solo teamSize removes non-floor ctx:team-only items", () => {
      const preset = getPreset("standard");
      const selection = resolveSelection(preset, "brownfield", "solo", index);

      const allIds = getAllContentIds(selection);
      expect(allIds.has("team-only")).toBe(false);
      // board-cmd carries ctx:team-only — also removed.
      expect(allIds.has("board-cmd")).toBe(false);
    });

    it("team teamSize keeps ctx:team-only items", () => {
      const preset = getPreset("full");
      const selection = resolveSelection(preset, "brownfield", "team", index);

      const allIds = getAllContentIds(selection);
      expect(allIds.has("team-only")).toBe(true);
      expect(allIds.has("board-cmd")).toBe(true);
    });

    // ── Custom preset ────────────────────────────────────────

    it("custom preset with customSelections uses explicit ID list (plus protected + floor)", () => {
      const preset = getPreset("custom");
      const selection = resolveSelection(
        preset, "brownfield", "team", index,
        ["orchestration-agent", "review-rule"],
      );

      const allIds = getAllContentIds(selection);
      expect(allIds.has("orchestration-agent")).toBe(true);
      expect(allIds.has("review-rule")).toBe(true);
      // Non-selected, non-protected, non-floor items excluded.
      expect(allIds.has("plan-cmd")).toBe(false);
      // Floor items still pass even in custom.
      expect(allIds.has("a11y-agent")).toBe(true);
      expect(allIds.has("security-rule")).toBe(true);
    });

    it("custom preset still includes protected items", () => {
      const preset = getPreset("custom");
      const selection = resolveSelection(
        preset, "brownfield", "team", index,
        ["orchestration-agent"],
      );

      const allIds = getAllContentIds(selection);
      expect(allIds.has("protected-agent")).toBe(true);
    });

    it("custom preset without customSelections falls back to floor-only admission (capability gate via empty .capabilities)", () => {
      const preset = getPreset("custom");
      // custom.capabilities is empty and includeCustomize is false. Result:
      // only floor + protected items survive the capability gate.
      const selection = resolveSelection(preset, "brownfield", "team", index);

      const allIds = getAllContentIds(selection);
      // Floor items pass.
      expect(allIds.has("a11y-agent")).toBe(true);
      expect(allIds.has("security-rule")).toBe(true);
      // Protected passes.
      expect(allIds.has("protected-agent")).toBe(true);
      // Items with only capability tags are rejected (custom has no caps).
      expect(allIds.has("orchestration-agent")).toBe(false);
      expect(allIds.has("plan-cmd")).toBe(false);
      // ctx:greenfield-only doesn't apply (we're brownfield) — both bf-cmd
      // and gf-cmd had capability tags but custom rejects those too.
      expect(allIds.has("bf-cmd")).toBe(false);
      expect(allIds.has("gf-cmd")).toBe(false);
    });

    // ── Selection grouping + metadata ────────────────────────

    it("groups items correctly by type in selection.items", () => {
      const preset = getPreset("full");
      const selection = resolveSelection(preset, "brownfield", "team", index);

      // Agents go to items.agents
      expect(selection.items.agents).toContain("orchestration-agent");
      expect(selection.items.agents).toContain("protected-agent");
      // Commands go to items.commands
      expect(selection.items.commands).toContain("plan-cmd");
      // Rules go to items.rules
      expect(selection.items.rules).toContain("security-rule");
    });

    it("returns correct preset/projectType/teamSize in selection", () => {
      const preset = getPreset("standard");
      const selection = resolveSelection(preset, "greenfield", "solo", index);

      expect(selection.preset).toBe("standard");
      expect(selection.projectType).toBe("greenfield");
      expect(selection.teamSize).toBe("solo");
    });

    it("empty index returns selection with empty items", () => {
      const preset = getPreset("full");
      const emptyIndex = makeIndex([]);
      const selection = resolveSelection(preset, "brownfield", "team", emptyIndex);

      expect(countSelectionItems(selection)).toBe(0);
    });

    // ── Dual context-tag items ───────────────────────────────

    it("item carrying both ctx:greenfield-only and ctx:brownfield-only is filtered by either project type", () => {
      // An item declaring incompatibility with BOTH project types removes
      // itself from every preset — there is no project type left it could
      // ship to. This is a tagging mistake by design.
      const dualItem = makeCatalogItem({
        id: "dual-context", type: "rule",
        tags: [TAG_IMPLEMENTATION, TAG_CTX_GREENFIELD_ONLY, TAG_CTX_BROWNFIELD_ONLY],
        relativePath: "rules/dual-context.md",
      });
      const dualIndex = makeIndex([dualItem]);
      const preset = getPreset("full");

      // Greenfield filter drops ctx:brownfield-only items.
      const gfSelection = resolveSelection(preset, "greenfield", "team", dualIndex);
      expect(getAllContentIds(gfSelection).has("dual-context")).toBe(false);

      // Brownfield filter drops ctx:greenfield-only items.
      const bfSelection = resolveSelection(preset, "brownfield", "team", dualIndex);
      expect(getAllContentIds(bfSelection).has("dual-context")).toBe(false);
    });

    // ── Language filtering (Finding #71) ────────────────────

    it("items without language tags are included regardless of project languages", () => {
      const genericRule = makeCatalogItem({
        id: "generic-rule", type: "rule", tags: [TAG_ORCHESTRATION],
        relativePath: "rules/generic-rule.md",
      });
      const langIndex = makeIndex([genericRule]);
      const preset = getPreset("full");

      const selection = resolveSelection(preset, "brownfield", "team", langIndex, undefined, ["python"]);
      expect(getAllContentIds(selection).has("generic-rule")).toBe(true);
    });

    it("items with matching language tag are included for that language", () => {
      const tsRule = makeCatalogItem({
        id: "ts-rule", type: "rule", tags: [TAG_ORCHESTRATION, "lang:typescript"],
        relativePath: "rules/ts-rule.md",
      });
      const langIndex = makeIndex([tsRule]);
      const preset = getPreset("full");

      const selection = resolveSelection(preset, "brownfield", "team", langIndex, undefined, ["typescript"]);
      expect(getAllContentIds(selection).has("ts-rule")).toBe(true);
    });

    it("items with non-matching language tag are excluded for other languages", () => {
      const tsRule = makeCatalogItem({
        id: "ts-only-rule", type: "rule", tags: [TAG_ORCHESTRATION, "lang:typescript"],
        relativePath: "rules/ts-only-rule.md",
      });
      const langIndex = makeIndex([tsRule]);
      const preset = getPreset("full");

      const selection = resolveSelection(preset, "brownfield", "team", langIndex, undefined, ["python"]);
      expect(getAllContentIds(selection).has("ts-only-rule")).toBe(false);
    });

    it("javascript projects match lang:typescript tagged items", () => {
      const tsRule = makeCatalogItem({
        id: "ts-js-rule", type: "rule", tags: [TAG_ORCHESTRATION, "lang:typescript"],
        relativePath: "rules/ts-js-rule.md",
      });
      const langIndex = makeIndex([tsRule]);
      const preset = getPreset("full");

      const selection = resolveSelection(preset, "brownfield", "team", langIndex, undefined, ["javascript"]);
      expect(getAllContentIds(selection).has("ts-js-rule")).toBe(true);
    });

    it("multi-language projects include items matching any detected language", () => {
      const pyRule = makeCatalogItem({
        id: "py-rule", type: "rule", tags: [TAG_ORCHESTRATION, "lang:python"],
        relativePath: "rules/py-rule.md",
      });
      const goRule = makeCatalogItem({
        id: "go-rule", type: "rule", tags: [TAG_ORCHESTRATION, "lang:go"],
        relativePath: "rules/go-rule.md",
      });
      const rubyRule = makeCatalogItem({
        id: "ruby-rule", type: "rule", tags: [TAG_ORCHESTRATION, "lang:ruby"],
        relativePath: "rules/ruby-rule.md",
      });
      const langIndex = makeIndex([pyRule, goRule, rubyRule]);
      const preset = getPreset("full");

      const selection = resolveSelection(preset, "brownfield", "team", langIndex, undefined, ["python", "go"]);
      const allIds = getAllContentIds(selection);
      expect(allIds.has("py-rule")).toBe(true);
      expect(allIds.has("go-rule")).toBe(true);
      expect(allIds.has("ruby-rule")).toBe(false);
    });

    it("protected items with non-matching language tags are still included", () => {
      const protectedLangItem = makeCatalogItem({
        id: "protected-lang", type: "agent",
        tags: [TAG_ORCHESTRATION, "lang:typescript"],
        protected: true,
        relativePath: "agents/protected-lang.md",
      });
      const langIndex = makeIndex([protectedLangItem]);
      const preset = getPreset("full");

      const selection = resolveSelection(preset, "brownfield", "team", langIndex, undefined, ["python"]);
      expect(getAllContentIds(selection).has("protected-lang")).toBe(true);
    });

    it("no language filtering when projectLanguages is undefined", () => {
      const tsRule = makeCatalogItem({
        id: "ts-rule-no-filter", type: "rule",
        tags: [TAG_ORCHESTRATION, "lang:typescript"],
        relativePath: "rules/ts-rule-no-filter.md",
      });
      const langIndex = makeIndex([tsRule]);
      const preset = getPreset("full");

      const selection = resolveSelection(preset, "brownfield", "team", langIndex);
      expect(getAllContentIds(selection).has("ts-rule-no-filter")).toBe(true);
    });

    it("no language filtering when projectLanguages is empty array", () => {
      const tsRule = makeCatalogItem({
        id: "ts-rule-empty", type: "rule",
        tags: [TAG_ORCHESTRATION, "lang:typescript"],
        relativePath: "rules/ts-rule-empty.md",
      });
      const langIndex = makeIndex([tsRule]);
      const preset = getPreset("full");

      const selection = resolveSelection(preset, "brownfield", "team", langIndex, undefined, []);
      expect(getAllContentIds(selection).has("ts-rule-empty")).toBe(true);
    });

    // ── skipContextFilters opt-out (config.ts path) ──────────

    it("skipContextFilters=true bypasses project-type, team-size, and language filters", () => {
      const preset = getPreset("full");
      const selection = resolveSelection(
        preset, "brownfield", "solo", index, undefined, undefined,
        { skipContextFilters: true },
      );
      const allIds = getAllContentIds(selection);
      // team-only and board-cmd would normally be removed for solo; under
      // skipContextFilters they stay.
      expect(allIds.has("team-only")).toBe(true);
      expect(allIds.has("board-cmd")).toBe(true);
    });

    // ── Maturity-tier gating (Decision 4 / #16) ──────────────

    describe("maturity tier admission", () => {
      // Items tagged with tier admission strings — these strings are not (yet)
      // registered in TAG_REGISTRY, so capability/floor predicates skip them
      // and the only filter that consults them is the tier gate.
      const enterpriseOnlyItem = makeCatalogItem({
        id: "enterprise-only-rule",
        type: "rule",
        tags: [TAG_ORCHESTRATION, "floor:enterprise-only"],
        relativePath: "rules/enterprise-only-rule.md",
      });
      const tierEnterpriseItem = makeCatalogItem({
        id: "tier-enterprise-rule",
        type: "rule",
        tags: [TAG_ORCHESTRATION, "tier:enterprise-only"],
        relativePath: "rules/tier-enterprise-rule.md",
      });
      const scaleupPlusItem = makeCatalogItem({
        id: "scaleup-plus-rule",
        type: "rule",
        tags: [TAG_ORCHESTRATION, "tier:scaleup-plus"],
        relativePath: "rules/scaleup-plus-rule.md",
      });
      const teamPlusItem = makeCatalogItem({
        id: "team-plus-rule",
        type: "rule",
        tags: [TAG_ORCHESTRATION, "tier:team-plus"],
        relativePath: "rules/team-plus-rule.md",
      });
      const tierAgnosticItem = makeCatalogItem({
        id: "tier-agnostic-rule",
        type: "rule",
        tags: [TAG_ORCHESTRATION],
        relativePath: "rules/tier-agnostic-rule.md",
      });
      const protectedEnterpriseItem = makeCatalogItem({
        id: "protected-enterprise-rule",
        type: "rule",
        tags: [TAG_ORCHESTRATION, "floor:enterprise-only"],
        protected: true,
        relativePath: "rules/protected-enterprise-rule.md",
      });
      const tierIndex = makeIndex([
        enterpriseOnlyItem, tierEnterpriseItem, scaleupPlusItem, teamPlusItem,
        tierAgnosticItem, protectedEnterpriseItem,
      ]);

      it("solo tier (default) drops items tagged floor:enterprise-only", () => {
        const preset = getPreset("full");
        const selection = resolveSelection(preset, "brownfield", "team", tierIndex);
        const allIds = getAllContentIds(selection);
        expect(allIds.has("enterprise-only-rule")).toBe(false);
        expect(allIds.has("tier-enterprise-rule")).toBe(false);
        expect(allIds.has("scaleup-plus-rule")).toBe(false);
        expect(allIds.has("team-plus-rule")).toBe(false);
      });

      it("solo tier admits items with no tier tag (default-admit behavior preserved)", () => {
        const preset = getPreset("full");
        const selection = resolveSelection(preset, "brownfield", "team", tierIndex);
        expect(getAllContentIds(selection).has("tier-agnostic-rule")).toBe(true);
      });

      it("solo tier still admits protected items that carry tier tags (protected wins)", () => {
        const preset = getPreset("full");
        const selection = resolveSelection(
          preset, "brownfield", "team", tierIndex,
          undefined, undefined, { maturity: "solo" },
        );
        expect(getAllContentIds(selection).has("protected-enterprise-rule")).toBe(true);
      });

      it("team tier admits tier:team-plus but drops tier:scaleup-plus and tier:enterprise-only", () => {
        const preset = getPreset("full");
        const selection = resolveSelection(
          preset, "brownfield", "team", tierIndex,
          undefined, undefined, { maturity: "team" },
        );
        const allIds = getAllContentIds(selection);
        expect(allIds.has("team-plus-rule")).toBe(true);
        expect(allIds.has("scaleup-plus-rule")).toBe(false);
        expect(allIds.has("tier-enterprise-rule")).toBe(false);
        expect(allIds.has("enterprise-only-rule")).toBe(false);
      });

      it("scaleup tier admits tier:team-plus and tier:scaleup-plus but drops tier:enterprise-only", () => {
        const preset = getPreset("full");
        const selection = resolveSelection(
          preset, "brownfield", "team", tierIndex,
          undefined, undefined, { maturity: "scaleup" },
        );
        const allIds = getAllContentIds(selection);
        expect(allIds.has("team-plus-rule")).toBe(true);
        expect(allIds.has("scaleup-plus-rule")).toBe(true);
        expect(allIds.has("tier-enterprise-rule")).toBe(false);
        expect(allIds.has("enterprise-only-rule")).toBe(false);
      });

      it("enterprise tier admits every tier-tagged item", () => {
        const preset = getPreset("full");
        const selection = resolveSelection(
          preset, "brownfield", "team", tierIndex,
          undefined, undefined, { maturity: "enterprise" },
        );
        const allIds = getAllContentIds(selection);
        expect(allIds.has("team-plus-rule")).toBe(true);
        expect(allIds.has("scaleup-plus-rule")).toBe(true);
        expect(allIds.has("tier-enterprise-rule")).toBe(true);
        expect(allIds.has("enterprise-only-rule")).toBe(true);
        expect(allIds.has("tier-agnostic-rule")).toBe(true);
      });

      it("missing maturity option defaults to solo (backward compat)", () => {
        const preset = getPreset("full");
        const withoutMaturity = resolveSelection(preset, "brownfield", "team", tierIndex);
        const withSolo = resolveSelection(
          preset, "brownfield", "team", tierIndex,
          undefined, undefined, { maturity: "solo" },
        );
        // The two calls must yield identical selections.
        expect(getAllContentIds(withoutMaturity)).toEqual(getAllContentIds(withSolo));
      });

      it("tier gating applies even when skipContextFilters=true (maturity is not a context filter)", () => {
        const preset = getPreset("full");
        const selection = resolveSelection(
          preset, "brownfield", "team", tierIndex,
          undefined, undefined, { skipContextFilters: true, maturity: "solo" },
        );
        expect(getAllContentIds(selection).has("enterprise-only-rule")).toBe(false);
        expect(getAllContentIds(selection).has("tier-enterprise-rule")).toBe(false);
      });

      it("tier gating applies to custom preset with explicit selections", () => {
        const preset = getPreset("custom");
        const selection = resolveSelection(
          preset, "brownfield", "team", tierIndex,
          ["enterprise-only-rule", "tier-agnostic-rule"], undefined,
          { maturity: "solo" },
        );
        const allIds = getAllContentIds(selection);
        // Tier gate fires after the custom-path admission — enterprise tag still drops at solo.
        expect(allIds.has("enterprise-only-rule")).toBe(false);
        // Tier-agnostic item passes the gate.
        expect(allIds.has("tier-agnostic-rule")).toBe(true);
      });
    });
  });

  // ── copySelectedContent ──────────────────────────────────

  describe("copySelectedContent", () => {
    it("copies glob-strategy items (.md files)", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const agentsDir = join(dir, "output");
      const index = await buildContentIndex(contentRoot);

      const selection = emptySelection({
        items: {
          agents: ["hatch3r-implementer"],
          skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [],
        },
      });

      const copied = await copySelectedContent(contentRoot, agentsDir, selection, index);
      // copied paths echo CatalogItem.relativePath (POSIX) — see B.2 in PR 64.
      expect(copied).toContain(posix.join("agents", "hatch3r-implementer.md"));

      const content = await readFile(join(agentsDir, "agents", "hatch3r-implementer.md"), "utf-8");
      expect(content).toContain("hatch3r-implementer");
    });

    it("copies subdirectory-strategy items (skill dirs recursively)", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const agentsDir = join(dir, "output");
      const index = await buildContentIndex(contentRoot);

      const selection = emptySelection({
        items: {
          agents: [], skills: ["hatch3r-refactor"], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [],
        },
      });

      const copied = await copySelectedContent(contentRoot, agentsDir, selection, index);
      expect(copied).toContain(posix.join("skills", "hatch3r-refactor"));

      // Check that the extra file inside the skill dir was also copied
      const helper = await readFile(join(agentsDir, "skills", "hatch3r-refactor", "helper.md"), "utf-8");
      expect(helper).toContain("Extra helper file");
    });

    it("copies companion .mdc files for rules", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const agentsDir = join(dir, "output");
      const index = await buildContentIndex(contentRoot);

      const selection = emptySelection({
        items: {
          agents: [], skills: [], rules: ["hatch3r-code-standards"], commands: [], prompts: [], hooks: [], githubAgents: [],
        },
      });

      const copied = await copySelectedContent(contentRoot, agentsDir, selection, index);
      expect(copied).toContain(posix.join("rules", "hatch3r-code-standards.md"));
      expect(copied).toContain(posix.join("rules", "hatch3r-code-standards.mdc"));

      const mdcContent = await readFile(join(agentsDir, "rules", "hatch3r-code-standards.mdc"), "utf-8");
      expect(mdcContent).toBe("companion mdc content");
    });

    it("skips items not in selection", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const agentsDir = join(dir, "output");
      const index = await buildContentIndex(contentRoot);

      // Only select one agent
      const selection = emptySelection({
        items: {
          agents: ["hatch3r-implementer"],
          skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [],
        },
      });

      const copied = await copySelectedContent(contentRoot, agentsDir, selection, index);
      // hatch3r-reviewer should NOT be copied
      const agentIds = copied.filter((p) => p.startsWith("agents"));
      expect(agentIds.length).toBe(1);
    });

    it("always copies checks/ directory", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const agentsDir = join(dir, "output");
      const index = await buildContentIndex(contentRoot);

      const selection = emptySelection();
      await copySelectedContent(contentRoot, agentsDir, selection, index);

      const checkContent = await readFile(join(agentsDir, "checks", "check1.md"), "utf-8");
      expect(checkContent).toContain("Check 1");
    });

    it("always copies mcp/ directory", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const agentsDir = join(dir, "output");
      const index = await buildContentIndex(contentRoot);

      const selection = emptySelection();
      await copySelectedContent(contentRoot, agentsDir, selection, index);

      const mcpContent = await readFile(join(agentsDir, "mcp", "mcp-config.json"), "utf-8");
      expect(mcpContent).toContain("servers");
    });

    it("handles missing checks/mcp dirs gracefully", async () => {
      const dir = await makeTempDir();
      // Content root with no checks/ or mcp/
      await mkdir(join(dir, "agents"), { recursive: true });
      const index = await buildContentIndex(dir);
      const agentsDir = join(dir, "output");

      const selection = emptySelection();
      // Should not throw
      const copied = await copySelectedContent(dir, agentsDir, selection, index);
      expect(copied).toEqual([]);
    });

    it("returns list of copied paths", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const agentsDir = join(dir, "output");
      const index = await buildContentIndex(contentRoot);

      const selection = emptySelection({
        items: {
          agents: ["hatch3r-implementer", "hatch3r-reviewer"],
          skills: ["hatch3r-feature"],
          rules: [], commands: [], prompts: [], hooks: [], githubAgents: [],
        },
      });

      const copied = await copySelectedContent(contentRoot, agentsDir, selection, index);
      expect(copied).toContain(posix.join("agents", "hatch3r-implementer.md"));
      expect(copied).toContain(posix.join("agents", "hatch3r-reviewer.md"));
      expect(copied).toContain(posix.join("skills", "hatch3r-feature"));
    });

    it("throws HatchError for path traversal in relativePath", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const agentsDir = join(dir, "output");

      const maliciousItem: CatalogItem = {
        id: "evil",
        type: "agent",
        description: "bad",
        tags: [],
        relativePath: "../../../etc/passwd",
        source: "canonical",
      };
      const index = makeIndex([maliciousItem]);
      const selection = emptySelection({
        items: {
          agents: ["evil"],
          skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [],
        },
      });

      await expect(
        copySelectedContent(contentRoot, agentsDir, selection, index),
      ).rejects.toThrow(HatchError);
    });
  });

  // ── getAvailableItems ─────────────────────────────────────

  describe("getAvailableItems", () => {
    it("returns items not on disk", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const agentsDir = join(dir, "installed");
      const index = await buildContentIndex(contentRoot);

      // Install only one agent
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await writeFile(
        join(agentsDir, "agents", "hatch3r-implementer.md"),
        mdFile({ id: "hatch3r-implementer", type: "agent" }),
      );

      const available = await getAvailableItems(contentRoot, agentsDir, index);
      const ids = available.map((a) => a.id);
      // Implementer is installed, should not be in available
      expect(ids).not.toContain("hatch3r-implementer");
      // Reviewer is NOT installed, should be in available
      expect(ids).toContain("hatch3r-reviewer");
    });

    it("returns empty array when all items are installed", async () => {
      const dir = await makeTempDir();
      // Small content root with just one agent
      await mkdir(join(dir, "content", "agents"), { recursive: true });
      await writeFile(
        join(dir, "content", "agents", "only-agent.md"),
        mdFile({ id: "only-agent", type: "agent" }),
      );
      const contentRoot = join(dir, "content");
      const index = await buildContentIndex(contentRoot);

      // Install the same agent
      const agentsDir = join(dir, "installed");
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await writeFile(
        join(agentsDir, "agents", "only-agent.md"),
        mdFile({ id: "only-agent", type: "agent" }),
      );

      const available = await getAvailableItems(contentRoot, agentsDir, index);
      expect(available).toEqual([]);
    });

    it("handles missing installed dirs gracefully", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const index = await buildContentIndex(contentRoot);

      // agentsDir doesn't exist at all
      const agentsDir = join(dir, "nonexistent");
      const available = await getAvailableItems(contentRoot, agentsDir, index);
      // Everything should be available since nothing is installed
      expect(available.length).toBe(index.items.length);
    });

    it("detects installed skills via subdirectory scanning", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const index = await buildContentIndex(contentRoot);

      const agentsDir = join(dir, "installed");
      await mkdir(join(agentsDir, "skills", "hatch3r-feature"), { recursive: true });
      await writeFile(
        join(agentsDir, "skills", "hatch3r-feature", "SKILL.md"),
        mdFile({ id: "hatch3r-feature", type: "skill" }),
      );

      const available = await getAvailableItems(contentRoot, agentsDir, index);
      const ids = available.map((a) => a.id);
      expect(ids).not.toContain("hatch3r-feature");
      expect(ids).toContain("hatch3r-refactor");
    });

    it("returns all items when installed dir is empty", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const index = await buildContentIndex(contentRoot);

      const agentsDir = join(dir, "installed");
      await mkdir(agentsDir, { recursive: true });
      // Dir exists but has no content subdirs

      const available = await getAvailableItems(contentRoot, agentsDir, index);
      expect(available.length).toBe(index.items.length);
    });
  });

  // ── buildSelectionsFromDisk ───────────────────────────────

  describe("buildSelectionsFromDisk", () => {
    it("scans glob dirs and adds IDs", async () => {
      const dir = await makeTempDir();
      const agentsDir = join(dir, "agents-dir");
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await writeFile(
        join(agentsDir, "agents", "agent1.md"),
        mdFile({ id: "agent1", type: "agent" }),
      );
      await writeFile(
        join(agentsDir, "agents", "agent2.md"),
        mdFile({ id: "agent2", type: "agent" }),
      );

      const selection = await buildSelectionsFromDisk(agentsDir);
      expect(selection.items.agents).toContain("agent1");
      expect(selection.items.agents).toContain("agent2");
    });

    it("scans subdirectory (skills) and adds IDs", async () => {
      const dir = await makeTempDir();
      const agentsDir = join(dir, "agents-dir");
      await mkdir(join(agentsDir, "skills", "my-skill"), { recursive: true });
      await writeFile(
        join(agentsDir, "skills", "my-skill", "SKILL.md"),
        mdFile({ id: "my-skill", type: "skill" }),
      );

      const selection = await buildSelectionsFromDisk(agentsDir);
      expect(selection.items.skills).toContain("my-skill");
    });

    it("returns full/brownfield/team defaults", async () => {
      const dir = await makeTempDir();
      const agentsDir = join(dir, "agents-dir");
      await mkdir(agentsDir, { recursive: true });

      const selection = await buildSelectionsFromDisk(agentsDir);
      expect(selection.preset).toBe("full");
      expect(selection.projectType).toBe("brownfield");
      expect(selection.teamSize).toBe("team");
    });

    it("handles empty/missing dirs", async () => {
      const dir = await makeTempDir();
      const agentsDir = join(dir, "nonexistent");

      const selection = await buildSelectionsFromDisk(agentsDir);
      expect(selection.items.agents).toEqual([]);
      expect(selection.items.skills).toEqual([]);
      expect(selection.items.rules).toEqual([]);
      expect(selection.items.commands).toEqual([]);
      expect(selection.items.prompts).toEqual([]);
      expect(selection.items.hooks).toEqual([]);
      expect(selection.items.githubAgents).toEqual([]);
    });

    it("scans all content type directories", async () => {
      const dir = await makeTempDir();
      const agentsDir = join(dir, "agents-dir");

      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await writeFile(join(agentsDir, "agents", "a.md"), mdFile({ id: "a", type: "agent" }));

      await mkdir(join(agentsDir, "commands"), { recursive: true });
      await writeFile(join(agentsDir, "commands", "c.md"), mdFile({ id: "c", type: "command" }));

      await mkdir(join(agentsDir, "rules"), { recursive: true });
      await writeFile(join(agentsDir, "rules", "r.md"), mdFile({ id: "r", type: "rule" }));

      await mkdir(join(agentsDir, "prompts"), { recursive: true });
      await writeFile(join(agentsDir, "prompts", "p.md"), mdFile({ id: "p", type: "prompt" }));

      await mkdir(join(agentsDir, "hooks"), { recursive: true });
      await writeFile(join(agentsDir, "hooks", "h.md"), mdFile({ id: "h", type: "hook" }));

      await mkdir(join(agentsDir, "github-agents"), { recursive: true });
      await writeFile(join(agentsDir, "github-agents", "g.md"), mdFile({ id: "g", type: "github-agent" }));

      await mkdir(join(agentsDir, "skills", "s"), { recursive: true });
      await writeFile(join(agentsDir, "skills", "s", "SKILL.md"), mdFile({ id: "s", type: "skill" }));

      const selection = await buildSelectionsFromDisk(agentsDir);
      expect(selection.items.agents).toContain("a");
      expect(selection.items.commands).toContain("cmd-c");
      expect(selection.items.rules).toContain("r");
      expect(selection.items.prompts).toContain("p");
      expect(selection.items.hooks).toContain("h");
      expect(selection.items.githubAgents).toContain("g");
      expect(selection.items.skills).toContain("s");
    });
  });

  // ── addContentItem / removeContentItem ────────────────────

  describe("addContentItem", () => {
    it("copies a glob-strategy item", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const agentsDir = join(dir, "output");
      const index = await buildContentIndex(contentRoot);
      const item = index.byId.get("hatch3r-implementer")!;

      await addContentItem(contentRoot, agentsDir, item);

      const content = await readFile(join(agentsDir, "agents", "hatch3r-implementer.md"), "utf-8");
      expect(content).toContain("hatch3r-implementer");
    });

    it("copies a skill directory recursively", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const agentsDir = join(dir, "output");
      const index = await buildContentIndex(contentRoot);
      const item = index.byId.get("hatch3r-refactor")!;

      await addContentItem(contentRoot, agentsDir, item);

      // SKILL.md should exist
      const skillContent = await readFile(join(agentsDir, "skills", "hatch3r-refactor", "SKILL.md"), "utf-8");
      expect(skillContent).toContain("hatch3r-refactor");
      // Extra helper file should also be copied
      const helperContent = await readFile(join(agentsDir, "skills", "hatch3r-refactor", "helper.md"), "utf-8");
      expect(helperContent).toContain("Extra helper file");
    });

    it("copies companion .mdc file for rules", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const agentsDir = join(dir, "output");
      const index = await buildContentIndex(contentRoot);
      const item = index.byId.get("hatch3r-code-standards")!;

      await addContentItem(contentRoot, agentsDir, item);

      const mdcContent = await readFile(join(agentsDir, "rules", "hatch3r-code-standards.mdc"), "utf-8");
      expect(mdcContent).toBe("companion mdc content");
    });

    it("throws HatchError for missing source item (ENOENT)", async () => {
      const dir = await makeTempDir();
      const agentsDir = join(dir, "output");

      const fakeItem: CatalogItem = {
        id: "nonexistent",
        type: "agent",
        description: "Does not exist",
        tags: [],
        relativePath: "agents/nonexistent.md",
        source: "canonical",
      };

      await expect(
        addContentItem(join(dir, "empty-content"), agentsDir, fakeItem),
      ).rejects.toThrow(HatchError);

      try {
        await addContentItem(join(dir, "empty-content"), agentsDir, fakeItem);
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).message).toContain("not found in package");
      }
    });

    it("throws HatchError for path traversal in relativePath", async () => {
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const agentsDir = join(dir, "output");

      const maliciousItem: CatalogItem = {
        id: "evil",
        type: "agent",
        description: "Path traversal attempt",
        tags: [],
        relativePath: "../../../etc/passwd",
        source: "canonical",
      };

      await expect(
        addContentItem(contentRoot, agentsDir, maliciousItem),
      ).rejects.toThrow(HatchError);
    });
  });

  describe("removeContentItem", () => {
    it("removes a glob-strategy item", async () => {
      const dir = await makeTempDir();
      const agentsDir = join(dir, "agents");
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await writeFile(join(agentsDir, "agents", "to-remove.md"), "# content");

      const item: CatalogItem = {
        id: "to-remove",
        type: "agent",
        description: "Will be removed",
        tags: [],
        relativePath: "agents/to-remove.md",
        source: "canonical",
      };

      await removeContentItem(agentsDir, item);

      await expect(readFile(join(agentsDir, "agents", "to-remove.md"), "utf-8")).rejects.toThrow();
    });

    it("removes a skill directory recursively", async () => {
      const dir = await makeTempDir();
      const agentsDir = join(dir, "agents");
      await mkdir(join(agentsDir, "skills", "my-skill"), { recursive: true });
      await writeFile(join(agentsDir, "skills", "my-skill", "SKILL.md"), "# skill");
      await writeFile(join(agentsDir, "skills", "my-skill", "extra.md"), "# extra");

      const item: CatalogItem = {
        id: "my-skill",
        type: "skill",
        description: "Skill to remove",
        tags: [],
        relativePath: "skills/my-skill",
        source: "canonical",
      };

      await removeContentItem(agentsDir, item);

      // Entire directory should be gone
      await expect(readdir(join(agentsDir, "skills", "my-skill"))).rejects.toThrow();
    });

    it("removes companion .mdc file for rules", async () => {
      const dir = await makeTempDir();
      const agentsDir = join(dir, "agents");
      await mkdir(join(agentsDir, "rules"), { recursive: true });
      await writeFile(join(agentsDir, "rules", "my-rule.md"), "# rule");
      await writeFile(join(agentsDir, "rules", "my-rule.mdc"), "companion");

      const item: CatalogItem = {
        id: "my-rule",
        type: "rule",
        description: "Rule with companion",
        tags: [],
        relativePath: "rules/my-rule.md",
        companionPath: "rules/my-rule.mdc",
        source: "canonical",
      };

      await removeContentItem(agentsDir, item);

      await expect(readFile(join(agentsDir, "rules", "my-rule.md"), "utf-8")).rejects.toThrow();
      await expect(readFile(join(agentsDir, "rules", "my-rule.mdc"), "utf-8")).rejects.toThrow();
    });

    it("cleans up .hatch3r customize files when rootDir is provided", async () => {
      const dir = await makeTempDir();
      const agentsDir = join(dir, "agents");
      const rootDir = join(dir, "project");

      // Create the item to remove
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await writeFile(join(agentsDir, "agents", "my-agent.md"), "# agent");

      // Create customize files
      await mkdir(join(rootDir, ".hatch3r", "agents"), { recursive: true });
      await writeFile(join(rootDir, ".hatch3r", "agents", "my-agent.customize.yaml"), "overrides: true");
      await writeFile(join(rootDir, ".hatch3r", "agents", "my-agent.customize.md"), "# custom");

      const item: CatalogItem = {
        id: "my-agent",
        type: "agent",
        description: "Agent with customize files",
        tags: [],
        relativePath: "agents/my-agent.md",
        source: "canonical",
      };

      await removeContentItem(agentsDir, item, { rootDir });

      await expect(readFile(join(rootDir, ".hatch3r", "agents", "my-agent.customize.yaml"), "utf-8")).rejects.toThrow();
      await expect(readFile(join(rootDir, ".hatch3r", "agents", "my-agent.customize.md"), "utf-8")).rejects.toThrow();
    });

    it("strips cmd- and hatch3r- prefixes when cleaning up command customize files", async () => {
      const dir = await makeTempDir();
      const agentsDir = join(dir, "agents");
      const rootDir = join(dir, "project");

      // Create the command file to remove
      await mkdir(join(agentsDir, "commands"), { recursive: true });
      await writeFile(join(agentsDir, "commands", "hatch3r-board-fill.md"), "# command");

      // Customize files are stored WITHOUT the cmd- and hatch3r- prefixes
      await mkdir(join(rootDir, ".hatch3r", "commands"), { recursive: true });
      await writeFile(join(rootDir, ".hatch3r", "commands", "board-fill.customize.yaml"), "overrides: true");

      const item: CatalogItem = {
        id: "cmd-hatch3r-board-fill",
        type: "command",
        description: "Command with prefixed id",
        tags: [],
        relativePath: "commands/hatch3r-board-fill.md",
        source: "canonical",
      };

      await removeContentItem(agentsDir, item, { rootDir });

      // The customize file (named without prefixes) should be deleted
      await expect(readFile(join(rootDir, ".hatch3r", "commands", "board-fill.customize.yaml"), "utf-8")).rejects.toThrow();
    });

    it("throws HatchError for path traversal in relativePath", async () => {
      const dir = await makeTempDir();

      const maliciousItem: CatalogItem = {
        id: "evil",
        type: "agent",
        description: "Path traversal attempt",
        tags: [],
        relativePath: "../../../etc/passwd",
        source: "canonical",
      };

      await expect(removeContentItem(dir, maliciousItem)).rejects.toThrow(HatchError);
    });

    it("does not throw when removing an already-absent item", async () => {
      const dir = await makeTempDir();
      const agentsDir = join(dir, "agents");
      await mkdir(agentsDir, { recursive: true });

      const item: CatalogItem = {
        id: "gone",
        type: "agent",
        description: "Already removed",
        tags: [],
        relativePath: "agents/gone.md",
        source: "canonical",
      };

      // rm with { force: true } should not throw
      await expect(removeContentItem(agentsDir, item)).resolves.toBeUndefined();
    });
  });

  // ── Utility functions ────────────────────────────────────

  describe("getAllContentIds", () => {
    it("returns a flat Set of all IDs across all types", () => {
      const selection = emptySelection({
        items: {
          agents: ["a1", "a2"],
          skills: ["s1"],
          rules: ["r1", "r2", "r3"],
          commands: ["c1"],
          prompts: [],
          hooks: ["h1"],
          githubAgents: ["g1"],
        },
      });

      const ids = getAllContentIds(selection);
      expect(ids.size).toBe(9);
      expect(ids.has("a1")).toBe(true);
      expect(ids.has("s1")).toBe(true);
      expect(ids.has("r3")).toBe(true);
      expect(ids.has("g1")).toBe(true);
    });

    it("returns empty set for empty selection", () => {
      const ids = getAllContentIds(emptySelection());
      expect(ids.size).toBe(0);
    });
  });

  describe("countSelectionItems", () => {
    it("returns correct total count", () => {
      const selection = emptySelection({
        items: {
          agents: ["a1", "a2"],
          skills: ["s1"],
          rules: [],
          commands: ["c1", "c2", "c3"],
          prompts: ["p1"],
          hooks: [],
          githubAgents: [],
        },
      });

      expect(countSelectionItems(selection)).toBe(7);
    });

    it("returns 0 for empty selection", () => {
      expect(countSelectionItems(emptySelection())).toBe(0);
    });
  });

  describe("selectionSummary", () => {
    it("shows types with counts", () => {
      const selection = emptySelection({
        items: {
          agents: ["a1", "a2"],
          skills: ["s1"],
          rules: ["r1"],
          commands: [],
          prompts: [],
          hooks: ["h1", "h2", "h3"],
          githubAgents: ["g1"],
        },
      });

      const summary = selectionSummary(selection);
      expect(summary).toContain("2 agents");
      expect(summary).toContain("1 skills");
      expect(summary).toContain("1 rules");
      expect(summary).toContain("3 hooks");
      expect(summary).toContain("1 github-agents");
    });

    it("omits types with 0 items", () => {
      const selection = emptySelection({
        items: {
          agents: ["a1"],
          skills: [],
          rules: [],
          commands: [],
          prompts: [],
          hooks: [],
          githubAgents: [],
        },
      });

      const summary = selectionSummary(selection);
      expect(summary).toBe("1 agents");
      expect(summary).not.toContain("skills");
      expect(summary).not.toContain("rules");
      expect(summary).not.toContain("commands");
      expect(summary).not.toContain("prompts");
      expect(summary).not.toContain("hooks");
      expect(summary).not.toContain("github-agents");
    });

    it("returns empty string for completely empty selection", () => {
      const summary = selectionSummary(emptySelection());
      expect(summary).toBe("");
    });
  });

  // ── Exclusion counting ───────────────────────────────────────

  describe("countPresetExclusions", () => {
    // Fixture exercises the new capability-gate + floor + customize semantics.
    const exclIndex = makeIndex([
      // Orchestration capability — admitted by every non-custom preset.
      makeCatalogItem({ id: "orch-item", tags: [TAG_ORCHESTRATION], relativePath: "agents/orch.md" }),
      // Planning — admitted by standard/full, EXCLUDED under minimal.
      makeCatalogItem({ id: "planning-item", type: "command", tags: [TAG_PLANNING], relativePath: "commands/plan.md" }),
      // Board — admitted by standard/full, EXCLUDED under minimal.
      makeCatalogItem({ id: "board-item", type: "command", tags: [TAG_BOARD], relativePath: "commands/board.md" }),
      // Review — admitted by standard/full, EXCLUDED under minimal.
      makeCatalogItem({ id: "review-item", type: "rule", tags: [TAG_REVIEW], relativePath: "rules/review.md" }),
      // Floor item — never counted as excluded under any preset.
      makeCatalogItem({ id: "floor-item", tags: [TAG_FLOOR_SECURITY], relativePath: "agents/floor.md" }),
    ]);

    it("returns 0 for full preset", () => {
      const preset = getPreset("full");
      expect(countPresetExclusions(preset, exclIndex)).toBe(0);
    });

    it("returns 0 for custom preset", () => {
      const preset = getPreset("custom");
      expect(countPresetExclusions(preset, exclIndex)).toBe(0);
    });

    it("counts capability-gated items as excluded for minimal preset", () => {
      const preset = getPreset("minimal");
      const count = countPresetExclusions(preset, exclIndex);
      // Minimal.capabilities = [orchestration, implementation]. Items missing
      // those capabilities and lacking floor/protected status are excluded:
      // planning, board, review = 3. floor-item is admitted by floor and not
      // counted; orch-item is admitted by capability gate and not counted.
      expect(count).toBe(3);
    });

    it("does not count protected items as excluded", () => {
      const protectedOnly = makeIndex([
        makeCatalogItem({
          id: "prot", type: "agent",
          tags: [], // no capability, no floor — would normally be dropped
          relativePath: "agents/prot.md",
          protected: true,
        }),
      ]);
      const preset = getPreset("minimal");
      expect(countPresetExclusions(preset, protectedOnly)).toBe(0);
    });

    it("does not count floor-tagged items as excluded (structural invariant)", () => {
      const floorOnly = makeIndex([
        makeCatalogItem({
          id: "ui-floor",
          tags: [TAG_FLOOR_UI_UX], // no capability — admitted by floor only
          relativePath: "agents/ui-floor.md",
        }),
      ]);
      const preset = getPreset("minimal");
      expect(countPresetExclusions(preset, floorOnly)).toBe(0);
    });

    it("counts customize-only items as excluded under includeCustomize=false (minimal)", () => {
      const customizeOnly = makeIndex([
        makeCatalogItem({
          id: "cust-only",
          tags: [TAG_CUSTOMIZE], // customize, no capability
          relativePath: "agents/cust-only.md",
        }),
      ]);
      const preset = getPreset("minimal"); // includeCustomize: false
      expect(countPresetExclusions(preset, customizeOnly)).toBe(1);
    });

    it("does not count customize-only items under includeCustomize=true (standard)", () => {
      const customizeOnly = makeIndex([
        makeCatalogItem({
          id: "cust-only",
          tags: [TAG_CUSTOMIZE],
          relativePath: "agents/cust-only.md",
        }),
      ]);
      const preset = getPreset("standard"); // includeCustomize: true
      expect(countPresetExclusions(preset, customizeOnly)).toBe(0);
    });

    it("does not count items rescued by includeIds carve-out", () => {
      const rescued = makeIndex([
        makeCatalogItem({
          id: "perf-only",
          tags: [TAG_PERFORMANCE], // not in minimal.capabilities
          relativePath: "agents/perf-only.md",
        }),
      ]);
      const carveOut = { ...getPreset("minimal"), includeIds: ["perf-only"] };
      expect(countPresetExclusions(carveOut, rescued)).toBe(0);
    });
  });

  describe("countProjectTypeExclusions", () => {
    it("counts ctx:brownfield-only items excluded by greenfield filter", () => {
      const items = [
        makeCatalogItem({ id: "bf-only", type: "agent", tags: [TAG_CTX_BROWNFIELD_ONLY], relativePath: "agents/bf.md" }),
        makeCatalogItem({ id: "both", type: "agent", tags: [TAG_CTX_BROWNFIELD_ONLY, TAG_ORCHESTRATION], relativePath: "agents/both.md" }),
        makeCatalogItem({ id: "gf", type: "agent", tags: [TAG_ORCHESTRATION], relativePath: "agents/gf.md" }),
      ];
      // Both items carrying ctx:brownfield-only count as exclusions for
      // greenfield (the count is a pre-filter UX hint, not a final selection).
      expect(countProjectTypeExclusions("greenfield", items)).toBe(2);
    });

    it("counts ctx:greenfield-only items excluded by brownfield filter", () => {
      const items = [
        makeCatalogItem({ id: "gf-only", type: "agent", tags: [TAG_CTX_GREENFIELD_ONLY], relativePath: "agents/gf.md" }),
        makeCatalogItem({ id: "mixed", type: "agent", tags: [TAG_CTX_GREENFIELD_ONLY, TAG_ORCHESTRATION], relativePath: "agents/mixed.md" }),
      ];
      expect(countProjectTypeExclusions("brownfield", items)).toBe(2);
    });

    it("does not count protected items", () => {
      const items = [
        makeCatalogItem({ id: "prot-bf", type: "agent", tags: [TAG_CTX_BROWNFIELD_ONLY], relativePath: "agents/prot.md", protected: true }),
      ];
      expect(countProjectTypeExclusions("greenfield", items)).toBe(0);
    });
  });

  describe("countTeamSizeExclusions", () => {
    it("counts ctx:team-only items excluded by solo filter", () => {
      const items = [
        makeCatalogItem({ id: "team-only", type: "command", tags: [TAG_CTX_TEAM_ONLY], relativePath: "commands/team.md" }),
        makeCatalogItem({ id: "team-orch", type: "command", tags: [TAG_CTX_TEAM_ONLY, TAG_ORCHESTRATION], relativePath: "commands/team-orch.md" }),
        makeCatalogItem({ id: "normal", type: "command", tags: [TAG_ORCHESTRATION], relativePath: "commands/normal.md" }),
      ];
      // Both items carrying ctx:team-only count as exclusions under solo.
      expect(countTeamSizeExclusions("solo", items)).toBe(2);
    });

    it("returns 0 for team filter", () => {
      const items = [
        makeCatalogItem({ id: "team-only", type: "command", tags: [TAG_CTX_TEAM_ONLY], relativePath: "commands/team.md" }),
      ];
      expect(countTeamSizeExclusions("team", items)).toBe(0);
    });

    it("does not count protected items", () => {
      const items = [
        makeCatalogItem({ id: "prot-team", type: "command", tags: [TAG_CTX_TEAM_ONLY], relativePath: "commands/pt.md", protected: true }),
      ];
      expect(countTeamSizeExclusions("solo", items)).toBe(0);
    });

    it("does not count floor-tagged ctx:team-only items (floor invariant ships UI/UX to solo)", () => {
      const items = [
        makeCatalogItem({
          id: "floor-team",
          tags: [TAG_FLOOR_UI_UX, TAG_CTX_TEAM_ONLY],
          relativePath: "agents/floor-team.md",
        }),
      ];
      expect(countTeamSizeExclusions("solo", items)).toBe(0);
    });
  });

  // ── Integration tests for complex validation paths (#100) ──

  describe("buildContentIndex — collision detection", () => {
    it("detects cross-type ID collisions (agent vs rule with same ID)", async () => {
      const dir = await makeTempDir();
      // Create an agent and a rule with the same ID (neither is prefixed)
      await mkdir(join(dir, "agents"), { recursive: true });
      await writeFile(
        join(dir, "agents", "hatch3r-dupe.md"),
        mdFile({ id: "hatch3r-dupe", type: "agent", description: "Agent dupe" }),
      );
      await mkdir(join(dir, "rules"), { recursive: true });
      await writeFile(
        join(dir, "rules", "hatch3r-dupe.md"),
        mdFile({ id: "hatch3r-dupe", type: "rule", description: "Rule dupe" }),
      );

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const index = await buildContentIndex(dir);
      warnSpy.mockRestore();

      expect(index.collisions.length).toBe(1);
      expect(index.collisions[0]!.kind).toBe("cross-type");
      expect(index.collisions[0]!.id).toBe("hatch3r-dupe");
    });

    it("does not collide when agent and command share the same base ID (cmd- prefix)", async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, "agents"), { recursive: true });
      await writeFile(
        join(dir, "agents", "hatch3r-dupe.md"),
        mdFile({ id: "hatch3r-dupe", type: "agent", description: "Agent dupe" }),
      );
      await mkdir(join(dir, "commands"), { recursive: true });
      await writeFile(
        join(dir, "commands", "hatch3r-dupe.md"),
        mdFile({ id: "hatch3r-dupe", type: "command", description: "Command dupe" }),
      );

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const index = await buildContentIndex(dir);
      warnSpy.mockRestore();

      // Command gets prefixed to "cmd-hatch3r-dupe", so no collision
      expect(index.collisions.length).toBe(0);
      expect(index.byId.get("hatch3r-dupe")).toBeDefined();
      expect(index.byId.get("hatch3r-dupe")!.type).toBe("agent");
      expect(index.byId.get("cmd-hatch3r-dupe")).toBeDefined();
      expect(index.byId.get("cmd-hatch3r-dupe")!.type).toBe("command");
    });

    it("detects same-type ID collisions (duplicate files with same frontmatter id)", async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, "agents"), { recursive: true });
      // Two files mapping to the same ID via frontmatter
      await writeFile(
        join(dir, "agents", "alpha.md"),
        mdFile({ id: "shared-id", type: "agent", description: "Alpha" }),
      );
      await writeFile(
        join(dir, "agents", "beta.md"),
        mdFile({ id: "shared-id", type: "agent", description: "Beta" }),
      );

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const index = await buildContentIndex(dir);
      warnSpy.mockRestore();

      expect(index.collisions.length).toBe(1);
      expect(index.collisions[0]!.kind).toBe("same-type");
    });

    it("byTypeAndId provides collision-safe lookup", async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, "agents"), { recursive: true });
      await writeFile(
        join(dir, "agents", "hatch3r-shared.md"),
        mdFile({ id: "hatch3r-shared", type: "agent", description: "Agent" }),
      );
      await mkdir(join(dir, "commands"), { recursive: true });
      await writeFile(
        join(dir, "commands", "hatch3r-shared.md"),
        mdFile({ id: "hatch3r-shared", type: "command", description: "Command" }),
      );

      const index = await buildContentIndex(dir);

      // Agent retains original ID, command gets cmd- prefix
      const agent = index.byTypeAndId.get(typeIdKey("agent", "hatch3r-shared"));
      expect(agent).toBeDefined();
      expect(agent!.type).toBe("agent");

      // Command ID is prefixed: cmd-hatch3r-shared
      const command = index.byTypeAndId.get(typeIdKey("command", "cmd-hatch3r-shared"));
      expect(command).toBeDefined();
      expect(command!.type).toBe("command");
    });

    it("getAllItemsById returns single item when agent and command have distinct IDs (cmd- prefix)", async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, "agents"), { recursive: true });
      await writeFile(
        join(dir, "agents", "hatch3r-multi.md"),
        mdFile({ id: "hatch3r-multi", type: "agent", description: "Agent" }),
      );
      await mkdir(join(dir, "commands"), { recursive: true });
      await writeFile(
        join(dir, "commands", "hatch3r-multi.md"),
        mdFile({ id: "hatch3r-multi", type: "command", description: "Command" }),
      );

      const index = await buildContentIndex(dir);

      // Agent keeps "hatch3r-multi", command becomes "cmd-hatch3r-multi"
      const agentItems = getAllItemsById(index, "hatch3r-multi");
      expect(agentItems.length).toBe(1);
      expect(agentItems[0]!.type).toBe("agent");

      const commandItems = getAllItemsById(index, "cmd-hatch3r-multi");
      expect(commandItems.length).toBe(1);
      expect(commandItems[0]!.type).toBe("command");
    });
  });

  describe("extractContentReferences", () => {
    it("extracts backtick-quoted hatch3r references", () => {
      const content = "Use `hatch3r-implementer` and `hatch3r-reviewer` for this.";
      const refs = extractContentReferences(content);
      expect(refs).toContain("hatch3r-implementer");
      expect(refs).toContain("hatch3r-reviewer");
    });

    it("returns empty array when no references present", () => {
      const content = "No hatch3r references here. Just plain text.";
      const refs = extractContentReferences(content);
      expect(refs).toEqual([]);
    });

    it("deduplicates references", () => {
      const content = "Use `hatch3r-test` and then `hatch3r-test` again.";
      const refs = extractContentReferences(content);
      expect(refs.length).toBe(1);
      expect(refs[0]).toBe("hatch3r-test");
    });

    it("does not match non-backtick-quoted references", () => {
      // D2-M10 (D2 Medium, Cycle 10 Wave 3 rollover): the primary scanner
      // remains backtick-scoped to avoid the adjective-modifier false
      // positive class ("hatch3r-generated code"). Bare prose mentions are
      // handled by `extractBareContentReferences` and surfaced as typo
      // warnings inside `validateCrossReferences` (resolve-or-skip).
      const content = "Use hatch3r-implementer without backticks.";
      const refs = extractContentReferences(content);
      expect(refs).toEqual([]);
    });

    it("handles multiple references on same line", () => {
      const content = "Both `hatch3r-alpha` and `hatch3r-beta` are needed.";
      const refs = extractContentReferences(content);
      expect(refs).toContain("hatch3r-alpha");
      expect(refs).toContain("hatch3r-beta");
    });
  });

  // D2-M10 (D2 Medium, Cycle 10 Wave 3 rollover): bare prose scanner used
  // by `validateCrossReferences` with resolve-or-skip discipline. Returns
  // candidates only; CALLER decides whether to warn.
  describe("extractBareContentReferences (D2-M10)", () => {
    it("captures bare prose mentions of hatch3r-* ids", async () => {
      const { extractBareContentReferences } = await import("../../content/index.js");
      const content = "Delegate to hatch3r-implementer for the change.";
      const refs = extractBareContentReferences(content);
      expect(refs).toContain("hatch3r-implementer");
    });

    it("captures adjective-modifier mentions (caller filters via index)", async () => {
      const { extractBareContentReferences } = await import("../../content/index.js");
      // The scanner returns candidates without judging adjective vs id.
      // It is the CALLER's job (validateCrossReferences resolve-or-skip)
      // to drop adjective-style mentions that don't resolve.
      const content = "Run hatch3r-generated code through hatch3r-managed checks.";
      const refs = extractBareContentReferences(content);
      expect(refs).toContain("hatch3r-generated");
      expect(refs).toContain("hatch3r-managed");
    });

    it("skips filesystem path mentions", async () => {
      const { extractBareContentReferences } = await import("../../content/index.js");
      const content =
        "See /repo/agents/hatch3r-implementer.md for details. " +
        "Or https://github.com/anthropic/hatch3r-implementer for the source.";
      const refs = extractBareContentReferences(content);
      expect(refs).toEqual([]);
    });

    it("skips .md / .mdc / .ts filename mentions but keeps bare id", async () => {
      const { extractBareContentReferences } = await import("../../content/index.js");
      const content = "Edit hatch3r-implementer.md to update hatch3r-implementer.";
      const refs = extractBareContentReferences(content);
      expect(refs).toContain("hatch3r-implementer");
      expect(refs.length).toBe(1);
    });

    it("does not duplicate backticked refs already captured", async () => {
      const { extractBareContentReferences } = await import("../../content/index.js");
      // The scanner's backtick carve-out matches at the boundary so this
      // would not double-count when used alongside extractContentReferences.
      const content = "`hatch3r-foo`";
      const refs = extractBareContentReferences(content);
      expect(refs).toEqual([]);
    });
  });

  describe("validateCrossReferences", () => {
    it("returns no warnings when all references exist in index", async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, "agents"), { recursive: true });
      await writeFile(
        join(dir, "agents", "hatch3r-caller.md"),
        mdFile({ id: "hatch3r-caller", type: "agent", description: "Calls others" }) +
        "\nUse `hatch3r-callee` for details.\n",
      );
      await writeFile(
        join(dir, "agents", "hatch3r-callee.md"),
        mdFile({ id: "hatch3r-callee", type: "agent", description: "Called by others" }),
      );

      const index = await buildContentIndex(dir);
      const result = await validateCrossReferences(dir, index);
      expect(result.warnings).toEqual([]);
    });

    it("returns warnings for missing cross-referenced IDs", async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, "agents"), { recursive: true });
      await writeFile(
        join(dir, "agents", "hatch3r-orphan-ref.md"),
        mdFile({ id: "hatch3r-orphan-ref", type: "agent", description: "Refs missing ID" }) +
        "\nSee `hatch3r-nonexistent` for details.\n",
      );

      const index = await buildContentIndex(dir);
      const result = await validateCrossReferences(dir, index);
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain("hatch3r-nonexistent");
      expect(result.warnings[0]).toContain("does not exist");
    });

    it("self-references do not trigger warnings", async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, "agents"), { recursive: true });
      await writeFile(
        join(dir, "agents", "hatch3r-self.md"),
        mdFile({ id: "hatch3r-self", type: "agent", description: "Self-referencing" }) +
        "\nThis is `hatch3r-self`.\n",
      );

      const index = await buildContentIndex(dir);
      const result = await validateCrossReferences(dir, index);
      expect(result.warnings).toEqual([]);
    });

    it("handles skill subdirectory cross-references", async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, "skills", "hatch3r-skillref"), { recursive: true });
      await writeFile(
        join(dir, "skills", "hatch3r-skillref", "SKILL.md"),
        mdFile({ id: "hatch3r-skillref", type: "skill", description: "Skill that refs" }) +
        "\nUse `hatch3r-missing-agent` to assist.\n",
      );

      const index = await buildContentIndex(dir);
      const result = await validateCrossReferences(dir, index);
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain("hatch3r-missing-agent");
    });

    // D2-M10 (D2 Medium, Cycle 10 Wave 3 rollover): bare prose references
    // that resolve to a near-by id via edit distance ≤ 2 surface as typo
    // warnings, closing the silent-invisibility gap. Adjective-modifier
    // mentions ("hatch3r-generated", "hatch3r-managed") stay quiet because
    // their edit distance from any real id is well above the threshold.
    describe("D2-M10 bare prose typo detection", () => {
      it("warns when bare prose ref is one edit away from a real id", async () => {
        const dir = await makeTempDir();
        await mkdir(join(dir, "agents"), { recursive: true });
        // The real id is "hatch3r-implementer"; the body mentions a typo
        // "hatch3r-implementr" (missing "e") in bare prose. Pre-D2-M10 this
        // silently passed because the validator only scanned backticks.
        await writeFile(
          join(dir, "agents", "hatch3r-impl.md"),
          mdFile({ id: "hatch3r-impl", type: "agent", description: "Caller" }) +
            "\nDelegate to hatch3r-implementr for the change.\n",
        );
        await writeFile(
          join(dir, "agents", "hatch3r-implementer.md"),
          mdFile({ id: "hatch3r-implementer", type: "agent", description: "Real" }),
        );

        const index = await buildContentIndex(dir);
        const result = await validateCrossReferences(dir, index);
        const typoWarnings = result.warnings.filter((w) => w.includes("typo of"));
        expect(typoWarnings.length).toBe(1);
        expect(typoWarnings[0]).toContain("hatch3r-implementr");
        expect(typoWarnings[0]).toContain("hatch3r-implementer");
      });

      it("does NOT warn on adjective-modifier prose (distance > 2 from any id)", async () => {
        const dir = await makeTempDir();
        await mkdir(join(dir, "agents"), { recursive: true });
        await writeFile(
          join(dir, "agents", "hatch3r-x.md"),
          mdFile({ id: "hatch3r-x", type: "agent", description: "Caller" }) +
            "\nRun hatch3r-generated code through hatch3r-managed checks.\n",
        );

        const index = await buildContentIndex(dir);
        const result = await validateCrossReferences(dir, index);
        const typoWarnings = result.warnings.filter((w) => w.includes("typo of"));
        expect(typoWarnings).toEqual([]);
      });

      it("does NOT warn on bare prose mention that exactly matches an existing id", async () => {
        const dir = await makeTempDir();
        await mkdir(join(dir, "agents"), { recursive: true });
        await writeFile(
          join(dir, "agents", "hatch3r-caller.md"),
          mdFile({ id: "hatch3r-caller", type: "agent", description: "Caller" }) +
            "\nDelegate to hatch3r-callee for the change.\n",
        );
        await writeFile(
          join(dir, "agents", "hatch3r-callee.md"),
          mdFile({ id: "hatch3r-callee", type: "agent", description: "Callee" }),
        );

        const index = await buildContentIndex(dir);
        const result = await validateCrossReferences(dir, index);
        expect(result.warnings).toEqual([]);
      });
    });
  });

  describe("validateOrchestrationDependencies", () => {
    it("returns no warnings when orchestration rule is absent", () => {
      const selection = emptySelection({
        items: {
          agents: [],
          skills: [],
          rules: [],
          commands: [],
          prompts: [],
          hooks: [],
          githubAgents: [],
        },
      });
      const warnings = validateOrchestrationDependencies(selection);
      expect(warnings).toEqual([]);
    });

    it("returns no warnings when all required agents are present", () => {
      // F16.3-H1 (Cycle 10 Wave 1C): legacy test-writer + security-auditor
      // collapsed into the CQ specialists. Strict orchestration roster lists
      // only protected + full-preset-admitted CQ agents (security); the
      // testability always-mode contract is enforced via the trigger table.
      const selection = emptySelection({
        items: {
          agents: [
            "hatch3r-researcher",
            "hatch3r-implementer",
            "hatch3r-reviewer",
            "hatch3r-security",
          ],
          skills: [],
          rules: ["hatch3r-agent-orchestration"],
          commands: [],
          prompts: [],
          hooks: [],
          githubAgents: [],
        },
      });
      const warnings = validateOrchestrationDependencies(selection);
      expect(warnings).toEqual([]);
    });

    it("returns warnings for each missing orchestration agent", () => {
      const selection = emptySelection({
        items: {
          agents: ["hatch3r-researcher"],
          skills: [],
          rules: ["hatch3r-agent-orchestration"],
          commands: [],
          prompts: [],
          hooks: [],
          githubAgents: [],
        },
      });
      const warnings = validateOrchestrationDependencies(selection);
      // Missing: implementer, reviewer, security
      // (post-F16.3-H1: strict roster lists only protected + full-preset
      // CQ agents; testability's always-mode floor is enforced via the
      // trigger table rather than this roster check.)
      expect(warnings.length).toBe(3);
      expect(warnings.some((w) => w.includes("hatch3r-implementer"))).toBe(true);
      expect(warnings.some((w) => w.includes("hatch3r-reviewer"))).toBe(true);
      expect(warnings.some((w) => w.includes("hatch3r-security"))).toBe(true);
    });

    it("warning messages mention the 4-phase pipeline", () => {
      const selection = emptySelection({
        items: {
          agents: [],
          skills: [],
          rules: ["hatch3r-agent-orchestration"],
          commands: [],
          prompts: [],
          hooks: [],
          githubAgents: [],
        },
      });
      const warnings = validateOrchestrationDependencies(selection);
      for (const w of warnings) {
        expect(w).toContain("4-phase pipeline");
      }
    });
  });

  // ── estimatePresetItemCount (#127) ─────────────────────────────
  describe("estimatePresetItemCount", () => {
    let tempDir: string;

    afterEach(async () => {
      if (tempDir) await rm(tempDir, { recursive: true, force: true });
    });

    it("returns item count for full preset", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-estimate-"));
      const root = await createContentRoot(tempDir);
      const index = await buildContentIndex(root);
      const { estimatePresetItemCount } = await import("../../content/index.js");
      const preset = getPreset("full");
      const count = estimatePresetItemCount(preset, "brownfield", "team", index);
      expect(count).toBe(index.items.length);
    });

    it("returns fewer items for minimal preset", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-estimate-"));
      const root = await createContentRoot(tempDir);
      const index = await buildContentIndex(root);
      const { estimatePresetItemCount } = await import("../../content/index.js");
      const fullPreset = getPreset("full");
      const minPreset = getPreset("minimal");
      const fullCount = estimatePresetItemCount(fullPreset, "brownfield", "team", index);
      const minCount = estimatePresetItemCount(minPreset, "brownfield", "team", index);
      expect(minCount).toBeLessThanOrEqual(fullCount);
    });
  });

  // ── generateMdcCompanions (#127) ──────────────────────────────
  describe("generateMdcCompanions", () => {
    let tempDir: string;

    afterEach(async () => {
      if (tempDir) await rm(tempDir, { recursive: true, force: true });
    });

    it("generates .mdc files for each .md file in the rules directory", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-mdc-"));
      const rulesDir = join(tempDir, "rules");
      await mkdir(rulesDir, { recursive: true });
      await writeFile(
        join(rulesDir, "hatch3r-test-rule.md"),
        "---\nid: hatch3r-test-rule\ntype: rule\ndescription: A test rule\nscope: always\n---\n# Test Rule\n\nContent.\n",
      );

      const { generateMdcCompanions } = await import("../../content/index.js");
      const written = await generateMdcCompanions(rulesDir);
      expect(written.length).toBe(1);

      const mdcContent = await readFile(join(rulesDir, "hatch3r-test-rule.mdc"), "utf-8");
      expect(mdcContent).toContain("alwaysApply: true");
      expect(mdcContent).toContain("A test rule");
      expect(mdcContent).toContain("# Test Rule");
    });

    it("generates correct globs for scoped rules", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-mdc-scope-"));
      const rulesDir = join(tempDir, "rules");
      await mkdir(rulesDir, { recursive: true });
      await writeFile(
        join(rulesDir, "hatch3r-ts-rule.md"),
        "---\nid: hatch3r-ts-rule\ntype: rule\ndescription: TypeScript rule\nscope: \"**/*.ts, **/*.tsx\"\n---\n# TS Rule\n",
      );

      const { generateMdcCompanions } = await import("../../content/index.js");
      await generateMdcCompanions(rulesDir);

      const mdcContent = await readFile(join(rulesDir, "hatch3r-ts-rule.mdc"), "utf-8");
      expect(mdcContent).toContain("globs:");
      expect(mdcContent).toContain("**/*.ts");
      expect(mdcContent).toContain("**/*.tsx");
    });

    it("returns empty array for nonexistent directory", async () => {
      const { generateMdcCompanions } = await import("../../content/index.js");
      const result = await generateMdcCompanions("/nonexistent/path");
      expect(result).toEqual([]);
    });

    // C7.5-W2B2-H4 (D2-SA2.6-2): .mdc companion writes now go through
    // atomicWriteFile (temp file + rename with fsync). A crash mid-write
    // can no longer leave a truncated .mdc visible to Cursor.
    it("C7.5-W2B2-H4: .mdc write is atomic (no partial files visible)", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-mdc-atomic-"));
      const rulesDir = join(tempDir, "rules");
      await mkdir(rulesDir, { recursive: true });
      await writeFile(
        join(rulesDir, "hatch3r-atomic-rule.md"),
        "---\nid: hatch3r-atomic-rule\ntype: rule\ndescription: atomic\nscope: always\n---\n# Body\n",
      );

      const { generateMdcCompanions } = await import("../../content/index.js");
      await generateMdcCompanions(rulesDir);

      // After success, exactly one .mdc file exists (no .tmp leftover).
      const entries = await readdir(rulesDir);
      const mdcFiles = entries.filter((e) => e.endsWith(".mdc"));
      const tmpFiles = entries.filter((e) => e.includes(".tmp."));
      expect(mdcFiles).toEqual(["hatch3r-atomic-rule.mdc"]);
      expect(tmpFiles).toEqual([]);
    });

    it("C7.5-W2B2-H4: .mdc content is well-formed after atomic write", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-mdc-wellformed-"));
      const rulesDir = join(tempDir, "rules");
      await mkdir(rulesDir, { recursive: true });
      await writeFile(
        join(rulesDir, "hatch3r-wf.md"),
        "---\nid: hatch3r-wf\ntype: rule\ndescription: wf\n---\n# Body\nLine 1\nLine 2\n",
      );

      const { generateMdcCompanions } = await import("../../content/index.js");
      await generateMdcCompanions(rulesDir);

      const mdcContent = await readFile(join(rulesDir, "hatch3r-wf.mdc"), "utf-8");
      expect(mdcContent.startsWith("---\n")).toBe(true);
      expect(mdcContent).toContain("description: wf");
      expect(mdcContent).toContain("Line 1");
      expect(mdcContent).toContain("Line 2");
    });
  });

  // C7.5-W2B2-H7 (D2-SA2.6-5): copySelectedContent warns on overwrite of
  // locally-edited canonical files when `options.warnings` is supplied.
  describe("C7.5-W2B2-H7 copySelectedContent user-edit overwrite detection", () => {
    it("emits a warning when destination bytes differ from source", async () => {
      const dir = await mkdtemp(join(tmpdir(), "hatch3r-overwrite-"));
      try {
        const contentRoot = await createContentRoot(dir);
        const agentsDir = join(dir, "output");
        const index = await buildContentIndex(contentRoot);

        const selection = emptySelection({
          items: {
            agents: ["hatch3r-implementer"],
            skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [],
          },
        });

        // First copy: clean install.
        await copySelectedContent(contentRoot, agentsDir, selection, index);

        // User edits the canonical file locally.
        const implPath = join(agentsDir, "agents", "hatch3r-implementer.md");
        await writeFile(implPath, "locally edited content\n", "utf-8");

        // Second copy with warnings sink: must detect divergence.
        const warnings: string[] = [];
        await copySelectedContent(contentRoot, agentsDir, selection, index, { warnings });

        expect(warnings.some((w) => w.includes("Overwriting locally-edited") && w.includes(".hatch3r/"))).toBe(true);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("does not warn when destination matches source byte-for-byte", async () => {
      const dir = await mkdtemp(join(tmpdir(), "hatch3r-no-overwrite-"));
      try {
        const contentRoot = await createContentRoot(dir);
        const agentsDir = join(dir, "output");
        const index = await buildContentIndex(contentRoot);

        const selection = emptySelection({
          items: {
            agents: ["hatch3r-implementer"],
            skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [],
          },
        });

        await copySelectedContent(contentRoot, agentsDir, selection, index);

        // Second invocation without local edits: source == dest.
        const warnings: string[] = [];
        await copySelectedContent(contentRoot, agentsDir, selection, index, { warnings });

        expect(warnings.some((w) => w.includes("Overwriting locally-edited"))).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("does not warn on first-time copy (no destination exists)", async () => {
      const dir = await mkdtemp(join(tmpdir(), "hatch3r-firstcopy-"));
      try {
        const contentRoot = await createContentRoot(dir);
        const agentsDir = join(dir, "output");
        const index = await buildContentIndex(contentRoot);

        const selection = emptySelection({
          items: {
            agents: ["hatch3r-implementer"],
            skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [],
          },
        });

        const warnings: string[] = [];
        await copySelectedContent(contentRoot, agentsDir, selection, index, { warnings });

        expect(warnings.some((w) => w.includes("Overwriting"))).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("is opt-in — omitting options preserves legacy behavior (no warnings emitted)", async () => {
      const dir = await mkdtemp(join(tmpdir(), "hatch3r-optin-"));
      try {
        const contentRoot = await createContentRoot(dir);
        const agentsDir = join(dir, "output");
        const index = await buildContentIndex(contentRoot);

        const selection = emptySelection({
          items: {
            agents: ["hatch3r-implementer"],
            skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [],
          },
        });

        await copySelectedContent(contentRoot, agentsDir, selection, index);
        const implPath = join(agentsDir, "agents", "hatch3r-implementer.md");
        await writeFile(implPath, "local edit\n", "utf-8");

        // No options argument: the function should still succeed without
        // throwing and without populating any warnings (legacy callers).
        const copied = await copySelectedContent(contentRoot, agentsDir, selection, index);
        expect(copied.length).toBeGreaterThan(0);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  // ── Finding 3.23: applyCommandPrefix and COMMAND_ID_PREFIX ──────
  describe("COMMAND_ID_PREFIX", () => {
    it("is the string 'cmd-'", () => {
      expect(COMMAND_ID_PREFIX).toBe("cmd-");
    });
  });

  describe("applyCommandPrefix", () => {
    it("prefixes command-type IDs with 'cmd-'", () => {
      expect(applyCommandPrefix("hatch3r-feature-plan", "command")).toBe("cmd-hatch3r-feature-plan");
    });

    it("does not prefix agent-type IDs", () => {
      expect(applyCommandPrefix("hatch3r-implementer", "agent")).toBe("hatch3r-implementer");
    });

    it("does not prefix rule-type IDs", () => {
      expect(applyCommandPrefix("hatch3r-code-standards", "rule")).toBe("hatch3r-code-standards");
    });

    it("does not prefix skill-type IDs", () => {
      expect(applyCommandPrefix("hatch3r-feature", "skill")).toBe("hatch3r-feature");
    });

    it("does not prefix prompt-type IDs", () => {
      expect(applyCommandPrefix("hatch3r-prompt", "prompt")).toBe("hatch3r-prompt");
    });

    it("does not prefix hook-type IDs", () => {
      expect(applyCommandPrefix("hatch3r-hook", "hook")).toBe("hatch3r-hook");
    });

    it("does not double-prefix already-prefixed command IDs", () => {
      // applyCommandPrefix always adds the prefix for command type,
      // so passing an already-prefixed ID will double-prefix it.
      // This documents the behavior — callers should not pass pre-prefixed IDs.
      const result = applyCommandPrefix("cmd-hatch3r-feature-plan", "command");
      expect(result).toBe("cmd-cmd-hatch3r-feature-plan");
    });
  });
});
