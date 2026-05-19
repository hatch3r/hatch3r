/**
 * Shared frontmatter helpers for the content layer.
 *
 * C9-M15: Single source of truth for extracting the optional
 * `adapters: [...]` array from a markdown file's frontmatter. Prior to this
 * module the same field was parsed twice — once via the canonical YAML
 * parser in `src/adapters/canonical.ts::parseFrontmatter` (which surfaces
 * it on `CanonicalMetadata.adapters`) and once via a regex line-scanner in
 * `src/content/index.ts::parseAdaptersFrontmatter`. The two parsers had
 * subtly different shapes:
 *
 *   - Block-form `adapters:\n  - foo` returned `null` when empty in the
 *     regex parser, but `string[]` in the YAML parser.
 *   - Malformed scalars (`adapters: claude`) returned `null` from the
 *     regex parser and `undefined` from the YAML parser — equivalent for
 *     callers but two different code paths.
 *
 * Consolidating onto the YAML parser eliminates duplicated regex logic and
 * makes adapter frontmatter handling consistent across the codebase.
 *
 * The helper here is a thin wrapper around `parseFrontmatter` that returns
 * just the `adapters` array (or `undefined` when absent / malformed), so
 * call sites that only need the adapters filter do not have to threaded
 * the full `CanonicalMetadata` shape.
 */

import { parseFrontmatter } from "../adapters/canonical.js";
import { verbose } from "../cli/shared/ui.js";

/**
 * Extract the optional `adapters: [tool, tool, ...]` array from raw
 * frontmatter. Returns the parsed array (filtered to strings) when present,
 * or `undefined` when the field is absent or malformed (e.g. a bare scalar
 * `adapters: claude` rather than an array). The return type matches the
 * `adapters?: string[]` shape on `CatalogItem` / `CanonicalFile`, so
 * callers can assign the result directly.
 *
 * Used by `buildContentIndex` for user-tier items so canonical content
 * never silently inherits an adapters filter. Canonical artifacts omit
 * the field, so this helper returns `undefined` for them.
 *
 * Behaviour matches the canonical YAML-based parser in
 * `src/adapters/canonical.ts::parseFrontmatter`:
 *   - inline `adapters: [a, b]` → `["a", "b"]`
 *   - block-form `adapters:\n  - a\n  - b` → `["a", "b"]`
 *   - empty array `adapters: []` → `[]` (caller decides how to treat)
 *   - missing field → `undefined`
 *   - non-array value (scalar / object) → `undefined`
 *   - missing/invalid frontmatter → `undefined`
 */
export function extractAdaptersFrontmatter(raw: string): string[] | undefined {
  let parsed;
  try {
    parsed = parseFrontmatter(raw);
  } catch (err) {
    // YAML parse error — the canonical reader path emits the authoritative
    // YAML_PARSE_ERROR diagnostic (see `readSingleMd` in
    // `src/adapters/canonical.ts`), which is the user-visible signal. Here
    // we degrade to "no adapters filter" so the index builder keeps loading
    // the item rather than throwing, and surface a verbose() trace per the
    // D8-H8.4.6 Silent Failure Contract so the secondary parse failure is
    // visible under --verbose without duplicating the authoritative warning.
    const message = err instanceof Error ? err.message : String(err);
    verbose(`content: extractAdaptersFrontmatter YAML parse failed — ${message}`);
    return undefined;
  }
  return parsed.metadata.adapters;
}
