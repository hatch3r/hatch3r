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
import { ALL_TAGS } from "../../content/tags.js";
import {
  buildContentIndex,
  validateCrossReferences,
  validateOrchestrationDependencies,
  resolveSelection,
  type ContentIndex,
} from "../../content/index.js";
import { getPreset } from "../../content/presets.js";
import type { ContentSelection } from "../../types.js";

// ── Constants ──────────────────────────────────────────────────

const PROJECT_ROOT = resolve(import.meta.dirname, "../../../");
const CONTENT_ROOT = PROJECT_ROOT; // Content lives at repo root

const CONTENT_DIRS: { dir: string; type: string; strategy: "glob" | "subdirectory" }[] = [
  { dir: "agents", type: "agent", strategy: "glob" },
  { dir: "commands", type: "command", strategy: "glob" },
  { dir: "rules", type: "rule", strategy: "glob" },
  { dir: "skills", type: "skill", strategy: "subdirectory" },
  { dir: "prompts", type: "prompt", strategy: "glob" },
  { dir: "hooks", type: "hook", strategy: "glob" },
  { dir: "github-agents", type: "github-agent", strategy: "glob" },
];

// Agents required by the orchestration pipeline
const ORCHESTRATION_AGENTS = [
  "hatch3r-researcher",
  "hatch3r-implementer",
  "hatch3r-reviewer",
  "hatch3r-test-writer",
  "hatch3r-security-auditor",
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

    it("at least one content file uses the core tag", () => {
      const coreFiles = allFiles.filter(
        (f) => Array.isArray(f.metadata.tags) && f.metadata.tags.includes("core"),
      );
      expect(coreFiles.length).toBeGreaterThan(0);
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
      expect(commands.length).toBeGreaterThanOrEqual(34);
    });

    it("has prompt content files", () => {
      const prompts = allFiles.filter((f) => f.type === "prompt");
      expect(prompts.length).toBeGreaterThanOrEqual(3);
    });

    it("has hook content files", () => {
      const hooks = allFiles.filter((f) => f.type === "hook");
      expect(hooks.length).toBeGreaterThanOrEqual(6);
    });

    it("has github-agent content files", () => {
      const ghAgents = allFiles.filter((f) => f.type === "github-agent");
      expect(ghAgents.length).toBeGreaterThanOrEqual(4);
    });

    it("all seven content type directories are represented", () => {
      const types = new Set(allFiles.map((f) => f.type));
      expect(types).toEqual(
        new Set(["agent", "command", "rule", "skill", "prompt", "hook", "github-agent"]),
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

    it("orchestration rule exists and is tagged as core", () => {
      const orchRule = allFiles.find(
        (f) => f.type === "rule" && f.metadata.id === "hatch3r-agent-orchestration",
      );
      expect(orchRule).toBeDefined();
      expect((orchRule!.metadata.tags as string[]).includes("core")).toBe(true);
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
  });

  // ── Cross-reference integrity ──────────────────────────────

  describe("cross-reference integrity", () => {
    it("all content cross-references resolve to existing IDs", async () => {
      const result = await validateCrossReferences(CONTENT_ROOT, contentIndex);
      expect(result.warnings).toEqual([]);
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

    it("full preset selects all content items", () => {
      const preset = getPreset("full");
      const selection = resolveSelection(preset, "brownfield", "team", contentIndex);
      const totalItems = Object.values(selection.items).reduce(
        (sum, arr) => sum + arr.length,
        0,
      );
      expect(totalItems).toBe(contentIndex.items.length);
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
  });
});
