/**
 * Cursor rules importer — minimal parser (Cycle 7.5 W2B2 H39).
 *
 * Scope: parse `.cursor/rules/*.mdc` frontmatter + body and emit canonical
 * hatch3r rule objects. This is the minimal-parser baseline that unblocks
 * the H59/H60/H61 deferred importers (copilot, windsurf, awesome-cursorrules)
 * landing in Cycle 8.
 *
 * Cycle 8 (this file): {@link importCursorRules} adds the import runner on top
 * of the parser — conflict detection against existing rule ids, dry-run mode,
 * summary reporting (sourceFiles / converted / conflicts / manualReview), and
 * `.mdc` companion emission alongside the canonical `.md` under
 * `.hatch3r/overrides/rules/`. The runner is pure of process.exit / console;
 * the CLI caller (`hatch3r init --import cursor`) renders the returned summary.
 *
 * Cursor rule format reference:
 *   https://cursor.com/docs/context/rules (accessed 2026-04-20)
 *   Frontmatter keys: `description` (string), `globs` (string|string[]|null),
 *   `alwaysApply` (boolean). Body is markdown.
 */
import { readFile, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";

import type { CanonicalFile } from "../types.js";
import { HATCH3R_PREFIX } from "../types.js";
import { atomicWriteFile } from "../merge/safeWrite.js";
import { cursorCompanionFrontmatter, resolveUserContentRoot } from "../content/index.js";

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/;

/** Parsed Cursor `.mdc` rule frontmatter. */
export interface CursorRuleFrontmatter {
  description?: string;
  globs?: string | string[] | null;
  alwaysApply?: boolean;
}

/** Result of importing a single `.mdc` file into canonical shape. */
export interface ImportedCursorRule {
  /** Relative source path (`.cursor/rules/*.mdc`). */
  sourcePath: string;
  /** Canonical output filename (without directory). */
  canonicalFilename: string;
  /** Canonical rule ready for write. `sourcePath` retains the Cursor origin. */
  canonical: CanonicalFile;
}

/**
 * Derive a filesystem-safe kebab-case slug from a Cursor rule filename.
 * Strips the `.mdc` extension, lowercases, collapses runs of non-alphanumeric
 * characters to a single hyphen, and trims leading/trailing hyphens.
 */
export function slugifyCursorRuleId(filename: string): string {
  const base = filename.replace(/\.mdc$/i, "");
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "rule";
}

/** Normalise Cursor `globs` (string, string[], or null) to a canonical comma-joined scope. */
function normaliseGlobs(globs: CursorRuleFrontmatter["globs"]): string | undefined {
  if (globs == null) return undefined;
  if (Array.isArray(globs)) {
    const cleaned = globs
      .filter((g): g is string => typeof g === "string" && g.trim().length > 0)
      .map((g) => g.trim());
    return cleaned.length > 0 ? cleaned.join(",") : undefined;
  }
  if (typeof globs === "string") {
    const trimmed = globs.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

/**
 * Parse a single Cursor `.mdc` file into a canonical hatch3r rule.
 *
 * Minimal mapping (Cycle 7.5 scope):
 *   Cursor `description` -> canonical `description` (empty string if missing)
 *   Cursor `alwaysApply: true` -> canonical `scope: "always"`
 *   Cursor `globs` (string or string[]) -> canonical `scope` (comma-joined)
 *   Body markdown -> canonical `content`
 *
 * The canonical `id` uses the source filename (sans `.mdc`, slugified) prefixed
 * with `hatch3r-cursor-import-`. This namespacing makes imported rules easy to
 * identify and avoids collisions with first-party hatch3r content during the
 * Cycle 8 merge work.
 *
 * Throws when YAML parsing fails. Missing frontmatter yields a rule with empty
 * description and no scope — callers can surface that via manualReview in the
 * Cycle 8 summary layer.
 */
export function parseCursorRule(filename: string, rawContent: string): ImportedCursorRule {
  const match = rawContent.match(FRONTMATTER_REGEX);
  let frontmatter: CursorRuleFrontmatter = {};
  let body: string;

  if (match) {
    const [, fmStr, bodyStr = ""] = match;
    const parsed = parseYaml(fmStr ?? "") as Record<string, unknown> | null;
    if (parsed && typeof parsed === "object") {
      const fm: CursorRuleFrontmatter = {};
      if (typeof parsed.description === "string") fm.description = parsed.description;
      if (typeof parsed.alwaysApply === "boolean") fm.alwaysApply = parsed.alwaysApply;
      if (typeof parsed.globs === "string" || Array.isArray(parsed.globs) || parsed.globs === null) {
        fm.globs = parsed.globs as CursorRuleFrontmatter["globs"];
      }
      frontmatter = fm;
    }
    body = bodyStr;
  } else {
    body = rawContent;
  }

  const slug = slugifyCursorRuleId(filename);
  const id = `${HATCH3R_PREFIX}cursor-import-${slug}`;
  const canonicalFilename = `${id}.md`;

  let scope: string | undefined;
  if (frontmatter.alwaysApply === true) {
    scope = "always";
  } else {
    scope = normaliseGlobs(frontmatter.globs);
  }

  const canonical: CanonicalFile = {
    id,
    type: "rule",
    description: frontmatter.description ?? "",
    scope,
    tags: ["cursor-import"],
    content: body,
    rawContent,
    sourcePath: filename,
  };

  return {
    sourcePath: filename,
    canonicalFilename,
    canonical,
  };
}

/**
 * Read and parse every `.mdc` file in a `.cursor/rules/` directory.
 *
 * Returns one `ImportedCursorRule` per file. Missing directory yields `[]`.
 * Non-`.mdc` files are ignored. This minimal parser does not write to disk,
 * detect conflicts, or wire into the CLI — see Cycle 8 for those phases.
 */
export async function parseCursorRulesDir(cursorDir: string): Promise<ImportedCursorRule[]> {
  let entries: string[];
  try {
    entries = (await readdir(cursorDir)).filter((f) => f.toLowerCase().endsWith(".mdc")).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }

  const results: ImportedCursorRule[] = [];
  for (const filename of entries) {
    const fullPath = join(cursorDir, filename);
    const raw = await readFile(fullPath, "utf-8");
    results.push(parseCursorRule(filename, raw));
  }
  return results;
}

/**
 * Structured outcome of an {@link importCursorRules} run. Every parsed `.mdc`
 * lands in exactly one of `converted`, `conflicts`, or `manualReview`.
 */
export interface CursorImportSummary {
  /** Absolute or caller-relative `.cursor/rules` directory that was scanned. */
  cursorDir: string;
  /** Number of `.mdc` files discovered (the parse universe). */
  sourceFiles: number;
  /** Rules converted to canonical shape and not in conflict. */
  converted: ImportedCursorRule[];
  /** Rules skipped because their canonical id collides (existing id or intra-import duplicate). */
  conflicts: { sourcePath: string; canonicalFilename: string; reason: string }[];
  /** Rules deferred for human review (empty / missing frontmatter). */
  manualReview: { sourcePath: string; reason: string }[];
  /** Paths written to disk (`.md` + `.mdc` per converted rule); empty under dryRun. */
  written: string[];
  /** True when the run computed the summary without writing any file. */
  dryRun: boolean;
}

/**
 * Compose the canonical `.md` payload (frontmatter + body) for an imported
 * rule. Frontmatter carries the namespaced id, `type: rule`, description,
 * the `cursor-import` tag, and `scope` when the source declared one. Mirrors
 * the `---\n<yaml>\n---\n<body>` shape that `composeArtifactFile`
 * (`src/content/userContent.ts`) emits for user artifacts.
 */
function composeCanonicalMd(rule: ImportedCursorRule): string {
  const fm: Record<string, unknown> = {
    id: rule.canonical.id,
    type: "rule",
    description: rule.canonical.description,
    tags: rule.canonical.tags ?? ["cursor-import"],
  };
  if (rule.canonical.scope !== undefined) {
    fm.scope = rule.canonical.scope;
  }
  const yaml = yamlStringify(fm).trim();
  const body = rule.canonical.content.startsWith("\n")
    ? rule.canonical.content
    : `\n${rule.canonical.content}`;
  return `---\n${yaml}\n---\n${body}`;
}

/**
 * True when a parsed rule carries no usable frontmatter — an empty description
 * AND no resolved scope. These land in `manualReview` rather than being written
 * blind, because a rule with no description/scope conveys no Cursor intent.
 */
function hasEmptyFrontmatter(rule: ImportedCursorRule): boolean {
  return rule.canonical.description === "" && rule.canonical.scope === undefined;
}

/**
 * Import `.cursor/rules/*.mdc` into canonical hatch3r rules under
 * `.hatch3r/overrides/rules/`.
 *
 * Pipeline per parsed rule:
 *   1. Empty/missing frontmatter (no description, no scope) → `manualReview`.
 *   2. Canonical id already in `existingRuleIds`, OR two imported files
 *      resolve to the same canonical id → `conflicts` (skip writing).
 *   3. Otherwise → `converted`.
 *
 * A missing `.cursor/rules` directory yields a summary with `sourceFiles: 0`
 * and every collection empty — it never throws. When `dryRun` is false, each
 * converted rule is written as BOTH a canonical `.md` and a Cursor-native
 * `.mdc` companion (scope→`alwaysApply`/`globs` via
 * {@link cursorCompanionFrontmatter}); both paths are recorded in `written`.
 * When `dryRun` is true the same classification runs but `written` stays empty.
 *
 * Pure of process.exit / console — the caller renders {@link CursorImportSummary}.
 */
export async function importCursorRules(opts: {
  rootDir: string;
  dryRun: boolean;
  /** Canonical + user rule ids already present — drives conflict detection. */
  existingRuleIds?: ReadonlySet<string>;
}): Promise<CursorImportSummary> {
  const { rootDir, dryRun, existingRuleIds } = opts;
  const cursorDir = join(rootDir, ".cursor", "rules");
  const parsed = await parseCursorRulesDir(cursorDir);

  const summary: CursorImportSummary = {
    cursorDir,
    sourceFiles: parsed.length,
    converted: [],
    conflicts: [],
    manualReview: [],
    written: [],
    dryRun,
  };

  // Track ids produced within this import run so two source files that slugify
  // to the same canonical id are flagged as a conflict rather than the second
  // silently overwriting the first.
  const seenIds = new Set<string>();

  for (const rule of parsed) {
    if (hasEmptyFrontmatter(rule)) {
      summary.manualReview.push({
        sourcePath: rule.sourcePath,
        reason: "empty or missing frontmatter — review before adopting",
      });
      continue;
    }

    const id = rule.canonical.id;
    if (existingRuleIds?.has(id)) {
      summary.conflicts.push({
        sourcePath: rule.sourcePath,
        canonicalFilename: rule.canonicalFilename,
        reason: `canonical id "${id}" already exists in this project`,
      });
      continue;
    }
    if (seenIds.has(id)) {
      summary.conflicts.push({
        sourcePath: rule.sourcePath,
        canonicalFilename: rule.canonicalFilename,
        reason: `canonical id "${id}" collides with another imported file`,
      });
      continue;
    }

    seenIds.add(id);
    summary.converted.push(rule);
  }

  if (!dryRun && summary.converted.length > 0) {
    const rulesDir = join(resolveUserContentRoot(rootDir), "rules");
    await mkdir(rulesDir, { recursive: true });
    for (const rule of summary.converted) {
      const mdTarget = join(rulesDir, rule.canonicalFilename);
      await atomicWriteFile(mdTarget, composeCanonicalMd(rule));
      summary.written.push(mdTarget);

      // `.mdc` companion: Cursor-native frontmatter via the canonical
      // scope→alwaysApply/globs transform, then the same body.
      const mdcFrontmatter = cursorCompanionFrontmatter(
        rule.canonical.description,
        rule.canonical.scope,
      );
      const body = rule.canonical.content.startsWith("\n")
        ? rule.canonical.content
        : `\n${rule.canonical.content}`;
      const mdcTarget = join(rulesDir, rule.canonicalFilename.replace(/\.md$/, ".mdc"));
      await atomicWriteFile(mdcTarget, `${mdcFrontmatter}${body}`);
      summary.written.push(mdcTarget);
    }
  }

  return summary;
}
