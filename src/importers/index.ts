/**
 * Migration-importer barrel + multi-format aggregator + runner (F14.4-H1/H2, D14).
 *
 * Re-exports every competitor-format importer and provides `importAllFormats`
 * (in-memory aggregation) plus `runImport` — the format-agnostic runner the
 * `hatch3r init --import <format|all|auto>` CLI flag dispatches to. The runner
 * takes parsed `ImportedRule[]` from any format and runs the same conflict-pass
 * + manual-review classification + `.md`/`.mdc` disk-write that the cursor
 * importer (`src/importers/cursor.ts::importCursorRules`) established, so
 * every format reaches `.hatch3r/overrides/rules/` through one code path.
 * Process/console-pure — the CLI caller renders the returned summaries.
 */
import { HatchError } from "../types.js";
import type { CanonicalFile } from "../types.js";
import {
  cursorCompanionFrontmatter,
  resolveUserContentRoot,
} from "../content/index.js";
import { resolveBundledContentRoot } from "../content/contentRoot.js";
import { parseFrontmatter } from "../adapters/canonical.js";
import { verbose } from "../cli/shared/ui.js";
import { atomicWriteFile } from "../merge/safeWrite.js";
import { canonicalScopeFields, type ImportedRule } from "./shared.js";
import { parseAgentsMdFile } from "./agentsMd.js";
import { parseAwesomeCursorrulesFile } from "./awesomeCursorrules.js";
import { parseCopilotInstructionsDir } from "./copilot.js";
import { parseCursorRulesDir, type ImportedCursorRule } from "./cursor.js";
import { parseWindsurfRulesDir } from "./windsurf.js";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify as yamlStringify } from "yaml";

export * from "./shared.js";
export * from "./cursor.js";
export * from "./copilot.js";
export * from "./windsurf.js";
export * from "./awesomeCursorrules.js";
export * from "./agentsMd.js";

/** Supported migration source formats. */
export type ImportFormat = "cursor" | "copilot" | "windsurf" | "cursorrules" | "agents";

/**
 * All importable source formats, in stable order. `agents` (root `AGENTS.md`
 * / `AGENT.md`, D14-SA14.4-03) is appended last so the pre-existing
 * cross-format id-precedence order of `--import auto` runs is unchanged.
 */
export const IMPORT_FORMATS: readonly ImportFormat[] = [
  "cursor",
  "copilot",
  "windsurf",
  "cursorrules",
  "agents",
] as const;

/** Rules imported from a single source format. */
export interface FormatImportResult {
  format: ImportFormat;
  rules: ImportedRule[];
}

/**
 * Run the importer for a single format against a repository root and return
 * its rules in canonical shape. The cursor format's `ImportedCursorRule` is
 * structurally assignable to `ImportedRule` (it adds no incompatible fields),
 * so the union return type is uniform.
 *
 * @param rootDir - Absolute path to the repository root directory.
 * @param format  - One of {@link IMPORT_FORMATS}.
 */
export async function importFormat(
  rootDir: string,
  format: ImportFormat,
): Promise<ImportedRule[]> {
  switch (format) {
    case "cursor": {
      const rules: ImportedCursorRule[] = await parseCursorRulesDir(
        join(rootDir, ".cursor", "rules"),
      );
      return rules;
    }
    case "copilot":
      return parseCopilotInstructionsDir(rootDir);
    case "windsurf":
      return parseWindsurfRulesDir(rootDir);
    case "cursorrules":
      return parseAwesomeCursorrulesFile(rootDir);
    case "agents":
      return parseAgentsMdFile(rootDir);
    default: {
      // Exhaustiveness guard: a new ImportFormat must add a case above.
      const never: never = format;
      throw new HatchError(
        `Unknown import format: ${String(never)}`,
        2,
        "VALIDATION_ERROR",
        `Pass one of: ${IMPORT_FORMATS.join(", ")}.`,
      );
    }
  }
}

/**
 * Run every importer against a repository root and return the rules grouped by
 * source format. Formats that find no source files yield an entry with an
 * empty `rules` array, so callers can report "0 found" per format. Importers
 * run in parallel — each reads disjoint source paths, so there is no shared
 * mutable state.
 *
 * Does NOT detect cross-format id collisions, write to disk, or report a
 * summary — those slices are cross-WU (F14.4-H2 / init.ts).
 *
 * @param rootDir - Absolute path to the repository root directory.
 */
export async function importAllFormats(rootDir: string): Promise<FormatImportResult[]> {
  const results = await Promise.all(
    IMPORT_FORMATS.map(async (format) => ({
      format,
      rules: await importFormat(rootDir, format),
    })),
  );
  return results;
}

// ── Format-agnostic import runner (F14.4-H2) ───────────────────────

