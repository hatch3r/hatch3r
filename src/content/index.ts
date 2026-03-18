import { readFile, readdir, cp, mkdir, rm } from "node:fs/promises";
import { join, dirname, normalize, isAbsolute } from "node:path";
import { parseFrontmatter } from "../adapters/canonical.js";
import { HatchError } from "../types.js";
import type { ContentSelection } from "../types.js";
import type { ContentPreset } from "./presets.js";

export function assertSafePath(relativePath: string, label: string): void {
  const normalized = normalize(relativePath);
  if (normalized.startsWith('..') || isAbsolute(normalized)) {
    throw new HatchError(`Unsafe path detected in ${label}: ${relativePath}`, 1);
  }
}

// ── Content Cross-References ───────────────────────────────────

/**
 * Extract hatch3r content IDs referenced in markdown content.
 * Looks for backtick-quoted `hatch3r-{name}` patterns.
 */
export function extractContentReferences(content: string): string[] {
  const refs = new Set<string>();
  const pattern = /`(hatch3r-[a-z0-9-]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    refs.add(match[1]);
  }
  return [...refs];
}

export interface CrossReferenceResult {
  warnings: string[];
}

/**
 * Validate cross-references between content items.
 * Parses markdown bodies for references to other content IDs and verifies
 * all referenced IDs exist in the index.
 */
export async function validateCrossReferences(
  contentRoot: string,
  index: ContentIndex,
): Promise<CrossReferenceResult> {
  const warnings: string[] = [];
  const allIds = new Set(index.items.map((item) => item.id));

  for (const item of index.items) {
    let content: string;
    try {
      const filePath =
        item.type === "skill"
          ? join(contentRoot, item.relativePath, "SKILL.md")
          : join(contentRoot, `${item.relativePath}`);
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const refs = extractContentReferences(content);
    for (const ref of refs) {
      if (ref === item.id) continue; // self-reference is fine
      if (!allIds.has(ref)) {
        warnings.push(
          `${item.type} "${item.id}" references "${ref}" which does not exist in the content index`,
        );
      }
    }
  }

  return { warnings };
}

// Agents required by the orchestration pipeline ("Always" in Agent Roster)
const ORCHESTRATION_REQUIRED_AGENTS = [
  "hatch3r-researcher",
  "hatch3r-implementer",
  "hatch3r-reviewer",
  "hatch3r-test-writer",
  "hatch3r-security-auditor",
];

/**
 * Validate that a content selection includes all agents required by the
 * orchestration pipeline. Returns warnings for missing agents.
 */
export function validateOrchestrationDependencies(
  selection: ContentSelection,
): string[] {
  const warnings: string[] = [];
  const selectedAgents = new Set(selection.items.agents);

  // Check if orchestration rule is selected
  const hasOrchestration = selection.items.rules.includes("hatch3r-agent-orchestration");
  if (!hasOrchestration) return warnings;

  for (const agentId of ORCHESTRATION_REQUIRED_AGENTS) {
    if (!selectedAgents.has(agentId)) {
      warnings.push(
        `Orchestration pipeline requires agent "${agentId}" but it is not in the content selection. ` +
        `The 4-phase pipeline (Research → Implement → Review → Quality) will be incomplete.`,
      );
    }
  }

  return warnings;
}

// ── Types ──────────────────────────────────────────────────────

export interface CatalogItem {
  id: string;
  type: "agent" | "skill" | "rule" | "command" | "prompt" | "hook" | "github-agent";
  description: string;
  tags: string[];
  protected?: boolean;
  /** For glob-strategy: relative path from content root (e.g. "agents/hatch3r-implementer.md") */
  relativePath: string;
  /** For rules: companion .mdc file path, if it exists */
  companionPath?: string;
}

export interface ContentIndex {
  items: CatalogItem[];
  byType: Record<string, CatalogItem[]>;
  byId: Map<string, CatalogItem>;
}

// ── Content type configs ───────────────────────────────────────

interface ContentTypeConfig {
  dir: string;
  type: CatalogItem["type"];
  strategy: "glob" | "subdirectory";
}

const CONTENT_TYPE_CONFIGS: ContentTypeConfig[] = [
  { dir: "agents", type: "agent", strategy: "glob" },
  { dir: "commands", type: "command", strategy: "glob" },
  { dir: "rules", type: "rule", strategy: "glob" },
  { dir: "skills", type: "skill", strategy: "subdirectory" },
  { dir: "prompts", type: "prompt", strategy: "glob" },
  { dir: "hooks", type: "hook", strategy: "glob" },
  { dir: "github-agents", type: "github-agent", strategy: "glob" },
];

// ── Build content index ────────────────────────────────────────

/**
 * Scan package content dirs, parse frontmatter, return indexed catalog.
 */
export async function buildContentIndex(contentRoot: string): Promise<ContentIndex> {
  const items: CatalogItem[] = [];

  for (const config of CONTENT_TYPE_CONFIGS) {
    const dirPath = join(contentRoot, config.dir);

    if (config.strategy === "subdirectory") {
      // Skills: each subdirectory has a SKILL.md
      let dirents: { name: string; isDirectory: () => boolean }[];
      try {
        dirents = await readdir(dirPath, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }

      for (const dirent of dirents) {
        if (!dirent.isDirectory()) continue;
        const skillPath = join(dirPath, dirent.name, "SKILL.md");
        try {
          const raw = await readFile(skillPath, "utf-8");
          const { metadata } = parseFrontmatter(raw);
          const id = metadata.id || metadata.name || dirent.name;
          items.push({
            id,
            type: config.type,
            description: metadata.description ?? "",
            tags: metadata.tags ?? [],
            protected: metadata.protected,
            relativePath: join(config.dir, dirent.name),
          });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
      }
    } else {
      // Glob: read all .md files
      let entries: string[];
      try {
        const all = await readdir(dirPath);
        entries = all.filter((f) => f.endsWith(".md"));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }

      for (const file of entries) {
        const filePath = join(dirPath, file);
        const raw = await readFile(filePath, "utf-8");
        const { metadata } = parseFrontmatter(raw);
        const id = metadata.id || metadata.name || file.replace(/\.md$/, "");

        const item: CatalogItem = {
          id,
          type: config.type,
          description: metadata.description ?? "",
          tags: metadata.tags ?? [],
          protected: metadata.protected,
          relativePath: join(config.dir, file),
        };

        // For rules, check for companion .mdc file
        if (config.type === "rule") {
          const mdcFile = file.replace(/\.md$/, ".mdc");
          try {
            await readFile(join(dirPath, mdcFile), "utf-8");
            item.companionPath = join(config.dir, mdcFile);
          } catch {
            // No companion file
          }
        }

        items.push(item);
      }
    }
  }

  // Build indexes
  const byType: Record<string, CatalogItem[]> = {};
  const byId = new Map<string, CatalogItem>();

  for (const item of items) {
    if (!byType[item.type]) byType[item.type] = [];
    byType[item.type].push(item);
    const existing = byId.get(item.id);
    if (existing && existing.type !== item.type) {
      console.warn(
        `[hatch3r] Content ID collision: "${item.id}" exists as both ${existing.type} and ${item.type}. The ${item.type} entry will shadow the ${existing.type} entry in ID lookups.`,
      );
    }
    byId.set(item.id, item);
  }

  return { items, byType, byId };
}

// ── Shared type-to-key mapping ──────────────────────────────────

export const TYPE_TO_SELECTION_KEY: Record<string, keyof ContentSelection["items"]> = {
  agent: "agents",
  skill: "skills",
  rule: "rules",
  command: "commands",
  prompt: "prompts",
  hook: "hooks",
  "github-agent": "githubAgents",
};

// ── Selection resolution ───────────────────────────────────────

/**
 * Apply preset + context filters to determine which IDs to include.
 *
 * Filtering logic:
 * 1. Start with all items from the index
 * 2. If preset has includeTags, keep only items matching ANY of those tags
 * 3. If preset has excludeTags, remove items matching ANY of those tags
 * 4. If projectType is "greenfield", remove items tagged ONLY with "brownfield"
 * 5. If projectType is "brownfield", remove items tagged ONLY with "greenfield"
 * 6. If teamSize is "solo", remove items whose ONLY tags are "team" / "board"
 * 7. Items with protected: true are always included
 * 8. For "custom" preset, use customSelections as explicit ID list
 */
export function resolveSelection(
  preset: ContentPreset,
  projectType: "greenfield" | "brownfield",
  teamSize: "solo" | "team",
  index: ContentIndex,
  customSelections?: string[],
): ContentSelection {
  let selected: CatalogItem[];

  if (preset.id === "custom" && customSelections) {
    // For custom, use explicit ID list
    const customSet = new Set(customSelections);
    selected = index.items.filter(
      (item) => customSet.has(item.id) || item.protected,
    );
  } else {
    selected = [...index.items];

    // Apply includeTags filter (if non-empty, keep only items matching ANY tag)
    if (preset.includeTags.length > 0) {
      const includeSet = new Set<string>(preset.includeTags);
      selected = selected.filter(
        (item) =>
          item.protected ||
          item.tags.length === 0 || // items without tags pass through
          item.tags.some((t) => includeSet.has(t)),
      );
    }

    // Apply excludeTags filter
    if (preset.excludeTags.length > 0) {
      const excludeSet = new Set<string>(preset.excludeTags);
      selected = selected.filter(
        (item) =>
          item.protected ||
          !item.tags.every((t) => excludeSet.has(t)),
      );
    }

    // Context filtering: project type
    if (projectType === "greenfield") {
      // Remove items tagged ONLY with "brownfield"
      selected = selected.filter(
        (item) =>
          item.protected ||
          !item.tags.includes("brownfield") ||
          item.tags.some((t) => t !== "brownfield" && t !== "team" && t !== "solo"),
      );
    } else {
      // Remove items tagged ONLY with "greenfield"
      selected = selected.filter(
        (item) =>
          item.protected ||
          !item.tags.includes("greenfield") ||
          item.tags.some((t) => t !== "greenfield" && t !== "team" && t !== "solo"),
      );
    }

    // Context filtering: team size
    if (teamSize === "solo") {
      // Remove items whose tags are exclusively team/board (no other workflow/domain tags)
      selected = selected.filter((item) => {
        if (item.protected) return true;
        if (!item.tags.includes("team") && !item.tags.includes("board")) return true;
        // Has team/board tag — keep if it has other non-context tags too
        return item.tags.some(
          (t) => t !== "team" && t !== "board" && t !== "solo" && t !== "greenfield" && t !== "brownfield",
        );
      });
    }
  }

  // Build the selection items grouped by type
  const items: ContentSelection["items"] = {
    agents: [],
    skills: [],
    rules: [],
    commands: [],
    prompts: [],
    hooks: [],
    githubAgents: [],
  };

  for (const item of selected) {
    const key = TYPE_TO_SELECTION_KEY[item.type];
    if (key) items[key].push(item.id);
  }

  return {
    preset: preset.id,
    projectType,
    teamSize,
    items,
  };
}

// ── Exclusion counting ─────────────────────────────────────────

/**
 * Count how many items a preset would exclude relative to the full item set.
 */
export function countPresetExclusions(
  preset: ContentPreset,
  index: ContentIndex,
): number {
  if (preset.id === "custom") return 0;
  if (preset.id === "full") return 0;

  let count = 0;
  for (const item of index.items) {
    if (item.protected) continue;
    // includeTags filter
    if (preset.includeTags.length > 0) {
      const includeSet = new Set<string>(preset.includeTags);
      if (item.tags.length > 0 && !item.tags.some((t) => includeSet.has(t))) {
        count++;
        continue;
      }
    }
    // excludeTags filter
    if (preset.excludeTags.length > 0) {
      const excludeSet = new Set<string>(preset.excludeTags);
      if (item.tags.every((t) => excludeSet.has(t))) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Count how many items the project type filter would remove from a pre-filtered set.
 */
export function countProjectTypeExclusions(
  projectType: "greenfield" | "brownfield",
  items: CatalogItem[],
): number {
  const opposite = projectType === "greenfield" ? "brownfield" : "greenfield";
  let count = 0;
  for (const item of items) {
    if (item.protected) continue;
    if (
      item.tags.includes(opposite) &&
      !item.tags.some((t) => t !== opposite && t !== "team" && t !== "solo")
    ) {
      count++;
    }
  }
  return count;
}

/**
 * Count how many items the team size filter would remove from a pre-filtered set.
 */
export function countTeamSizeExclusions(
  teamSize: "solo" | "team",
  items: CatalogItem[],
): number {
  if (teamSize !== "solo") return 0;
  let count = 0;
  for (const item of items) {
    if (item.protected) continue;
    if (!item.tags.includes("team") && !item.tags.includes("board")) continue;
    const hasOther = item.tags.some(
      (t) => t !== "team" && t !== "board" && t !== "solo" && t !== "greenfield" && t !== "brownfield",
    );
    if (!hasOther) count++;
  }
  return count;
}

// ── Copy selected content ──────────────────────────────────────

/**
 * Copy only selected content files from package to .agents/.
 * Returns list of relative paths copied.
 */
export async function copySelectedContent(
  contentRoot: string,
  agentsDir: string,
  selection: ContentSelection,
  index: ContentIndex,
): Promise<string[]> {
  const copied: string[] = [];

  // Collect all selected IDs
  const selectedIds = new Set<string>();
  for (const ids of Object.values(selection.items)) {
    for (const id of ids) selectedIds.add(id);
  }

  for (const item of index.items) {
    if (!selectedIds.has(item.id)) continue;

    assertSafePath(item.relativePath, "copySelectedContent");
    if (item.companionPath) {
      assertSafePath(item.companionPath, "copySelectedContent companion");
    }

    const srcPath = join(contentRoot, item.relativePath);
    const destPath = join(agentsDir, item.relativePath);

    if (item.type === "skill") {
      // Copy entire skill subdirectory
      await mkdir(destPath, { recursive: true });
      await cp(srcPath, destPath, { recursive: true, force: true });
      copied.push(item.relativePath);
    } else {
      // Copy individual .md file
      await mkdir(dirname(destPath), { recursive: true });
      await cp(srcPath, destPath, { force: true });
      copied.push(item.relativePath);

      // Copy companion .mdc file if it exists (rules)
      if (item.companionPath) {
        const mdcSrc = join(contentRoot, item.companionPath);
        const mdcDest = join(agentsDir, item.companionPath);
        try {
          await cp(mdcSrc, mdcDest, { force: true });
          copied.push(item.companionPath);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
      }
    }
  }

  // Always copy checks/ (referenced by agents, small)
  try {
    const checksSrc = join(contentRoot, "checks");
    const checksDest = join(agentsDir, "checks");
    await mkdir(checksDest, { recursive: true });
    await cp(checksSrc, checksDest, { recursive: true, force: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  // Always copy mcp/ (handled separately by init for filtering)
  try {
    const mcpSrc = join(contentRoot, "mcp");
    const mcpDest = join(agentsDir, "mcp");
    await mkdir(mcpDest, { recursive: true });
    await cp(mcpSrc, mcpDest, { recursive: true, force: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  return copied;
}

// ── Available items ────────────────────────────────────────────

/**
 * Get items available in package but not currently installed on disk.
 */
export async function getAvailableItems(
  contentRoot: string,
  agentsDir: string,
  index: ContentIndex,
): Promise<CatalogItem[]> {
  const installed = new Set<string>();

  // Scan what's on disk
  for (const config of CONTENT_TYPE_CONFIGS) {
    const dirPath = join(agentsDir, config.dir);

    if (config.strategy === "subdirectory") {
      try {
        const dirents = await readdir(dirPath, { withFileTypes: true });
        for (const d of dirents) {
          if (d.isDirectory()) {
            try {
              const raw = await readFile(join(dirPath, d.name, "SKILL.md"), "utf-8");
              const { metadata } = parseFrontmatter(raw);
              installed.add(metadata.id || metadata.name || d.name);
            } catch {
              // skip
            }
          }
        }
      } catch {
        // directory doesn't exist
      }
    } else {
      try {
        const files = await readdir(dirPath);
        for (const f of files.filter((f) => f.endsWith(".md"))) {
          const raw = await readFile(join(dirPath, f), "utf-8");
          const { metadata } = parseFrontmatter(raw);
          installed.add(metadata.id || metadata.name || f.replace(/\.md$/, ""));
        }
      } catch {
        // directory doesn't exist
      }
    }
  }

  return index.items.filter((item) => !installed.has(item.id));
}

// ── Build selections from disk ─────────────────────────────────

/**
 * Scan .agents/ to build a ContentSelection from what's on disk.
 * Used for legacy migration — converts "everything installed" to explicit tracking.
 */
export async function buildSelectionsFromDisk(
  agentsDir: string,
): Promise<ContentSelection> {
  const items: ContentSelection["items"] = {
    agents: [],
    skills: [],
    rules: [],
    commands: [],
    prompts: [],
    hooks: [],
    githubAgents: [],
  };

  for (const config of CONTENT_TYPE_CONFIGS) {
    const dirPath = join(agentsDir, config.dir);
    const key = TYPE_TO_SELECTION_KEY[config.type];
    if (!key) continue;

    if (config.strategy === "subdirectory") {
      try {
        const dirents = await readdir(dirPath, { withFileTypes: true });
        for (const d of dirents) {
          if (!d.isDirectory()) continue;
          try {
            const raw = await readFile(join(dirPath, d.name, "SKILL.md"), "utf-8");
            const { metadata } = parseFrontmatter(raw);
            items[key].push(metadata.id || metadata.name || d.name);
          } catch {
            // skip
          }
        }
      } catch {
        // directory doesn't exist
      }
    } else {
      try {
        const files = await readdir(dirPath);
        for (const f of files.filter((f) => f.endsWith(".md"))) {
          const raw = await readFile(join(dirPath, f), "utf-8");
          const { metadata } = parseFrontmatter(raw);
          items[key].push(metadata.id || metadata.name || f.replace(/\.md$/, ""));
        }
      } catch {
        // directory doesn't exist
      }
    }
  }

  return {
    preset: "full",
    projectType: "brownfield",
    teamSize: "team",
    items,
  };
}

// ── Content item add/remove ────────────────────────────────────

/**
 * Add a single content item from the package to .agents/.
 */
export async function addContentItem(
  contentRoot: string,
  agentsDir: string,
  item: CatalogItem,
): Promise<void> {
  assertSafePath(item.relativePath, "addContentItem");
  if (item.companionPath) {
    assertSafePath(item.companionPath, "addContentItem companion");
  }

  const srcPath = join(contentRoot, item.relativePath);
  const destPath = join(agentsDir, item.relativePath);

  try {
    if (item.type === "skill") {
      await mkdir(destPath, { recursive: true });
      await cp(srcPath, destPath, { recursive: true, force: true });
    } else {
      await mkdir(dirname(destPath), { recursive: true });
      await cp(srcPath, destPath, { force: true });

      if (item.companionPath) {
        try {
          await cp(
            join(contentRoot, item.companionPath),
            join(agentsDir, item.companionPath),
            { force: true },
          );
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new HatchError(
        `Content "${item.id}" (${item.type}) not found in package at ${item.relativePath}. ` +
        `It may have been renamed or removed in this hatch3r version.`,
        1,
      );
    }
    throw err;
  }
}

/**
 * Remove a single content item from .agents/ and optionally clean up customization files.
 */
export async function removeContentItem(
  agentsDir: string,
  item: CatalogItem,
  options?: { rootDir?: string },
): Promise<void> {
  assertSafePath(item.relativePath, "removeContentItem");
  if (item.companionPath) {
    assertSafePath(item.companionPath, "removeContentItem companion");
  }

  const destPath = join(agentsDir, item.relativePath);

  if (item.type === "skill") {
    await rm(destPath, { recursive: true, force: true });
  } else {
    await rm(destPath, { force: true });

    if (item.companionPath) {
      await rm(join(agentsDir, item.companionPath), { force: true });
    }
  }

  // Clean up customize files if rootDir provided
  if (options?.rootDir) {
    const typeToDir: Record<string, string> = {
      agent: "agents",
      skill: "skills",
      rule: "rules",
      command: "commands",
    };
    const customDir = typeToDir[item.type];
    if (customDir) {
      const yamlPath = join(options.rootDir, ".hatch3r", customDir, `${item.id}.customize.yaml`);
      const mdPath = join(options.rootDir, ".hatch3r", customDir, `${item.id}.customize.md`);
      await rm(yamlPath, { force: true });
      await rm(mdPath, { force: true });
    }
  }
}

/**
 * Get all content IDs from a ContentSelection as a flat Set.
 */
export function getAllContentIds(selection: ContentSelection): Set<string> {
  const ids = new Set<string>();
  for (const arr of Object.values(selection.items)) {
    for (const id of arr) ids.add(id);
  }
  return ids;
}

/**
 * Get total count of selected items.
 */
export function countSelectionItems(selection: ContentSelection): number {
  return Object.values(selection.items).reduce((sum, arr) => sum + arr.length, 0);
}

/**
 * Get a summary string of selection items by type.
 */
export function selectionSummary(selection: ContentSelection): string {
  const parts: string[] = [];
  const { items } = selection;
  if (items.agents.length > 0) parts.push(`${items.agents.length} agents`);
  if (items.skills.length > 0) parts.push(`${items.skills.length} skills`);
  if (items.rules.length > 0) parts.push(`${items.rules.length} rules`);
  if (items.commands.length > 0) parts.push(`${items.commands.length} commands`);
  if (items.prompts.length > 0) parts.push(`${items.prompts.length} prompts`);
  if (items.hooks.length > 0) parts.push(`${items.hooks.length} hooks`);
  if (items.githubAgents.length > 0) parts.push(`${items.githubAgents.length} github-agents`);
  return parts.join(", ");
}
