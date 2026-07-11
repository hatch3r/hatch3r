import { readFile, readdir, cp, mkdir, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname, normalize, isAbsolute, posix } from "node:path";
import { parseFrontmatter, csvToGlobList } from "../adapters/canonical.js";
import { extractAdaptersFrontmatter } from "./frontmatter.js";
import { atomicWriteFile } from "../merge/safeWrite.js";
import {
  PLATFORM_TOOL_MARKER,
  substituteCanonicalPlatformMarker,
} from "../pipeline/adapterToolTranslator.js";
import { ARCHIVE_DIR, HatchError } from "../types.js";
import type { ContentSelection } from "../types.js";
import {
  getPreset,
  capabilityLabel,
  FULL_CAPABILITY_SUPERSET,
  type ContentPreset,
  type CapabilityTag,
} from "./presets.js";
import {
  TAG_CTX_BROWNFIELD_ONLY,
  TAG_CTX_GREENFIELD_ONLY,
  TAG_CTX_TEAM_ONLY,
  filterByLanguages,
  isCapabilityTag,
  isCustomizeTag,
  isFloorTag,
  type RoleId,
  FACET_TAG_ADMISSIONS,
  type FacetId,
} from "./tags.js";
import { verbose } from "../cli/shared/ui.js";

/**
 * Record a content-probe failure: emit a verbose() line to stderr (visible
 * only with --verbose) AND, when a `warnings` sink is supplied, push the same
 * diagnostic to it.
 *
 * Per D8-H8.4.6 (C9-H19) Silent Failure Contract the warnings[] array is the
 * first-class channel; D2-SA2.6-2.6-F10 (Cycle 10 Wave 4) wires that sink
 * through `buildContentIndex` / `getAvailableItems` / `buildSelectionsFromDisk`
 * so probe diagnostics reach a programmatic channel (tests, `--json` output)
 * in addition to the verbose stderr stream. When no sink is supplied the
 * helper degrades to verbose-only — no behavioural change for existing callers.
 */
function recordContentProbeFailure(
  operation: string,
  err: unknown,
  warnings?: string[],
): void {
  const message = err instanceof Error ? err.message : String(err);
  const line = `content: ${operation} — ${message}`;
  verbose(line);
  warnings?.push(line);
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
 * name, etc.). This scanner covers user-tier artifacts too: since D2-SA2.6-03
 * `validateCrossReferences` reads each user body from its own `sourceRoot` and
 * runs it through here, so a dangling `hatch3r-*` reference in a
 * `.hatch3r/overrides/` artifact surfaces exactly like a canonical one.
 *
 * D2-M10 (D2 Medium, Cycle 10 Wave 3 rollover): bare prose references
 * (e.g. "delegate to hatch3r-implementer" without backticks) are detected
 * by a sibling scanner {@link extractBareContentReferences} and surfaced
 * by {@link validateCrossReferences} as advisory warnings ONLY when the
 * bare match resolves to a known content id. This avoids the
 * adjective-modifier false-positive class ("hatch3r-generated code",
 * "hatch3r-managed file", "hatch3r-driven workflow") that broadening this
 * primary scanner would create — those phrases are prose modifiers, not
 * delegations, and have no corresponding id in the index.
 *
 * D2-SA2.6-2.6-F03 (Cycle 10 Wave 4): YAML frontmatter and fenced code
 * blocks are stripped before the regex runs. A backticked `hatch3r-foo`
 * inside a ```bash example or a frontmatter value is illustrative, not a
 * cross-reference — scanning it would let {@link validateCrossReferences}
 * emit a "references X which does not exist" warning for a documentation
 * example or future-id placeholder. Stripping both contexts keeps the
 * scanner scoped to prose-level delegation references.
 */
export function extractContentReferences(content: string): string[] {
  const refs = new Set<string>();
  const scannable = stripFrontmatterAndFences(content);
  const pattern = /`((?:cmd-)?hatch3r-[a-z0-9-]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(scannable)) !== null) {
    refs.add(match[1]);
  }
  return [...refs];
}

/**
 * Remove a single leading YAML frontmatter block (`---\n...\n---`) and every
 * fenced code block (``` … ``` or ~~~ … ~~~) from markdown so a reference
 * scanner sees only prose. Used by {@link extractContentReferences} and
 * {@link extractBareContentReferences} to keep illustrative ids inside
 * examples/frontmatter off the cross-reference channel (D2-SA2.6-2.6-F03).
 */
