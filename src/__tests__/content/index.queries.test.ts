import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ARCHIVE_DIR } from "../../types.js";
import type { ContentSelection } from "../../types.js";
import {
  buildContentIndex,
  getAvailableItems,
  buildSelectionsFromDisk,
  archiveCustomizeOverrides,
  getAllContentIds,
  countSelectionItems,
  selectionSummary,
  countPresetExclusions,
  presetOmittedClusters,
  countProjectTypeExclusions,
  countTeamSizeExclusions,
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
  TAG_FLOOR_CONTENT_QUALITY,
  TAG_CTX_GREENFIELD_ONLY,
  TAG_CTX_BROWNFIELD_ONLY,
  TAG_CTX_TEAM_ONLY,
  TAG_CUSTOMIZE,
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

describe("content/index — queries, mutations & counts", () => {
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

  // ── getAvailableItems ────────────────────────────────────

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

  // ── buildSelectionsFromDisk ──────────────────────────────

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

  // ── archiveCustomizeOverrides ────────────────────────────

  describe("archiveCustomizeOverrides", () => {
    it("archives .hatch3r customize files (not hard-delete) on removal", async () => {
      // D10-35 (Cycle 11 Wave 3): a preset downgrade must not silently destroy
      // hand-authored overrides. archiveCustomizeOverrides moves them to
      // `.hatch3r-archive/customize/<type>/` and reports the rescued paths.
      const dir = await makeTempDir();
      const rootDir = join(dir, "project");

      // Create customize files
      await mkdir(join(rootDir, ".hatch3r", "agents"), { recursive: true });
      await writeFile(join(rootDir, ".hatch3r", "agents", "my-agent.customize.yaml"), "overrides: true");
      await writeFile(join(rootDir, ".hatch3r", "agents", "my-agent.customize.md"), "# custom");

      const result = await archiveCustomizeOverrides(rootDir, { id: "my-agent", type: "agent" });

      // Originals are gone from the live .hatch3r/ tree …
      await expect(readFile(join(rootDir, ".hatch3r", "agents", "my-agent.customize.yaml"), "utf-8")).rejects.toThrow();
      await expect(readFile(join(rootDir, ".hatch3r", "agents", "my-agent.customize.md"), "utf-8")).rejects.toThrow();

      // … but the bytes survive under the customize archive.
      const archiveDir = join(rootDir, ARCHIVE_DIR, "customize", "agents");
      expect(await readFile(join(archiveDir, "my-agent.customize.yaml"), "utf-8")).toBe("overrides: true");
      expect(await readFile(join(archiveDir, "my-agent.customize.md"), "utf-8")).toBe("# custom");

      // The rescued paths are returned for the caller's summary.
      expect(result.archivedCustomizeFiles).toEqual([
        `${ARCHIVE_DIR}/customize/agents/my-agent.customize.yaml`,
        `${ARCHIVE_DIR}/customize/agents/my-agent.customize.md`,
      ]);
    });

    it("returns an empty archived list when no customize files exist (ENOENT skip)", async () => {
      const dir = await makeTempDir();
      const rootDir = join(dir, "project");
      await mkdir(rootDir, { recursive: true });

      const result = await archiveCustomizeOverrides(rootDir, { id: "plain-agent", type: "agent" });

      expect(result.archivedCustomizeFiles).toEqual([]);
      // No customize archive directory is created when there is nothing to move.
      await expect(readdir(join(rootDir, ARCHIVE_DIR, "customize", "agents"))).rejects.toThrow();
    });

    it("strips cmd- and hatch3r- prefixes when archiving command customize files", async () => {
      const dir = await makeTempDir();
      const rootDir = join(dir, "project");

      // Customize files are stored WITHOUT the cmd- and hatch3r- prefixes
      await mkdir(join(rootDir, ".hatch3r", "commands"), { recursive: true });
      await writeFile(join(rootDir, ".hatch3r", "commands", "board-fill.customize.yaml"), "overrides: true");

      const result = await archiveCustomizeOverrides(rootDir, { id: "cmd-hatch3r-board-fill", type: "command" });

      // The customize file (named without prefixes) moves out of the live tree …
      await expect(readFile(join(rootDir, ".hatch3r", "commands", "board-fill.customize.yaml"), "utf-8")).rejects.toThrow();
      // … and into the customize archive under the prefix-stripped name.
      expect(
        await readFile(join(rootDir, ARCHIVE_DIR, "customize", "commands", "board-fill.customize.yaml"), "utf-8"),
      ).toBe("overrides: true");
      expect(result.archivedCustomizeFiles).toEqual([
        `${ARCHIVE_DIR}/customize/commands/board-fill.customize.yaml`,
      ]);
    });

    it("degrades gracefully when the archive write fails and still removes the original", async () => {
      const dir = await makeTempDir();
      const rootDir = join(dir, "project");

      await mkdir(join(rootDir, ".hatch3r", "agents"), { recursive: true });
      await writeFile(join(rootDir, ".hatch3r", "agents", "my-agent.customize.yaml"), "overrides: true");
      // Plant a FILE where the archive root directory must be created so
      // `mkdir(archiveDir, { recursive: true })` fails (ENOTDIR/EEXIST).
      await writeFile(join(rootDir, ARCHIVE_DIR), "not a directory");

      // No throw: the failure downgrades to a verbose diagnostic …
      const result = await archiveCustomizeOverrides(rootDir, { id: "my-agent", type: "agent" });

      // … nothing is reported as archived …
      expect(result.archivedCustomizeFiles).toEqual([]);
      // … and the live override is still removed so the on-disk override set
      // stays consistent with the manifest selection (documented degradation).
      await expect(readFile(join(rootDir, ".hatch3r", "agents", "my-agent.customize.yaml"), "utf-8")).rejects.toThrow();
    });

    it("returns an empty list for types without a customize directory", async () => {
      const dir = await makeTempDir();
      const rootDir = join(dir, "project");
      await mkdir(rootDir, { recursive: true });

      const result = await archiveCustomizeOverrides(rootDir, { id: "some-hook", type: "hook" });

      expect(result.archivedCustomizeFiles).toEqual([]);
    });
  });

  // ── getAllContentIds ─────────────────────────────────────

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

  // ── countSelectionItems ──────────────────────────────────

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

  // ── selectionSummary ─────────────────────────────────────

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

  // ── countPresetExclusions ────────────────────────────────

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

  // ── presetOmittedClusters (D10-12) ───────────────────────
  // The realized post-floor omit-cluster labels. The systematic bug D10-12
  // flagged: the picker's "omits:" line claimed a preset dropped a capability
  // cluster (e.g. "review") that floor admission actually ships, because the
  // old line read the capability-intent gap (`presets.ts::omittedCapabilityClusters`).
  // These tests pin that a cluster appears in the omit list ONLY when the
  // preset genuinely drops at least one item of it after floor admission.
  describe("presetOmittedClusters", () => {
    it("returns [] for full (drops nothing)", () => {
      const idx = makeIndex([
        makeCatalogItem({ id: "p", type: "command", tags: [TAG_PLANNING], relativePath: "commands/p.md" }),
      ]);
      expect(presetOmittedClusters(getPreset("full"), idx)).toEqual([]);
    });

    it("returns [] for custom (user-driven)", () => {
      const idx = makeIndex([
        makeCatalogItem({ id: "p", type: "command", tags: [TAG_PLANNING], relativePath: "commands/p.md" }),
      ]);
      expect(presetOmittedClusters(getPreset("custom"), idx)).toEqual([]);
    });

    it("names a cluster minimal genuinely drops (non-floor planning item)", () => {
      const idx = makeIndex([
        makeCatalogItem({ id: "orch", tags: [TAG_ORCHESTRATION], relativePath: "agents/orch.md" }),
        // pure planning, no floor tag → genuinely dropped by minimal
        makeCatalogItem({ id: "plan", type: "command", tags: [TAG_PLANNING], relativePath: "commands/plan.md" }),
      ]);
      expect(presetOmittedClusters(getPreset("minimal"), idx)).toEqual(["planning"]);
    });

    it("does NOT name a cluster whose only item is floor-admitted (the D10-12 lie)", () => {
      const idx = makeIndex([
        makeCatalogItem({ id: "orch", tags: [TAG_ORCHESTRATION], relativePath: "agents/orch.md" }),
        // review capability BUT carries a content-quality floor tag → ships under
        // minimal via floor admission. The old capability-intent line claimed
        // minimal "omits review"; this realized line must NOT, because the item
        // is in the generated repo.
        makeCatalogItem({
          id: "review-floor", type: "agent",
          tags: [TAG_REVIEW, TAG_FLOOR_CONTENT_QUALITY],
          relativePath: "agents/review-floor.md",
        }),
      ]);
      expect(presetOmittedClusters(getPreset("minimal"), idx)).toEqual([]);
    });

    it("names only the genuinely-dropped clusters when floor and non-floor items mix", () => {
      const idx = makeIndex([
        makeCatalogItem({ id: "orch", tags: [TAG_ORCHESTRATION], relativePath: "agents/orch.md" }),
        // planning ships nothing under minimal (no floor) → omitted
        makeCatalogItem({ id: "plan", type: "command", tags: [TAG_PLANNING], relativePath: "commands/plan.md" }),
        // review is floor-admitted → NOT omitted despite minimal not requesting review
        makeCatalogItem({
          id: "review-floor", type: "agent",
          tags: [TAG_REVIEW, TAG_FLOOR_UI_UX],
          relativePath: "agents/review-floor.md",
        }),
        // board, no floor → omitted
        makeCatalogItem({ id: "board", type: "command", tags: [TAG_BOARD], relativePath: "commands/board.md" }),
      ]);
      const omitted = presetOmittedClusters(getPreset("minimal"), idx);
      // full-superset order: planning before board; review excluded (floor-shipped).
      expect(omitted).toEqual(["planning", "board"]);
    });

    it("maps the ai capability tag to the 'AI feature engineering' label", () => {
      const idx = makeIndex([
        makeCatalogItem({ id: "orch", tags: [TAG_ORCHESTRATION], relativePath: "agents/orch.md" }),
        // ai item with no floor tag → genuinely dropped by standard (no ai cap)
        makeCatalogItem({ id: "ai", type: "agent", tags: [TAG_AI], relativePath: "agents/ai.md" }),
      ]);
      expect(presetOmittedClusters(getPreset("standard"), idx)).toEqual(["AI feature engineering"]);
    });

    it("does not surface non-capability tags (e.g. ctx:* or floor) as cluster labels", () => {
      const idx = makeIndex([
        makeCatalogItem({ id: "orch", tags: [TAG_ORCHESTRATION], relativePath: "agents/orch.md" }),
        // a team-only item with NO capability tag is dropped by minimal, but it
        // contributes no capability label — the omit list stays empty.
        makeCatalogItem({
          id: "ctx-only", type: "command",
          tags: [TAG_CTX_TEAM_ONLY],
          relativePath: "commands/ctx-only.md",
        }),
      ]);
      // skipContextFilters is set inside presetOmittedClusters, so ctx:team-only
      // is not removed by the context filter — but it has no capability tag, so
      // it cannot name a cluster. The item is simply not admitted (no capability,
      // no floor), and produces no label.
      expect(presetOmittedClusters(getPreset("minimal"), idx)).toEqual([]);
    });
  });

  // ── countProjectTypeExclusions ───────────────────────────

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

  // ── countTeamSizeExclusions ──────────────────────────────

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

  // ── estimatePresetItemCount ──────────────────────────────

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

  // ── COMMAND_ID_PREFIX ────────────────────────────────────

  describe("COMMAND_ID_PREFIX", () => {
    it("is the string 'cmd-'", () => {
      expect(COMMAND_ID_PREFIX).toBe("cmd-");
    });
  });

  // ── applyCommandPrefix ───────────────────────────────────

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

    it("is idempotent on already-prefixed command IDs", () => {
      // D2-SA2.6-2.6-F04: applyCommandPrefix only prepends when the id does
      // not already start with COMMAND_ID_PREFIX, so re-indexing an
      // already-prefixed id (e.g. a round-trip through user-content authoring)
      // cannot produce a `cmd-cmd-` double prefix.
      const result = applyCommandPrefix("cmd-hatch3r-feature-plan", "command");
      expect(result).toBe("cmd-hatch3r-feature-plan");
    });
  });
});
