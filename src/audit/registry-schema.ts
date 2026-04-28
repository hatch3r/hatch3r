/**
 * src/audit/registry-schema.ts
 *
 * Type definitions, parsing, validation, and migration for the audit
 * finding-registry. Hand-rolled (no schema lib) to match the project's
 * lean dependency policy and the validate-rule-parity.ts / inventory.ts
 * scaffold pattern.
 *
 * Pillars: P2 (Scientific Quality — rigor of prior-cycle signal),
 *          P4 (Lean Coverage — bounded live registry),
 *          P5 (Governance Self-Quality — code-enforced contracts),
 *          P7 (Speed & Token Efficiency).
 *
 * The registry has two shapes on disk:
 *
 *   v1 (legacy):  Finding[]                       — bare array
 *   v2 (current): { schema_version, generated_at, entries: Finding[] }
 *
 * `parseRegistry` accepts both. `migrate` converts v1 → v2 with a
 * documented backfill strategy. `validateRegistry` returns a structured
 * DriftReport[] consumed by scripts/validate-finding-registry.ts and the
 * Phase 0 audit-execute orchestrator.
 */

export const CURRENT_REGISTRY_VERSION = "2.0.0";

export type Severity = "Critical" | "High" | "Medium" | "Low" | "Info";

export type Disposition =
  | "targeted"
  | "excluded"
  | "human_only"
  | "deferred"
  | "already_resolved"
  | "rollover"
  | "partially_promoted"
  | "external_blocker"
  | "phase_5_candidate"
  | "multi_cycle_deferred";

export type ExecutionStatus =
  | "pending"
  | "done"
  | "partial"
  | "failed"
  | "rolled_back"
  | "never_attempted"
  | "already_resolved"
  | "deferred";

export type Confidence = "high" | "medium" | "low";

export type ExecutionTier = 1 | 2 | 3;

export interface FeatureStatus {
  implemented: boolean;
  wired: boolean;
  cli_registered: boolean;
  tested: boolean;
}

export interface Finding {
  finding_id: string;
  domain: string;
  severity: Severity;
  description: string;
  disposition: Disposition;

  // Phase 1 triage fields (post-Cycle-7 entries carry these; pre-Cycle-7
  // legacy entries are grandfathered via disposition_note=pre-rigor-contract).
  confidence?: Confidence;
  causal_chain_depth?: number;
  sources?: ReadonlyArray<unknown>;
  central_path?: boolean;
  execution_tier?: ExecutionTier;
  tier1_pattern?: string | null;

  // Owner & cycle attribution.
  owner?: string;
  cycle?: string | number;

  // Dedup linkage. `keep` and `merge_into:<id>` are mutually exclusive.
  dedup_action?: string;
  dedup_tier?: number | null;
  dedup_rationale?: string | null;

  // Phase 2 grouping.
  work_unit?: string;
  wave?: number | null;
  sub_wave_batch?: number | null;

  // Phase 4 execution telemetry.
  execution_status?: ExecutionStatus;
  commit_sha?: string | null;
  rollback_reason?: string | null;
  rollback_level?: number | null;

  // Final review.
  reviewer_verdict?: string | null;
  reviewer_notes?: string | null;
  false_positive?: boolean;

  // Phase 5/7 closed-loop.
  cl1_status?: string | null;
  sdr_status?: string | null;

  // Misc / cross-cutting.
  pillar?: ReadonlyArray<string>;
  finding_type?: string;
  effort?: string;
  depends_on?: string | null;
  feature_status?: FeatureStatus;
  files_modified?: ReadonlyArray<string>;
  files_affected?: ReadonlyArray<string>;
  parent_finding?: string;
  source_finding_ref?: string;

  // Migration provenance. Set by `migrate()` on backfilled entries.
  schema_revision?: string;
  confidence_basis?: string;
  disposition_note?: string;

  // Tolerated extension: forward-compatible extra fields.
  [extra: string]: unknown;
}

export interface Registry {
  schema_version: string;
  generated_at: string;
  entries: Finding[];
}

