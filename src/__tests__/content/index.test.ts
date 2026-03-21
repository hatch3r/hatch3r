import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
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
} from "../../content/index.js";
import type { CatalogItem, ContentIndex } from "../../content/index.js";
import { getPreset } from "../../content/presets.js";

// ── Fixture helper ─────────────────────────────────────────────

function mdFile(overrides: Record<string, unknown> = {}, body = "# Content"): string {
  const defaults: Record<string, unknown> = {
    id: "test-item",
    type: "agent",
    description: "A test item",
    tags: ["core", "implementation"],
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
    mdFile({ id: "hatch3r-implementer", type: "agent", description: "Implements features", tags: ["core", "implementation"] }),
  );
  await writeFile(
    join(contentRoot, "agents", "hatch3r-reviewer.md"),
    mdFile({ id: "hatch3r-reviewer", type: "agent", description: "Reviews code", tags: ["core", "review"] }),
  );
  await writeFile(
    join(contentRoot, "agents", "hatch3r-protected.md"),
    mdFile({ id: "hatch3r-protected", type: "agent", description: "Protected agent", tags: ["core"], protected: true }),
  );

  // commands (glob strategy)
  await mkdir(join(contentRoot, "commands"), { recursive: true });
  await writeFile(
    join(contentRoot, "commands", "hatch3r-feature-plan.md"),
    mdFile({ id: "hatch3r-feature-plan", type: "command", description: "Plan a feature", tags: ["planning"] }),
  );
  await writeFile(
    join(contentRoot, "commands", "hatch3r-board-init.md"),
    mdFile({ id: "hatch3r-board-init", type: "command", description: "Init board", tags: ["board", "team"] }),
  );

  // rules (glob strategy — with companion .mdc)
  await mkdir(join(contentRoot, "rules"), { recursive: true });
  await writeFile(
    join(contentRoot, "rules", "hatch3r-code-standards.md"),
    mdFile({ id: "hatch3r-code-standards", type: "rule", description: "Code standards", tags: ["core"] }),
  );
  await writeFile(
    join(contentRoot, "rules", "hatch3r-code-standards.mdc"),
    "companion mdc content",
  );
  await writeFile(
    join(contentRoot, "rules", "hatch3r-testing.md"),
    mdFile({ id: "hatch3r-testing", type: "rule", description: "Testing rules", tags: ["review"] }),
  );

  // skills (subdirectory strategy)
  await mkdir(join(contentRoot, "skills", "hatch3r-feature"), { recursive: true });
  await writeFile(
    join(contentRoot, "skills", "hatch3r-feature", "SKILL.md"),
    mdFile({ id: "hatch3r-feature", type: "skill", description: "Feature skill", tags: ["implementation"] }),
  );
  await mkdir(join(contentRoot, "skills", "hatch3r-refactor"), { recursive: true });
  await writeFile(
    join(contentRoot, "skills", "hatch3r-refactor", "SKILL.md"),
    mdFile({ id: "hatch3r-refactor", type: "skill", description: "Refactor skill", tags: ["implementation"] }),
  );
  await writeFile(
    join(contentRoot, "skills", "hatch3r-refactor", "helper.md"),
    "# Extra helper file in skill dir",
  );

  // prompts (glob strategy)
  await mkdir(join(contentRoot, "prompts"), { recursive: true });
  await writeFile(
    join(contentRoot, "prompts", "hatch3r-code-review.md"),
    mdFile({ id: "hatch3r-code-review", type: "prompt", description: "Code review prompt", tags: ["review"] }),
  );

  // hooks (glob strategy)
  await mkdir(join(contentRoot, "hooks"), { recursive: true });
  await writeFile(
    join(contentRoot, "hooks", "hatch3r-pre-commit.md"),
    mdFile({ id: "hatch3r-pre-commit", type: "hook", description: "Pre-commit hook", tags: ["devops"] }),
  );

  // github-agents (glob strategy)
  await mkdir(join(contentRoot, "github-agents"), { recursive: true });
  await writeFile(
    join(contentRoot, "github-agents", "hatch3r-test-agent.md"),
    mdFile({ id: "hatch3r-test-agent", type: "github-agent", description: "Test GH agent", tags: ["review"] }),
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
    tags: ["core"],
    relativePath: "agents/test-item.md",
    ...overrides,
  };
}

