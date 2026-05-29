/**
 * Task-level routing — tag-filtered candidate set for LLM-decided final pick.
 *
 * Per Decision 8 / Bucket 2.4 of the hatch3r 2.0.0 design model, per-task
 * routing balances determinism (capability-tag pre-filter via
 * `src/content/tags.ts::TAG_REGISTRY`) with adaptivity (an LLM picks the
 * final artifact for each task from inside the filtered set). The functions
 * in this module are the deterministic upstream half — they whittle the
 * installed content surface down to a candidate set per task without
 * touching the LLM step.
 *
 * Pillars served:
 *   - P1 (CLI UI/UX Excellence): every admission / drop is paired with a
 *     human-readable rationale string so routing decisions are debuggable
 *     on demand.
 *   - P4 (Comprehensive Lean Coverage): tag-filtered admission keeps the
 *     installed surface relevant per task; routing never returns the full
 *     catalog when the task tags pinpoint a narrower slice.
 *
 * Design constraints:
 *   - Pure functions only — no I/O, no side effects, no logging via
 *     `verbose()` (that lives in resolveSelection's side-effecting host).
 *   - No mutation of the input arrays.
 *   - All `floor:*`-tagged items are admitted unconditionally (mirrors the
 *     preset-time floor invariant) — task routing cannot remove security or
 *     UI/UX content.
 *   - `narrowByProjectDetection` enforces tech-stack and lifecycle-stage
 *     compatibility but never drops floor items.
 *
 * Wiring into `resolveSelection` happens in a follow-up integration commit;
 * Bucket 2.1 is editing `src/content/index.ts` in parallel for the
 * maturity-tier admission stage.
 */

import { isFloorTag, isCapabilityTag, isLanguageTag, LANGUAGE_TO_TAG } from "./tags.js";

// ── Types ────────────────────────────────────────────────────────

/**
 * Minimal shape required by the routing functions. Compatible with
 * `CatalogItem` from `src/content/index.ts` (which carries `id`, `tags`,
 * and optional `protected`) but kept structural so this module can be
 * unit-tested without instantiating the full ContentIndex.
 */
export interface RoutableItem {
  /** Stable artifact identifier (e.g. "hatch3r-implementer"). */
  id: string;
  /** Tag list — capability, floor, context, and language tags. */
  tags: string[];
  /** Protected items bypass filtering. Inherits the semantics from CatalogItem. */
  protected?: boolean;
}

/**
 * A description of the work the orchestrator is about to dispatch. The
 * routing decision is per-task; this struct carries the inputs.
 *
 * `tags` lists the capability tags relevant to the task (e.g. `["review",
 * "ai"]` for an AI-feature review). An empty array means "task has no
 * capability constraints"; only floor and protected items are admitted in
 * that case (deliberate: an unparameterised task should not pull in the
 * full installed surface).
 */
export interface TaskDescription {
  /**
   * Capability tags the task needs. Items pass the capability gate when
   * any of their capability tags intersect this list. Floor items bypass
   * the gate.
   */
  tags: string[];
}

/**
 * Detected project state used to narrow the candidate set further than
 * the task-level capability filter. All three fields are required so
 * callers cannot silently bypass narrowing — pass empty arrays / explicit
 * "unknown" values for missing data instead.
 *
 * Fields:
 *   - `techStack`: language / runtime names detected in the project
 *     (e.g. `["typescript", "python"]`). Used to drop items whose
 *     `lang:*` tags exclude every detected language.
 *   - `lifecycleStage`: coarse project lifecycle bucket (`"greenfield"` |
 *     `"brownfield"`). Used to honour `ctx:greenfield-only` /
 *     `ctx:brownfield-only` markers — though the per-task router treats
 *     these as advisory; the preset-time `resolveSelection` filter is the
 *     primary enforcer.
 *   - `maturityTier`: maturity tier label introduced by Bucket 2.1
 *     (Decision 4). The router does not currently filter on this field —
 *     it is carried through to the rationale for downstream tooling and
 *     for the LLM step — but the call signature reserves the slot so a
 *     future tier-aware narrowing rule can be added without breaking
 *     callers.
 */
export interface ProjectDetection {
  techStack: string[];
  lifecycleStage: string;
  maturityTier: string;
}

/**
 * A single per-item routing decision in machine-readable form. `decision`
 * is `"admit"` or `"drop"`; `reason` is a short stable token describing the
 * cause (e.g. `"protected"`, `"floor"`, `"capability-match"`,
 * `"no-capability-match"`, `"ctx-greenfield-only"`, `"ctx-brownfield-only"`,
 * `"lang-mismatch"`, `"project-detection"`). Consumers assert on `decision`
 * + `reason` instead of substring-matching the free-text `rationale` lines,
 * which decouples tests and tooling from the human-readable format string.
 */
