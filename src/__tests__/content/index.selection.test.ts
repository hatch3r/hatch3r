import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, posix } from "node:path";
import { tmpdir } from "node:os";
import type { ContentSelection } from "../../types.js";
import {
  TYPE_TO_SELECTION_KEY,
  buildContentIndex,
  resolveSelection,
  getAllContentIds,
  countSelectionItems,
  typeIdKey,
  getAllItemsById,
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

// ── Tests ────────────────────────────────────────────────────

describe("content/index — selection & index", () => {
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

    it("surfaces probe failures on index.warnings (D2-SA2.6-2.6-F10)", async () => {
      // hatch3r-testing.md ships without a companion .mdc, so the companion
      // probe fails and recordContentProbeFailure pushes to the warnings sink
      // in addition to the verbose() stderr stream.
      const dir = await makeTempDir();
      const contentRoot = await createContentRoot(dir);
      const index = await buildContentIndex(contentRoot);

      expect(Array.isArray(index.warnings)).toBe(true);
      expect(
        index.warnings!.some((w) => w.includes("no companion .mdc for hatch3r-testing.md")),
      ).toBe(true);
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

  // ── buildContentIndex — collision detection ──────────────

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
});
