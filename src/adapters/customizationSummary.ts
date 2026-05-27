// SA12.3-F03 (Cycle 10 Wave 2): customization-applied summary.
//
// `applyCustomization` is invoked 10× from `src/adapters/base.ts` per
// `npm test` coverage, but its applied state — what overrides were honored,
// what was dropped fail-closed, what was rejected as protected/floor — never
// reaches a user-facing report. The Silent Failure Contract (CONSTITUTION
// §2 P5) requires that consumed signal be observable; this module produces
// a structured summary that both `hatch3r explain --customizations` and the
// `Customizations` row in `hatch3r status` render from.
//
// Three failure modes are made visible:
//   (1) `enabled: false` on a non-protected, non-floor artifact -> SKIPPED
//       (artifact silently absent from adapter output; the report names it).
//   (2) Protected/floor artifact with `enabled: false` override -> FAILED
//       (the override is rejected at customization.ts line 437; the user sees
//       which artifact, which reason, and that the canonical body emits).
//   (3) Deny-pattern hit on .customize.md -> FAILED (entire body dropped
//       fail-closed at customization.ts line 530; the report names the
//       artifact and the violation count).
//
// The helper performs a dry-call: it enumerates every canonical artifact id
// from the bundled content root, calls `applyCustomization` against each, and
// captures the result + warnings. No adapter output is written. The dry-call
// surface is read-only from the user's repo perspective; only `.hatch3r/`
// customization files are read.

import { resolveBundledContentRoot } from "../content/contentRoot.js";
import {
  readCanonicalFiles,
  type CanonicalType,
} from "./canonical.js";
import { applyCustomization } from "./customization.js";
import type { CanonicalFile } from "../types.js";

/**
 * Customization classes that have a directory mapping in TYPE_TO_DIR
 * (`src/adapters/customization.ts:9`). Other canonical types (prompt, hook,
 * github-agent, check, policy, learning) do not consume customize files.
 */
const CUSTOMIZATION_TYPES: CanonicalType[] = [
  "agents",
  "skills",
  "commands",
  "rules",
];

export interface CustomizationStatus {
  /** Canonical artifact id (e.g. "hatch3r-reviewer"). */
  id: string;
  /** Canonical artifact type (singular form: "agent", "skill", "command", "rule"). */
  type: string;
  /**
   * Outcome class:
   *   - `active`  — at least one override applied (yaml fields and/or md body).
   *   - `skipped` — `enabled: false` honored; artifact dropped from emission.
   *   - `failed`  — at least one rejection warning surfaced (protected lock,
   *                 floor-tag lock, fail-closed deny-pattern drop, byte-cap
   *                 truncation, promptGuard block).
   *   - `none`    — no customize.yaml/.customize.md files for this id (default).
   */
  outcome: "active" | "skipped" | "failed" | "none";
  /** True iff this artifact has a `.hatch3r/{type}/{id}.customize.yaml` file. */
  hasYaml: boolean;
  /** True iff this artifact has a `.hatch3r/{type}/{id}.customize.md` file. */
  hasMd: boolean;
  /** Override values that survived the precedence + safety pipeline. */
  appliedOverrides: {
    description?: string;
    model?: string;
    scope?: string;
    enabled?: boolean;
  };
  /**
   * Human-readable reason for the outcome. For `failed`, the first warning
   * (causal). For `skipped`, "enabled: false honored". For `active`,
   * `<count> field(s) applied`. For `none`, undefined.
   */
  reason?: string;
  /** All warnings surfaced by `applyCustomization` for this artifact. */
  warnings: string[];
}

export interface CustomizationSummary {
  entries: CustomizationStatus[];
  counts: {
    /** Artifacts with active overrides (yaml fields and/or md body applied). */
    active: number;
    /** Artifacts where `enabled: false` was honored. */
    skipped: number;
    /** Artifacts where one or more rejections surfaced via warnings. */
    failed: number;
  };
}

/**
 * Map plural `CanonicalType` directory name to the singular type field used
 * inside `CanonicalFile.type` (the form consumed by `applyCustomization`'s
 * TYPE_TO_DIR lookup).
 */
function singularType(canonicalType: CanonicalType): string {
  switch (canonicalType) {
    case "agents":
      return "agent";
    case "skills":
      return "skill";
    case "commands":
      return "command";
    case "rules":
      return "rule";
    default:
      return canonicalType;
  }
}

/**
 * Classify a single `applyCustomization` invocation into one of the four
 * outcome classes. Centralized here so the explain and status renderers
 * share one definition.
 *
 * Outcome precedence (highest signal first):
 *   1. Rejection warning matches one of the known fail-closed phrases ->
 *      `failed`. Reason = first matching warning.
 *   2. `skip === true` -> `skipped` (enabled: false honored).
 *   3. Effective override applied (yaml fields or md body) -> `active`.
 *   4. No effect -> `none` (artifact has no customize files or all dropped).
 */
