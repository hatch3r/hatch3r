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
 * Normalize a parsed canonical scope into the frontmatter fields the canonical
 * `.md` form requires (D1-SA1.1-09 emitter mandate, mirrored in
 * `.claude/rules/content-authoring.md` §Rule Scope Transform):
 *
 *   - `"always"` / `"agent-requested"` / `"conditional"` — sanctioned keywords,
 *     passed through (`conditional` keeps its separate `globs` CSV when present).
 *   - any other non-empty value — a glob CSV carried inline in `scope` (the
 *     DEPRECATED legacy form the source parsers produce); rewritten to the
 *     canonical two-line form `scope: conditional` + `globs: "<csv>"`. The CSV
 *     string is passed through verbatim, so the glob set the parity gate derives
 *     (`scripts/validate-rule-parity.ts::csvToSet`) is unchanged.
 *   - `undefined` or empty/whitespace-only — no scope; both fields absent
 *     (matches `cursorCompanionFrontmatter`'s truthiness handling, which
 *     treats a falsy scope as scope-less rather than emitting empty fields).
 */
export function canonicalScopeFields(
  scope: string | undefined,
  globs?: string,
): { scope?: string; globs?: string } {
  if (scope === undefined || scope.trim() === "") return {};
  if (scope === "always" || scope === "agent-requested") return { scope };
  if (scope === "conditional") {
    return globs !== undefined ? { scope, globs } : { scope };
  }
  return { scope: "conditional", globs: scope };
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