function makeIndex(items: CatalogItem[]): ContentIndex {
  const byType: Record<string, CatalogItem[]> = {};
  const byId = new Map<string, CatalogItem>();
  for (const item of items) {
    if (!byType[item.type]) byType[item.type] = [];
    byType[item.type].push(item);
    byId.set(item.id, item);
  }
  return { items, byType, byId, collisions: [] };
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
      expect(agent!.tags).toEqual(["core", "implementation"]);
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
      expect(rule!.companionPath).toBe(join("rules", "hatch3r-code-standards.mdc"));
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
      expect(agent!.relativePath).toBe(join("agents", "hatch3r-implementer.md"));

      const skill = index.byId.get("hatch3r-feature");
      expect(skill!.relativePath).toBe(join("skills", "hatch3r-feature"));
    });
  });

  // ── resolveSelection ──────────────────────────────────────

  describe("resolveSelection", () => {
    const coreAgent = makeCatalogItem({ id: "core-agent", tags: ["core", "implementation"] });
    const planningCmd = makeCatalogItem({ id: "plan-cmd", type: "command", tags: ["planning"], relativePath: "commands/plan-cmd.md" });
    const boardCmd = makeCatalogItem({ id: "board-cmd", type: "command", tags: ["board", "team"], relativePath: "commands/board-cmd.md" });
    const protectedAgent = makeCatalogItem({ id: "protected-agent", protected: true, tags: ["core"], relativePath: "agents/protected-agent.md" });
    const brownfieldCmd = makeCatalogItem({ id: "bf-cmd", type: "command", tags: ["brownfield"], relativePath: "commands/bf-cmd.md" });
    const greenfieldCmd = makeCatalogItem({ id: "gf-cmd", type: "command", tags: ["greenfield"], relativePath: "commands/gf-cmd.md" });
    const noTagsRule = makeCatalogItem({ id: "no-tags-rule", type: "rule", tags: [], relativePath: "rules/no-tags-rule.md" });
    const reviewRule = makeCatalogItem({ id: "review-rule", type: "rule", tags: ["review"], relativePath: "rules/review-rule.md" });
    const a11yAgent = makeCatalogItem({ id: "a11y-agent", tags: ["a11y"], relativePath: "agents/a11y-agent.md" });
    const teamOnlyCmd = makeCatalogItem({ id: "team-only", type: "command", tags: ["team"], relativePath: "commands/team-only.md" });
    const teamCoreCmd = makeCatalogItem({ id: "team-core", type: "command", tags: ["team", "core"], relativePath: "commands/team-core.md" });

    const allItems = [
      coreAgent, planningCmd, boardCmd, protectedAgent, brownfieldCmd,
      greenfieldCmd, noTagsRule, reviewRule, a11yAgent, teamOnlyCmd, teamCoreCmd,
    ];
    const index = makeIndex(allItems);

    it("full preset includes all items when no filters apply", () => {
      const preset = getPreset("full");
      const selection = resolveSelection(preset, "brownfield", "team", index);

      const allIds = getAllContentIds(selection);
      // Full preset, brownfield+team: greenfield-only removed, everything else in
      expect(allIds.has("core-agent")).toBe(true);
      expect(allIds.has("plan-cmd")).toBe(true);
      expect(allIds.has("board-cmd")).toBe(true);
      expect(allIds.has("bf-cmd")).toBe(true);
      expect(allIds.has("team-only")).toBe(true);
    });

    it("minimal preset with includeTags filters to only matching tags", () => {
      const preset = getPreset("minimal");
      const selection = resolveSelection(preset, "brownfield", "team", index);

      const allIds = getAllContentIds(selection);
      // Minimal only includes "core" tag
      expect(allIds.has("core-agent")).toBe(true);
      // planning-only item should be excluded
      expect(allIds.has("plan-cmd")).toBe(false);
      // a11y-only item should be excluded
      expect(allIds.has("a11y-agent")).toBe(false);
    });

    it("standard preset excludeTags removes items with only excluded tags", () => {
      const preset = getPreset("standard");
      const selection = resolveSelection(preset, "brownfield", "team", index);

      const allIds = getAllContentIds(selection);
      // Standard excludes board, a11y, performance, customize
      expect(allIds.has("a11y-agent")).toBe(false);
      // board-cmd has tags ["board", "team"] — both board and team are excluded via excludeTags? No,
      // standard excludeTags = ["board", "a11y", "performance", "customize"]
      // board-cmd tags = ["board", "team"] — "team" is NOT in excludeSet, so not all tags excluded
      // It should survive excludeTags, but may fail includeTags check
      // standard includeTags = ["core", "planning", "implementation", "review", "devops", "maintenance"]
      // board-cmd has ["board", "team"] — none in includeTags, so excluded by includeTags
      expect(allIds.has("board-cmd")).toBe(false);
    });

    it("protected items are always included regardless of filters", () => {
      const preset = getPreset("minimal");
      const selection = resolveSelection(preset, "greenfield", "solo", index);

      const allIds = getAllContentIds(selection);
      expect(allIds.has("protected-agent")).toBe(true);
    });

    it("items without tags pass through includeTags filter", () => {
      const preset = getPreset("minimal");
      const selection = resolveSelection(preset, "brownfield", "team", index);

      const allIds = getAllContentIds(selection);
      expect(allIds.has("no-tags-rule")).toBe(true);
    });

    it("greenfield projectType removes brownfield-only items", () => {
      const preset = getPreset("full");
      const selection = resolveSelection(preset, "greenfield", "team", index);

      const allIds = getAllContentIds(selection);
      // brownfield-only should be removed
      expect(allIds.has("bf-cmd")).toBe(false);
      // greenfield-only should remain
      expect(allIds.has("gf-cmd")).toBe(true);
    });

    it("brownfield projectType removes greenfield-only items", () => {
      const preset = getPreset("full");
      const selection = resolveSelection(preset, "brownfield", "team", index);

      const allIds = getAllContentIds(selection);
      expect(allIds.has("gf-cmd")).toBe(false);
      expect(allIds.has("bf-cmd")).toBe(true);
    });

    it("solo teamSize removes items with only team/board tags", () => {
      const preset = getPreset("full");
      const selection = resolveSelection(preset, "brownfield", "solo", index);

      const allIds = getAllContentIds(selection);
      // team-only has tags ["team"] — all tags are team/board context, should be removed
      expect(allIds.has("team-only")).toBe(false);
      // board-cmd has tags ["board", "team"] — all context tags, should be removed
      expect(allIds.has("board-cmd")).toBe(false);
    });

    it("solo teamSize keeps items with team tag plus other workflow tags", () => {
      const preset = getPreset("full");
      const selection = resolveSelection(preset, "brownfield", "solo", index);

      const allIds = getAllContentIds(selection);
      // team-core has tags ["team", "core"] — has "core" (non-context), should stay
      expect(allIds.has("team-core")).toBe(true);
    });

    it("team teamSize keeps team/board items", () => {
      const preset = getPreset("full");
      const selection = resolveSelection(preset, "brownfield", "team", index);

      const allIds = getAllContentIds(selection);
      expect(allIds.has("team-only")).toBe(true);
      expect(allIds.has("board-cmd")).toBe(true);
    });

    it("custom preset with customSelections uses explicit ID list", () => {
      const preset = getPreset("custom");
      const selection = resolveSelection(preset, "brownfield", "team", index, ["core-agent", "review-rule"]);

      const allIds = getAllContentIds(selection);
      expect(allIds.has("core-agent")).toBe(true);
      expect(allIds.has("review-rule")).toBe(true);
      // Non-selected, non-protected items should be excluded
      expect(allIds.has("plan-cmd")).toBe(false);
      expect(allIds.has("a11y-agent")).toBe(false);
    });

    it("custom preset still includes protected items", () => {
      const preset = getPreset("custom");
      const selection = resolveSelection(preset, "brownfield", "team", index, ["core-agent"]);

      const allIds = getAllContentIds(selection);
      expect(allIds.has("protected-agent")).toBe(true);
    });

    it("groups items correctly by type in selection.items", () => {
      const preset = getPreset("full");
      const selection = resolveSelection(preset, "brownfield", "team", index);

      // Agents go to items.agents
      expect(selection.items.agents).toContain("core-agent");
      expect(selection.items.agents).toContain("protected-agent");
      // Commands go to items.commands
      expect(selection.items.commands).toContain("plan-cmd");
      // Rules go to items.rules
      expect(selection.items.rules).toContain("no-tags-rule");
    });

    it("returns correct preset/projectType/teamSize in selection", () => {
      const preset = getPreset("standard");
      const selection = resolveSelection(preset, "greenfield", "solo", index);

      expect(selection.preset).toBe("standard");
      expect(selection.projectType).toBe("greenfield");
      expect(selection.teamSize).toBe("solo");
    });

    it("full preset with greenfield+solo applies both context filters", () => {
      const preset = getPreset("full");
      const selection = resolveSelection(preset, "greenfield", "solo", index);

      const allIds = getAllContentIds(selection);
      // Brownfield-only removed
      expect(allIds.has("bf-cmd")).toBe(false);
      // Team-only removed
      expect(allIds.has("team-only")).toBe(false);
      // Core agent survives both filters
      expect(allIds.has("core-agent")).toBe(true);
    });

    it("custom preset without customSelections falls back to all items with filters", () => {
      const preset = getPreset("custom");
      // custom preset has empty includeTags/excludeTags, so everything passes preset filters
      const selection = resolveSelection(preset, "brownfield", "team", index);

      const allIds = getAllContentIds(selection);
      // Everything except greenfield-only should be present
      expect(allIds.has("core-agent")).toBe(true);
      expect(allIds.has("gf-cmd")).toBe(false);
    });

    it("items with mixed brownfield+other tags survive greenfield filter", () => {
      const mixedItem = makeCatalogItem({
        id: "mixed-bf",
        type: "command",
        tags: ["brownfield", "core"],
        relativePath: "commands/mixed-bf.md",
      });
      const mixedIndex = makeIndex([mixedItem]);
      const preset = getPreset("full");
      const selection = resolveSelection(preset, "greenfield", "team", mixedIndex);

      const allIds = getAllContentIds(selection);
      // Has "core" as a non-context tag alongside "brownfield", so survives
      expect(allIds.has("mixed-bf")).toBe(true);
    });

    it("empty index returns selection with empty items", () => {
      const preset = getPreset("full");
      const emptyIndex = makeIndex([]);
      const selection = resolveSelection(preset, "brownfield", "team", emptyIndex);

      expect(countSelectionItems(selection)).toBe(0);
    });

    it("minimal preset excludes review-tagged items (not in includeTags)", () => {
      const preset = getPreset("minimal");
      const selection = resolveSelection(preset, "brownfield", "team", index);

      const allIds = getAllContentIds(selection);
      expect(allIds.has("review-rule")).toBe(false);
    });

    // ── Tag consolidation edge cases ──────────────────────────

    it("item with both greenfield and brownfield tags passes both project type filters", () => {
      const dualItem = makeCatalogItem({
        id: "dual-context",
        type: "rule",
        tags: ["greenfield", "brownfield"],
        relativePath: "rules/dual-context.md",
      });
      const dualIndex = makeIndex([dualItem]);
      const preset = getPreset("full");

      // Should survive greenfield filter (has non-brownfield tag: "greenfield")
      const gfSelection = resolveSelection(preset, "greenfield", "team", dualIndex);
      expect(getAllContentIds(gfSelection).has("dual-context")).toBe(true);

      // Should survive brownfield filter (has non-greenfield tag: "brownfield")
      const bfSelection = resolveSelection(preset, "brownfield", "team", dualIndex);
      expect(getAllContentIds(bfSelection).has("dual-context")).toBe(true);
    });

    it("item with only 'team' tag is filtered out when teamSize is solo", () => {
      const teamOnlyItem = makeCatalogItem({
        id: "team-only-item",
        type: "command",
        tags: ["team"],
        relativePath: "commands/team-only-item.md",
      });
      const soloIndex = makeIndex([teamOnlyItem]);
      const preset = getPreset("full");

      const selection = resolveSelection(preset, "brownfield", "solo", soloIndex);
      expect(getAllContentIds(selection).has("team-only-item")).toBe(false);
    });

    it("item with 'team' and 'core' tags survives solo teamSize filter", () => {
      const teamCoreItem = makeCatalogItem({
        id: "team-core-item",
        type: "rule",
        tags: ["team", "core"],
        relativePath: "rules/team-core-item.md",
      });
      const mixedIndex = makeIndex([teamCoreItem]);
      const preset = getPreset("full");

      // "core" is a non-context tag, so item should survive solo filter
      const selection = resolveSelection(preset, "brownfield", "solo", mixedIndex);
      expect(getAllContentIds(selection).has("team-core-item")).toBe(true);
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
      expect(copied).toContain(join("agents", "hatch3r-implementer.md"));

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
      expect(copied).toContain(join("skills", "hatch3r-refactor"));

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
      expect(copied).toContain(join("rules", "hatch3r-code-standards.md"));
      expect(copied).toContain(join("rules", "hatch3r-code-standards.mdc"));

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
      expect(copied).toContain(join("agents", "hatch3r-implementer.md"));
      expect(copied).toContain(join("agents", "hatch3r-reviewer.md"));
      expect(copied).toContain(join("skills", "hatch3r-feature"));
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
      expect(selection.items.commands).toContain("c");
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
      };

      await removeContentItem(agentsDir, item, { rootDir });

      await expect(readFile(join(rootDir, ".hatch3r", "agents", "my-agent.customize.yaml"), "utf-8")).rejects.toThrow();
      await expect(readFile(join(rootDir, ".hatch3r", "agents", "my-agent.customize.md"), "utf-8")).rejects.toThrow();
    });

    it("throws HatchError for path traversal in relativePath", async () => {
      const dir = await makeTempDir();

      const maliciousItem: CatalogItem = {
        id: "evil",
        type: "agent",
        description: "Path traversal attempt",
        tags: [],
        relativePath: "../../../etc/passwd",
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
    const exclIndex = makeIndex([
      makeCatalogItem({ id: "core-item", tags: ["core"], relativePath: "agents/core.md" }),
      makeCatalogItem({ id: "planning-item", type: "command", tags: ["planning"], relativePath: "commands/plan.md" }),
      makeCatalogItem({ id: "board-item", type: "command", tags: ["board"], relativePath: "commands/board.md" }),
      makeCatalogItem({ id: "review-item", type: "rule", tags: ["review"], relativePath: "rules/review.md" }),
    ]);

    it("returns 0 for full preset", () => {
      const preset = getPreset("full");
      expect(countPresetExclusions(preset, exclIndex)).toBe(0);
    });

    it("returns 0 for custom preset", () => {
      const preset = getPreset("custom");
      expect(countPresetExclusions(preset, exclIndex)).toBe(0);
    });

    it("counts excluded items for minimal preset", () => {
      const preset = getPreset("minimal");
      const count = countPresetExclusions(preset, exclIndex);
      // Minimal only includes "core" tag; planning, board, review get excluded
      expect(count).toBe(3);
    });

    it("does not count protected items as excluded", () => {
      const protectedOnly = makeIndex([
        makeCatalogItem({
          id: "prot",
          type: "agent",
          tags: ["obscure-tag"],
          relativePath: "agents/prot.md",
          protected: true,
        }),
      ]);
      const preset = getPreset("minimal");
      expect(countPresetExclusions(preset, protectedOnly)).toBe(0);
    });
  });

  describe("countProjectTypeExclusions", () => {
    it("counts brownfield-only items excluded by greenfield filter", () => {
      const items = [
        makeCatalogItem({ id: "bf-only", type: "agent", tags: ["brownfield"], relativePath: "agents/bf.md" }),
        makeCatalogItem({ id: "both", type: "agent", tags: ["brownfield", "core"], relativePath: "agents/both.md" }),
        makeCatalogItem({ id: "gf", type: "agent", tags: ["core"], relativePath: "agents/gf.md" }),
      ];
      expect(countProjectTypeExclusions("greenfield", items)).toBe(1); // only bf-only
    });

    it("counts greenfield-only items excluded by brownfield filter", () => {
      const items = [
        makeCatalogItem({ id: "gf-only", type: "agent", tags: ["greenfield"], relativePath: "agents/gf.md" }),
        makeCatalogItem({ id: "mixed", type: "agent", tags: ["greenfield", "core"], relativePath: "agents/mixed.md" }),
      ];
      expect(countProjectTypeExclusions("brownfield", items)).toBe(1); // only gf-only
    });

    it("does not count protected items", () => {
      const items = [
        makeCatalogItem({ id: "prot-bf", type: "agent", tags: ["brownfield"], relativePath: "agents/prot.md", protected: true }),
      ];
      expect(countProjectTypeExclusions("greenfield", items)).toBe(0);
    });
  });

  describe("countTeamSizeExclusions", () => {
    it("counts team-only items excluded by solo filter", () => {
      const items = [
        makeCatalogItem({ id: "team-only", type: "command", tags: ["team"], relativePath: "commands/team.md" }),
        makeCatalogItem({ id: "board-only", type: "command", tags: ["board"], relativePath: "commands/board.md" }),
        makeCatalogItem({ id: "team-core", type: "command", tags: ["team", "core"], relativePath: "commands/team-core.md" }),
        makeCatalogItem({ id: "normal", type: "command", tags: ["core"], relativePath: "commands/normal.md" }),
      ];
      expect(countTeamSizeExclusions("solo", items)).toBe(2); // team-only and board-only
    });

    it("returns 0 for team filter", () => {
      const items = [
        makeCatalogItem({ id: "team-only", type: "command", tags: ["team"], relativePath: "commands/team.md" }),
      ];
      expect(countTeamSizeExclusions("team", items)).toBe(0);
    });

    it("does not count protected items", () => {
      const items = [
        makeCatalogItem({ id: "prot-team", type: "command", tags: ["team"], relativePath: "commands/pt.md", protected: true }),
      ];
      expect(countTeamSizeExclusions("solo", items)).toBe(0);
    });
  });
});
