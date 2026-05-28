/**
 * GitHub Copilot custom-instructions importer (F14.4-H1, D14, Cycle 10).
 *
 * Scope: parse the two Copilot custom-instruction shapes into canonical hatch3r
 * rule objects, mirroring the minimal-parser baseline established by
 * `src/importers/cursor.ts`:
 *
 *   1. Modern per-file instructions: `.github/instructions/<NAME>.instructions.md`
 *      with optional YAML frontmatter (`description`, `applyTo`, `name`).
 *   2. Legacy single-file repo instructions: `.github/copilot-instructions.md`
 *      (plain Markdown, no frontmatter, always applies).
 *
 * Out of scope (cross-WU — owned by init.ts/program.ts, tracked under F14.4-H2):
 *   - writing converted rules to disk (`.hatch3r/overrides/<id>.md`)
 *   - CLI wiring (`hatch3r init --import copilot`)
 *   - conflict detection across importers / dry-run / overwrite modes
 *   - summary reporting (sourceFiles / converted / conflicts / manualReview)
 *
 * Copilot instruction-file format reference:
 *   https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot
 *     (accessed 2026-05-28) — `.github/instructions/*.instructions.md`,
 *     `applyTo` glob (comma-separated for multiple patterns), `description`.
 *   https://code.visualstudio.com/docs/copilot/customization/custom-instructions
 *     (accessed 2026-05-28) — frontmatter keys + body-is-Markdown semantics.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

import type { CanonicalFile } from "../types.js";
import { HATCH3R_PREFIX } from "../types.js";
import {
  FRONTMATTER_REGEX,
  slugifyRuleId,
  splitFrontmatter,
  type ImportedRule,
} from "./shared.js";

/** Parsed GitHub Copilot `.instructions.md` frontmatter. */
export interface CopilotInstructionFrontmatter {
  /** Human-readable label. Copilot docs example uses `name:`. */
  name?: string;
  /** Short description of the instruction set. */
  description?: string;
  /**
   * Glob pattern(s) the instructions apply to. Copilot uses a comma-separated
   * string for multiple patterns (e.g. a TypeScript-files glob plus a TSX
   * glob). YAML may also carry it as a list; both are accepted.
   */
  applyTo?: string | string[];
}

/** Canonical id prefix for imported Copilot instructions. */
const COPILOT_IMPORT_PREFIX = `${HATCH3R_PREFIX}copilot-import-`;
/** Canonical id used for the legacy single-file repo instructions. */
const COPILOT_LEGACY_ID = `${COPILOT_IMPORT_PREFIX}repo-instructions`;

/**
 * Normalise a Copilot `applyTo` value (comma-separated string or YAML list)
 * to a canonical comma-joined scope string. Returns `undefined` when no
 * usable pattern is present (e.g. `applyTo: "**"` is treated as always-apply
 * and mapped to `"always"` by the caller, not here).
 */
function normaliseApplyTo(applyTo: CopilotInstructionFrontmatter["applyTo"]): string[] {
  if (applyTo == null) return [];
  const raw: string[] = Array.isArray(applyTo)
    ? applyTo.filter((g): g is string => typeof g === "string")
    : typeof applyTo === "string"
      ? applyTo.split(",")
      : [];
  return raw.map((g) => g.trim()).filter((g) => g.length > 0);
}

/**
 * Map a list of `applyTo` globs to a canonical `scope`:
 *   - a sole `**` (match-everything) → `"always"` (Copilot's repo-wide default)
 *   - one or more concrete globs → comma-joined CSV
 *   - no globs → `undefined` (rule has no scope; caller may flag for review)
 */
function applyToToScope(globs: string[]): string | undefined {
  if (globs.length === 0) return undefined;
  if (globs.length === 1 && (globs[0] === "**" || globs[0] === "**/*")) return "always";
  return globs.join(",");
}

/**
 * Parse one Copilot per-file instruction (`<NAME>.instructions.md`) into a
 * canonical hatch3r rule.
 *
 * Mapping:
 *   `description` (or `name`) → canonical `description`
 *   `applyTo` glob(s)         → canonical `scope` (CSV, or `"always"` for `**`)
 *   body Markdown             → canonical `content`
 *
 * The canonical id strips the trailing `.instructions.md`, slugifies the
 * remaining `NAME`, and prefixes `hatch3r-copilot-import-`. Throws when the
 * frontmatter block is present but is not valid YAML (consistent with
 * `parseCursorRule`).
 */
