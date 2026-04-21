/**
 * Cursor rules importer — minimal parser (Cycle 7.5 W2B2 H39).
 *
 * Scope: parse `.cursor/rules/*.mdc` frontmatter + body and emit canonical
 * hatch3r rule objects. This is the minimal-parser baseline that unblocks
 * the H59/H60/H61 deferred importers (copilot, windsurf, awesome-cursorrules)
 * landing in Cycle 8.
 *
 * Out of scope (Cycle 8, per C7.5-W2B2-H59 and spec):
 *   - conflict detection, dry-run mode, overwrite/skip/prompt modes
 *   - writing converted rules to disk (this parser returns in-memory objects)
 *   - CLI wiring (`hatch3r init --import cursor`)
 *   - summary reporting (sourceFiles / converted / conflicts / manualReview)
 *   - `.mdc` companion emission (Cursor-native consumers)
 *
 * Cursor rule format reference:
 *   https://cursor.com/docs/context/rules (accessed 2026-04-20)
 *   Frontmatter keys: `description` (string), `globs` (string|string[]|null),
 *   `alwaysApply` (boolean). Body is markdown.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

import type { CanonicalFile } from "../types.js";
import { HATCH3R_PREFIX } from "../types.js";

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

// TODO(Cycle 8, C7.5-W2B2-H59): wire this parser into `hatch3r init --import cursor`
// with conflict detection, dry-run mode, summary reporting, and `.mdc` companion
// emission. See .audit-workspace/content-specs/C7-05-cursor-importer.md.
