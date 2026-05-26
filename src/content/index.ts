import { readFile, readdir, cp, mkdir, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname, normalize, isAbsolute, posix } from "node:path";
import { parseFrontmatter } from "../adapters/canonical.js";
import { extractAdaptersFrontmatter } from "./frontmatter.js";
import { atomicWriteFile } from "../merge/safeWrite.js";
import {
  PLATFORM_TOOL_MARKER,
  substituteCanonicalPlatformMarker,
} from "../pipeline/adapterToolTranslator.js";
import { HatchError } from "../types.js";
import type { ContentSelection } from "../types.js";
import type { ContentPreset } from "./presets.js";
import {
  TAG_CTX_BROWNFIELD_ONLY,
  TAG_CTX_GREENFIELD_ONLY,
  TAG_CTX_TEAM_ONLY,
  filterByLanguages,
  isCapabilityTag,
  isCustomizeTag,
  isFloorTag,
} from "./tags.js";
import { verbose } from "../cli/shared/ui.js";

/**
 * Record a content-probe failure: emit a verbose() line to stderr (visible
 * only with --verbose). Per D8-H8.4.6 (C9-H19) Silent Failure Contract — probes
 * for "does file/dir exist?" cannot push to caller warnings channels (none are
 * wired through buildContentIndex / buildSelectionsFromDisk), so verbose() is
 * the minimum-viable diagnostic surface.
 */
function recordContentProbeFailure(operation: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  verbose(`content: ${operation} — ${message}`);
}

/**
 * Validate that a relative path does not escape its base directory.
 *
 * Throws a HatchError if the path contains directory traversal (`..`),
 * is absolute, or contains null bytes. Used to prevent path injection
 * during content copy and install operations.
 */
export function assertSafePath(relativePath: string, label: string): void {
  // Strip null bytes before validation — prevents null byte injection bypasses
  const sanitized = relativePath.replace(/\0/g, '');
  const normalized = normalize(sanitized);
  if (normalized.startsWith('..') || isAbsolute(normalized)) {
    throw new HatchError(`Unsafe path detected in ${label}: ${relativePath}`, 1, "FS_ERROR");
  }
  if (sanitized !== relativePath) {
    throw new HatchError(`Unsafe path detected in ${label}: ${relativePath}`, 1, "FS_ERROR");
  }
}

// ── Content Cross-References ───────────────────────────────────

/**
 * Extract hatch3r content IDs referenced in markdown content.
 * Looks for backtick-quoted `hatch3r-{name}` patterns.
 *
 * Conservative scope: only matches the `hatch3r-`/`cmd-hatch3r-` namespace.
 * Broadening this regex to plain kebab-case identifiers would generate false
 * positives across the canonical corpus (every backticked CLI flag, package
 * name, etc.). User-tier artifacts use a separate, opt-in scanner — see
 * {@link extractUserContentReferences} — applied only to user bodies during
 * D20 cross-reference checks.
 */