export function parseCopilotInstruction(filename: string, rawContent: string): ImportedRule {
  const { frontmatterStr, body } = splitFrontmatter(rawContent);
  let fm: CopilotInstructionFrontmatter = {};
  if (frontmatterStr != null) {
    const parsed = parseYaml(frontmatterStr) as Record<string, unknown> | null;
    if (parsed && typeof parsed === "object") {
      const next: CopilotInstructionFrontmatter = {};
      if (typeof parsed.name === "string") next.name = parsed.name;
      if (typeof parsed.description === "string") next.description = parsed.description;
      if (typeof parsed.applyTo === "string" || Array.isArray(parsed.applyTo)) {
        next.applyTo = parsed.applyTo as CopilotInstructionFrontmatter["applyTo"];
      }
      fm = next;
    }
  }

  const baseName = filename.replace(/\.instructions\.md$/i, "").replace(/\.md$/i, "");
  const slug = slugifyRuleId(baseName);
  const id = `${COPILOT_IMPORT_PREFIX}${slug}`;
  const scope = applyToToScope(normaliseApplyTo(fm.applyTo));

  const canonical: CanonicalFile = {
    id,
    type: "rule",
    description: fm.description ?? fm.name ?? "",
    scope,
    tags: ["copilot-import"],
    content: body,
    rawContent,
    sourcePath: filename,
  };

  return { sourcePath: filename, canonicalFilename: `${id}.md`, canonical };
}

/**
 * Parse the legacy single-file `.github/copilot-instructions.md` (plain
 * Markdown, no frontmatter) into a canonical rule. The whole file body becomes
 * `content`; scope is `"always"` because the legacy file applies repo-wide.
 */
export function parseCopilotLegacyInstructions(rawContent: string): ImportedRule {
  // The legacy file has no frontmatter, but tolerate one if a user added it.
  const { frontmatterStr, body } = splitFrontmatter(rawContent);
  let description = "";
  if (frontmatterStr != null) {
    const parsed = parseYaml(frontmatterStr) as Record<string, unknown> | null;
    if (parsed && typeof parsed.description === "string") description = parsed.description;
  }
  const canonical: CanonicalFile = {
    id: COPILOT_LEGACY_ID,
    type: "rule",
    description,
    scope: "always",
    tags: ["copilot-import"],
    content: frontmatterStr != null ? body : rawContent,
    rawContent,
    sourcePath: ".github/copilot-instructions.md",
  };
  return {
    sourcePath: ".github/copilot-instructions.md",
    canonicalFilename: `${COPILOT_LEGACY_ID}.md`,
    canonical,
  };
}

/**
 * Read and parse every Copilot instruction source under a repository root.
 *
 * Discovers (in deterministic, path-sorted order):
 *   1. `<name>.instructions.md` files anywhere under `.github/instructions/`
 *      (recursive — Copilot allows subdirectories such as
 *      `instructions/frontend/react.instructions.md`).
 *   2. `.github/copilot-instructions.md` (legacy single file), appended last.
 *
 * Returns one `ImportedRule` per source. Missing directory/file yields no
 * entry for that source. This parser does not write to disk, detect conflicts,
 * or wire into the CLI — those slices are cross-WU (F14.4-H2 / init.ts).
 *
 * @param rootDir - Absolute path to the repository root directory.
 */
export async function parseCopilotInstructionsDir(rootDir: string): Promise<ImportedRule[]> {
  const results: ImportedRule[] = [];
  const instructionsDir = join(rootDir, ".github", "instructions");
  const files = await collectInstructionFiles(instructionsDir);
  for (const { relName, fullPath } of files) {
    const raw = await readFile(fullPath, "utf-8");
    results.push(parseCopilotInstruction(relName, raw));
  }

  // Legacy single-file repo instructions (appended last so a per-file
  // instruction with the same slug sorts ahead of it deterministically).
  try {
    const legacyPath = join(rootDir, ".github", "copilot-instructions.md");
    const raw = await readFile(legacyPath, "utf-8");
    results.push(parseCopilotLegacyInstructions(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  return results;
}

/**
 * Recursively collect `*.instructions.md` files under `dir`, returning each
 * file's slash-joined relative name (relative to `dir`) and absolute path,
 * sorted by relative name. Missing directory yields `[]`.
 */
async function collectInstructionFiles(
  dir: string,
): Promise<{ relName: string; fullPath: string }[]> {
  const out: { relName: string; fullPath: string }[] = [];
  await walk(dir, "");
  out.sort((a, b) => a.relName.localeCompare(b.relName));
  return out;

  async function walk(absDir: string, relPrefix: string): Promise<void> {
    let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[];
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT" || (err as NodeJS.ErrnoException).code === "ENOTDIR") {
        return;
      }
      throw err;
    }
    for (const entry of entries) {
      const rel = relPrefix.length > 0 ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        await walk(join(absDir, entry.name), rel);
      } else if (entry.isFile() && /\.instructions\.md$/i.test(entry.name)) {
        out.push({ relName: rel, fullPath: join(absDir, entry.name) });
      }
    }
  }
}

// Re-export the frontmatter regex so format-specific callers/tests can reuse
// the same parsing primitive as the cursor importer.
export { FRONTMATTER_REGEX };
