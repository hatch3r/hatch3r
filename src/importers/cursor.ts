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

/**
 * Minimum description length `hatch3r validate` accepts for a user override —
 * mirror of `src/cli/commands/validate.ts` USER_CONTENT_MIN_DESCRIPTION and
 * `src/content/userContent.ts` MIN_DESCRIPTION_LENGTH. A clean
 * `init --import cursor` writes overrides the init success box then tells the
 * user to check with `hatch3r validate`; source-tool descriptions are usually a
 * single short phrase, so a converted rule under this floor gets a synthesized
 * description instead of tripping the CTA (D1-SA1.1-03). Keep the three in sync.
 */
const USER_CONTENT_MIN_DESCRIPTION = 60;

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
  /**
   * First line of the YAML parser message when the source frontmatter failed to
   * parse. The parser no longer throws on malformed YAML (D1-SA1.1-01); it sets
   * this so the runner routes the file to `manualReview` with a specific reason
   * and keeps importing sibling files. Absent for well-formed sources.
   */
  parseError?: string;
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

/** First line of a (possibly multi-line) parser message, trimmed. */
function firstLine(message: string): string {
  return (message.split(/\r?\n/, 1)[0] ?? message).trim();
}

/**
 * First non-empty body line, stripped of a leading markdown heading (`#`), list
 * marker (`-`/`*`/`+`), or blockquote (`>`) prefix. Empty string when the body
 * has no usable line. Seeds a synthesized description.
 */
function firstBodyLine(body: string): string {
  for (const rawLine of body.split(/\r?\n/)) {
    const cleaned = rawLine
      .trim()
      .replace(/^#{1,6}\s+/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/^>\s+/, "")
      .trim();
    if (cleaned !== "") return cleaned;
  }
  return "";
}

/**
 * Reduce arbitrary text to a YAML-plain-scalar-safe single line: collapse
 * whitespace, neutralize the `:`+space mapping indicator and the space+`#`
 * comment indicator, drop stray `#`/`"`, and strip leading punctuation (YAML
 * block indicators like `*`, `[`, `&`). The canonical `.md` is emitted via
 * `yamlStringify` (self-quoting), but the `.mdc` companion interpolates the
 * description raw (`cursorCompanionFrontmatter`), so a synthesized description
 * that pulled in body text must not carry a sequence that corrupts the `.mdc`.
 */
function sanitizeForYamlScalar(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/:\s/g, " - ")
    .replace(/\s#/g, " ")
    .replace(/[#"]/g, "")
    .replace(/^[^\w\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build a description of at least {@link USER_CONTENT_MIN_DESCRIPTION} chars for
 * an imported rule whose source description is short or empty. Leads with the
 * most specific text available (source description, else the body's first line,
 * else the filename slug as words) and appends the import provenance (source
 * filename and scope). A trailing fixed clause guarantees the floor for
 * pathologically short inputs and flags the description as auto-generated so the
 * user refines it.
 */
function synthesizeImportDescription(
  sourceDescription: string,
  body: string,
  filename: string,
  scope: string | undefined,
): string {
  let lead = sourceDescription !== "" ? sourceDescription : firstBodyLine(body);
  if (lead === "") lead = slugifyCursorRuleId(filename).replace(/-/g, " ");
  if (lead.length > 140) lead = `${lead.slice(0, 137).trimEnd()}...`;
  const scopeClause = scope !== undefined ? `, scope ${scope}` : "";
  let description = sanitizeForYamlScalar(
    `${lead} — imported from Cursor rule file ${filename}${scopeClause}`,
  );
  if (description.length < USER_CONTENT_MIN_DESCRIPTION) {
    description = `${description} — auto-generated on import; edit to describe the rule's intent`;
  }
  return description;
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
 * Cycle 8 merge work. (Residual D1-SA1.1-03: `hatch3r validate` reserves the
 * `hatch3r-` prefix for canonical artifacts, so this id still trips its
 * reserved-prefix rule for user overrides — the reconciliation is a cross-file
 * follow-up on `src/cli/commands/validate.ts`, the finding's preferred fix.)
 *
 * Never throws on malformed YAML frontmatter (D1-SA1.1-01): a parse failure is
 * caught, the frontmatter is treated as empty, and the first line of the parser
 * message is recorded on `parseError` so the runner routes the file to
 * `manualReview` and keeps importing siblings. Missing frontmatter likewise
 * yields an empty description and no scope. A converted rule whose source
 * description is under {@link USER_CONTENT_MIN_DESCRIPTION} chars gets a
 * synthesized description so the override clears `hatch3r validate`'s floor
 * (D1-SA1.1-03).
 */
export function parseCursorRule(filename: string, rawContent: string): ImportedCursorRule {
  const match = rawContent.match(FRONTMATTER_REGEX);
  let frontmatter: CursorRuleFrontmatter = {};
  let body: string;
  let parseError: string | undefined;

  if (match) {
    const [, fmStr, bodyStr = ""] = match;
    // D1-SA1.1-01: contain a malformed-YAML throw here. Left unguarded it
    // propagates through `parseCursorRulesDir`'s per-file loop and aborts the
    // whole import — the CLI then surfaces a filename-less generic error and
    // skips sibling valid files. Catch, leave the frontmatter empty, and record
    // `parseError` so the runner routes just this file to `manualReview`.
    try {
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
    } catch (err) {
      parseError = firstLine(err instanceof Error ? err.message : String(err));
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

  // D1-SA1.1-03: keep converted rules above validate's ≥60-char description
  // floor. A rule with no intent (empty description AND no scope) keeps an empty
  // description so `hasEmptyFrontmatter` still routes it to manualReview; only
  // rules that will convert (a description or a scope) and fall under the floor
  // get a synthesized description.
  const sourceDescription = (frontmatter.description ?? "").trim();
  const hasIntent = sourceDescription !== "" || scope !== undefined;
  let description: string;
  if (!hasIntent) {
    description = "";
  } else if (sourceDescription.length >= USER_CONTENT_MIN_DESCRIPTION) {
    description = frontmatter.description ?? "";
  } else {
    description = synthesizeImportDescription(sourceDescription, body, filename, scope);
  }

  const canonical: CanonicalFile = {
    id,
    type: "rule",
    description,
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
    ...(parseError !== undefined ? { parseError } : {}),
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
    if (rule.parseError !== undefined) {
      // D1-SA1.1-01: malformed YAML frontmatter — name the file and the reason
      // instead of throwing a filename-less error and aborting the whole import.
      summary.manualReview.push({
        sourcePath: rule.sourcePath,
        reason: `invalid YAML frontmatter: ${rule.parseError}`,
      });
      continue;
    }
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
        rule.canonical.globs,
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