/** A selectable `--import` target: any concrete format, or `auto` (every format). */
export type ImportTarget = ImportFormat | "auto";

/** All selectable `--import` targets, in stable order (`auto` last). */
export const IMPORT_TARGETS: readonly ImportTarget[] = [
  ...IMPORT_FORMATS,
  "auto",
] as const;

/**
 * Structured outcome of a single format's import run. Every parsed source rule
 * lands in exactly one of `converted`, `conflicts`, or `manualReview`. `shadows`
 * is not a fourth exclusive bucket — it annotates the subset of `converted`
 * whose topic overlaps a shipped canonical rule those imports now outrank via
 * override precedence. Mirrors the cursor importer's `CursorImportSummary` shape
 * so the CLI renders every format with one summary renderer.
 */
export interface FormatImportSummary {
  /** The source format this summary describes. */
  format: ImportFormat;
  /** Number of source rules discovered (the parse universe). */
  sourceFiles: number;
  /** Rules converted to canonical shape and not in conflict. */
  converted: ImportedRule[];
  /** Rules skipped because their canonical id collides (existing or intra-import duplicate). */
  conflicts: { sourcePath: string; canonicalFilename: string; reason: string }[];
  /** Rules deferred for human review (empty / missing frontmatter). */
  manualReview: { sourcePath: string; reason: string }[];
  /**
   * Converted rules whose topic overlaps a shipped canonical rule they now
   * outrank via `.hatch3r/overrides/rules/` precedence — the layer adapters
   * prefer over bundled canonical content. Informational: these rules are still
   * written (migration intent); the entry surfaces the otherwise-silent
   * precedence effect. Keyword topic overlap is a heuristic, not a semantic
   * diff. One entry per (imported rule, shipped rule) overlap.
   */
  shadows: { importedId: string; sourcePath: string; shippedRuleId: string; topic: string }[];
  /** Paths written to disk (`.md` + `.mdc` per converted rule); empty under dryRun. */
  written: string[];
  /** True when the run computed the summary without writing any file. */
  dryRun: boolean;
}

/**
 * Compose the canonical `.md` payload (frontmatter + body) for an imported
 * rule. Frontmatter carries the namespaced id, `type: rule`, description,
 * the format's import tag, and — when the source declared a scope — the
 * canonical scope fields per `canonicalScopeFields` (D1-SA1.1-09: a glob CSV
 * is emitted as `scope: conditional` + `globs: "<csv>"`, never as the
 * deprecated inline-CSV `scope`). Mirrors
 * `src/importers/cursor.ts::composeCanonicalMd` so cursor and the other three
 * formats emit byte-identical canonical files.
 */
function composeCanonicalMd(canonical: CanonicalFile): string {
  const fm: Record<string, unknown> = {
    id: canonical.id,
    type: "rule",
    description: canonical.description,
    tags: canonical.tags ?? [],
  };
  const scopeFields = canonicalScopeFields(canonical.scope, canonical.globs);
  if (scopeFields.scope !== undefined) fm.scope = scopeFields.scope;
  if (scopeFields.globs !== undefined) fm.globs = scopeFields.globs;
  const yaml = yamlStringify(fm).trim();
  const body = canonical.content.startsWith("\n")
    ? canonical.content
    : `\n${canonical.content}`;
  return `---\n${yaml}\n---\n${body}`;
}

/**
 * True when a parsed rule carries no usable frontmatter — an empty description
 * AND no resolved scope. These land in `manualReview` rather than being written
 * blind, because a rule with no description/scope conveys no source intent.
 */
function hasEmptyFrontmatter(rule: ImportedRule): boolean {
  return rule.canonical.description === "" && rule.canonical.scope === undefined;
}

/**
 * Topic index: a normalized topic keyword → the shipped canonical rule ids that
 * declare it as a tag. Injected into the import runner (mirrors `existingRuleIds`)
 * so shadow detection stays pure and unit-testable; {@link runImport} seeds a
 * default from the bundled canonical rule tags via {@link buildShippedRuleTopics}.
 * Keys are lowercase, `floor:` prefixes stripped, `ctx:` context tags excluded.
 */
export type ShippedRuleTopics = ReadonlyMap<string, ReadonlySet<string>>;

/** Shared empty index — no shipped topics means no shadow detection. */
const EMPTY_SHIPPED_RULE_TOPICS: ShippedRuleTopics = new Map();

