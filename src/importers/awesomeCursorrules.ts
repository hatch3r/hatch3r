/**
 * Legacy `.cursorrules` importer (F14.4-H1, D14, Cycle 10).
 *
 * Scope: parse the legacy single-file `.cursorrules` format distributed by the
 * awesome-cursorrules collection into a canonical hatch3r rule, mirroring the
 * minimal-parser baseline of `src/importers/cursor.ts`.
 *
 * This is distinct from `src/importers/cursor.ts`, which parses the modern
 * `.cursor/rules/*.mdc` Project Rules (Cursor 0.45+). The legacy `.cursorrules`
 * file at the repo root is plain text (the LLM interprets it as structured
 * natural language) with no frontmatter and no glob scoping — it always
 * applies repo-wide. Cursor still reads it for backward compatibility, and the
 * awesome-cursorrules repository (https://github.com/PatrickJS/awesome-cursorrules,
 * accessed 2026-05-28) distributes rules in exactly this single-file shape.
 *
 * Out of scope (cross-WU — owned by init.ts/program.ts, tracked under F14.4-H2):
 *   - disk write (`.hatch3r/overrides/<id>.md`), CLI wiring (`--import cursorrules`)
 *   - conflict detection / dry-run / summary reporting
 *
 * Reference:
 *   https://github.com/PatrickJS/awesome-cursorrules (accessed 2026-05-28) —
 *     curated `.cursorrules` files, legacy single-file plain-text format.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

import type { CanonicalFile } from "../types.js";
import { HATCH3R_PREFIX } from "../types.js";
import { splitFrontmatter, type ImportedRule } from "./shared.js";

/** Canonical id for an imported legacy `.cursorrules` file. */
const AWESOME_CURSORRULES_ID = `${HATCH3R_PREFIX}cursorrules-import`;

/**
 * Parse a legacy `.cursorrules` file body into a canonical hatch3r rule.
 *
 * The legacy format has no frontmatter, so the entire file is `content` and
 * scope is `"always"` (the file applies repo-wide). A frontmatter block is
 * tolerated if a user added one — its `description` is lifted and the body
 * below it becomes `content` — but the awesome-cursorrules canonical shape has
 * none. The canonical id is a fixed `hatch3r-cursorrules-import` because the
 * legacy format is a single root file with no name to slugify.
 *
 * Throws when a present frontmatter block is not valid YAML (consistent with
 * `parseCursorRule`).
 */
export function parseAwesomeCursorrules(rawContent: string): ImportedRule {
  const { frontmatterStr, body } = splitFrontmatter(rawContent);
  let description = "";
  if (frontmatterStr != null) {
    const parsed = parseYaml(frontmatterStr) as Record<string, unknown> | null;
    if (parsed && typeof parsed.description === "string") description = parsed.description;
  }

  const canonical: CanonicalFile = {
    id: AWESOME_CURSORRULES_ID,
    type: "rule",
    description,
    scope: "always",
    tags: ["cursorrules-import"],
    content: frontmatterStr != null ? body : rawContent,
    rawContent,
    sourcePath: ".cursorrules",
  };

  return {
    sourcePath: ".cursorrules",
    canonicalFilename: `${AWESOME_CURSORRULES_ID}.md`,
    canonical,
  };
}

/**
 * Read and parse the legacy `.cursorrules` file at a repository root.
 *
 * Returns a single-element array with the parsed rule, or `[]` when the file
 * is absent. This parser does not write to disk, detect conflicts, or wire
 * into the CLI — those slices are cross-WU (F14.4-H2 / init.ts).
 *
 * @param rootDir - Absolute path to the repository root directory.
 */
export async function parseAwesomeCursorrulesFile(rootDir: string): Promise<ImportedRule[]> {
  let raw: string;
  try {
    raw = await readFile(join(rootDir, ".cursorrules"), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT" || (err as NodeJS.ErrnoException).code === "EISDIR") {
      return [];
    }
    throw err;
  }
  return [parseAwesomeCursorrules(raw)];
}
