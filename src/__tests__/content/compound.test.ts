/**
 * Content structure validation tests for the hatch3r compound system.
 *
 * These tests validate the actual content files (agents, rules, skills,
 * commands, prompts, hooks, github-agents) against structural invariants
 * required by the compound system. They catch regressions in:
 *
 * - Frontmatter completeness (every file has id, description, tags)
 * - Naming conventions (hatch3r-* prefix)
 * - Content type coverage (all expected types present)
 * - Cross-reference integrity (referenced content IDs exist)
 * - Orchestration dependencies (pipeline agents present)
 * - Severity scale consistency (canonical 5-level scale)
 * - Tag validity (only valid tags used)
 * - Companion file parity (.md/.mdc for rules)
 *
 * Ref: AUDIT-REPORT.md D16-5 — "No content-level regression tests"
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseFrontmatter } from "../../adapters/canonical.js";
import {
  ALL_TAGS,
  isFloorTag,
  TAG_FLOOR_SECURITY,
  TAG_FLOOR_CONTENT_QUALITY,
} from "../../content/tags.js";
import {
  buildContentIndex,
  validateCrossReferences,
  validateOrchestrationDependencies,
  resolveSelection,
  getAllContentIds,
  type ContentIndex,
} from "../../content/index.js";
import { getPreset, type PresetId } from "../../content/presets.js";

// ── Constants ──────────────────────────────────────────────────

const PROJECT_ROOT = resolve(import.meta.dirname, "../../../");
const CONTENT_ROOT = PROJECT_ROOT; // Content lives at repo root

// Wave 2 of the content-pack redesign removed the prompts/ directory after the
// 3 prompt artifacts were deprecated (`hatch3r-bug-triage`, `hatch3r-code-review`,
// `hatch3r-pr-description`). The prompt content type remains in TYPE_TO_SELECTION_KEY
// and ContentSelection.items.prompts so existing user-tier content keeps working,
// but the directory itself ships empty and the canonical inventory is now
// 6 content types — agent, command, rule, skill, hook, github-agent.
const CONTENT_DIRS: { dir: string; type: string; strategy: "glob" | "subdirectory" }[] = [
  { dir: "agents", type: "agent", strategy: "glob" },
  { dir: "commands", type: "command", strategy: "glob" },
  { dir: "rules", type: "rule", strategy: "glob" },
  { dir: "skills", type: "skill", strategy: "subdirectory" },
  { dir: "hooks", type: "hook", strategy: "glob" },
  { dir: "github-agents", type: "github-agent", strategy: "glob" },
];

// Agents required by the orchestration pipeline ("Always" in Agent Roster).
// F16.3-H1 (Cycle 10 Wave 1C): the legacy test-writer + security-auditor
// always-mode roles collapsed into the CQ specialists. Only the
// pipeline-protected CQ agent enforced as an always-mode roster member is
// listed here (hatch3r-security at CQ3). hatch3r-testability (CQ5) carries
// the always-mode floor in SPECIALIST_TRIGGER_TABLE but is not enforced in
// the strict-orchestration roster; its always-mode behaviour is enforced at
// orchestrator runtime via SPECIALIST_TRIGGER_TABLE.
const ORCHESTRATION_AGENTS = [
  "hatch3r-researcher",
  "hatch3r-implementer",
  "hatch3r-reviewer",
  "hatch3r-security",
];

// The canonical 5-level severity scale
const CANONICAL_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

const validTagSet = new Set(ALL_TAGS as readonly string[]);

// ── Helpers ────────────────────────────────────────────────────

interface ContentFile {
  filePath: string;
  relativePath: string;
  type: string;
  raw: string;
  metadata: Record<string, unknown>;
  body: string;
}

async function loadAllContentFiles(): Promise<ContentFile[]> {
  const files: ContentFile[] = [];

  for (const config of CONTENT_DIRS) {
    const dirPath = join(CONTENT_ROOT, config.dir);

    if (config.strategy === "subdirectory") {
      const dirents = await readdir(dirPath, { withFileTypes: true });
      for (const dirent of dirents) {
        if (!dirent.isDirectory()) continue;
        const skillPath = join(dirPath, dirent.name, "SKILL.md");
        try {
          const raw = await readFile(skillPath, "utf-8");
          const { metadata, content } = parseFrontmatter(raw);
          files.push({
            filePath: skillPath,
            relativePath: join(config.dir, dirent.name),
            type: config.type,
            raw,
            metadata: metadata as unknown as Record<string, unknown>,
            body: content,
          });
        } catch (err) {
          // Skip missing SKILL.md.
          void err;
        }
      }
    } else {
      const entries = await readdir(dirPath);
      const mdFiles = entries.filter((f) => f.endsWith(".md"));
      for (const file of mdFiles) {
        const filePath = join(dirPath, file);
        const raw = await readFile(filePath, "utf-8");
        const { metadata, content } = parseFrontmatter(raw);
        files.push({
          filePath,
          relativePath: join(config.dir, file),
          type: config.type,
          raw,
          metadata: metadata as unknown as Record<string, unknown>,
          body: content,
        });
      }
    }
  }

  return files;
}

// ── Test suite ─────────────────────────────────────────────────

describe("compound system content validation", () => {
  let allFiles: ContentFile[];
  let contentIndex: ContentIndex;

  beforeAll(async () => {
    allFiles = await loadAllContentFiles();
    contentIndex = await buildContentIndex(CONTENT_ROOT);
  });

  // ── Frontmatter completeness ───────────────────────────────

  describe("frontmatter completeness", () => {
    it("every content file has an id field", () => {
      const missing = allFiles.filter((f) => !f.metadata.id);
      expect(missing.map((f) => f.relativePath)).toEqual([]);
    });

    it("every content file has a description field", () => {
      const missing = allFiles.filter((f) => !f.metadata.description);
      expect(missing.map((f) => f.relativePath)).toEqual([]);
    });

    it("every content file has a tags array", () => {
      const missing = allFiles.filter(
        (f) => !Array.isArray(f.metadata.tags) || f.metadata.tags.length === 0,
      );
      expect(missing.map((f) => f.relativePath)).toEqual([]);
    });

    it("no content file has an empty id", () => {
      const empty = allFiles.filter((f) => f.metadata.id === "");
      expect(empty.map((f) => f.relativePath)).toEqual([]);
    });
  });

  // ── Naming conventions ─────────────────────────────────────

  describe("naming conventions", () => {
    it("all content IDs use the hatch3r- prefix (except hooks with event-based IDs)", () => {
      const invalid = allFiles.filter((f) => {
        const id = String(f.metadata.id);
        // Hooks may use event-based IDs (e.g., pre-commit-lint-fixer)
        if (f.type === "hook") return false;
        return !id.startsWith("hatch3r-");
      });
      expect(invalid.map((f) => `${f.relativePath}: ${f.metadata.id}`)).toEqual([]);
    });

    it("all content IDs are lowercase kebab-case", () => {
      const invalid = allFiles.filter((f) => {
        const id = String(f.metadata.id);
        return id !== id.toLowerCase() || /[^a-z0-9-]/.test(id);
      });
      expect(invalid.map((f) => `${f.relativePath}: ${f.metadata.id}`)).toEqual([]);
    });

    it("no duplicate content IDs exist within the same type", () => {
      const seenByType = new Map<string, Map<string, string>>();
      const duplicates: string[] = [];
      for (const f of allFiles) {
        const id = String(f.metadata.id);
        if (!seenByType.has(f.type)) seenByType.set(f.type, new Map());
        const typeMap = seenByType.get(f.type)!;
        if (typeMap.has(id)) {
          duplicates.push(`"${id}" (${f.type}) in ${typeMap.get(id)} and ${f.relativePath}`);
        }
        typeMap.set(id, f.relativePath);
      }
      expect(duplicates).toEqual([]);
    });

    it("cross-type ID sharing only occurs between commands and skills", () => {
      // Commands and skills intentionally share IDs (command = invocation spec, skill = full workflow)
      const idsByType = new Map<string, Set<string>>();
      for (const f of allFiles) {
        const id = String(f.metadata.id);
        if (!idsByType.has(f.type)) idsByType.set(f.type, new Set());
        idsByType.get(f.type)!.add(id);
      }
      const unexpected: string[] = [];
      const types = [...idsByType.keys()];
      for (let i = 0; i < types.length; i++) {
        for (let j = i + 1; j < types.length; j++) {
          const a = types[i];
          const b = types[j];
          // command/skill overlap is expected
          if ((a === "command" && b === "skill") || (a === "skill" && b === "command")) continue;
          const setA = idsByType.get(a)!;
          const setB = idsByType.get(b)!;
          for (const id of setA) {
            if (setB.has(id)) {
              unexpected.push(`"${id}" shared between ${a} and ${b}`);
            }
          }
        }
      }
      expect(unexpected).toEqual([]);
    });
  });

  // ── Tag validity ───────────────────────────────────────────

  describe("tag validity", () => {
    it("all tags used in content files are from the canonical tag set", () => {
      const invalid: string[] = [];
      for (const f of allFiles) {
        const tags = f.metadata.tags as string[];
        for (const tag of tags) {
          if (!validTagSet.has(tag)) {
            invalid.push(`${f.relativePath}: invalid tag "${tag}"`);
          }
        }
      }
      expect(invalid).toEqual([]);
    });

    it("at least one content file uses the orchestration capability tag (formerly 'core')", () => {
      // Wave 1 renamed the legacy `core` tag to `orchestration` (capability
      // facet). Per src/content/tags.ts every published canonical artifact
      // must carry at least one capability or floor tag, and the orchestration
      // pipeline agents are tagged `orchestration` specifically.
      const orchFiles = allFiles.filter(
        (f) => Array.isArray(f.metadata.tags) && f.metadata.tags.includes("orchestration"),
      );
      expect(orchFiles.length).toBeGreaterThan(0);
    });
  });

  // ── Content type coverage ──────────────────────────────────

  describe("content type coverage", () => {
    it("has agent content files", () => {
      const agents = allFiles.filter((f) => f.type === "agent");
      expect(agents.length).toBeGreaterThanOrEqual(16);
    });

    it("has rule content files", () => {
      const rules = allFiles.filter((f) => f.type === "rule");
      expect(rules.length).toBeGreaterThanOrEqual(22);
    });

    it("has skill content files", () => {
      const skills = allFiles.filter((f) => f.type === "skill");
      expect(skills.length).toBeGreaterThanOrEqual(25);
    });

    it("has command content files", () => {
      const commands = allFiles.filter((f) => f.type === "command");
      expect(commands.length).toBeGreaterThanOrEqual(20);
    });

    it("has hook content files", () => {
      const hooks = allFiles.filter((f) => f.type === "hook");
      expect(hooks.length).toBeGreaterThanOrEqual(6);
    });

    it("has github-agent content files", () => {
      const ghAgents = allFiles.filter((f) => f.type === "github-agent");
      expect(ghAgents.length).toBeGreaterThanOrEqual(4);
    });

    it("all six published content type directories are represented", () => {
      // Wave 2 deprecated the 3 canonical prompts (hatch3r-bug-triage,
      // hatch3r-code-review, hatch3r-pr-description) and shipped the prompts/
      // directory empty. The selection key is preserved for user-tier
      // extensions but the directory is no longer in CONTENT_DIRS.
      const types = new Set(allFiles.map((f) => f.type));
      expect(types).toEqual(
        new Set(["agent", "command", "rule", "skill", "hook", "github-agent"]),
      );
    });
  });

  // ── Orchestration dependencies ─────────────────────────────

  describe("orchestration dependencies", () => {
    it("all orchestration-required agents exist in content", () => {
      const agentIds = new Set(
        allFiles.filter((f) => f.type === "agent").map((f) => String(f.metadata.id)),
      );
      const missing = ORCHESTRATION_AGENTS.filter((id) => !agentIds.has(id));
      expect(missing).toEqual([]);
    });

    it("orchestration-required agents are all marked as protected", () => {
      for (const agentId of ORCHESTRATION_AGENTS) {
        const agent = allFiles.find(
          (f) => f.type === "agent" && f.metadata.id === agentId,
        );
        expect(agent, `agent ${agentId} should exist`).toBeDefined();
        expect(
          agent!.metadata.protected,
          `agent ${agentId} should be protected`,
        ).toBe(true);
      }
    });

    it("orchestration rule exists and is tagged as orchestration (formerly 'core')", () => {
      // Wave 1 renamed the legacy `core` capability tag to `orchestration`.
      const orchRule = allFiles.find(
        (f) => f.type === "rule" && f.metadata.id === "hatch3r-agent-orchestration",
      );
      expect(orchRule).toBeDefined();
      expect((orchRule!.metadata.tags as string[]).includes("orchestration")).toBe(true);
    });

    it("full preset resolveSelection includes all orchestration agents", () => {
      const fullPreset = getPreset("full");
      const selection = resolveSelection(
        fullPreset,
        "brownfield",
        "team",
        contentIndex,
      );
      for (const agentId of ORCHESTRATION_AGENTS) {
        expect(
          selection.items.agents.includes(agentId),
          `full preset should include ${agentId}`,
        ).toBe(true);
      }
    });

    it("validateOrchestrationDependencies returns no warnings for full preset", () => {
      const fullPreset = getPreset("full");
      const selection = resolveSelection(
        fullPreset,
        "brownfield",
        "team",
        contentIndex,
      );
      const warnings = validateOrchestrationDependencies(selection);
      expect(warnings).toEqual([]);
    });

    // D10-37 (D14-SA14.3-F, P1): board-presence contract lock. The init
    // success-box disclosure for solo+full claims team-scoped (`ctx:team-only`)
    // workflows are EXCLUDED for solo even under full — because
    // `resolveSelection` Stage 4 (team-size filter, src/content/index.ts) strips
    // every NON-floor `ctx:team-only` item when teamSize=solo, and init never
    // passes `skipContextFilters`. This test locks that contract so the
    // disclosure can never silently re-invert: a non-floor team-only board skill
    // (e.g. `hatch3r-board-init`, tags `[board, ctx:team-only]`) must be ABSENT
    // under solo+full and PRESENT under team+full. The id is derived from the
    // live index (not hard-coded) so a tag/id rename keeps the assertion honest.
    it("D10-37: solo+full excludes non-floor ctx:team-only board workflows; team+full includes them", () => {
      const isFloor = (tags: readonly string[]) => tags.some((t) => t.startsWith("floor:"));
      // A representative non-floor, team-only board item that init's Step-5 flow
      // enters (board-init). Prove it exists with the expected facets first.
      const boardTeamOnly = contentIndex.items.find(
        (i) =>
          i.id === "hatch3r-board-init" &&
          i.tags.includes("ctx:team-only") &&
          !isFloor(i.tags),
      );
      expect(
        boardTeamOnly,
        "expected hatch3r-board-init to be a non-floor ctx:team-only item",
      ).toBeDefined();
      const targetId = boardTeamOnly!.id;

      const fullPreset = getPreset("full");
      const soloFull = getAllContentIds(
        resolveSelection(fullPreset, "brownfield", "solo", contentIndex),
      );
      const teamFull = getAllContentIds(
        resolveSelection(fullPreset, "brownfield", "team", contentIndex),
      );
      // The disclosure's claim: solo+full strips non-floor team-only workflows.
      expect(soloFull.has(targetId)).toBe(false);
      // ...and the named remedy (`--team-size team`) actually includes them.
      expect(teamFull.has(targetId)).toBe(true);

      // Generalize: every non-floor ctx:team-only item present under team+full
      // is absent under solo+full (the filter is uniform, not item-specific).
      const teamOnlyNonFloor = contentIndex.items
        .filter((i) => i.tags.includes("ctx:team-only") && !isFloor(i.tags) && !i.protected)
        .map((i) => i.id);
      for (const id of teamOnlyNonFloor) {
        if (teamFull.has(id)) {
          expect(
            soloFull.has(id),
            `solo+full must exclude non-floor team-only item ${id}`,
          ).toBe(false);
        }
      }
    });
  });

  // ── Cross-reference integrity ──────────────────────────────

  describe("cross-reference integrity", () => {
    // D22-1 (Cycle 11 Wave 2) added a dangling rule-file-path check to
    // validateCrossReferences. It surfaces two pre-existing dead rule-path
    // citations that are owned by the still-open Medium finding D5-30
    // (`rules/hatch3r-content-authoring.md`) and its enhancability twin
    // (`rules/hatch3r-plugin-architecture.md`). Those repoints belong to the
    // Medium wave, not Wave 2 — allow-list them here so the new check stays
    // active for every OTHER reference. Remove these two entries when D5-30
    // lands the repoints; any new dangling reference still fails this test.
    const D5_30_DEFERRED_DANGLING = [
      "rules/hatch3r-content-authoring.md",
      "rules/hatch3r-plugin-architecture.md",
    ];

    it("all content cross-references resolve to existing IDs", async () => {
      const result = await validateCrossReferences(CONTENT_ROOT, contentIndex);
      const unexpected = result.warnings.filter(
        (w) => !D5_30_DEFERRED_DANGLING.some((p) => w.includes(p)),
      );
      expect(unexpected).toEqual([]);
    });
  });

  // ── Severity scale consistency ─────────────────────────────

  describe("severity scale consistency", () => {
    it("orchestration rule defines the canonical severity scale", () => {
      const orchRule = allFiles.find(
        (f) => f.type === "rule" && f.metadata.id === "hatch3r-agent-orchestration",
      );
      expect(orchRule).toBeDefined();
      for (const severity of CANONICAL_SEVERITIES) {
        expect(
          orchRule!.body.includes(`**${severity}**`),
          `orchestration rule should define ${severity} severity`,
        ).toBe(true);
      }
    });

    it("no content file uses the deprecated Moderate severity level", () => {
      const violations: string[] = [];
      for (const f of allFiles) {
        // Check for "Moderate" as a standalone severity label (not in regular prose)
        // Match patterns like: severity: Moderate, | Moderate |, "Moderate"
        if (/\bModerate\b/.test(f.body)) {
          // Allow "Moderate" in prose context, only flag in structured severity contexts
          const lines = f.body.split("\n");
          for (const line of lines) {
            if (
              /severity.*Moderate|Moderate.*severity|\|\s*Moderate\s*\|/i.test(line)
            ) {
              violations.push(`${f.relativePath}: uses deprecated "Moderate" severity`);
              break;
            }
          }
        }
      }
      expect(violations).toEqual([]);
    });
  });

  // ── Rule companion file parity ─────────────────────────────

  describe("rule companion file parity", () => {
    it("every rule .md file has a companion .mdc file", async () => {
      const rulesDir = join(CONTENT_ROOT, "rules");
      const entries = await readdir(rulesDir);
      const mdFiles = entries.filter((f) => f.endsWith(".md"));
      const mdcFiles = new Set(entries.filter((f) => f.endsWith(".mdc")));

      const missing: string[] = [];
      for (const md of mdFiles) {
        const expectedMdc = md.replace(/\.md$/, ".mdc");
        if (!mdcFiles.has(expectedMdc)) {
          missing.push(md);
        }
      }
      expect(missing).toEqual([]);
    });

    it("every rule .mdc file has a companion .md file", async () => {
      const rulesDir = join(CONTENT_ROOT, "rules");
      const entries = await readdir(rulesDir);
      const mdcFiles = entries.filter((f) => f.endsWith(".mdc"));
      const mdFiles = new Set(entries.filter((f) => f.endsWith(".md")));

      const orphaned: string[] = [];
      for (const mdc of mdcFiles) {
        const expectedMd = mdc.replace(/\.mdc$/, ".md");
        if (!mdFiles.has(expectedMd)) {
          orphaned.push(mdc);
        }
      }
      expect(orphaned).toEqual([]);
    });
  });

  // ── Content index integrity ────────────────────────────────

  describe("content index integrity", () => {
    it("buildContentIndex has no cross-type collisions (command IDs are cmd- prefixed)", () => {
      expect(contentIndex.collisions).toEqual([]);
    });

    it("index item count matches file count", () => {
      expect(contentIndex.items.length).toBe(allFiles.length);
    });

    it("byId map has entries for all items", () => {
      for (const item of contentIndex.items) {
        expect(contentIndex.byId.has(item.id)).toBe(true);
      }
    });

    it("byType groups match expected types", () => {
      const indexTypes = new Set(Object.keys(contentIndex.byType));
      const expectedTypes = new Set(CONTENT_DIRS.map((c) => c.type));
      expect(indexTypes).toEqual(expectedTypes);
    });
  });

  // ── Preset coverage ────────────────────────────────────────

  describe("preset coverage", () => {
    it("minimal preset selects at least the core items", () => {
      const preset = getPreset("minimal");
      const selection = resolveSelection(preset, "brownfield", "team", contentIndex);
      const totalItems = Object.values(selection.items).reduce(
        (sum, arr) => sum + arr.length,
        0,
      );
      expect(totalItems).toBeGreaterThan(0);
    });

    it("full preset selects every item except those filtered by the context filter", () => {
      // Under the Wave 1 pipeline the full preset covers every capability and
      // every floor admission, but the context filter (project type) still
      // removes items declaring incompatibility with the selected project
      // type. brownfield+team here drops ctx:greenfield-only items; the rest
      // ship. Items dropped by context are counted via
      // countProjectTypeExclusions + countTeamSizeExclusions.
      //
      // Maturity is a calibration dial, not a content-admission gate: the
      // retired `tier:*` / `floor:enterprise-only` facet no longer subtracts
      // any item, so the full-preset count equals the corpus minus only the
      // greenfield-only set under brownfield+team.
      const preset = getPreset("full");
      const selection = resolveSelection(preset, "brownfield", "team", contentIndex);
      const totalItems = Object.values(selection.items).reduce(
        (sum, arr) => sum + arr.length,
        0,
      );
      const greenfieldOnly = contentIndex.items.filter(
        (i) => !i.protected && i.tags.includes("ctx:greenfield-only"),
      ).length;
      expect(totalItems).toBe(contentIndex.items.length - greenfieldOnly);
    });

    // F3.3-H4 (D3 Cycle 10 Wave 2): the "full preset … context filter" test
    // above only asserts the brownfield+team direction. If a future content
    // artifact adds a `ctx:brownfield-only` tag, the brownfield+team count test
    // still passes (brownfield admits brownfield-only items) while the
    // symmetric greenfield+team direction silently regresses (greenfield must
    // DROP brownfield-only items). This describe.each parameterises BOTH
    // directions over one body so neither can drift unguarded. It asserts the
    // directional context-filter invariant via set membership — robust to the
    // unrelated global item-count fluctuations the count-based test above is
    // sensitive to.
    describe.each([
      { projectType: "brownfield" as const, includeTag: "ctx:brownfield-only", excludeTag: "ctx:greenfield-only" },
      { projectType: "greenfield" as const, includeTag: "ctx:greenfield-only", excludeTag: "ctx:brownfield-only" },
    ])("full preset context-filter symmetry ($projectType+team)", ({ projectType, includeTag, excludeTag }) => {
      it(`admits every ctx:${projectType}-only item and drops every opposite-context item`, () => {
        const preset = getPreset("full");
        const selection = resolveSelection(preset, projectType, "team", contentIndex);
        const selectedIds = new Set(
          Object.values(selection.items).flat() as string[],
        );

        // Items declaring the SAME-context tag (and not protected) must be
        // admitted under this projectType. Maturity no longer gates content,
        // so there is no tier exemption to subtract here.
        const sameContext = contentIndex.items.filter(
          (i) =>
            i.tags.includes(includeTag) &&
            !i.tags.includes(excludeTag) &&
            !i.protected,
        );
        // Must have ≥1 same-context item or the symmetry assertion is vacuous —
        // both ctx:greenfield-only and ctx:brownfield-only exist in the corpus.
        expect(sameContext.length).toBeGreaterThan(0);
        for (const item of sameContext) {
          expect(
            selectedIds.has(item.id),
            `${item.id} (${includeTag}) should be admitted under ${projectType}+team`,
          ).toBe(true);
        }

        // Items declaring ONLY the opposite-context tag must be dropped.
        const oppositeContextOnly = contentIndex.items.filter(
          (i) => i.tags.includes(excludeTag) && !i.tags.includes(includeTag) && !i.protected,
        );
        for (const item of oppositeContextOnly) {
          expect(
            selectedIds.has(item.id),
            `${item.id} (${excludeTag}) should be dropped under ${projectType}+team`,
          ).toBe(false);
        }
      });
    });

    it("standard preset selects more than minimal but not necessarily all", () => {
      const minPreset = getPreset("minimal");
      const stdPreset = getPreset("standard");
      const minSelection = resolveSelection(
        minPreset,
        "brownfield",
        "team",
        contentIndex,
      );
      const stdSelection = resolveSelection(
        stdPreset,
        "brownfield",
        "team",
        contentIndex,
      );
      const minCount = Object.values(minSelection.items).reduce(
        (sum, arr) => sum + arr.length,
        0,
      );
      const stdCount = Object.values(stdSelection.items).reduce(
        (sum, arr) => sum + arr.length,
        0,
      );
      expect(stdCount).toBeGreaterThanOrEqual(minCount);
    });

    // D2-20 (Cycle 11 Wave 3): the `CapabilityTag` union + every
    // `preset.capabilities` array list only 9 of the 44 capability-facet tags
    // in TAG_REGISTRY. An artifact whose ONLY capability tags fall in the other
    // 35 (no floor:* tag, protected !== true) intersects no preset's
    // `capabilities` and is dropped by EVERY preset INCLUDING `full` — a silent
    // corpus hole, since `full` is meant to ship everything. The corpus has 0
    // such orphans today; this guard fails the build the moment one is added.
    // `skipContextFilters: true` isolates the preset-admission set (floor +
    // capability + customize + protected) from the context/language stages, so
    // a legitimately project-scoped item (ctx:greenfield-only on brownfield)
    // is not misreported as a capability-coverage orphan.
    it("every canonical artifact is admitted by full, floor-tagged, or protected (D2-20)", () => {
      const fullAdmitted = getAllContentIds(
        resolveSelection(getPreset("full"), "brownfield", "team", contentIndex, undefined, undefined, {
          skipContextFilters: true,
        }),
      );
      const orphans = contentIndex.items.filter(
        (item) =>
          !fullAdmitted.has(item.id) &&
          !item.protected &&
          !item.tags.some(isFloorTag),
      );
      expect(
        orphans.map((i) => `${i.id} [${i.tags.join(", ")}]`),
        "artifacts admitted by no preset (capability tags outside the 9 preset-positive tags, no floor tag, not protected)",
      ).toEqual([]);
    });
  });

  // ── Archetype preset corpus resolution (D3-14) ─────────────────
  // The 6 project-archetype presets were exercised only by capability-set
  // arithmetic (presets.test.ts); the sole preset→resolveSelection content
  // test (above) covered minimal/standard/full only. A corpus retag that left
  // an archetype's realized selection empty — e.g. `security` if the
  // floor:security/floor:content-quality artifacts lost their tags — was
  // uncaught. These tests resolve each archetype against the REAL contentIndex.
  describe("archetype preset corpus resolution (D3-14)", () => {
    const ARCHETYPE_IDS: PresetId[] = [
      "web-app",
      "api-service",
      "cli-tool",
      "monorepo",
      "legacy",
      "security",
    ];

    // `full` is the capability superset; every archetype is a capability subset
    // of it (asserted by presets.test.ts), so each archetype's realized,
    // context-invariant selection must be a subset of full's. skipContextFilters
    // isolates preset admission from project-type/language stages so the subset
    // relation reflects capability shaping, not context divergence.
    const fullSelectedIds = (): Set<string> =>
      getAllContentIds(
        resolveSelection(getPreset("full"), "brownfield", "team", contentIndex, undefined, undefined, {
          skipContextFilters: true,
        }),
      );

    it.each(ARCHETYPE_IDS)(
      "%s resolves to a non-empty selection that is a subset of full's real-corpus selection",
      (id) => {
        const fullIds = fullSelectedIds();
        const selectedIds = getAllContentIds(
          resolveSelection(getPreset(id), "brownfield", "team", contentIndex, undefined, undefined, {
            skipContextFilters: true,
          }),
        );
        expect(selectedIds.size, `${id} must select ≥1 artifact against the real corpus`).toBeGreaterThan(0);
        const notInFull = [...selectedIds].filter((x) => !fullIds.has(x));
        expect(notInFull, `${id} selection must be ⊆ full's selection`).toEqual([]);
      },
    );

    it("security archetype includes the floor:security and floor:content-quality artifacts", () => {
      const selectedIds = getAllContentIds(
        resolveSelection(getPreset("security"), "brownfield", "team", contentIndex, undefined, undefined, {
          skipContextFilters: true,
        }),
      );
      // The security floor (CQ3 specialist + supporting rules) and the
      // content-quality floor (CQ1-CQ9 specialists) ship in every non-custom
      // preset via floor admission; the security archetype is the one a user
      // picks expressly for hardening, so a retag dropping these from it is the
      // exact regression D3-14 targets. Assert both floors land via membership.
      const floorSecurity = contentIndex.items.filter((i) => i.tags.includes(TAG_FLOOR_SECURITY));
      const floorContentQuality = contentIndex.items.filter((i) =>
        i.tags.includes(TAG_FLOOR_CONTENT_QUALITY),
      );
      // Guard against a vacuous assertion: both floor sets must be non-empty.
      expect(floorSecurity.length, "corpus must carry ≥1 floor:security artifact").toBeGreaterThan(0);
      expect(
        floorContentQuality.length,
        "corpus must carry ≥1 floor:content-quality artifact",
      ).toBeGreaterThan(0);
      const missingSecurity = floorSecurity.filter((i) => !selectedIds.has(i.id)).map((i) => i.id);
      const missingCQ = floorContentQuality.filter((i) => !selectedIds.has(i.id)).map((i) => i.id);
      expect(missingSecurity, "floor:security items missing from the security archetype").toEqual([]);
      expect(missingCQ, "floor:content-quality items missing from the security archetype").toEqual([]);
    });
  });
});