/** Escape a topic keyword for safe embedding in a word-boundary RegExp. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Detect which converted rules SHADOW a shipped canonical rule. A shipped topic
 * keyword (length >= 3) that appears as a whole word in a converted rule's tags
 * + description + body flags that imported rule as a potential silent override
 * of every shipped rule carrying that topic — the import lands in
 * `.hatch3r/overrides/rules/`, the layer adapters prefer over bundled canonical
 * content. Keyword overlap is a heuristic, not a semantic diff: false positives
 * are acceptable because the goal is surfacing the precedence effect, not
 * proving contradiction. Deterministic output — topics and shipped ids are
 * visited in sorted order and each (imported rule, shipped rule) pair is emitted
 * once (the first matching topic wins). The >= 3 length floor drops 2-char tags
 * (`ui`, `ux`, `ai`) whose bare-word matches against prose would be noise.
 */
export function detectShadows(
  converted: readonly ImportedRule[],
  shippedRuleTopics: ShippedRuleTopics,
): FormatImportSummary["shadows"] {
  if (shippedRuleTopics.size === 0 || converted.length === 0) return [];

  const topics = [...shippedRuleTopics.keys()].filter((t) => t.length >= 3).sort();
  const shadows: FormatImportSummary["shadows"] = [];

  for (const rule of converted) {
    const haystack = [
      ...(rule.canonical.tags ?? []),
      rule.canonical.description,
      rule.canonical.content,
    ]
      .join("\n")
      .toLowerCase();
    const emittedShipped = new Set<string>();
    for (const topic of topics) {
      if (!new RegExp(`\\b${escapeRegExp(topic)}\\b`).test(haystack)) continue;
      for (const shippedRuleId of [...(shippedRuleTopics.get(topic) ?? [])].sort()) {
        if (emittedShipped.has(shippedRuleId)) continue;
        emittedShipped.add(shippedRuleId);
        shadows.push({
          importedId: rule.canonical.id,
          sourcePath: rule.sourcePath,
          shippedRuleId,
          topic,
        });
      }
    }
  }
  return shadows;
}

/**
 * Build the default {@link ShippedRuleTopics} index from the bundled canonical
 * rule tags: read `rules/*.md` under the bundled content root, lift each rule's
 * `tags`, strip `floor:` prefixes, and drop `ctx:` context tags (compatibility
 * statements, not topics). Resilient — a missing bundled root, unreadable dir,
 * or unparseable rule file yields whatever was accumulated so far, so a failure
 * to locate bundled rules disables shadow detection rather than failing the
 * import.
 */
