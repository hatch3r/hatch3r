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
  // `deferred`/`multi_cycle_deferred` are retained for historical/archived-cycle
  // data only (governance/audit/archive/cycle-*.json still carry them and must
  // still parse). They MUST NOT be assigned to a `targeted` finding in a live
  // cycle — the Cycle Drain Contract (AUDIT-EXECUTE.md) requires a targeted
  // finding to reach a terminal execution_status by cycle close. Enforced for
  // execution_status in validateEntry (targeted + deferred/never_attempted → error).
  | "deferred"
  | "deferred_cycle10"
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
  // `never_attempted`/`deferred` are retained for historical/archived-cycle data
  // only (governance/audit/archive/cycle-*.json still carry them and must still
  // parse). They MUST NOT be assigned to a `targeted` finding in a live cycle —
  // the Cycle Drain Contract (AUDIT-EXECUTE.md) requires a targeted finding to
  // reach a terminal execution_status by cycle close. Enforced in validateEntry.
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

/**
 * Closed-loop re-opening record (D16-SA16.2-07). Attached to a finding that a
 * later cycle re-opened after auditing and falsifying a prior closure. The
 * pattern was first written ad-hoc on F16.2-C1 (Cycle-11 D16-6 re-open) and is
 * codified here so a machine-readable record that a prior closure was audited,
 * falsified, and re-dispositioned with a named artifact is a typed, validatable
 * field rather than an example.
 *
 * - `cycle`       — the cycle that re-opened the finding.
 * - `finding_id`  — the re-opening finding's id (the one that falsified the
 *                   prior closure).
 * - `prior_close` — narrates the falsified earlier closure (which commit
 *                   claimed `done`, why its diff did not deliver).
 * - `true_fix`    — set when the finding was re-closed; names the shipped
 *                   artifact (F16.2-C1 form).
 * - `outstanding` — set when the finding remains open; names what still must
 *                   land (D12-SA12.3-F07 form).
 *
 * Both re-disposition narratives live in the corpus, so at least one is
 * required by `validateEntry`, but the two are not mutually exclusive.
 */
export interface Reopened {
  cycle: number;
  finding_id: string;
  prior_close: string;
  true_fix?: string;
  outstanding?: string;
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
  // `cl1_status`  — Phase 5 PRD-evolution disposition (none|candidate then a
  //                 terminal applied|deferred|rejected|declined|superseded).
  // `sdr_status`  — strategic-decision-register disposition (none baseline).
  // `cl3_status`  — Phase 7 audit-self-evolution disposition. CL-3 was tracked
  //                 only as ad-hoc top-level cycle keys (cycle10_re_envision_*),
  //                 so per-proposal cross-cycle disposition was not queryable
  //                 (D16-16 / D18-15). This field makes it a sibling of
  //                 cl1_status: none|queued_for_cycle_<N>_phase_7 then a
  //                 terminal applied|deferred|rejected|declined|superseded,
  //                 written by closed-loop-agents.md Phase 7 at apply-time and
  //                 surfaced by scripts/audit-closed-loop-report.ts. Free-form
  //                 string (no enum gate) to match cl1_status/sdr_status.
  cl1_status?: string | null;
  sdr_status?: string | null;
  cl3_status?: string | null;

  // Closed-loop re-opening record (D16-SA16.2-07): set when a later cycle
  // re-opens this finding after falsifying a prior closure. Shape + rationale
  // in the `Reopened` interface; structural check in `validateEntry`.
  reopened?: Reopened;

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
  "anti_slop_swap",
  "currency_header_add",
  "doc_count_update",
  "frontmatter_field_add",
  "typo_fix",
  "version_bump",
  "lint_disable_removal",
]);

