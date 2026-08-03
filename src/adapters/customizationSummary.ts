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
import { isIdInSelection } from "../content/index.js";
import {
  readCanonicalFiles,
  type CanonicalType,
} from "./canonical.js";
import { applyCustomization } from "./customization.js";
import type { CanonicalFile, ContentSelection } from "../types.js";

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
   *                 truncation, promptGuard block, model override dropped on a
   *                 modelless type, or a YAML read failure — oversize/parse-error).
   *   - `inert`   — an override exists but the artifact is NOT in the current
   *                 content selection (`manifest.content.items`), so no adapter
   *                 ever emits it. The override is real but has no effect on
   *                 output. Dominates `active`/`skipped`/`failed` when a
   *                 selection set is supplied (D10-29).
   *   - `none`    — no customize.yaml/.customize.md files for this id (default).
   */
  outcome: "active" | "skipped" | "failed" | "inert" | "none";
  /** True iff this artifact has a `.hatch3r/{type}/{id}.customize.yaml` file. */
  hasYaml: boolean;
  /** True iff this artifact has a `.hatch3r/{type}/{id}.customize.md` file. */
  hasMd: boolean;
  /** Override values that survived the precedence + safety pipeline. */
  appliedOverrides: {
    description?: string;
    model?: string;
    /** release/2.7.0 effort axis — agents-only, enum-gated at apply time. */
    effort?: string;
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
    /**
     * Artifacts whose override is real but inert because the artifact is not in
     * the current content selection (`manifest.content.items`) — counted only
     * when a selection set is passed to `buildCustomizationSummary` (D10-29).
     */
    inert: number;
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
  // A rejection warning is the dominant signal. Every drop path — protected /
  // floor lock, promptGuard block, deny-pattern, byte-cap truncation, model
  // no-op on a modelless type, and YAML read failure (oversize / parse-error) —
  // emits a warning we key off. This prefix list is a hand-maintained mirror of
  // the emitters in customization.ts + customize.ts; keep it in sync when a new
  // warning family is added (D2-SA2.3-09: three families had drifted un-mirrored
  // and fell through to `none`).
  const rejectionWarning = warnings.find(
    (w) =>
      w.startsWith("Cannot disable") ||
      w.startsWith("Cannot override scope") ||
      w.startsWith("Cannot override description") ||
      w.startsWith("Scope override on") ||
      // D11-SA11.4-02: a `model:` override on a rule/prompt/hook is dropped with
      // this warning (customization.ts) — the structural twin of the "Scope
      // override on" no-op above; D02 §2.3 lists BOTH as When-warns rows, so the
      // classifier catches them symmetrically, not scope-only.
      w.startsWith("Model override on") ||
      // release/2.7.0: an `effort:` override on a non-agent type is dropped
      // with this warning (customization.ts TYPES_WITHOUT_EFFORT) — same
      // no-op family as the scope/model rows above. The enum-gate strip
      // ("Blocked: YAML effort …") is already caught by the "Blocked: "
      // prefix row below.
      w.startsWith("Effort override on") ||
      w.startsWith("Blocked: ") ||
      // D2-SA2.3-09: both YAML-read failure families drop the override —
      // oversize ("Customization YAML for … exceeds … bytes. Skipping.") and the
      // D2-12 parse-error ("Customization YAML for … failed to parse …", whose
      // visibility was the point of that fix). "Customization YAML" uniquely
      // prefixes these two (snapshot warnings begin "Customization file(s)", md
      // warnings "Customization markdown"), so this catches both drops without
      // over-matching.
      w.startsWith("Customization YAML") ||
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
 *
 * D10-29: `buildCustomizationSummary` dry-calls against the FULL bundled
 * corpus, but a user's repo emits only the artifacts in `manifest.content.items`
 * (the selection set). An override on a deselected artifact therefore reaches
 * no adapter output — reporting it as `active` mislabels a no-op as honored.
 * When the caller passes `selectedIds` (the union of `content.items` across all
 * types), an override on an id absent from that set is reclassified `inert`
 * with the reason "not in current selection; will not be emitted". Omitting
 * `selectedIds` (legacy "full" manifests with no `content` block) preserves the
 * prior unfiltered behavior — every override is classified on its own merit.
 *
 * Selection-set membership routes through `isIdInSelection`
 * (src/content/index.ts): current-form ids (incl. the selection-side `cmd-`
 * prefix on commands) plus the legacy un-`cmd-`-prefixed and bare (no
 * `hatch3r-`) forms are accepted, mirroring the orphan-customize scan in
 * `src/cli/commands/sync.ts`.
 */
export async function buildCustomizationSummary(
  projectRoot: string,
  selectedIds?: ReadonlySet<string>,
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

      let classification = classifyOutcome({
        skip: result.skip,
        overrideKeys,
        warnings: result.warnings,
        mdContentApplied: hasMdContent,
      });

      // D10-29: a real override on an artifact the manifest never selects has
      // no effect on adapter output. Reclassify it `inert` so the report does
      // not advertise a deselected override as `active`/`skipped`/`failed`.
      // `failed` is preserved — a rejection warning (protected/floor/deny) is a
      // user-actionable authoring error regardless of selection, so it stays
      // visible rather than being masked as inert.
      //
      // D10-SA10.6-01: membership routes through the shared
      // `isIdInSelection` predicate (src/content/index.ts) — the same one the
      // adapter emission allowlist uses — which maps command ids to their
      // selection-side `cmd-` form. The prior local predicate skipped that
      // mapping, so every selected command override was mislabeled `inert`.
      if (
        selectedIds !== undefined &&
        classification.outcome !== "failed" &&
        !isIdInSelection(file.id, singularType(canonicalType), selectedIds)
      ) {
        classification = {
          outcome: "inert",
          reason: "not in current selection; will not be emitted",
        };
      }

      // Heuristic for the per-row `hasYaml` / `hasMd` flags exposed to
      // renderers. We do not re-read the snapshot to determine presence
      // (doubles I/O for no fidelity gain); instead we infer:
      //   - `hasYaml` true when overrides survived OR a yaml-shaped warning
      //     surfaced (Cannot disable / override / Scope override).
      //   - `hasMd` true when md content was applied OR a md-shaped warning
      //     surfaced (Blocked: Customization, byte-cap truncation).
      const yamlWarningPattern = /^(Cannot (disable|override)|Scope override|Model override|Effort override|Customization YAML)/;
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
          effort: result.overrides.effort,
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
    inert: entries.filter((e) => e.outcome === "inert").length,
  };

  // Stable sort by type then id so the report is deterministic across runs.
  entries.sort((a, b) => (a.type === b.type ? a.id.localeCompare(b.id) : a.type.localeCompare(b.type)));

  return { entries, counts };
}

/**
 * Derive the `selectedIds` argument for `buildCustomizationSummary` from a
 * manifest's `content` selection (D10-29). Returns the union of every id across
 * `content.items.{agents,skills,rules,commands,...}`.
 *
 * Returns `undefined` when `content` is absent (legacy "full" manifests with no
 * selection block) so the caller passes nothing and `buildCustomizationSummary`
 * keeps its prior unfiltered behavior — never down-grading a real override to
 * `inert` on a manifest that does not record a selection. Callers pass the
 * result straight through:
 *   `buildCustomizationSummary(rootDir, selectionSetFromManifest(manifest.content))`.
 */
export function selectionSetFromManifest(
  content: ContentSelection | undefined,
): ReadonlySet<string> | undefined {
  if (!content) return undefined;
  const ids = new Set<string>();
  for (const list of Object.values(content.items)) {
    for (const id of list) ids.add(id);
  }
  return ids;
}