function stripFrontmatterAndFences(content: string): string {
  let body = content;
  // Leading frontmatter: anchored at start, `---` line .. next `---` line.
  body = body.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  // Fenced code blocks: backtick or tilde fences, non-greedy to the closer.
  body = body.replace(/^[ \t]*```[\s\S]*?^[ \t]*```[ \t]*$/gm, "");
  body = body.replace(/^[ \t]*~~~[\s\S]*?^[ \t]*~~~[ \t]*$/gm, "");
  return body;
}

/**
 * D2-M10 (D2 Medium, Cycle 10 Wave 3 rollover): scan markdown for bare
 * prose mentions of `hatch3r-foo` / `cmd-hatch3r-foo` outside backticks,
 * with carve-outs for clear non-reference contexts. Returns a deduplicated
 * list of candidate ids — the CALLER is responsible for resolving each
 * against the content index and deciding whether to warn.
 *
 * The "candidates only, no judgement" return contract mitigates the
 * adjective-modifier false-positive class (`hatch3r-generated code`,
 * `hatch3r-managed file`, `hatch3r-driven workflow`) — those phrasal
 * modifiers DO match the bare regex but have no corresponding id in the
 * content index. {@link validateCrossReferences} applies a resolve-or-skip
 * discipline that keeps phrasal modifiers off the warnings channel even
 * though they match here.
 *
 * Carve-outs (all suppress the candidate):
 *   - URL hosts/paths: preceded by `/`, `\`, or `:` (covers `https://...`,
 *     `github.com/.../hatch3r-foo`, Windows paths)
 *   - File extensions: followed by `.md`, `.mdc`, `.json`, `.yaml`, `.yml`,
 *     `.ts`, `.js`, `.tsx`, `.jsx` so `hatch3r-foo.md` (a filename) does not
 *     surface as a reference
 *   - Intra-token suffixes: a trailing `-` followed by more name chars means
 *     the regex stopped at the wrong boundary
 *   - Backtick-adjacent: characters at boundary positions matching the
 *     backticked-pattern emitter so we do not duplicate hits already
 *     captured by {@link extractContentReferences}
 */
export function extractBareContentReferences(content: string): string[] {
  const refs = new Set<string>();
  const FILE_EXT = /\.(?:md|mdc|json|ya?ml|tsx?|jsx?)\b/;
  // D2-SA2.6-2.6-F03: strip frontmatter + fenced blocks so bare mentions
  // inside examples/frontmatter never surface as typo candidates.
  const scannable = stripFrontmatterAndFences(content);
  const barePattern = /\b((?:cmd-)?hatch3r-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)/g;
  let match: RegExpExecArray | null;
  while ((match = barePattern.exec(scannable)) !== null) {
    const ref = match[1];
    const start = match.index;
    const prev = start > 0 ? scannable[start - 1] : "";
    if (prev === "/" || prev === "\\" || prev === ":" || prev === "`") continue;
    const after = scannable.slice(start + ref.length);
    if (FILE_EXT.test(after.slice(0, 6))) continue;
    if (after.startsWith("-")) continue;
    if (after.startsWith("`")) continue;
    refs.add(ref);
  }
  return [...refs];
}

/**
 * D22-1 (Cycle 11 Wave 2): scan markdown for BACKTICKED references to
 * canonical rule files by path — `` `rules/hatch3r-foo.md` `` or its `.mdc`
 * twin — so a citation of a rule file that does not exist on disk is caught.
 * The id-based scanners (`extractContentReferences`) only resolve bare ids
 * like `` `hatch3r-foo` ``; a backticked PATH such as
 * `` `rules/hatch3r-reliability.md` `` matches neither the bare-id regex (the
 * leading backtick is followed by `rules/`, not `hatch3r-`) nor the bare-prose
 * scanner (which carves out `/`-prefixed and `.md`-suffixed forms). That gap
 * let a rule path cited 5× across the corpus dangle while `hatch3r validate`
 * exited 0. Returns deduplicated repo-relative paths; the CALLER resolves each
 * against the content root and warns on miss.
 *
 * Scope is deliberately narrow — only `rules/hatch3r-*.{md,mdc}` paths — to
 * keep the false-positive rate at zero: these are first-class canonical rule
 * artifacts that MUST exist on disk, unlike illustrative `src/...` or
 * `docs/...` paths that appear in prose as examples. Frontmatter and fenced
 * code blocks are stripped first so example paths inside ```bash blocks or
 * frontmatter values are not flagged.
 */