export interface RationaleEntry {
  id: string;
  decision: "admit" | "drop";
  reason:
    | "protected"
    | "floor"
    | "capability-match"
    | "no-capability-match"
    | "ctx-greenfield-only"
    | "ctx-brownfield-only"
    | "lang-mismatch"
    | "project-detection";
}

/**
 * The output of `buildCandidateSet`. `candidates` is the filtered subset
 * suitable for the LLM final-pick step; `rationale` is a parallel array of
 * one-line strings recording every admission / drop decision the routing
 * made. Rationale order is NOT guaranteed to align 1:1 with `candidates`
 * — callers consume it as a debug log, not a per-item annotation.
 * `rationaleStructured` carries the same per-item admit/drop decisions in a
 * machine-readable shape (one entry per admitted/dropped item, excluding the
 * `routing:` header/footer log lines) so callers can assert decisions
 * structurally without coupling to the `rationale` string format.
 */
export interface CandidateSet {
  candidates: RoutableItem[];
  rationale: string[];
  rationaleStructured: RationaleEntry[];
}

// ── Helpers (internal) ───────────────────────────────────────────

/**
 * True when the item is protected or carries any floor tag. Floor items
 * are admitted unconditionally — they bypass both the capability filter
 * and project-detection narrowing.
 */
function isFloorOrProtected(item: RoutableItem): boolean {
  if (item.protected) return true;
  return item.tags.some(isFloorTag);
}

/**
 * Resolve the project's tech-stack names to the corresponding `lang:*`
 * tag set. Reuses the `LANGUAGE_TO_TAG` map from `tags.ts` so language
 * routing matches the rest of the pipeline. Unknown languages are
 * silently dropped (consistent with `resolveLanguageTags`).
 */
function projectLangTags(techStack: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const lang of techStack) {
    const tag = LANGUAGE_TO_TAG[lang];
    if (tag) out.add(tag);
  }
  return out;
}

// ── Public functions ─────────────────────────────────────────────

/**
 * Filter content items down to those whose capability tags intersect the
 * task's tags. Floor-tagged and protected items are admitted
 * unconditionally — they cannot be dropped by task tags.
 *
 * Semantics:
 *   - When `taskTags` is empty, only floor + protected items pass.
 *   - When an item has zero capability tags AND no floor tag AND is not
 *     protected, it is dropped. This mirrors the preset-time reversed
 *     "empty tags = passthrough" rule from `resolveSelection` and avoids
 *     pulling in untagged debris.
 *   - The function returns a NEW array. The input is not mutated.
 *
 * @param items The full installed surface (or any candidate subset).
 * @param taskTags Capability tags describing the task. Non-capability tag
 *                 values in this array are accepted but never match an
 *                 item — only `isCapabilityTag()` values participate in
 *                 the intersection check.
 * @returns A subset where each item either has ≥1 matching capability tag
 *          OR carries a floor tag OR is protected.
 */
export function filterCandidatesByTags(
  items: readonly RoutableItem[],
  taskTags: readonly string[],
): RoutableItem[] {
  const taskTagSet = new Set<string>(taskTags.filter(isCapabilityTag));
  const out: RoutableItem[] = [];
  for (const item of items) {
    if (isFloorOrProtected(item)) {
      out.push(item);
      continue;
    }
    const itemCaps = item.tags.filter(isCapabilityTag);
    if (itemCaps.length === 0) continue; // reversed empty-tag rule
    if (itemCaps.some((t) => taskTagSet.has(t))) {
      out.push(item);
    }
  }
  return out;
}

/**
 * Narrow a candidate set by the project's detected state. Floor and
 * protected items are NEVER dropped — they always pass. Otherwise:
 *
 *   - Tech-stack: items carrying any `lang:*` tag must intersect the
 *     project's resolved language tag set. Items with zero `lang:*` tags
 *     are language-agnostic and pass through. When `project.techStack`
 *     is empty the language filter is a no-op (the call site has no
 *     language signal to filter on).
 *   - Lifecycle-stage: items tagged `ctx:greenfield-only` are dropped on
 *     brownfield projects and vice versa. Items tagged with neither pass.
 *     `lifecycleStage` values other than `"greenfield"` / `"brownfield"`
 *     are treated as "unknown" — the lifecycle filter is bypassed.
 *   - Maturity-tier: the field is carried through `ProjectDetection` for
 *     downstream tooling (the LLM final-pick step and the integration
 *     wiring in `resolveSelection`) but the router does not filter on it.
 *
 * @param candidates Pre-filtered candidate set (typically the output of
 *                   `filterCandidatesByTags`).
 * @param project Detected project state. All three fields required.
 * @returns A narrowed subset; input is not mutated.
 */