async function buildShippedRuleTopics(): Promise<ShippedRuleTopics> {
  const topics = new Map<string, Set<string>>();
  try {
    const rulesDir = join(resolveBundledContentRoot(), "rules");
    const files = (await readdir(rulesDir)).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      try {
        const { metadata } = parseFrontmatter(await readFile(join(rulesDir, file), "utf-8"));
        const id = metadata.id;
        if (!id) continue;
        for (const tag of metadata.tags ?? []) {
          if (tag.startsWith("ctx:")) continue;
          const topic = tag.replace(/^floor:/, "").toLowerCase();
          if (!topic) continue;
          let ids = topics.get(topic);
          if (!ids) {
            ids = new Set<string>();
            topics.set(topic, ids);
          }
          ids.add(id);
        }
      } catch (err) {
        // Skip an unreadable/unparseable rule file; keep scanning the rest.
        verbose(
          `importers: skipped shipped rule "${file}" for the shadow-topic index — ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } catch (err) {
    // No bundled rules dir (or resolution failed) → shadow detection disabled.
    verbose(
      `importers: shadow-topic index disabled (bundled canonical rules unavailable) — ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return topics;
}

/**
 * Classify already-parsed rules for one format and (unless `dryRun`) write each
 * converted rule as BOTH a canonical `.md` and a Cursor-native `.mdc` companion
 * under `.hatch3r/overrides/rules/`. Pure of process.exit / console.
 *
 * Classification per rule (identical to the cursor runner):
 *   1. Empty/missing frontmatter (no description, no scope) → `manualReview`.
 *   2. Canonical id already in `existingRuleIds`, OR two parsed rules resolve to
 *      the same canonical id → `conflicts` (skip writing).
 *   3. Otherwise → `converted`.
 * Converted rules are additionally cross-referenced against `shippedRuleTopics`
 * (when supplied) via {@link detectShadows} to populate `summary.shadows` — the
 * subset of converts whose topic overlaps a shipped rule they now outrank via
 * override precedence. This is annotation only; shadowed rules are still written.
 *
 * @param rootDir           - Absolute path to the repository root directory.
 * @param format            - The source format these rules came from.
 * @param rules             - Parsed rules for this format (from {@link importFormat}).
 * @param dryRun            - When true, classify only; write nothing.
 * @param existingRuleIds   - Canonical + user rule ids already present (conflict source).
 * @param shippedRuleTopics - Shipped-rule topic index for shadow detection; when
 *                            omitted, `summary.shadows` is empty.
 */
export async function runFormatImport(opts: {
  rootDir: string;
  format: ImportFormat;
  rules: ImportedRule[];
  dryRun: boolean;
  existingRuleIds?: ReadonlySet<string>;
  shippedRuleTopics?: ShippedRuleTopics;
}): Promise<FormatImportSummary> {
  const { rootDir, format, rules, dryRun, existingRuleIds, shippedRuleTopics } = opts;

  const summary: FormatImportSummary = {
    format,
    sourceFiles: rules.length,
    converted: [],
    conflicts: [],
    manualReview: [],
    shadows: [],
    written: [],
    dryRun,
  };

  // Track ids produced within this run so two source rules that resolve to the
  // same canonical id are flagged as a conflict rather than the second silently
  // overwriting the first.
  const seenIds = new Set<string>();

  for (const rule of rules) {
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

  // Annotate (do not gate) the converts that shadow a shipped rule via override
  // precedence. Computed from `converted` regardless of dryRun, so a dry-run
  // preview surfaces the precedence warning before any write.
  summary.shadows = detectShadows(
    summary.converted,
    shippedRuleTopics ?? EMPTY_SHIPPED_RULE_TOPICS,
  );

  if (!dryRun && summary.converted.length > 0) {
    const rulesDir = join(resolveUserContentRoot(rootDir), "rules");
    await mkdir(rulesDir, { recursive: true });
    for (const rule of summary.converted) {
      const mdTarget = join(rulesDir, rule.canonicalFilename);
      await atomicWriteFile(mdTarget, composeCanonicalMd(rule.canonical));
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

/**
 * Resolve an {@link ImportTarget} to the concrete format list it covers.
 * A concrete format yields a single-element list; `auto` yields every format
 * in {@link IMPORT_FORMATS} stable order.
 */
export function resolveImportTargets(target: ImportTarget): readonly ImportFormat[] {
  return target === "auto" ? IMPORT_FORMATS : [target];
}

/**
 * Run the importer for one target (`<format>` or `auto`) and return one
 * {@link FormatImportSummary} per concrete format covered. Parses each format
 * via {@link importFormat}, then classifies + writes via {@link runFormatImport}.
 *
 * Conflict detection shares a single `seenIds` accumulator across formats so a
 * canonical id produced by an earlier format (e.g. the cursor parser) makes a
 * later format's identically-named rule a conflict, not a silent overwrite.
 * Formats are parsed in parallel (disjoint read paths) but classified/written
 * sequentially in {@link IMPORT_FORMATS} order so cross-format id precedence is
 * deterministic.
 *
 * Shadow detection: unless `shippedRuleTopics` is supplied, the topic index is
 * seeded once from the bundled canonical rule tags ({@link buildShippedRuleTopics})
 * and reused for every covered format, so each summary's `shadows` surfaces
 * imports that outrank a shipped rule via override precedence.
 *
 * @param rootDir           - Absolute path to the repository root directory.
 * @param target            - One of {@link IMPORT_TARGETS}.
 * @param dryRun            - When true, classify only; write nothing.
 * @param existingRuleIds   - Canonical + user rule ids already present (conflict source).
 * @param shippedRuleTopics - Optional shipped-rule topic index override; when
 *                            omitted, seeded from the bundled canonical rules.
 */
export async function runImport(opts: {
  rootDir: string;
  target: ImportTarget;
  dryRun: boolean;
  existingRuleIds?: ReadonlySet<string>;
  shippedRuleTopics?: ShippedRuleTopics;
}): Promise<FormatImportSummary[]> {
  const { rootDir, target, dryRun, existingRuleIds, shippedRuleTopics } = opts;
  const formats = resolveImportTargets(target);

  // Parse all covered formats up front (disjoint read paths → parallel-safe).
  const parsed = await Promise.all(
    formats.map(async (format) => ({ format, rules: await importFormat(rootDir, format) })),
  );

  // Seed the shadow-detection topic index once for the whole run (caller
  // override wins; otherwise read the bundled canonical rule tags).
  const shippedTopics = shippedRuleTopics ?? (await buildShippedRuleTopics());

  // Carry already-claimed ids across formats so the same canonical id can only
  // be written once across the whole run. Seed with the caller's existing ids.
  const claimedIds = new Set<string>(existingRuleIds ?? []);
  const summaries: FormatImportSummary[] = [];
  for (const { format, rules } of parsed) {
    const summary = await runFormatImport({
      rootDir,
      format,
      rules,
      dryRun,
      existingRuleIds: claimedIds,
      shippedRuleTopics: shippedTopics,
    });
    for (const c of summary.converted) {
      claimedIds.add(c.canonical.id);
    }
    summaries.push(summary);
  }
  return summaries;
}