export interface DriftReport {
  finding_id: string;
  reason: string;
  detail: string;
}

export type ParsedRegistry =
  | { kind: "v2"; registry: Registry; rawLength: number }
  | { kind: "legacy-v1"; entries: Finding[]; rawLength: number };

export class RegistryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryParseError";
  }
}

const TIER1_PATTERN_ENUM: ReadonlySet<string> = new Set([
  // Closed enum from AUDIT-EXECUTE.md §Tier Classification — Tier 1.
  // Kept here as the runtime authority. Update when AUDIT-EXECUTE.md
  // adds new mechanical fix-shapes via CL-3.
  "anti-slop-substitution",
  "frontmatter-field-stamp",
  "broken-link-fix",
  "trailing-whitespace",
  "missing-pillar-tag",
  "missing-last-updated",
]);

const VALID_DISPOSITIONS: ReadonlySet<string> = new Set([
  "targeted",
  "excluded",
  "human_only",
  "deferred",
  "already_resolved",
  "rollover",
  "partially_promoted",
  "external_blocker",
  "phase_5_candidate",
  "multi_cycle_deferred",
]);

const VALID_SEVERITIES: ReadonlySet<string> = new Set([
  "Critical",
  "High",
  "Medium",
  "Low",
  "Info",
]);

const VALID_EXECUTION_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "done",
  "partial",
  "failed",
  "rolled_back",
  "never_attempted",
  "already_resolved",
  "deferred",
]);

/**
 * Dispositions that mark an entry as a rollover summary, not a single
 * finding. Rollover summaries carry aggregate fields (`medium_count`,
 * `low_count`, `promoted_finding_ids`) and use composite severities
 * like `Medium+Low`. They are exempt from the per-finding rigor contract.
 */
const ROLLOVER_SUMMARY_DISPOSITIONS: ReadonlySet<string> = new Set([
  "rollover",
  "partially_promoted",
]);

const AGGREGATE_SEVERITY_RE = /^[A-Z][a-z]+(\+[A-Z][a-z]+)+$/;

/**
 * Parse a raw JSON value into either v2 envelope or v1 legacy array.
 * Throws RegistryParseError on shapes neither matches.
 */
export function parseRegistry(raw: unknown): ParsedRegistry {
  if (Array.isArray(raw)) {
    const entries = raw.map(coerceFindingShape);
    return { kind: "legacy-v1", entries, rawLength: raw.length };
  }
  if (raw === null || typeof raw !== "object") {
    throw new RegistryParseError(
      "registry root is neither an array (v1) nor an object (v2)",
    );
  }
  const obj = raw as Record<string, unknown>;
  if (!("schema_version" in obj) || typeof obj.schema_version !== "string") {
    throw new RegistryParseError(
      "registry object is missing string `schema_version`",
    );
  }
  if (!Array.isArray(obj.entries)) {
    throw new RegistryParseError("registry object is missing array `entries`");
  }
  const generated_at =
    typeof obj.generated_at === "string" ? obj.generated_at : "";
  const entries = obj.entries.map(coerceFindingShape);
  return {
    kind: "v2",
    registry: {
      schema_version: obj.schema_version,
      generated_at,
      entries,
    },
    rawLength: obj.entries.length,
  };
}

/**
 * Coerce a JSON value into a Finding-shaped object. Does not validate field
 * presence or values — only ensures it is a non-null object. Validation
 * happens in `validateRegistry`. This split mirrors how zod's safeParse and
 * issue lists are conventionally separated, without adding the dep.
 */
function coerceFindingShape(value: unknown): Finding {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RegistryParseError(
      `finding entry is not an object: ${JSON.stringify(value)}`,
    );
  }
  return value as Finding;
}

export interface ValidateOptions {
  /**
   * When true, applies the post-migration strict contract:
   * - confidence/causal_chain_depth/sources required (no disposition_note grandfather).
   * - execution_tier required for targeted findings.
   * - work_unit required after Phase 2 (caller decides; this option just enables the check).
   *
   * When false (default), legacy-tolerant: pre-rigor-contract entries with
   * disposition_note="pre-rigor-contract" are allowed to omit rigor fields.
   */
  strict?: boolean;
  /**
   * Enable Phase 2 invariants (work_unit + wave coverage). Default false —
   * Phase 1 validator runs before Phase 2 and would falsely flag every entry.
   */
  postPhase2?: boolean;
}