function classifyOutcome(args: {
  skip: boolean;
  overrideKeys: string[];
  warnings: string[];
  mdContentApplied: boolean;
}): { outcome: CustomizationStatus["outcome"]; reason?: string } {
  const { skip, overrideKeys, warnings, mdContentApplied } = args;
  // A rejection warning is the dominant signal. Every drop path (protected,
  // floor, promptGuard, deny-pattern, byte-cap) emits a warning we can key off.
  const rejectionWarning = warnings.find(
    (w) =>
      w.startsWith("Cannot disable") ||
      w.startsWith("Cannot override scope") ||
      w.startsWith("Cannot override description") ||
      w.startsWith("Scope override on") ||
      w.startsWith("Blocked: ") ||
      (w.includes("exceeds ") && w.includes(" bytes. Truncating")),
  );
  if (rejectionWarning) {
    return { outcome: "failed", reason: rejectionWarning };
  }
  if (skip) {
    return { outcome: "skipped", reason: "enabled: false honored" };
  }
  if (overrideKeys.length > 0 || mdContentApplied) {
    const parts: string[] = [];
    if (overrideKeys.length > 0) parts.push(`${overrideKeys.length} yaml field(s)`);
    if (mdContentApplied) parts.push("md body appended");
    return { outcome: "active", reason: parts.join(" + ") };
  }
  return { outcome: "none" };
}

/**
 * Build the per-artifact customization summary by dry-calling
 * `applyCustomization` against every canonical id under
 * {agents, skills, commands, rules} in the bundled content root.
 *
 * Read-only: never writes adapter output, never touches `.hatch3r/hatch.json`.
 * Side effects limited to `.hatch3r/{type}/*.customize.{yaml,md}` reads (the
 * same paths `applyCustomization` reads during sync).
 */
export async function buildCustomizationSummary(
  projectRoot: string,
): Promise<CustomizationSummary> {
  const bundledRoot = resolveBundledContentRoot();
  const entries: CustomizationStatus[] = [];

  for (const canonicalType of CUSTOMIZATION_TYPES) {
    // The warnings array passed to readCanonicalFiles is for canonical-read
    // errors (malformed frontmatter, etc.), not customization errors — we
    // suppress it here because summary callers care about customization
    // state, not canonical parse failures (those are surfaced by `validate`).
    const canonicalFiles: CanonicalFile[] = await readCanonicalFiles(bundledRoot, canonicalType);

    for (const file of canonicalFiles) {
      const result = await applyCustomization(projectRoot, file);
      // Detect whether any customize.{yaml,md} effect surfaced. Layers:
      //   - `result.warnings` non-empty -> at least one file was read AND
      //     processed (truncation, rejection, snapshot warning).
      //   - `result.overrides` keys -> yaml fields survived the pipeline.
      //   - `result.skip` -> yaml `enabled: false` honored.
      //   - `result.content !== file.content` -> md body appended.
      // Any of these is sufficient evidence that customize files exist for
      // this id.
      const hasMdContent = result.content !== file.content;
      const overrideKeys = Object.keys(result.overrides).filter(
        (k) => result.overrides[k as keyof typeof result.overrides] !== undefined,
      );
      const hasAnyEffect = result.warnings.length > 0 || overrideKeys.length > 0 || result.skip || hasMdContent;
      if (!hasAnyEffect) {
        // No customize files for this id — skip from the report entirely.
        continue;
      }

      const classification = classifyOutcome({
        skip: result.skip,
        overrideKeys,
        warnings: result.warnings,
        mdContentApplied: hasMdContent,
      });

      // Heuristic for the per-row `hasYaml` / `hasMd` flags exposed to
      // renderers. We do not re-read the snapshot to determine presence
      // (doubles I/O for no fidelity gain); instead we infer:
      //   - `hasYaml` true when overrides survived OR a yaml-shaped warning
      //     surfaced (Cannot disable / override / Scope override).
      //   - `hasMd` true when md content was applied OR a md-shaped warning
      //     surfaced (Blocked: Customization, byte-cap truncation).
      const yamlWarningPattern = /^(Cannot (disable|override)|Scope override|Customization YAML)/;
      const mdWarningPattern = /^(Blocked: Customization|Customization markdown)/;
      const hasYaml = overrideKeys.length > 0 || result.skip || result.warnings.some((w) => yamlWarningPattern.test(w));
      const hasMd = hasMdContent || result.warnings.some((w) => mdWarningPattern.test(w));

      entries.push({
        id: file.id,
        type: singularType(canonicalType),
        outcome: classification.outcome,
        hasYaml,
        hasMd,
        appliedOverrides: {
          description: result.overrides.description,
          model: result.overrides.model,
          scope: result.overrides.scope,
          enabled: result.overrides.enabled,
        },
        reason: classification.reason,
        warnings: result.warnings,
      });
    }
  }

  const counts = {
    active: entries.filter((e) => e.outcome === "active").length,
    skipped: entries.filter((e) => e.outcome === "skipped").length,
    failed: entries.filter((e) => e.outcome === "failed").length,
  };

  // Stable sort by type then id so the report is deterministic across runs.
  entries.sort((a, b) => (a.type === b.type ? a.id.localeCompare(b.id) : a.type.localeCompare(b.type)));

  return { entries, counts };
}
