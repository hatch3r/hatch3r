/**
 * Windsurf / Devin Desktop (Cascade) rules importer (F14.4-H1, D14, Cycle 10;
 * `.devin/rules/` read path added Cycle 12 per D14-SA14.4-07).
 *
 * Scope: parse the Windsurf/Devin rule shapes into canonical hatch3r rule
 * objects, mirroring the minimal-parser baseline of `src/importers/cursor.ts`:
 *
 *   1. Modern directory rules: `.devin/rules/*.md` (preferred) and
 *      `.windsurf/rules/*.md` (fallback), each with YAML frontmatter carrying an
 *      activation `trigger` (`always_on` | `manual` | `model_decision` | `glob`)
 *      and, for `trigger: glob`, a `globs` value.
 *   2. Legacy single-file rules: `.windsurfrules` at the repo root — plain text
 *      where every rule is always active (pre-Wave-8 format). No `.devinrules`
 *      single-file equivalent exists.
 *
 * Cognition rebranded Windsurf to Devin Desktop on 2026-06-02: `.devin/rules/`
 * is the preferred path and takes precedence, with `.windsurf/rules/` and the
 * legacy `.windsurfrules` retained for backward compatibility. The
 * `docs.windsurf.com` reference URL below now 307-redirects to `docs.devin.ai`.
 *
 * Out of scope (cross-WU — owned by init.ts/program.ts, tracked under F14.4-H2):
 *   - disk write (`.hatch3r/overrides/<id>.md`), CLI wiring (`--import windsurf`)
 *   - conflict detection / dry-run / summary reporting
 *
 * Rule format reference (re-verified 2026-07-12 against the rebranded docs):
 *   https://docs.devin.ai/desktop/cascade/memories (accessed 2026-07-12)
 *     — `.devin/rules/` preferred + `.windsurf/rules/` fallback directories of
 *       version-controlled rule files; `.devin/` takes precedence.
 *   https://docs.devin.ai/desktop/devin-desktop-faq (accessed 2026-07-12)
 *     — precedence + backward-compatibility statement; legacy `.windsurfrules`
 *       still read; no `.devinrules` single-file equivalent.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

import type { CanonicalFile } from "../types.js";
import { HATCH3R_PREFIX } from "../types.js";
import { slugifyRuleId, splitFrontmatter, type ImportedRule } from "./shared.js";

/** Windsurf rule activation modes (frontmatter `trigger`). */
export type WindsurfTrigger = "always_on" | "manual" | "model_decision" | "glob";

/** Parsed Windsurf `.windsurf/rules/*.md` frontmatter. */
export interface WindsurfRuleFrontmatter {
  /** Activation mode. */
  trigger?: WindsurfTrigger;
  /** Glob pattern(s); only meaningful when `trigger: glob`. */
  globs?: string | string[];
  /** Optional human-readable description. */
  description?: string;
}

/** Canonical id prefix for imported Windsurf rules. */
const WINDSURF_IMPORT_PREFIX = `${HATCH3R_PREFIX}windsurf-import-`;
/** Canonical id used for the legacy single-file `.windsurfrules`. */
const WINDSURF_LEGACY_ID = `${WINDSURF_IMPORT_PREFIX}windsurfrules`;

const VALID_TRIGGERS: ReadonlySet<string> = new Set<WindsurfTrigger>([
  "always_on",
  "manual",
  "model_decision",
  "glob",
]);

/** Normalise Windsurf `globs` (string or string[]) to trimmed glob strings. */
function normaliseGlobs(globs: WindsurfRuleFrontmatter["globs"]): string[] {
  if (globs == null) return [];
  const raw: string[] = Array.isArray(globs)
    ? globs.filter((g): g is string => typeof g === "string")
    : typeof globs === "string"
      ? globs.split(",")
      : [];
  return raw.map((g) => g.trim()).filter((g) => g.length > 0);
}

/**
 * Map a Windsurf `trigger` + `globs` to a canonical `scope`:
 *   - `always_on`                 → `"always"`
 *   - `glob` with concrete globs  → comma-joined CSV
 *   - `glob` with no globs        → `undefined` (mis-authored; caller may flag)
 *   - `manual` / `model_decision` → `undefined` (no static scope; the model
 *     decides activation, so no canonical glob/always mapping applies)
 *   - missing trigger             → `"always"` (Windsurf treats a rule with no
 *     trigger like the always-active legacy default)
 */
function triggerToScope(trigger: WindsurfTrigger | undefined, globs: string[]): string | undefined {
  switch (trigger) {
    case "always_on":
      return "always";
    case "glob":
      return globs.length > 0 ? globs.join(",") : undefined;
    case "manual":
    case "model_decision":
      return undefined;
    default:
      return "always";
  }
}

/**
 * Parse one Windsurf directory rule (`.windsurf/rules/<name>.md`) into a
 * canonical hatch3r rule.
 *
 * Mapping:
 *   `description`         → canonical `description`
 *   `trigger` (+ `globs`) → canonical `scope` (see {@link triggerToScope})
 *   body Markdown         → canonical `content`
 *
 * The canonical id strips `.md`, slugifies the name, and prefixes
 * `hatch3r-windsurf-import-`. Throws when a present frontmatter block is not
 * valid YAML (consistent with `parseCursorRule`).
 */