/**
 * Validate a parsed registry against AUDIT-EXECUTE.md §Finding Registry
 * Invariants 1-7 (excluding 6 — Registry Anchor — which is checked by a
 * separate anchor-log validator). Returns drift reports; empty array means
 * no drift.
 */
export function validateRegistry(
  parsed: ParsedRegistry,
  opts: ValidateOptions = {},
): DriftReport[] {
  const reports: DriftReport[] = [];
  const entries =
    parsed.kind === "v2" ? parsed.registry.entries : parsed.entries;

  // Schema-version gate: when strict, the file MUST be v2.
  if (opts.strict && parsed.kind !== "v2") {
    reports.push({
      finding_id: "<file>",
      reason: "schema_version missing",
      detail:
        "strict mode requires the v2 envelope " +
        `({ schema_version, generated_at, entries }); got legacy v1 array`,
    });
  }
  if (parsed.kind === "v2") {
    const v = parsed.registry.schema_version;
    if (v !== CURRENT_REGISTRY_VERSION) {
      reports.push({
        finding_id: "<file>",
        reason: "schema_version mismatch",
        detail: `expected "${CURRENT_REGISTRY_VERSION}", got "${v}"`,
      });
    }
  }

  // Per-entry shape checks + collect for invariant cross-checks.
  const seenIds = new Map<string, number>(); // id -> index of first occurrence
  const byId = new Map<string, Finding>();
  for (let i = 0; i < entries.length; i++) {
    const f = entries[i];
    reports.push(...validateEntry(f, i, opts));
    const id = typeof f.finding_id === "string" ? f.finding_id : "";
    if (id) {
      if (seenIds.has(id)) {
        reports.push({
          finding_id: id,
          reason: "duplicate finding_id",
          detail: `entry index ${i}; first seen at index ${seenIds.get(id)}`,
        });
      } else {
        seenIds.set(id, i);
        byId.set(id, f);
      }
    }
  }

  // Invariant 2: dedup_action `merge_into:<id>` ↔ `merged_from:<id>` symmetry.
  for (const f of entries) {
    const action = typeof f.dedup_action === "string" ? f.dedup_action : "";
    const m = action.match(/^merge_into:(.+)$/);
    if (!m) continue;
    const targetId = m[1].trim();
    const target = byId.get(targetId);
    if (!target) {
      reports.push({
        finding_id: f.finding_id,
        reason: "dedup target missing",
        detail: `dedup_action="${action}" references unknown finding_id "${targetId}"`,
      });
      continue;
    }
    const targetAction =
      typeof target.dedup_action === "string" ? target.dedup_action : "";
    if (!targetAction.startsWith("merged_from:")) {
      reports.push({
        finding_id: f.finding_id,
        reason: "dedup symmetry broken",
        detail: `target "${targetId}" has dedup_action="${targetAction}"; expected "merged_from:..."`,
      });
    }
  }

  return reports;
}