export function narrowByProjectDetection(
  candidates: readonly RoutableItem[],
  project: ProjectDetection,
): RoutableItem[] {
  const langTags = projectLangTags(project.techStack);
  const langFilterActive = project.techStack.length > 0;
  const stage = project.lifecycleStage;

  const out: RoutableItem[] = [];
  for (const item of candidates) {
    if (isFloorOrProtected(item)) {
      out.push(item);
      continue;
    }
    // Lifecycle-stage compatibility check (advisory at task time).
    if (stage === "greenfield" && item.tags.includes("ctx:brownfield-only")) {
      continue;
    }
    if (stage === "brownfield" && item.tags.includes("ctx:greenfield-only")) {
      continue;
    }
    // Language compatibility check.
    if (langFilterActive) {
      const itemLangs = item.tags.filter(isLanguageTag);
      if (itemLangs.length > 0) {
        const matches = itemLangs.some((t) => langTags.has(t));
        if (!matches) continue;
      }
    }
    out.push(item);
  }
  return out;
}

/**
 * Compose `filterCandidatesByTags` + `narrowByProjectDetection` into a
 * single call returning the final candidate set plus a rationale log.
 * Each entry in `rationale` is a one-line, human-readable string suitable
 * for surfacing under `--verbose` or for embedding in an LLM prompt as
 * "here is why these are the candidates".
 *
 * The function does NOT consult any external state — `items`, `task`,
 * and `project` together fully determine the output.
 *
 * @param items The full installed surface.
 * @param task The task description.
 * @param project Detected project state.
 * @returns Candidate set + rationale strings.
 */
export function buildCandidateSet(
  items: readonly RoutableItem[],
  task: TaskDescription,
  project: ProjectDetection,
): CandidateSet {
  const rationale: string[] = [];
  const rationaleStructured: RationaleEntry[] = [];
  rationale.push(
    `routing: input items=${items.length} taskTags=[${task.tags.join(", ")}] ` +
      `techStack=[${project.techStack.join(", ")}] lifecycle=${project.lifecycleStage} ` +
      `maturityTier=${project.maturityTier}`,
  );

  // Stage 1: capability tag filter.
  const afterTags = filterCandidatesByTags(items, task.tags);
  const droppedByTags = items.filter((i) => !afterTags.includes(i));
  for (const item of droppedByTags) {
    rationale.push(
      `drop ${item.id}: no capability-tag match for task tags [${task.tags.join(", ")}] and no floor/protected admission`,
    );
    rationaleStructured.push({ id: item.id, decision: "drop", reason: "no-capability-match" });
  }

  // Stage 2: project-detection narrowing. Compute the final survivor set
  // before recording structured admit entries so an item admitted by the
  // capability gate but then dropped here yields a single (drop) structured
  // entry — one entry per item, reflecting its FINAL decision (F3.3-L1).
  const afterProject = narrowByProjectDetection(afterTags, project);

  for (const item of afterTags) {
    // Items dropped by project narrowing are recorded as drops below; skip
    // the transient capability-stage admit so each item appears once.
    if (!afterProject.includes(item)) continue;
    if (item.protected) {
      rationale.push(`admit ${item.id}: protected bypass`);
      rationaleStructured.push({ id: item.id, decision: "admit", reason: "protected" });
    } else if (item.tags.some(isFloorTag)) {
      const floors = item.tags.filter(isFloorTag).join(", ");
      rationale.push(`admit ${item.id}: floor tag(s) [${floors}] bypass capability gate`);
      rationaleStructured.push({ id: item.id, decision: "admit", reason: "floor" });
    } else {
      const matched = item.tags
        .filter(isCapabilityTag)
        .filter((t) => task.tags.includes(t));
      rationale.push(
        `admit ${item.id}: capability match [${matched.join(", ")}]`,
      );
      rationaleStructured.push({ id: item.id, decision: "admit", reason: "capability-match" });
    }
  }

  const droppedByProject = afterTags.filter((i) => !afterProject.includes(i));
  for (const item of droppedByProject) {
    const langs = item.tags.filter(isLanguageTag);
    const ctxGf = item.tags.includes("ctx:greenfield-only");
    const ctxBf = item.tags.includes("ctx:brownfield-only");
    let reason: string;
    let structuredReason: RationaleEntry["reason"];
    if (ctxGf && project.lifecycleStage === "brownfield") {
      reason = "ctx:greenfield-only on brownfield project";
      structuredReason = "ctx-greenfield-only";
    } else if (ctxBf && project.lifecycleStage === "greenfield") {
      reason = "ctx:brownfield-only on greenfield project";
      structuredReason = "ctx-brownfield-only";
    } else if (langs.length > 0) {
      reason = `lang tags [${langs.join(", ")}] do not match techStack [${project.techStack.join(", ")}]`;
      structuredReason = "lang-mismatch";
    } else {
      reason = "project-detection narrowing";
      structuredReason = "project-detection";
    }
    rationale.push(`drop ${item.id}: ${reason}`);
    rationaleStructured.push({ id: item.id, decision: "drop", reason: structuredReason });
  }

  rationale.push(`routing: final candidates=${afterProject.length}`);
  return { candidates: afterProject, rationale, rationaleStructured };
}