export function parseWindsurfRule(filename: string, rawContent: string): ImportedRule {
  const { frontmatterStr, body } = splitFrontmatter(rawContent);
  let fm: WindsurfRuleFrontmatter = {};
  if (frontmatterStr != null) {
    const parsed = parseYaml(frontmatterStr) as Record<string, unknown> | null;
    if (parsed && typeof parsed === "object") {
      const next: WindsurfRuleFrontmatter = {};
      if (typeof parsed.trigger === "string" && VALID_TRIGGERS.has(parsed.trigger)) {
        next.trigger = parsed.trigger as WindsurfTrigger;
      }
      if (typeof parsed.globs === "string" || Array.isArray(parsed.globs)) {
        next.globs = parsed.globs as WindsurfRuleFrontmatter["globs"];
      }
      if (typeof parsed.description === "string") next.description = parsed.description;
      fm = next;
    }
  }

  const slug = slugifyRuleId(filename.replace(/\.md$/i, ""));
  const id = `${WINDSURF_IMPORT_PREFIX}${slug}`;
  const scope = triggerToScope(fm.trigger, normaliseGlobs(fm.globs));

  const canonical: CanonicalFile = {
    id,
    type: "rule",
    description: fm.description ?? "",
    scope,
    tags: ["windsurf-import"],
    content: body,
    rawContent,
    sourcePath: filename,
  };

  return { sourcePath: filename, canonicalFilename: `${id}.md`, canonical };
}

/**
 * Parse the legacy plain-text `.windsurfrules` single file into a canonical
 * rule. The whole file is `content`; scope is `"always"` because every rule in
 * the legacy file is always active.
 */
export function parseWindsurfLegacyRules(rawContent: string): ImportedRule {
  const canonical: CanonicalFile = {
    id: WINDSURF_LEGACY_ID,
    type: "rule",
    description: "",
    scope: "always",
    tags: ["windsurf-import"],
    content: rawContent,
    rawContent,
    sourcePath: ".windsurfrules",
  };
  return {
    sourcePath: ".windsurfrules",
    canonicalFilename: `${WINDSURF_LEGACY_ID}.md`,
    canonical,
  };
}

/**
 * Read and parse every `.md` rule file under a single Windsurf/Devin rules
 * directory (`.devin/rules/` or `.windsurf/rules/`), in deterministic
 * path-sorted order. A missing directory (`ENOENT`) or a non-directory at the
 * path (`ENOTDIR`) yields an empty list; any other read error propagates.
 * Non-`.md` files are ignored. The `parseWindsurfRule` id is derived from the
 * bare filename, so the same rule name under either directory resolves to the
 * same canonical id (the property `parseWindsurfRulesDir` relies on for
 * precedence).
 */
async function readWindsurfRuleDir(rulesDir: string): Promise<ImportedRule[]> {
  let entries: string[] = [];
  try {
    entries = (await readdir(rulesDir)).filter((f) => f.toLowerCase().endsWith(".md")).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT" && (err as NodeJS.ErrnoException).code !== "ENOTDIR") {
      throw err;
    }
  }
  const rules: ImportedRule[] = [];
  for (const filename of entries) {
    const raw = await readFile(join(rulesDir, filename), "utf-8");
    rules.push(parseWindsurfRule(filename, raw));
  }
  return rules;
}

/**
 * Read and parse every Windsurf/Devin rule source under a repository root.
 *
 * Discovers (in deterministic order):
 *   1. `.devin/rules/*.md` (preferred directory rules — take precedence).
 *   2. `.windsurf/rules/*.md` (backward-compatibility fallback directory rules).
 *   3. `.windsurfrules` (legacy single file), appended last.
 *
 * Returns one `ImportedRule` per source file. A rule present in both
 * `.devin/rules/` and `.windsurf/rules/` yields two entries that resolve to the
 * same canonical id, `.devin/` first; the downstream runner's first-id-wins
 * pass keeps the `.devin/` copy and reports the `.windsurf/` copy as a shadowed
 * duplicate — mirroring Devin Desktop's own `.devin/` > `.windsurf/` precedence.
 * Missing directory/file yields no entry for that source. Non-`.md` files in a
 * rules directory are ignored. This parser does not write to disk, detect
 * conflicts, or wire into the CLI.
 *
 * @param rootDir - Absolute path to the repository root directory.
 */
export async function parseWindsurfRulesDir(rootDir: string): Promise<ImportedRule[]> {
  const results: ImportedRule[] = [];

  // Directory rules in Devin Desktop precedence order. Reading `.devin/rules/`
  // before `.windsurf/rules/` means a rule that exists in both directories is
  // adopted from `.devin/` (read first) by the runner's first-id-wins pass,
  // with the `.windsurf/` copy flagged as the shadowed duplicate.
  results.push(...(await readWindsurfRuleDir(join(rootDir, ".devin", "rules"))));
  results.push(...(await readWindsurfRuleDir(join(rootDir, ".windsurf", "rules"))));

  // Legacy single-file rules at the repo root. Devin Desktop still reads the
  // legacy `.windsurfrules` file and has no `.devinrules` single-file
  // equivalent (new rules use the directory format), so only `.windsurfrules`
  // is read here.
  try {
    const legacyPath = join(rootDir, ".windsurfrules");
    const raw = await readFile(legacyPath, "utf-8");
    results.push(parseWindsurfLegacyRules(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  return results;
}