function validateEntry(
  f: Finding,
  index: number,
  opts: ValidateOptions,
): DriftReport[] {
  const reports: DriftReport[] = [];
  const id = typeof f.finding_id === "string" ? f.finding_id : `<index ${index}>`;

  // Required fields (all entries, all cycles).
  if (typeof f.finding_id !== "string" || f.finding_id.length === 0) {
    reports.push({
      finding_id: id,
      reason: "missing finding_id",
      detail: `entry at index ${index} has no finding_id string`,
    });
  }
  if (typeof f.domain !== "string" || f.domain.length === 0) {
    reports.push({ finding_id: id, reason: "missing domain", detail: "" });
  }
  const isRolloverSummary =
    typeof f.disposition === "string" &&
    ROLLOVER_SUMMARY_DISPOSITIONS.has(f.disposition);
  if (typeof f.severity !== "string") {
    reports.push({
      finding_id: id,
      reason: "missing severity",
      detail: "",
    });
  } else if (!VALID_SEVERITIES.has(f.severity)) {
    // Rollover summaries may carry aggregate severities like "Medium+Low".
    if (!(isRolloverSummary && AGGREGATE_SEVERITY_RE.test(f.severity))) {
      reports.push({
        finding_id: id,
        reason: "invalid severity",
        detail: `got ${JSON.stringify(f.severity)}; expected one of Critical|High|Medium|Low|Info${isRolloverSummary ? " or aggregate <Sev>+<Sev>" : ""}`,
      });
    }
  }
  if (typeof f.description !== "string" || f.description.length === 0) {
    reports.push({ finding_id: id, reason: "missing description", detail: "" });
  }
  if (typeof f.disposition !== "string" || !VALID_DISPOSITIONS.has(f.disposition)) {
    reports.push({
      finding_id: id,
      reason: "invalid disposition",
      detail: `got ${JSON.stringify(f.disposition)}`,
    });
  }

  // Targeted-only checks. Rollover summaries are exempt from the rigor
  // contract — they aggregate per-finding work into a single registry row
  // for traceability, not for execution.
  const isTargeted = f.disposition === "targeted";
  if (isTargeted) {
    if (
      typeof f.execution_status !== "string" ||
      !VALID_EXECUTION_STATUSES.has(f.execution_status)
    ) {
      reports.push({
        finding_id: id,
        reason: "invalid execution_status on targeted",
        detail: `got ${JSON.stringify(f.execution_status)}`,
      });
    }
  }

  // Rigor contract: confidence/causal_chain_depth/sources.
  // Legacy-tolerant: allowed missing if disposition_note === "pre-rigor-contract".
  const isPreRigor =
    typeof f.disposition_note === "string" &&
    f.disposition_note === "pre-rigor-contract";
  const requiresRigor = !isPreRigor || opts.strict === true;
  if (requiresRigor && isTargeted) {
    if (typeof f.confidence !== "string") {
      reports.push({
        finding_id: id,
        reason: "missing confidence",
        detail: opts.strict
          ? "strict mode requires confidence on every targeted entry"
          : "post-Cycle-7 targeted entries must carry confidence",
      });
    }
    if (typeof f.causal_chain_depth !== "number") {
      reports.push({
        finding_id: id,
        reason: "missing causal_chain_depth",
        detail: "",
      });
    } else if (f.causal_chain_depth < 3 && !isPreRigor) {
      reports.push({
        finding_id: id,
        reason: "shallow causal_chain_depth",
        detail: `got ${f.causal_chain_depth}; rigor contract requires >=3`,
      });
    }
    if (!Array.isArray(f.sources)) {
      reports.push({
        finding_id: id,
        reason: "missing sources",
        detail: "rigor contract requires sources array (may be empty for code-internal findings)",
      });
    }
  }

  // Invariant 7: tier coverage on targeted.
  if (isTargeted && opts.strict) {
    if (
      f.execution_tier !== 1 &&
      f.execution_tier !== 2 &&
      f.execution_tier !== 3
    ) {
      reports.push({
        finding_id: id,
        reason: "missing execution_tier",
        detail: `got ${JSON.stringify(f.execution_tier)}; required when strict`,
      });
    }
  }
  if (f.execution_tier === 1) {
    if (typeof f.tier1_pattern !== "string" || f.tier1_pattern.length === 0) {
      reports.push({
        finding_id: id,
        reason: "tier=1 missing tier1_pattern",
        detail: "execution_tier=1 requires a non-null tier1_pattern from the closed enum",
      });
    } else if (!TIER1_PATTERN_ENUM.has(f.tier1_pattern)) {
      reports.push({
        finding_id: id,
        reason: "tier1_pattern outside closed enum",
        detail: `got "${f.tier1_pattern}"; allowed: ${[...TIER1_PATTERN_ENUM].join(", ")}`,
      });
    }
  }

  // Invariants 3+4 (Phase 2 fields).
  if (opts.postPhase2 && isTargeted) {
    if (typeof f.work_unit !== "string" || f.work_unit.length === 0) {
      reports.push({
        finding_id: id,
        reason: "missing work_unit",
        detail: "Phase 2 invariant: every targeted finding has a work_unit",
      });
    }
    if (typeof f.wave !== "number") {
      reports.push({
        finding_id: id,
        reason: "missing wave",
        detail: "Phase 2 invariant: every targeted finding has a wave",
      });
    }
  }

  return reports;
}