export function extractRuleFileReferences(content: string): string[] {
  const refs = new Set<string>();
  const scannable = stripFrontmatterAndFences(content);
  const pattern = /`(rules\/hatch3r-[a-z0-9-]+\.mdc?)`/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(scannable)) !== null) {
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
 *
 * D2-M10 (D2 Medium, Cycle 10 Wave 3 rollover): in addition to the strict
 * backtick-scoped check, scan for BARE prose references (via
 * {@link extractBareContentReferences}) and surface a typo-detection
 * warning when a bare candidate is "close to" a known id (Levenshtein
 * distance ≤ 2) but does not exactly match any indexed id. This catches
 * the silent-invisibility class — a paragraph like "delegate to
 * hatch3r-implementr" (typo, missing "e") previously passed validation
 * because the unbacticked reference fell outside the scanner. The
 * distance threshold avoids the adjective-modifier false-positive class
 * ("hatch3r-generated" is distance 4-5+ from any real id and is correctly
 * suppressed).
 */
export async function validateCrossReferences(
  contentRoot: string,
  index: ContentIndex,
): Promise<CrossReferenceResult> {
  const warnings: string[] = [];
  const allIds = new Set(index.items.map((item) => item.id));
  const allIdsList = [...allIds];

  // D22-1: existence cache for backticked `rules/hatch3r-*.{md,mdc}` path
  // references. The same rule path is cited many times across the corpus
  // (e.g. `rules/hatch3r-resilience-patterns.md` appears in 10+ files), so a
  // per-path `stat` is memoized to one filesystem probe per distinct path.
  const ruleFileExists = new Map<string, boolean>();
  const checkRuleFile = async (refPath: string): Promise<boolean> => {
    const cached = ruleFileExists.get(refPath);
    if (cached !== undefined) return cached;
    let exists = false;
    try {
      await stat(join(contentRoot, refPath));
      exists = true;
    } catch {
      exists = false;
    }
    ruleFileExists.set(refPath, exists);
    return exists;
  };

  // D2-M10: cheap Levenshtein distance for bare-ref typo detection. Scoped
  // small (≤ 2) so adjective-modifier matches like "hatch3r-generated" never
  // pair with a real id; only single-edit typos like "hatch3r-implementr"
  // resolve to "hatch3r-implementer".
  const editDistance = (a: string, b: string): number => {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    const curr = new Array<number>(b.length + 1);
    for (let i = 1; i <= a.length; i++) {
      curr[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      prev = [...curr];
    }
    return prev[b.length];
  };

  for (const item of index.items) {
    let content: string;
    // D2-SA2.6-03: resolve each item against the root it was scanned from
    // (`sourceRoot`), not a single shared `contentRoot`. User-tier items are
    // rooted at `.hatch3r/overrides/`; joining their `relativePath` onto the
    // canonical `contentRoot` (the pre-fix behaviour) missed the file, and the
    // silent `catch { continue }` excluded every user artifact from the
    // dangling-id / typo / rule-path scans. Fall back to `contentRoot` for any
    // legacy item lacking `sourceRoot`.
    const itemRoot = item.sourceRoot ?? contentRoot;
    try {
      // D1-SA1.7-01: single-source-of-truth skill-path resolution (skills are
      // indexed by directory; the readable file is <dir>/SKILL.md).
      content = await readFile(resolveArtifactFilePath(itemRoot, item), "utf-8");
    } catch (err) {
      // Silent Failure Contract (D2-SA2.6-2.6-F10): an indexed item that becomes
      // unreadable between index build and this scan (e.g. a filesystem race)
      // is surfaced through the warnings channel instead of a silent skip.
      recordContentProbeFailure(
        `validateCrossReferences: skipped ${item.type} "${item.id}" (${item.relativePath} unreadable)`,
        err,
        warnings,
      );
      continue;
    }

    const refs = extractContentReferences(content);
    for (const ref of refs) {
      if (ref === item.id) continue; // self-reference is fine
      // Check both the raw ref and the cmd-prefixed form (command IDs are prefixed during indexing)
      if (!allIds.has(ref) && !allIds.has(`${COMMAND_ID_PREFIX}${ref}`)) {
        warnings.push(
          `${item.type} "${item.id}" references "${ref}" which is not in the content index — verify it is a real artifact id and not an example or future id`,
        );
      }
    }

    // D2-M10: bare-prose typo scan. Look at bare candidates NOT already
    // captured by the backticked scan and NOT already a known id — only
    // surface a warning when the candidate is within Levenshtein 2 of a
    // real id, which is a strong signal it is a typo (not an adjective).
    const bareRefs = extractBareContentReferences(content);
    const backticked = new Set(refs);
    for (const bareRef of bareRefs) {
      if (backticked.has(bareRef)) continue; // already covered by strict scan
      if (bareRef === item.id) continue;
      if (allIds.has(bareRef) || allIds.has(`${COMMAND_ID_PREFIX}${bareRef}`)) {
        continue; // resolves cleanly — bare prose mention of a real id
      }
      // Find nearest existing id; only warn when distance ≤ 2 (single
      // character typo or short transposition).
      let best: string | undefined;
      let bestDistance = Infinity;
      for (const known of allIdsList) {
        const d = editDistance(bareRef, known);
        if (d < bestDistance) {
          bestDistance = d;
          best = known;
        }
        if (bestDistance === 0) break;
      }
      if (best && bestDistance > 0 && bestDistance <= 2) {
        warnings.push(
          `${item.type} "${item.id}" contains bare prose reference "${bareRef}" which appears to be a typo of "${best}" (edit distance ${bestDistance})`,
        );
      }
    }

    // D22-1: dangling rule-file path scan. A backticked `rules/hatch3r-*.md`
    // (or `.mdc`) citation that does not resolve on disk is drift — the
    // id-based scanners above never see it because it is a path, not a bare
    // id. Warn so the reference is repointed to an existing rule.
    for (const rulePath of extractRuleFileReferences(content)) {
      if (!(await checkRuleFile(rulePath))) {
        warnings.push(
          `${item.type} "${item.id}" references rule file "${rulePath}" which does not exist on disk — repoint it to an existing rule or author the missing file`,
        );
      }
    }
  }

  return { warnings };
}

// Agents required by the orchestration pipeline ("Always" in Agent Roster).
// F16.3-H1 (Cycle 10 Wave 1C): the legacy test-writer + security-auditor
// always-mode floors are now carried by hatch3r-testability (CQ5) and
// hatch3r-security (CQ3) per SPECIALIST_TRIGGER_TABLE. Only hatch3r-security
// is listed here today because it is the currently-protected + full-preset-
// admitted CQ agent; hatch3r-testability is `tier:enterprise-only` without
// `protected: true`, so the always-mode contract is enforced at orchestrator
// runtime via SPECIALIST_TRIGGER_TABLE rather than via this strict roster.
// Exported so the custom-content picker can surface a "required by 4-phase
// pipeline" hint inline at item-selection time (D10-M18) — previously the
// dependency check ran only AFTER `resolveSelection`, so a user deselecting
// `hatch3r-implementer` discovered the warning post-submission instead of
// at the row that caused it.
export const ORCHESTRATION_REQUIRED_AGENTS = [
  "hatch3r-researcher",
  "hatch3r-implementer",
  "hatch3r-reviewer",
  "hatch3r-security",
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
   * Absolute directory the item was scanned from — the base its `relativePath`
   * resolves against. `scanContentRoot` sets this for every indexed item so a
   * consumer that reads the item's file (e.g. `validateCrossReferences`)
   * resolves it against its OWN root: canonical items carry the package content
   * root, user items carry `.hatch3r/overrides/`. Before D2-SA2.6-03 every item
   * was read against a single shared `contentRoot`, so user-tier bodies (rooted
   * at `.hatch3r/overrides/`) missed the read and were silently excluded from
   * cross-reference validation. Optional so hand-built ContentIndex literals in
   * tests stay valid; `buildContentIndex` always populates it.
   */
  sourceRoot?: string;
  /**
   * When present, restricts which platform adapters emit this artifact. Only
   * meaningful for source: "user" items; empty / omitted = full parity.
   */
  adapters?: string[];
}

/**
 * D1-SA1.7-01 (D1, P1): resolve a {@link CatalogItem} to its readable on-disk
 * FILE path.
 *
 * Skills are indexed by their DIRECTORY (`skills/<id>`); the readable file is
 * `<dir>/SKILL.md`. Every other type's `relativePath` already points at a file.
 * Three consumers (`show`, `deps`, and the cross-reference scan in this module)
 * each re-derived the "skill = dir + SKILL.md" convention independently — and
 * `show` omitted the skill branch, so `hatch3r show <skill-id>` called
 * `readFile()` on a directory and crashed with a raw EISDIR for every skill
 * artifact. Centralizing here is the single source of truth (P4): pass the
 * content root the item was scanned from (canonical or user) and get a path
 * `readFile` accepts for any type.
 */
export function resolveArtifactFilePath(
  contentRoot: string,
  item: Pick<CatalogItem, "type" | "relativePath">,
): string {
  return item.type === "skill"
    ? join(contentRoot, item.relativePath, "SKILL.md")
    : join(contentRoot, item.relativePath);
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
  /**
   * Diagnostic lines for content-probe failures encountered during indexing
   * (e.g. a rule missing its companion `.mdc`). Populated via the Silent
   * Failure Contract warnings[] channel (D2-SA2.6-2.6-F10); an empty array
   * when no probe failed. Optional so legacy ContentIndex literals (tests,
   * fixtures) remain valid; `buildContentIndex` always populates it. Callers
   * MAY surface these to the user or a `--json` envelope.
   */
  warnings?: string[];
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
 *
 * Idempotent: a command id that already starts with `COMMAND_ID_PREFIX` is
 * returned unchanged, so re-indexing an already-prefixed id (e.g. a round-trip
 * through user-content authoring) cannot produce a `cmd-cmd-` double prefix.
 */
export function applyCommandPrefix(id: string, type: string): string {
  if (type !== "command" || id.startsWith(COMMAND_ID_PREFIX)) return id;
  return `${COMMAND_ID_PREFIX}${id}`;
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
  warnings?: string[],
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
            sourceRoot: rootPath,
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
        let raw: string;
        let metadata: ReturnType<typeof parseFrontmatter>["metadata"];
        try {
          raw = await readFile(filePath, "utf-8");
          ({ metadata } = parseFrontmatter(raw));
        } catch (err) {
          // D2-19 (Cycle 11 Wave 3): one malformed-YAML file (realistic trigger:
          // a `.hatch3r/overrides/` typo) previously threw a YAMLParseError with
          // no source path and aborted the entire index build for
          // init/sync/status/add/show/config. ENOENT means the file vanished
          // between readdir and readFile — a genuine filesystem race worth
          // surfacing loudly — so re-throw it. Any other error (parse failure,
          // permission) is per-file: record an actionable named warning naming
          // the offending path and continue indexing the rest of the corpus.
          if ((err as NodeJS.ErrnoException).code === "ENOENT") throw err;
          recordContentProbeFailure(
            `buildContentIndex: skipped ${posix.join(config.dir, file)} (unreadable or malformed frontmatter)`,
            err,
            warnings,
          );
          continue;
        }
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
          sourceRoot: rootPath,
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
              warnings,
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
  const warnings: string[] = [];

  await scanContentRoot(contentRoot, "canonical", items, warnings);

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
      await scanContentRoot(options.userRoot, "user", items, warnings);
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

  return { items, byType, byId, byTypeAndId, collisions, warnings };
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
 * Six-stage pipeline (Wave 1 content-pack redesign + D14-M6 role extensions).
 * Maturity tier no longer gates content selection — it is a pure runtime
 * investment-calibration dial delivered via the manifest + adapter header
 * (Decision 16 reframe, 2026-06-03), so selection is tier-invariant:
 *
 *   1. Custom path — explicit ID list plus protected + floor passthrough.
 *      For `preset.id === "custom"` with `customSelections` provided.
 *   2. Floor admission — items carrying any `isFloorTag(t)` tag (or
 *      `protected: true`) are admitted unconditionally for every non-custom
 *      preset. Structural invariant: a preset cannot disable floor admission.
 *   3. Capability gate — non-floor items pass when their capability tags
 *      intersect the preset's `capabilities` positive list. Customize-family
 *      items (carrying `TAG_CUSTOMIZE`) pass only when `preset.includeCustomize`
 *      is true. Facet admission (`options.facets`) admits items carrying any
 *      mapped facet tag. Per-id `includeIds` / `excludeIds` provide additive /
 *      subtractive carve-outs but cannot remove floor or protected items.
 *      Items with zero capability tags AND zero floor tags AND not protected
 *      AND not in `includeIds` are DROPPED — this is a deliberate reversal
 *      of the v1 "empty tags = passthrough" loophole.
 *   4. Context filter — remove items whose context tags are incompatible
 *      with the project type. Team-size filter applies to `ctx:team-only`
 *      items but is bypassed for floor-admitted items (security & UI/UX
 *      apply to everyone, even solo developers).
 *   5. Language filter — items with `lang:*` tags pass only when the project's
 *      detected languages match; see `filterByLanguages`.
 *   6. Role filter — when `options.role` is set, keep only floor-admitted,
 *      protected, or matching `role:<id>`-tagged items (D14-M6).
 *
 * Stages 4 and 5 are skipped when `options.skipContextFilters` is set (e.g. from
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
  options?: { skipContextFilters?: boolean; role?: RoleId; facets?: ReadonlyArray<FacetId> },
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

    // D14-M9 (Cycle 10): build the union of facet-admission tags from the
    // user-supplied `--facets` list (a11y, performance, observability).
    // Items carrying any of these tags are admitted by the capability
    // stage even when the preset's `capabilities` would not have admitted
    // them — graduated customization without dropping to full custom.
    const facetTagUnion = new Set<string>();
    for (const facet of options?.facets ?? []) {
      const admissions = FACET_TAG_ADMISSIONS[facet];
      if (!admissions) continue;
      for (const tag of admissions) facetTagUnion.add(tag);
    }

    for (const item of index.items) {
      if (admitted.has(item.id)) continue;
      // excludeIds is subtractive but cannot remove floor / protected items —
      // those were already added to `admitted` above and are skipped here.
      if (excludeIdSet.has(item.id)) continue;

      const itemCapabilities = item.tags.filter(isCapabilityTag);
      const hasMatchingCapability = itemCapabilities.some((t) => capSet.has(t));
      const isCustomizeItem = item.tags.some(isCustomizeTag);
      // D14-M9: facet admission. An item matches a facet when it carries
      // any of the facet's mapped tags (FACET_TAG_ADMISSIONS).
      const hasMatchingFacet =
        facetTagUnion.size > 0 && item.tags.some((t) => facetTagUnion.has(t));

      if (hasMatchingCapability) {
        admitted.add(item.id);
      } else if (hasMatchingFacet) {
        admitted.add(item.id);
      } else if (isCustomizeItem && preset.includeCustomize) {
        // Customize is gated by a typed boolean, not the capability set, by
        // design — see the `ContentPreset.includeCustomize` JSDoc in
        // presets.ts for the rationale (D2-SA2.6-F05).
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

  // ── Stage 6: Role filter (D14-M6, Cycle 10 rollover) ──
  // When a role is selected (e.g. `--role reviewer`), keep only items that
  // (a) are floor-admitted (security and UI/UX floor still applies), or
  // (b) are protected (orchestration pipeline survives every role), or
  // (c) carry a matching `role:<id>` tag at the artifact source.
  //
  // A role with no matching tagged items collapses to "floor + protected
  // only" — the role exists but the canonical corpus has not yet been
  // re-tagged for it. This is deliberate: the surface lands without the
  // tagging effort blocking it; later commits add `role:*` tags to the
  // existing artifacts.
  if (options?.role) {
    const roleTag = `role:${options.role}`;
    selected = selected.filter((item) => {
      if (item.protected) return true;
      if (item.tags.some(isFloorTag)) return true;
      return item.tags.includes(roleTag);
    });
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
 * D10-12 (Cycle 11 Wave 2, P1): the capability clusters a preset actually drops
 * from a generated repo, computed from the realized post-floor selection delta
 * `resolveSelection(full) \ resolveSelection(preset)` rather than the
 * capability-intent gap in `presets.ts::omittedCapabilityClusters`.
 *
 * Why this exists: floor admission (stage 2 of `resolveSelection`) ships every
 * `floor:*`-tagged item for every non-custom preset, so the capability-intent
 * gap systematically over-states what a preset removes. A `minimal` preset that
 * intent-omits "review" still ships `floor:content-quality`-tagged review
 * artifacts; labeling it "omits review" in the picker was a lie (D10-12). This
 * function names only the clusters whose items are genuinely absent after floor
 * admission, so the picker's `omits:` line matches the generated output.
 *
 * Method:
 *   1. Resolve `full` and `preset` with `skipContextFilters: true` on BOTH —
 *      the cluster labels describe the capability/floor dial, independent of
 *      project-type / team-size context filtering (which the picker surfaces
 *      separately via its `Filters:` line and the `(excludes N of M)` count).
 *   2. Diff the id sets → the items `preset` drops that `full` keeps.
 *   3. Collect those dropped items' capability tags, intersect with the `full`
 *      capability superset, and emit the matching labels in superset order via
 *      the shared `capabilityLabel` map (single source of truth with
 *      `presets.ts`). Non-capability tags on dropped items (e.g. `supply-chain`,
 *      `ctx:*`) are not cluster labels and are excluded.
 *
 * `full` and `custom` return `[]` (full drops nothing; custom is user-driven).
 * Pure read-only over `index`; no I/O.
 */
export function presetOmittedClusters(
  preset: ContentPreset,
  index: ContentIndex,
): string[] {
  if (preset.id === "full" || preset.id === "custom") return [];

  const opts = { skipContextFilters: true } as const;
  const fullIds = getAllContentIds(
    resolveSelection(getPreset("full"), "brownfield", "team", index, undefined, undefined, opts),
  );
  const presetIds = getAllContentIds(
    resolveSelection(preset, "brownfield", "team", index, undefined, undefined, opts),
  );

  // Capability tags carried by at least one genuinely-dropped item.
  const droppedCapabilities = new Set<string>();
  for (const id of fullIds) {
    if (presetIds.has(id)) continue;
    const item = index.byId.get(id);
    if (!item) continue;
    for (const tag of item.tags) {
      if (isCapabilityTag(tag)) droppedCapabilities.add(tag);
    }
  }

  // Emit in full-superset order via the shared label map so the picker labels
  // match `presets.ts` exactly (e.g. ai → "AI feature engineering").
  return FULL_CAPABILITY_SUPERSET.filter((cap) => droppedCapabilities.has(cap)).map(
    (cap) => capabilityLabel(cap as CapabilityTag),
  );
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
    `Canonical files are regenerated from the bundled package on each sync/init — place ` +
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
  warnings?: string[],
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
                warnings,
              );
            }
          }
        }
      } catch (err) {
        recordContentProbeFailure(
          `getRemovableContent: readdir(${dirPath}) — directory missing`,
          err,
          warnings,
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
          warnings,
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
  warnings?: string[],
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
              warnings,
            );
          }
        }
      } catch (err) {
        recordContentProbeFailure(
          `buildSelectionsFromDisk: readdir(${dirPath}) — directory missing`,
          err,
          warnings,
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
          warnings,
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

// ── Customize-override archival ────────────────────────────────

/**
 * Archive (never hard-delete) a removed item's hand-authored
 * `.hatch3r/<type-dir>/<id>.customize.{yaml,md}` overrides.
 *
 * When a content item leaves the selection, its overrides are moved into
 * `<rootDir>/.hatch3r-archive/customize/<type-dir>/` (`ARCHIVE_DIR`) so the
 * user-authored bytes survive a preset downgrade and can be restored by
 * moving them back. The returned `archivedCustomizeFiles` lists each rescued
 * file as a `.hatch3r-archive/customize/...` repo-relative path so the caller
 * can surface it in the removal summary (D10-35, Cycle 11 Wave 3, D10, P1).
 *
 * Failure handling: a missing override (ENOENT) is skipped silently; any
 * other stat error degrades to a verbose line and skips the archive; an
 * archive write failure (permission, disk) also degrades to a verbose line —
 * in every case the live override is still removed so the on-disk override
 * set stays consistent with the manifest selection.
 */
export async function archiveCustomizeOverrides(
  rootDir: string,
  item: Pick<CatalogItem, "id" | "type">,
): Promise<{ archivedCustomizeFiles: string[] }> {
  const archivedCustomizeFiles: string[] = [];

  const typeToDir: Record<string, string> = {
    agent: "agents",
    skill: "skills",
    rule: "rules",
    command: "commands",
  };
  const customDir = typeToDir[item.type];
  if (!customDir) return { archivedCustomizeFiles };

  const cleanId = item.id.replace(/^cmd-/, "").replace(/^hatch3r-/, "");
  // Path guard (Cycle 12 P6): the id-derived fileName below flows into
  // `cp` + `rm(force: true)`. Today every caller passes canonical catalog ids,
  // but a future caller wiring user-tier items in would turn a separator- or
  // `..`-bearing id into a traversal read/delete primitive. Reject any cleaned
  // id outside the safe charset BEFORE a path is built, degrading exactly like
  // the function's other failure modes (verbose diagnostic + skip, no throw)
  // so a removal flow never aborts on a malformed id.
  if (!/^[A-Za-z0-9._-]+$/.test(cleanId) || cleanId.includes("..")) {
    verbose(
      `archiveCustomizeOverrides: invalid item id ${JSON.stringify(item.id)} — skipped (unsafe path characters)`,
    );
    return { archivedCustomizeFiles };
  }
  const archiveDir = join(rootDir, ARCHIVE_DIR, "customize", customDir);
  for (const fileName of [`${cleanId}.customize.yaml`, `${cleanId}.customize.md`]) {
    const srcPath = join(rootDir, ".hatch3r", customDir, fileName);
    // D10-35: a hard `rm` here silently destroyed user-authored overrides on
    // every preset downgrade (the removal preview only covered archived tool
    // output, never these files). Move each existing override into the
    // customize archive instead, then remove the original. Probe existence
    // first so a missing override never creates an empty archive directory.
    let exists = false;
    try {
      await stat(srcPath);
      exists = true;
    } catch (err) {
      // ENOENT: no override to rescue — leave `exists` false and skip the
      // move. Any other stat error (e.g. permission) also degrades to "skip
      // the archive"; the original `rm` below still runs so the on-disk
      // selection stays consistent.
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        const message = err instanceof Error ? err.message : String(err);
        verbose(`archiveCustomizeOverrides: stat ${srcPath} skipped — ${message}`);
      }
    }
    if (exists) {
      try {
        // `cp` overwrites a same-named prior archive copy — acceptable since
        // the archive is an inspection/restore convenience, not a versioned
        // store.
        await mkdir(archiveDir, { recursive: true });
        await cp(srcPath, join(archiveDir, fileName));
        archivedCustomizeFiles.push(posix.join(ARCHIVE_DIR, "customize", customDir, fileName));
      } catch (err) {
        // Archive write failed (permission, disk) — downgrade to a verbose
        // line and still remove the original so the selection is consistent.
        const message = err instanceof Error ? err.message : String(err);
        verbose(`archiveCustomizeOverrides: archive ${srcPath} skipped — ${message}`);
      }
    }
    await rm(srcPath, { force: true });
  }

  return { archivedCustomizeFiles };
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
  options?: { skipContextFilters?: boolean; role?: RoleId; facets?: ReadonlyArray<FacetId> },
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
 * Maps `scope` (+ a separate `globs` CSV) to `alwaysApply` / `globs` using the
 * same `.md → .mdc` transform the Cursor adapter applies via `resolveRuleGlobs`
 * (`src/adapters/canonical.ts`):
 *   - `scope: always`                      → `alwaysApply: true` (no globs)
 *   - `scope: agent-requested`             → `alwaysApply: false` (no globs;
 *                                             Cursor Apply-Intelligently mode —
 *                                             the agent pulls the rule in by its
 *                                             `description`. D5-28)
 *   - `scope: conditional` + `globs: <csv>`→ `globs: ["g1", ...]` (auto-attached)
 *   - `scope: conditional` with no `globs`  → `alwaysApply: false` (deprecated
 *                                             globs-less conditional — prefer the
 *                                             explicit `agent-requested` keyword)
 *   - `scope: "<csv>"` (legacy inline form) → `globs: ["g1", ...]`
 *   - absent / empty scope                  → `alwaysApply: false`
 *
 * D2-18 (Cycle 11 Wave 3): before the `globs` parameter existed, the canonical
 * two-line form (`scope: conditional` + a separate `globs:` line — the form
 * `.claude/rules/content-authoring.md` mandates for new rules) fell through to
 * the final `alwaysApply: false` branch with NO globs, silently demoting every
 * auto-attached Cursor rule (50+ canonical rules) to manual-only `@`-mention.
 * Routing the CSV through `csvToGlobList` mirrors the parity gate
 * (`scripts/validate-rule-parity.ts` `csvToSet`) so the emitted `.mdc` glob set
 * matches what the validator derives from the same `.md`.
 */
function cursorCompanionFrontmatter(
  description: string,
  scope?: string,
  globs?: string,
): string {
  const lines: string[] = [`description: ${description}`];
  if (scope === "always") {
    lines.push("alwaysApply: true");
  } else if (scope === "agent-requested") {
    // D5-28: Cursor Apply-Intelligently mode — description-only `.mdc` with no
    // globs. The agent reads `description` and pulls the rule in when relevant
    // (cursor.com/docs/context/rules, accessed 2026-06-09). Must short-circuit
    // before the legacy-CSV branch, which would otherwise treat the literal
    // "agent-requested" token as a glob.
    lines.push("alwaysApply: false");
  } else if (scope === "conditional") {
    // Canonical two-line form: the real patterns live in the separate `globs`
    // CSV, never in `scope`. A conditional rule with no `globs` is a deprecated
    // globs-less rule → manual-only (alwaysApply: false), per the transform.
    const list = csvToGlobList(globs);
    if (list.length > 0) {
      lines.push(`globs: [${list.map((g) => `"${g}"`).join(", ")}]`);
    } else {
      lines.push("alwaysApply: false");
    }
  } else if (scope) {
    // Legacy inline-CSV form (`scope: "**/*.ts, **/*.tsx"` or a single bare
    // glob): the patterns live in the scope string itself.
    const list = csvToGlobList(scope);
    if (list.length > 0) {
      lines.push(`globs: [${list.map((g) => `"${g}"`).join(", ")}]`);
    } else {
      lines.push("alwaysApply: false");
    }
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
    const globs = metadata.globs;
    const frontmatter = cursorCompanionFrontmatter(description, scope, globs);
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