export function extractContentReferences(content: string): string[] {
  const refs = new Set<string>();
  const pattern = /`((?:cmd-)?hatch3r-[a-z0-9-]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    refs.add(match[1]);
  }
  return [...refs];
}

/**
 * D20 user-tier reference scanner. Picks up plain kebab-case identifiers
 * inside `[[wikilinks]]` or fenced ``` ``` ``` code blocks ONLY — never the
 * full body text — to keep the false-positive rate near zero on natural
 * prose. Used by validation when checking that a user artifact's
 * cross-references resolve in the merged canonical+user index.
 *
 * Includes canonical hatch3r-* / cmd-hatch3r-* IDs as well so a user
 * artifact that depends on a canonical agent surfaces in the same
 * dependency graph.
 */
export function extractUserContentReferences(content: string): string[] {
  const refs = new Set<string>();
  // Wikilinks: [[my-id]] or [[my-id|label]]
  const wiki = /\[\[([a-z][a-z0-9-]*)(?:\|[^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = wiki.exec(content)) !== null) {
    refs.add(m[1]);
  }
  // Backticked canonical IDs (same as extractContentReferences).
  for (const ref of extractContentReferences(content)) {
    refs.add(ref);
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
      // Check both the raw ref and the cmd-prefixed form (command IDs are prefixed during indexing)
      if (!allIds.has(ref) && !allIds.has(`${COMMAND_ID_PREFIX}${ref}`)) {
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
  /**
   * Provenance of the catalog item. Always set: "canonical" for items scanned
   * from the package content root, "user" for items scanned from
   * `.hatch3r/overrides/` (D20 user-content authoring).
   */
  source: "canonical" | "user";
  /**
   * When present, restricts which platform adapters emit this artifact. Only
   * meaningful for source: "user" items; empty / omitted = full parity.
   */
  adapters?: string[];
}

export interface ContentCollision {
  id: string;
  kind: "cross-type" | "same-type" | "user-shadow-canonical";
  existingType: CatalogItem["type"];
  existingPath: string;
  duplicateType: CatalogItem["type"];
  duplicatePath: string;
}

export interface ContentIndex {
  items: CatalogItem[];
  byType: Record<string, CatalogItem[]>;
  byId: Map<string, CatalogItem>;
  /**
   * Collision-safe lookup: `"type:id"` → CatalogItem.
   * Use this when the content type is known to avoid cross-type ID shadows.
   * Key format: `"agent:hatch3r-implementer"`, `"skill:hatch3r-recipe"`, etc.
   */
  byTypeAndId: Map<string, CatalogItem>;
  /** Structured records of ID collisions detected during indexing. */
  collisions: ContentCollision[];
}

/**
 * Build a composite key for the `byTypeAndId` map.
 */
export function typeIdKey(type: CatalogItem["type"], id: string): string {
  return `${type}:${id}`;
}

/**
 * Get all items matching an ID, across all content types.
 * Unlike `byId.get()` which returns only the last-indexed item for a colliding ID,
 * this returns every item that shares the given ID (typically 1, but 2+ when
 * a command and skill share the same name).
 */
export function getAllItemsById(index: ContentIndex, id: string): CatalogItem[] {
  return index.items.filter((item) => item.id === id);
}

// ── Command ID prefix ─────────────────────────────────────────

/**
 * Prefix applied to command-type content IDs to prevent cross-type
 * collisions (e.g. a command and skill sharing the same base name).
 */
export const COMMAND_ID_PREFIX = "cmd-";

/**
 * Apply the command ID prefix if the content type is "command".
 * Other content types are returned unchanged.
 */
export function applyCommandPrefix(id: string, type: string): string {
  return type === "command" ? `${COMMAND_ID_PREFIX}${id}` : id;
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
 * Scan one content root (canonical or user) according to CONTENT_TYPE_CONFIGS
 * and append discovered items to `items`. Tags every appended item with the
 * supplied `source` provenance.
 *
 * For user-tier items the optional frontmatter `adapters: [...]` array is
 * captured on `item.adapters` so adapter filters can honour parity opt-outs.
 */
async function scanContentRoot(
  rootPath: string,
  source: "canonical" | "user",
  items: CatalogItem[],
): Promise<void> {
  for (const config of CONTENT_TYPE_CONFIGS) {
    // User-tier scan only covers the 5 authoring types (agent/skill/rule/
    // command/hook). Prompts and github-agents are framework-only.
    if (source === "user" && config.type !== "agent" && config.type !== "skill" && config.type !== "rule" && config.type !== "command" && config.type !== "hook") {
      continue;
    }

    const dirPath = join(rootPath, config.dir);

    if (config.strategy === "subdirectory") {
      // Skills: each subdirectory has a SKILL.md
      let dirents: { name: string; isDirectory: () => boolean }[];
      try {
        dirents = (await readdir(dirPath, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
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
          const rawId = metadata.id || metadata.name || dirent.name;
          const id = applyCommandPrefix(rawId, config.type);
          const item: CatalogItem = {
            id,
            type: config.type,
            description: metadata.description ?? "",
            tags: metadata.tags ?? [],
            protected: metadata.protected,
            relativePath: posix.join(config.dir, dirent.name),
            source,
          };
          if (source === "user") {
            const adapters = extractAdaptersFrontmatter(raw);
            if (adapters) item.adapters = adapters;
          }
          items.push(item);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
      }
    } else {
      // Glob: read all .md files
      let entries: string[];
      try {
        const all = await readdir(dirPath);
        entries = all.filter((f) => f.endsWith(".md")).sort();
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }

      for (const file of entries) {
        const filePath = join(dirPath, file);
        const raw = await readFile(filePath, "utf-8");
        const { metadata } = parseFrontmatter(raw);
        const rawId = metadata.id || metadata.name || file.replace(/\.md$/, "");
        const id = applyCommandPrefix(rawId, config.type);

        const item: CatalogItem = {
          id,
          type: config.type,
          description: metadata.description ?? "",
          tags: metadata.tags ?? [],
          protected: metadata.protected,
          relativePath: posix.join(config.dir, file),
          source,
        };

        // For rules, check for companion .mdc file
        if (config.type === "rule") {
          const mdcFile = file.replace(/\.md$/, ".mdc");
          try {
            await readFile(join(dirPath, mdcFile), "utf-8");
            item.companionPath = posix.join(config.dir, mdcFile);
          } catch (err) {
            recordContentProbeFailure(
              `buildContentIndex: no companion .mdc for ${file}`,
              err,
            );
          }
        }

        if (source === "user") {
          const adapters = extractAdaptersFrontmatter(raw);
          if (adapters) item.adapters = adapters;
        }

        items.push(item);
      }
    }
  }
}

/**
 * Scan package content dirs, parse frontmatter, return indexed catalog.
 *
 * When `options.userRoot` is provided and that directory exists, the user
 * subtree (`{userRoot}/{type}/`) is scanned with the same dual glob /
 * subdirectory strategy as canonical content. User items are tagged with
 * `source: "user"` and may carry an `adapters[]` filter parsed from their
 * frontmatter; canonical items are tagged `source: "canonical"`.
 *
 * Existing call sites that pass only `contentRoot` keep their current
 * behaviour — the user scan is opt-in via the second argument.
 */
export async function buildContentIndex(
  contentRoot: string,
  options?: { userRoot?: string },
): Promise<ContentIndex> {
  const items: CatalogItem[] = [];

  await scanContentRoot(contentRoot, "canonical", items);

  if (options?.userRoot) {
    let userRootExists = true;
    try {
      await stat(options.userRoot);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        userRootExists = false;
      } else {
        throw err;
      }
    }
    if (userRootExists) {
      await scanContentRoot(options.userRoot, "user", items);
    }
  }

  // Build indexes
  const byType: Record<string, CatalogItem[]> = {};
  const byId = new Map<string, CatalogItem>();
  const byTypeAndId = new Map<string, CatalogItem>();
  const collisions: ContentCollision[] = [];

  for (const item of items) {
    if (!byType[item.type]) byType[item.type] = [];
    byType[item.type].push(item);

    // Collision-safe type-qualified lookup (never shadows)
    byTypeAndId.set(typeIdKey(item.type, item.id), item);

    const existing = byId.get(item.id);
    if (existing) {
      // D20: user-shadow-canonical takes precedence over the existing kinds
      // when a user-tier item collides with a canonical item — the framework
      // namespace is reserved and shadowing it must surface as an error.
      let kind: ContentCollision["kind"];
      if (existing.source !== item.source) {
        kind = "user-shadow-canonical";
      } else if (existing.type !== item.type) {
        kind = "cross-type";
      } else {
        kind = "same-type";
      }
      collisions.push({
        id: item.id,
        kind,
        existingType: existing.type,
        existingPath: existing.relativePath,
        duplicateType: item.type,
        duplicatePath: item.relativePath,
      });
      if (kind === "user-shadow-canonical") {
        console.warn(
          `[hatch3r] User content "${item.id}" shadows a canonical artifact (${existing.type} at ${existing.relativePath}). User IDs must not collide with the hatch3r-* / cmd-hatch3r-* canonical namespace.`,
        );
      } else if (kind === "cross-type") {
        console.warn(
          `[hatch3r] Content ID collision: "${item.id}" exists as both ${existing.type} (${existing.relativePath}) and ${item.type} (${item.relativePath}). Use index.byTypeAndId for collision-safe lookup.`,
        );
      } else {
        console.warn(
          `[hatch3r] Duplicate content ID: "${item.id}" found in ${existing.relativePath} and ${item.relativePath}. The later entry will shadow the earlier one in ID lookups.`,
        );
      }
    }
    byId.set(item.id, item);
  }

  return { items, byType, byId, byTypeAndId, collisions };
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
 * Four-stage pipeline (Wave 1 of content-pack redesign; see
 * `.audit-workspace/council-D-architect.md` §3):
 *
 *   1. Custom path — explicit ID list plus protected + floor passthrough.
 *      For `preset.id === "custom"` with `customSelections` provided.
 *   2. Floor admission — items carrying any `isFloorTag(t)` tag (or
 *      `protected: true`) are admitted unconditionally for every non-custom
 *      preset. Structural invariant: a preset cannot disable floor admission.
 *   3. Capability gate — non-floor items pass when their capability tags
 *      intersect the preset's `capabilities` positive list. Customize-family
 *      items (carrying `TAG_CUSTOMIZE`) pass only when `preset.includeCustomize`
 *      is true. Per-id `includeIds` / `excludeIds` provide additive /
 *      subtractive carve-outs but cannot remove floor or protected items.
 *      Items with zero capability tags AND zero floor tags AND not protected
 *      AND not in `includeIds` are DROPPED — this is a deliberate reversal
 *      of the v1 "empty tags = passthrough" loophole.
 *   4. Context filter — remove items whose context tags are incompatible
 *      with the project type. Team-size filter applies to `ctx:team-only`
 *      items but is bypassed for floor-admitted items (security & UI/UX
 *      apply to everyone, even solo developers).
 *   5. Language filter — unchanged from v1; see `filterByLanguages`.
 *
 * Skipped when `options.skipContextFilters` is set (e.g. from
 * `hatch3r config` — the user is explicitly choosing a preset and should
 * not have items silently removed by stored context filters).
 */
export function resolveSelection(
  preset: ContentPreset,
  projectType: "greenfield" | "brownfield",
  teamSize: "solo" | "team",
  index: ContentIndex,
  customSelections?: string[],
  projectLanguages?: string[],
  options?: { skipContextFilters?: boolean },
): ContentSelection {
  let selected: CatalogItem[];

  // ── Stage 1: Custom path ──
  if (preset.id === "custom" && customSelections) {
    const customSet = new Set(customSelections);
    selected = index.items.filter(
      (item) =>
        customSet.has(item.id) ||
        item.protected ||
        item.tags.some(isFloorTag), // floor still applies to custom
    );
  } else {
    // ── Stage 2: Floor admission (structural invariant) ──
    // Any item carrying a floor:* tag is admitted unconditionally for every
    // non-custom preset. No preset can remove a floor-tagged item via
    // configuration — only by removing the tag at the source artifact.
    const admitted = new Set<string>();
    for (const item of index.items) {
      if (item.protected || item.tags.some(isFloorTag)) {
        admitted.add(item.id);
      }
    }

    // ── Stage 3: Capability gate ──
    // Non-floor items pass when their capability tags intersect the preset's
    // capabilities. The customize facet is gated by preset.includeCustomize.
    // Items with zero capability tags AND not in includeIds are NOT admitted —
    // that's a deliberate reversal of the v1 "empty tags = passthrough"
    // loophole; surfacing tagging mistakes is the point.
    const capSet = new Set<string>(preset.capabilities);
    const includeIdSet = new Set<string>(preset.includeIds ?? []);
    const excludeIdSet = new Set<string>(preset.excludeIds ?? []);

    for (const item of index.items) {
      if (admitted.has(item.id)) continue;
      // excludeIds is subtractive but cannot remove floor / protected items —
      // those were already added to `admitted` above and are skipped here.
      if (excludeIdSet.has(item.id)) continue;

      const itemCapabilities = item.tags.filter(isCapabilityTag);
      const hasMatchingCapability = itemCapabilities.some((t) => capSet.has(t));
      const isCustomizeItem = item.tags.some(isCustomizeTag);

      if (hasMatchingCapability) {
        admitted.add(item.id);
      } else if (isCustomizeItem && preset.includeCustomize) {
        admitted.add(item.id);
      } else if (includeIdSet.has(item.id)) {
        admitted.add(item.id);
      }
    }

    selected = index.items.filter((item) => admitted.has(item.id));
  }

  // ── Stage 4: Context filter (technical compatibility, not preferences) ──
  if (!options?.skipContextFilters) {
    selected = selected.filter((item) => {
      if (item.protected) return true;

      // Project-type compatibility applies even to floor-admitted items —
      // a brownfield-migration helper is technically meaningless on greenfield.
      if (projectType === "greenfield" && item.tags.includes(TAG_CTX_BROWNFIELD_ONLY)) {
        return false;
      }
      if (projectType === "brownfield" && item.tags.includes(TAG_CTX_GREENFIELD_ONLY)) {
        return false;
      }

      // Team-size compatibility. Floor-admitted items bypass team-size
      // filtering — a security or UI/UX item that happens to be team-shaped
      // still ships for solo developers (the floor invariant wins). Replaces
      // the v1 `full`-preset carve-out: same effect, structural mechanism
      // (floor tag) instead of a hard-coded preset id check.
      const isFloor = item.tags.some(isFloorTag);
      if (!isFloor && teamSize === "solo" && item.tags.includes(TAG_CTX_TEAM_ONLY)) {
        return false;
      }
      return true;
    });
  }

  // ── Stage 5: Language filter (Finding #71) ──
  // Items with language tags (lang:*) are only included when the project's
  // detected languages match. Items without any language tags pass through
  // (language-agnostic content). Skipped when skipContextFilters is set.
  if (!options?.skipContextFilters && projectLanguages && projectLanguages.length > 0) {
    selected = filterByLanguages(selected, projectLanguages);
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
 *
 * Wave 1 semantics: an item is excluded when it is not admitted by either
 * floor admission, the capability gate, or the customize/includeIds carve-outs.
 * Protected and floor-tagged items are never counted as excluded.
 */
export function countPresetExclusions(
  preset: ContentPreset,
  index: ContentIndex,
): number {
  if (preset.id === "custom") return 0;
  if (preset.id === "full") return 0;

  const capSet = new Set<string>(preset.capabilities);
  const includeIdSet = new Set<string>(preset.includeIds ?? []);
  const excludeIdSet = new Set<string>(preset.excludeIds ?? []);

  let count = 0;
  for (const item of index.items) {
    if (item.protected) continue;
    if (item.tags.some(isFloorTag)) continue;
    if (excludeIdSet.has(item.id)) {
      count++;
      continue;
    }
    const hasMatchingCapability = item.tags
      .filter(isCapabilityTag)
      .some((t) => capSet.has(t));
    if (hasMatchingCapability) continue;
    if (item.tags.some(isCustomizeTag) && preset.includeCustomize) continue;
    if (includeIdSet.has(item.id)) continue;
    count++;
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
  const oppositeTag =
    projectType === "greenfield" ? TAG_CTX_BROWNFIELD_ONLY : TAG_CTX_GREENFIELD_ONLY;
  let count = 0;
  for (const item of items) {
    if (item.protected) continue;
    if (item.tags.includes(oppositeTag)) count++;
  }
  return count;
}

/**
 * Count how many items the team size filter would remove from a pre-filtered set.
 *
 * Wave 1 semantics: removes items carrying `ctx:team-only` for solo developers,
 * but bypasses floor-admitted items (the floor invariant ships UI/UX and security
 * for everyone, including solo). Returned count is an upper bound — callers use
 * it for pre-prompt UX hints before the preset is known.
 */
export function countTeamSizeExclusions(
  teamSize: "solo" | "team",
  items: CatalogItem[],
): number {
  if (teamSize !== "solo") return 0;
  let count = 0;
  for (const item of items) {
    if (item.protected) continue;
    if (item.tags.some(isFloorTag)) continue;
    if (item.tags.includes(TAG_CTX_TEAM_ONLY)) count++;
  }
  return count;
}

// ── Copy selected content ──────────────────────────────────────

/**
 * C7.5-W2B2-H7: Compute SHA-256 of a file's bytes. Returns null when the
 * file is absent or unreadable — callers treat a null hash as "no prior
 * content to diff against" so the subsequent copy is an unconditional
 * first write rather than a silent overwrite of user edits.
 */
async function sha256OfFile(filePath: string): Promise<string | null> {
  try {
    const buf = await readFile(filePath);
    return createHash("sha256").update(buf).digest("hex");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    // Permission or I/O errors propagate as null — the overwrite warning
    // pathway does not treat these as user edits; the subsequent cp call
    // will surface the underlying error if the destination is truly
    // unwritable.
    return null;
  }
}

/**
 * C7.5-W2B2-H7: Compare the pending source copy with the existing
 * destination. Returns a warning string when the destination exists and
 * its bytes differ from the source (user edit), otherwise null.
 */
async function detectUserEditOverwrite(
  srcPath: string,
  destPath: string,
  relativePath: string,
): Promise<string | null> {
  // Skip when destination does not exist — nothing to overwrite.
  let destStat;
  try {
    destStat = await stat(destPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
  if (!destStat.isFile()) return null;

  const [srcHash, destHash] = await Promise.all([
    sha256OfFile(srcPath),
    sha256OfFile(destPath),
  ]);
  if (srcHash === null || destHash === null) return null;
  if (srcHash === destHash) return null;

  return (
    `Overwriting locally-edited canonical file "${relativePath}" with package content. ` +
    `Canonical files under .agents/ are regenerated on each sync/init — place ` +
    `project-specific customizations under .hatch3r/ instead.`
  );
}

/**
 * Copy only selected content files from package to .agents/.
 *
 * Returns list of relative paths copied.
 *
 * C7.5-W2B2-H7 (D2-SA2.6-5): pass `options.warnings` to receive a warning
 * for every .md/.mdc file whose destination bytes differ from the source
 * before the overwrite. User edits in `.agents/` are expected to be
 * regenerable; the warning points operators at `.hatch3r/` overrides so
 * they do not silently lose customizations during sync/init.
 */
export async function copySelectedContent(
  contentRoot: string,
  agentsDir: string,
  selection: ContentSelection,
  index: ContentIndex,
  options?: { warnings?: string[] },
): Promise<string[]> {
  const copied: string[] = [];
  const warnings = options?.warnings;

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
      if (warnings) {
        const w = await detectUserEditOverwrite(srcPath, destPath, item.relativePath);
        if (w) warnings.push(w);
      }
      await cp(srcPath, destPath, { force: true });
      copied.push(item.relativePath);

      // Copy companion .mdc file if it exists (rules)
      if (item.companionPath) {
        const mdcSrc = join(contentRoot, item.companionPath);
        const mdcDest = join(agentsDir, item.companionPath);
        try {
          if (warnings) {
            const w = await detectUserEditOverwrite(mdcSrc, mdcDest, item.companionPath);
            if (w) warnings.push(w);
          }
          await cp(mdcSrc, mdcDest, { force: true });
          copied.push(item.companionPath);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
      }
    }
  }

  // Always copy support subdirectories (non-hatch3r-prefixed dirs inside glob-strategy content types)
  // These are shared/companion files referenced by agents and commands (e.g. agents/shared/, agents/modes/, commands/board/)
  for (const config of CONTENT_TYPE_CONFIGS) {
    if (config.strategy !== "glob") continue;
    try {
      const dirEntries = await readdir(join(contentRoot, config.dir), { withFileTypes: true });
      for (const entry of dirEntries) {
        if (!entry.isDirectory() || entry.name.startsWith("hatch3r-")) continue;
        const subSrc = join(contentRoot, config.dir, entry.name);
        const subDest = join(agentsDir, config.dir, entry.name);
        await mkdir(subDest, { recursive: true });
        await cp(subSrc, subDest, { recursive: true, force: true });
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
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

  // Substitute the platform-tool marker in shared canonical files so every
  // platform's agent reads a populated enumeration table instead of the raw
  // marker. Adapter-agnostic — the table lists all known adapter→tool
  // mappings and the runtime agent looks up its own row. See
  // `src/pipeline/adapterToolTranslator.ts::buildAskUserPlatformTable`.
  await substitutePlatformToolMarker(agentsDir);

  return copied;
}

/**
 * Walk `agents/shared/` under the canonical destination and replace the
 * platform-tool marker in any .md file that contains it. Idempotent;
 * no-op when no file has the marker.
 *
 * Scoped to `agents/shared/` because that is the canonical home of the
 * user-question protocol (the only file that ships the marker today).
 * Broaden the search if future shared files introduce the marker.
 */
async function substitutePlatformToolMarker(agentsDir: string): Promise<void> {
  const sharedDir = join(agentsDir, "agents", "shared");
  let entries;
  try {
    entries = await readdir(sharedDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = join(sharedDir, entry.name);
    const content = await readFile(filePath, "utf-8");
    if (!content.includes(PLATFORM_TOOL_MARKER)) continue;
    await atomicWriteFile(filePath, substituteCanonicalPlatformMarker(content));
  }
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
              const rawId = metadata.id || metadata.name || d.name;
              installed.add(applyCommandPrefix(rawId, config.type));
            } catch (err) {
              recordContentProbeFailure(
                `getRemovableContent: skipped ${dirPath}/${d.name}/SKILL.md`,
                err,
              );
            }
          }
        }
      } catch (err) {
        recordContentProbeFailure(
          `getRemovableContent: readdir(${dirPath}) — directory missing`,
          err,
        );
      }
    } else {
      try {
        const files = await readdir(dirPath);
        for (const f of files.filter((f) => f.endsWith(".md"))) {
          const raw = await readFile(join(dirPath, f), "utf-8");
          const { metadata } = parseFrontmatter(raw);
          const rawId = metadata.id || metadata.name || f.replace(/\.md$/, "");
          installed.add(applyCommandPrefix(rawId, config.type));
        }
      } catch (err) {
        recordContentProbeFailure(
          `getRemovableContent: readdir(${dirPath}) — directory missing`,
          err,
        );
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
            const rawId = metadata.id || metadata.name || d.name;
            items[key].push(applyCommandPrefix(rawId, config.type));
          } catch (err) {
            recordContentProbeFailure(
              `buildSelectionsFromDisk: skipped ${dirPath}/${d.name}/SKILL.md`,
              err,
            );
          }
        }
      } catch (err) {
        recordContentProbeFailure(
          `buildSelectionsFromDisk: readdir(${dirPath}) — directory missing`,
          err,
        );
      }
    } else {
      try {
        const files = await readdir(dirPath);
        for (const f of files.filter((f) => f.endsWith(".md"))) {
          const raw = await readFile(join(dirPath, f), "utf-8");
          const { metadata } = parseFrontmatter(raw);
          const rawId = metadata.id || metadata.name || f.replace(/\.md$/, "");
          items[key].push(applyCommandPrefix(rawId, config.type));
        }
      } catch (err) {
        recordContentProbeFailure(
          `buildSelectionsFromDisk: readdir(${dirPath}) — directory missing`,
          err,
        );
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
        "FS_ERROR",
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
      const cleanId = item.id.replace(/^cmd-/, "").replace(/^hatch3r-/, "");
      const yamlPath = join(options.rootDir, ".hatch3r", customDir, `${cleanId}.customize.yaml`);
      const mdPath = join(options.rootDir, ".hatch3r", customDir, `${cleanId}.customize.md`);
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
 * Estimate the item count a preset would yield for a given project type and team size.
 * Used to show expected item counts in the profile selector prompt (#147 D19-18).
 */
export function estimatePresetItemCount(
  preset: ContentPreset,
  projectType: "greenfield" | "brownfield",
  teamSize: "solo" | "team",
  index: ContentIndex,
  projectLanguages?: string[],
  options?: { skipContextFilters?: boolean },
): number {
  const selection = resolveSelection(preset, projectType, teamSize, index, undefined, projectLanguages, options);
  return Object.values(selection.items).reduce((sum, arr) => sum + arr.length, 0);
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

// ── MDC companion generation ───────────────────────────────────

/**
 * Generate Cursor-native frontmatter from canonical rule metadata.
 * Maps `scope` to `alwaysApply` / `globs` as the Cursor adapter does.
 */
function cursorCompanionFrontmatter(description: string, scope?: string): string {
  const lines: string[] = [`description: ${description}`];
  if (scope === "always") {
    lines.push("alwaysApply: true");
  } else if (scope && scope !== "conditional") {
    // Treat non-"always", non-"conditional" scope values as glob patterns
    const globs = scope.includes(",")
      ? scope.split(",").map((g) => g.trim())
      : [scope];
    lines.push(`globs: [${globs.map((g) => `"${g}"`).join(", ")}]`);
  } else {
    lines.push("alwaysApply: false");
  }
  return `---\n${lines.join("\n")}\n---`;
}

/**
 * Resolve the absolute path to the user-content subtree under a project root.
 * D20: user-tier artifacts live at `<rootDir>/.hatch3r/overrides/{type}/...`.
 *
 * Wave 5: relocated from `<rootDir>/.agents/user/` to `<rootDir>/.hatch3r/overrides/`
 * as part of the `.hatch3r/`-only on-disk contract. The migration shim in
 * `src/migration/agentsToHatch3r.ts` relocates pre-1.9 installs on next
 * init/sync/update.
 *
 * Always returns the path; callers stat the directory to decide whether the
 * subtree exists yet (it is created lazily by the first `saveUserContent`).
 */
export function resolveUserContentRoot(rootDir: string): string {
  return join(rootDir, ".hatch3r", "overrides");
}

/**
 * Export the cursor companion frontmatter generator for `userContent.ts` so
 * user-authored rule artifacts produce a parity-compliant `.mdc` companion
 * via the same scope→`alwaysApply`/`globs` mapping the canonical pipeline
 * uses.
 */
export { cursorCompanionFrontmatter };

/**
 * Generate .mdc companion files for all .md rule files in a directory.
 * Each .mdc file contains Cursor-native frontmatter (description, alwaysApply/globs)
 * and the full body content from the source .md file.
 *
 * Returns the list of .mdc file paths that were written.
 */
export async function generateMdcCompanions(rulesDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = (await readdir(rulesDir)).filter((f) => f.endsWith(".md"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const written: string[] = [];
  for (const mdFile of entries) {
    const mdPath = join(rulesDir, mdFile);
    const raw = await readFile(mdPath, "utf-8");
    const { metadata, content } = parseFrontmatter(raw);
    const description = metadata.description || "";
    const scope = metadata.scope;
    const frontmatter = cursorCompanionFrontmatter(description, scope);
    const mdcContent = `${frontmatter}\n${content}`;
    const mdcFile = mdFile.replace(/\.md$/, ".mdc");
    const mdcPath = join(rulesDir, mdcFile);
    // C7.5-W2B2-H4 (D2-SA2.6-2): atomic temp+rename write so SIGINT or OOM
    // mid-write does not produce a truncated .mdc companion. Matches the
    // pattern used by every other production write path — the previous
    // raw writeFile could leave callers (Cursor) consuming a partial file.
    await atomicWriteFile(mdcPath, mdcContent);
    written.push(mdcPath);
  }
  return written;
}