/**
 * Convert a legacy v1 array to a v2 envelope. Backfill rules:
 *
 * - Entries lacking `confidence`, `causal_chain_depth`, OR `sources` get
 *   `disposition_note: "pre-rigor-contract"` plus `confidence: "medium"` /
 *   `causal_chain_depth: 0` / `sources: []` placeholders + `confidence_basis`
 *   recording the backfill provenance. The validator allows depth=0 only
 *   when this note is set; new entries must satisfy the full rigor contract.
 *
 * - Entries lacking `execution_tier` default to `3` (the safest tier — sees
 *   a dedicated sub-agent rather than a batch). Mirrors the prose at
 *   AUDIT-EXECUTE.md:256 ("Absent on pre-Cycle-9 entries → treat as 3").
 *
 * - Entries lacking `central_path` default to `false`.
 *
 * - Entries lacking `false_positive` default to `false`.
 *
 * - The wrapper carries `schema_version: CURRENT_REGISTRY_VERSION` and a
 *   `generated_at` ISO timestamp.
 *
 * The function is pure: input array is not mutated.
 */
export interface MigrateOptions {
  /** ISO timestamp; defaults to new Date().toISOString(). Override for deterministic tests. */
  generatedAt?: string;
}

export interface MigrationStats {
  total: number;
  preRigorBackfilled: number;
  tierBackfilled: number;
  centralPathBackfilled: number;
  falsePositiveBackfilled: number;
}

export function migrate(
  legacy: ReadonlyArray<unknown>,
  opts: MigrateOptions = {},
): { registry: Registry; stats: MigrationStats } {
  const stats: MigrationStats = {
    total: legacy.length,
    preRigorBackfilled: 0,
    tierBackfilled: 0,
    centralPathBackfilled: 0,
    falsePositiveBackfilled: 0,
  };

  const entries: Finding[] = legacy.map((rawEntry) => {
    const f = coerceFindingShape(rawEntry);
    const out: Finding = { ...f };

    const lacksRigor =
      out.confidence === undefined ||
      out.causal_chain_depth === undefined ||
      out.sources === undefined;
    if (lacksRigor) {
      if (out.confidence === undefined) out.confidence = "medium";
      if (out.causal_chain_depth === undefined) out.causal_chain_depth = 0;
      if (out.sources === undefined) out.sources = [];
      out.confidence_basis = "backfilled-during-v2-migration";
      out.disposition_note = "pre-rigor-contract";
      out.schema_revision = "migrated-v1-to-v2";
      stats.preRigorBackfilled += 1;
    }

    if (out.execution_tier === undefined) {
      out.execution_tier = 3;
      stats.tierBackfilled += 1;
    }
    if (out.central_path === undefined) {
      out.central_path = false;
      stats.centralPathBackfilled += 1;
    }
    if (out.false_positive === undefined) {
      out.false_positive = false;
      stats.falsePositiveBackfilled += 1;
    }

    return out;
  });

  return {
    registry: {
      schema_version: CURRENT_REGISTRY_VERSION,
      generated_at: opts.generatedAt ?? new Date().toISOString(),
      entries,
    },
    stats,
  };
}

/**
 * Internal export for the validator script — knows the closed Tier-1 enum
 * and surfaces it for human inspection on demand.
 */
export const __internal = {
  TIER1_PATTERN_ENUM,
  VALID_DISPOSITIONS,
  VALID_SEVERITIES,
  VALID_EXECUTION_STATUSES,
};