const VALID_DISPOSITIONS: ReadonlySet<string> = new Set([
  "targeted",
  "excluded",
  "human_only",
  "deferred",
  "deferred_cycle10",
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
 * Wiring-verb subset (D16-7): a finding whose recommended fix is to connect an
 * artifact into a live code path — `wire`, `import`, `call`, `register`, `emit`,
 * the phrase "add … gate", or the negative diagnosis "no production/runtime
 * callers". For these, "fix landed" (commit_sha present) is not the same as "fix
 * works" (the new caller/importer actually exists). D10-SA10.8-F1 (SPACE
 * telemetry, 0 importers) and D16-6 (adoption-tracker closed by a commit that
 * never built it) both closed `done` with a commit yet zero wiring. The closing
 * reviewer must therefore record a `reviewer_notes` line citing the new
 * caller/importer (grep-checkable), and a `done` row whose `reviewer_notes` is
 * empty fails the strict gate. Matched against `description` (the field carrying
 * the finding's recommended fix). Each alternative is bounded by a word/phrase
 * boundary so substrings like "recall" or "preregister" do not false-positive.
 */
const WIRING_VERB_RE =
  /\b(wir(?:e|ed|es|ing)|import(?:ed|s|ing)?|call(?:ed|s|ing)?|register(?:ed|s|ing)?|emit(?:ted|s|ting)?)\b|add[^.]{0,40}?\bgate\b|\bno (?:production|runtime) callers\b/i;

/**
 * Value-hygiene pattern for `commit_sha` (Invariant 8, D16-SA16.2-07). A
 * well-formed value is a git object name — a 7-to-64-char hex abbreviation or
 * full SHA-1/SHA-256 — optionally namespaced by a `<repo>:` prefix for a
 * cross-repository pointer. The corpus carries `overlay:c0ca1c0` (a real SHA in
 * the private governance overlay), which this pattern accepts; placeholder
 * tokens such as `phase7` (D16-9, the motivating fixture) are not git object
 * names and fail it. Enforced strict-only in `validateEntry`, paired with the
 * invariant-11 / D16-7 forward contracts, so the pre-Cycle-12 corpus is
 * grandfathered in tolerant mode.
 */
const COMMIT_SHA_RE = /^(?:[a-z][a-z0-9_-]*:)?[0-9a-f]{7,64}$/i;

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
 * separate anchor-log validator) plus the terminal-evidence contract
 * (D16-6: strict-mode `done`-needs-evidence), the effectiveness leg
 * (D16-7: strict-mode wiring-verb `done` needs a `reviewer_notes` line citing
 * the new caller/importer), the invariant-8 commit_sha value-hygiene check
 * (D16-SA16.2-07: strict-mode `commit_sha` must be a git object name, not a
 * placeholder token), and the always-on `reopened` structural check
 * (D16-SA16.2-07). Returns drift reports; empty array means no drift.
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
    // Cycle Drain Contract (AUDIT-EXECUTE.md): a targeted finding may not end
    // the cycle parked. `deferred`/`never_attempted` are retained only for
    // historical/archived-cycle rows (which are non-targeted summaries), so a
    // *targeted* finding holding either status at cycle close is a HALT error.
    if (
      f.execution_status === "deferred" ||
      f.execution_status === "never_attempted"
    ) {
      reports.push({
        finding_id: id,
        reason: "targeted finding parked at cycle close",
        detail: `Finding ${id}: disposition 'targeted' may not hold execution_status '${f.execution_status}' at cycle close (Cycle Drain Contract — AUDIT-EXECUTE.md)`,
      });
    }

    // Terminal-evidence contract (D16-6 / F16.2-C1): a targeted finding marked
    // `done` must carry closure evidence — a `commit_sha` OR a `disposition_note`
    // recording why no commit landed. F16.2-C1 was closed `done` with a
    // commit_sha whose diff never built the recommended artifact; the broader
    // failure mode is a `done` row with neither pointer, which is closure by
    // assertion. Strict-only (forward contract): the legacy corpus carries
    // pre-rigor `done` rows lacking both fields, grandfathered exactly like the
    // execution_tier strict gate below. New closures must satisfy it.
    if (
      opts.strict &&
      f.execution_status === "done" &&
      !(typeof f.commit_sha === "string" && f.commit_sha.length > 0) &&
      !(typeof f.disposition_note === "string" && f.disposition_note.length > 0)
    ) {
      reports.push({
        finding_id: id,
        reason: "done without closure evidence",
        detail: `Finding ${id}: disposition 'targeted' marked 'done' carries neither commit_sha nor disposition_note (terminal-evidence contract — AUDIT-EXECUTE.md / F16.2-C1)`,
      });
    }

    // Effectiveness leg (D16-7): the terminal-evidence check above proves a
    // commit landed, not that the fix is wired. For the wiring-verb subset
    // (WIRING_VERB_RE on `description`), closure-by-completion and
    // closure-by-effectiveness diverge: a commit can land while the prescribed
    // caller/importer/gate never materializes (D10-SA10.8-F1, D16-6). So a
    // `done` wiring-verb finding must carry a non-empty `reviewer_notes`
    // citing the new caller/importer (grep-checkable). Strict-only forward
    // contract, paired with the terminal-evidence gate above (same validator).
    if (
      opts.strict &&
      f.execution_status === "done" &&
      typeof f.description === "string" &&
      WIRING_VERB_RE.test(f.description) &&
      !(typeof f.reviewer_notes === "string" && f.reviewer_notes.trim().length > 0)
    ) {
      reports.push({
        finding_id: id,
        reason: "wiring-verb done without effectiveness note",
        detail: `Finding ${id}: a 'done' finding whose recommended fix is a wiring verb (wire/import/call/register/emit/add-gate/no-callers) must carry a reviewer_notes line citing the new caller/importer (effectiveness leg — AUDIT-EXECUTE.md / D16-7)`,
      });
    }
  }

  // Invariant 8 (value hygiene, D16-SA16.2-07): a `commit_sha`, when present,
  // must be a git object name — a hex abbreviation/full SHA, optionally a
  // `<repo>:`-namespaced cross-repo pointer — not a phase/placeholder token.
  // Applies to any entry carrying a commit_sha (format hygiene is independent
  // of disposition). Strict-only forward contract, paired with invariants 11
  // and D16-7: the pre-Cycle-12 corpus carries placeholder tokens (D16-9
  // `commit_sha: "phase7"`) grandfathered in tolerant mode; Cycle-12+ writes
  // must satisfy it.
  if (
    opts.strict &&
    typeof f.commit_sha === "string" &&
    f.commit_sha.length > 0 &&
    !COMMIT_SHA_RE.test(f.commit_sha)
  ) {
    reports.push({
      finding_id: id,
      reason: "commit_sha not a git object name",
      detail: `Finding ${id}: commit_sha ${JSON.stringify(f.commit_sha)} is not a hex SHA or <repo>:<sha> pointer (Invariant 8 value hygiene — AUDIT-EXECUTE.md / D16-9 fixture)`,
    });
  }

  // Closed-loop re-opening record (D16-SA16.2-07): when the `reopened` object is
  // present it must carry its irreducible core — the re-opening `cycle`
  // (number), the re-opened `finding_id` (string), and the `prior_close`
  // narrative of the falsified earlier closure — plus at least one
  // re-disposition narrative: `true_fix` (re-closed) or `outstanding` (still
  // open). Codifies the F16.2-C1 pattern so it is validatable, not example-only.
  // Always-on: both live corpus instances satisfy it, so no legacy grandfather
  // is needed.
  if (f.reopened !== undefined) {
    const r = f.reopened;
    if (r === null || typeof r !== "object" || Array.isArray(r)) {
      reports.push({
        finding_id: id,
        reason: "reopened not an object",
        detail: `Finding ${id}: reopened must be an object; got ${JSON.stringify(r)}`,
      });
    } else {
      if (typeof r.cycle !== "number") {
        reports.push({
          finding_id: id,
          reason: "reopened missing cycle",
          detail: `Finding ${id}: reopened.cycle must be a number (the re-opening cycle)`,
        });
      }
      if (typeof r.finding_id !== "string" || r.finding_id.length === 0) {
        reports.push({
          finding_id: id,
          reason: "reopened missing finding_id",
          detail: `Finding ${id}: reopened.finding_id must be a non-empty string`,
        });
      }
      if (typeof r.prior_close !== "string" || r.prior_close.length === 0) {
        reports.push({
          finding_id: id,
          reason: "reopened missing prior_close",
          detail: `Finding ${id}: reopened.prior_close must narrate the falsified earlier closure`,
        });
      }
      const hasTrueFix =
        typeof r.true_fix === "string" && r.true_fix.length > 0;
      const hasOutstanding =
        typeof r.outstanding === "string" && r.outstanding.length > 0;
      if (!hasTrueFix && !hasOutstanding) {
        reports.push({
          finding_id: id,
          reason: "reopened missing re-disposition narrative",
          detail: `Finding ${id}: reopened requires a non-empty true_fix (re-closed) or outstanding (still open)`,
        });
      }
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

// ── CL-row balance invariant (Cycle-12 CL-3 Proposal 6c / D16-SA16.2-02) ──
//
// The stalled-strategic detector's data producers (Phase 5/7 CL writes) and
// the detector itself form a circular dependency: a phase stall guarantees
// detector silence. The balance invariant breaks the circle at the data layer:
// when BOTH the registry AND a cycle's AUDIT-REPORT.md CL tables are readable,
// every Phase CL-1 / CL-3 table row must be materialized as a registry entry
// (`C<cycle>-CL1-<n>` / `C<cycle>-CL3-<n>` — the Phase-1 drops-log pattern).
// AUDIT-REPORT.md is private (absent in public clones), so the wrapper script
// (scripts/validate-finding-registry.ts) only runs the check when both files
// exist and skips with a notice otherwise.

/** The two report phases whose rows must balance against registry entries. */
export type ClPhase = "CL-1" | "CL-3";

/** Report-side row counts; `null` = the phase's section/table was not found. */
export interface ClBalanceCounts {
  cl1ReportRows: number | null;
  cl3ReportRows: number | null;
}

/**
 * Count the body rows of the FIRST markdown table inside the report's
 * `## Phase CL-1:` / `## Phase CL-3:` section. Returns `null` when the section
 * heading or its table is absent. Scanning stops at the next `##`/`###`
 * heading so subsection tables (CL-3's "### Routed to EVOLVE") are never
 * counted — only the phase's own candidate/proposal table balances against
 * registry entries.
 */
export function countClReportRows(
  reportMarkdown: string,
  phase: ClPhase,
): number | null {
  const lines = reportMarkdown.split(/\r?\n/);
  const headingRe = new RegExp(`^##\\s+Phase ${phase}\\b`);
  let i = lines.findIndex((line) => headingRe.test(line));
  if (i === -1) return null;
  i += 1;
  while (i < lines.length && !lines[i].startsWith("|")) {
    if (/^#{2,}\s/.test(lines[i])) return null;
    i += 1;
  }
  if (i >= lines.length) return null;
  let tableLines = 0;
  while (i < lines.length && lines[i].startsWith("|")) {
    tableLines += 1;
    i += 1;
  }
  // Header row + separator row precede the body; fewer than 2 lines is not a
  // markdown table.
  if (tableLines < 2) return null;
  return tableLines - 2;
}

/**
 * Count registry entries materialized from a cycle's CL rows: `finding_id`
 * matching `^C<cycle>-CL1-<n>$` / `^C<cycle>-CL3-<n>$` (anchored — other
 * cycles' entries and suffixed ids do not count).
 */
export function countClRegistryEntries(
  entries: ReadonlyArray<Finding>,
  cycle: number,
  phase: ClPhase,
): number {
  const idRe = new RegExp(`^C${cycle}-${phase.replace("-", "")}-\\d+$`);
  let count = 0;
  for (const f of entries) {
    if (typeof f.finding_id === "string" && idRe.test(f.finding_id)) {
      count += 1;
    }
  }
  return count;
}

/**
 * The balance assertion: per phase, report-CL-row count === materialized
 * registry-entry count. Empty array = balanced. A `null` report-row count is
 * itself a failure (the report exists but its phase table could not be
 * located — the invariant must not silently pass on a shape drift).
 */
export function checkClBalance(
  entries: ReadonlyArray<Finding>,
  cycle: number,
  counts: ClBalanceCounts,
): DriftReport[] {
  const reports: DriftReport[] = [];
  const phases: ReadonlyArray<[ClPhase, number | null]> = [
    ["CL-1", counts.cl1ReportRows],
    ["CL-3", counts.cl3ReportRows],
  ];
  for (const [phase, reportRows] of phases) {
    const idStem = `C${cycle}-${phase.replace("-", "")}`;
    if (reportRows === null) {
      reports.push({
        finding_id: `${idStem}-*`,
        reason: `cl-balance table missing (${phase})`,
        detail:
          `cycle ${cycle}: no "## Phase ${phase}" table found in AUDIT-REPORT.md — ` +
          `the balance invariant reads the section's first markdown table; ` +
          `restore the heading/table or fix the section shape`,
      });
      continue;
    }
    const registryCount = countClRegistryEntries(entries, cycle, phase);
    if (reportRows !== registryCount) {
      reports.push({
        finding_id: `${idStem}-*`,
        reason: `cl-row balance broken (${phase})`,
        detail:
          `cycle ${cycle}: AUDIT-REPORT.md §Phase ${phase} has ${reportRows} table row(s) ` +
          `but the registry holds ${registryCount} ${idStem}-<n> entr${registryCount === 1 ? "y" : "ies"}; ` +
          `materialize one registry entry per report CL row at report assembly ` +
          `(or prune orphan entries) — CL-3 Proposal 6c balance invariant`,
      });
    }
  }
  return reports;
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
