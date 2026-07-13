/**
 * Root `AGENTS.md` importer (D14-SA14.4-03, Cycle 12 CL-2).
 *
 * Scope: parse a repo-root `AGENTS.md` (with the pre-consolidation singular
 * `AGENT.md` alias) into ONE always-on canonical hatch3r rule, on the legacy
 * single-file pattern of `src/importers/awesomeCursorrules.ts`. The agents.md
 * convention is free-form Markdown with no frontmatter, no per-section
 * scoping, and no activation semantics — consuming tools load the whole file
 * as undifferentiated context — so the whole body maps to one rule rather
 * than being split on headings the source format does not treat as rule
 * boundaries. Nested `<dir>/AGENTS.md` subtree files are out of scope; only
 * the repo-root file is imported.
 *
 * Emission-loop guard: the sibling `agentsmd` OUTPUT unit (D9-SA9.5-05) emits
 * a root AGENTS.md wrapped in `HATCH3R:BEGIN`/`HATCH3R:END` managed blocks.
 * A candidate file carrying a managed block (any variant, line-anchored via
 * `hasManagedBlock`) is hatch3r's own emission — importing it would loop
 * shipped content back in as a user override that then outranks the canonical
 * content it was generated from — so that file is skipped, per file, with no
 * rule produced. The skip is whole-file (not strip-block-and-import-remainder):
 * the emission flow preserves user content in place at write time, so nothing
 * is lost by declining the import.
 *
 * Out of scope (cross-WU — owned by init.ts/program.ts):
 *   - disk write, CLI wiring (`--import agents`), conflict detection,
 *     dry-run / summary reporting — all reused from `runImport`.
 *
 * Format reference:
 *   https://agents.md (accessed 2026-07-10 via D14-SA14.4-03 sources) —
 *     root AGENTS.md applies repo-wide; plain Markdown, no frontmatter.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

import type { CanonicalFile } from "../types.js";
import { HATCH3R_PREFIX } from "../types.js";
import { hasManagedBlock } from "../merge/managedBlocks.js";
import { splitFrontmatter, type ImportedRule } from "./shared.js";

/** Canonical id for an imported root `AGENTS.md` / `AGENT.md`. */
const AGENTS_MD_IMPORT_ID = `${HATCH3R_PREFIX}agents-import`;

/**
 * The candidate root filenames, in precedence order: the AAIF-standard
 * `AGENTS.md` first, then the pre-consolidation singular `AGENT.md` alias.
 * Both parse to the same canonical id, so when both files exist the runner's
 * first-id-wins pass keeps the `AGENTS.md` copy and reports the `AGENT.md`
 * copy as an intra-import conflict (visible, not silently dropped) — the same
 * precedence mechanism `parseWindsurfRulesDir` uses for `.devin/` over
 * `.windsurf/`.
 */
export const AGENTS_MD_FILENAMES = ["AGENTS.md", "AGENT.md"] as const;

/** A root agents-instruction filename this importer reads. */
export type AgentsMdFilename = (typeof AGENTS_MD_FILENAMES)[number];

/**
 * Parse one root agents-instruction file into a canonical hatch3r rule, or
 * `null` when the file yields nothing to import:
 *
 *   - a managed block is present (any `HATCH3R:BEGIN`/`HATCH3R:END` variant)
 *     → the file is hatch3r's own `agentsmd` emission; re-importing it would
 *     feed shipped content back in as an outranking override, so skip;
 *   - the instruction body is whitespace-only → an empty always-on override
 *     rule carries no instruction value, so skip.
 *
 * The standard format has no frontmatter: the whole file is `content` and
 * scope is `"always"` (root AGENTS.md applies repo-wide). A frontmatter block
 * is tolerated if a user added one — its `description` is lifted and the body
 * below it becomes `content`. Throws when a present frontmatter block is not
 * valid YAML (consistent with `parseAwesomeCursorrules`).
 */
export function parseAgentsMd(
  filename: AgentsMdFilename,
  rawContent: string,
): ImportedRule | null {
  if (hasManagedBlock(rawContent, filename)) return null;

  const { frontmatterStr, body } = splitFrontmatter(rawContent);
  let description = "";
  if (frontmatterStr != null) {
    const parsed = parseYaml(frontmatterStr) as Record<string, unknown> | null;
    if (parsed && typeof parsed.description === "string") description = parsed.description;
  }

  const content = frontmatterStr != null ? body : rawContent;
  if (content.trim() === "") return null;

  const canonical: CanonicalFile = {
    id: AGENTS_MD_IMPORT_ID,
    type: "rule",
    description,
    scope: "always",
    tags: ["agents-import"],
    content,
    rawContent,
    sourcePath: filename,
  };

  return {
    sourcePath: filename,
    canonicalFilename: `${AGENTS_MD_IMPORT_ID}.md`,
    canonical,
  };
}

/**
 * Read and parse the root `AGENTS.md` / `AGENT.md` at a repository root.
 *
 * Candidates are read in {@link AGENTS_MD_FILENAMES} precedence order; each
 * present, importable file yields one entry (both resolve to the same
 * canonical id — see {@link AGENTS_MD_FILENAMES} for the both-present
 * behavior). An absent file, a hatch3r-emitted file (managed block), or a
 * whitespace-only file yields no entry. This parser does not write to disk,
 * detect conflicts, or wire into the CLI — those slices live in `runImport`.
 *
 * @param rootDir - Absolute path to the repository root directory.
 */
export async function parseAgentsMdFile(rootDir: string): Promise<ImportedRule[]> {
  const results: ImportedRule[] = [];
  for (const filename of AGENTS_MD_FILENAMES) {
    let raw: string;
    try {
      raw = await readFile(join(rootDir, filename), "utf-8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EISDIR") continue;
      throw err;
    }
    const rule = parseAgentsMd(filename, raw);
    if (rule) results.push(rule);
  }
  return results;
}
