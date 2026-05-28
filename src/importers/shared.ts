/**
 * Shared importer substrate (F14.4-H1, D14, Cycle 10).
 *
 * Common primitives for the competitor-format importers (cursor, copilot,
 * windsurf, awesome-cursorrules). The cursor importer (`src/importers/cursor.ts`)
 * predates this module and keeps its own slug/frontmatter helpers for backward
 * compatibility with its published `slugifyCursorRuleId` export; the three
 * Cycle-10 importers share these primitives to avoid duplicating the
 * frontmatter-split and slugify logic across files (P4 lean coverage).
 *
 * Out of scope (cross-WU): disk write, CLI wiring, conflict detection, and
 * summary reporting — those are F14.4-H2 and live in init.ts/program.ts.
 */
import type { CanonicalFile } from "../types.js";

/**
 * Matches a leading YAML frontmatter block delimited by `---` lines, capturing
 * the frontmatter body (group 1) and the post-frontmatter content (group 2).
 * Tolerates CRLF and a missing trailing body. Identical in intent to the regex
 * in `src/importers/cursor.ts`.
 */
export const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/;

/** Result of importing a single source file into canonical shape. */
export interface ImportedRule {
  /** Relative source path within the repo (importer-specific origin). */
  sourcePath: string;
  /** Canonical output filename (without directory). */
  canonicalFilename: string;
  /** Canonical rule ready for write. `sourcePath` retains the import origin. */
  canonical: CanonicalFile;
}

/**
 * Split raw file content into its (optional) YAML frontmatter string and body.
 * When no frontmatter block is present, `frontmatterStr` is `undefined` and
 * `body` is the whole input. Never throws — YAML parse is the caller's job.
 */
export function splitFrontmatter(rawContent: string): {
  frontmatterStr: string | undefined;
  body: string;
} {
  const match = rawContent.match(FRONTMATTER_REGEX);
  if (!match) return { frontmatterStr: undefined, body: rawContent };
  const [, fmStr, bodyStr = ""] = match;
  return { frontmatterStr: fmStr ?? "", body: bodyStr };
}

/**
 * Derive a filesystem-safe kebab-case slug from an arbitrary base name. Slashes
 * (from nested source paths) collapse to hyphens so a nested instruction file
 * maps to a flat canonical id. Lowercases, collapses runs of non-alphanumeric
 * characters to a single hyphen, trims leading/trailing hyphens, and falls back
 * to `"rule"` when nothing usable remains.
 */
export function slugifyRuleId(baseName: string): string {
  const slug = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "rule";
}
