/**
 * Cost visibility for orchestrator runs (Decision 24 / 2.0.0 #29).
 *
 * Surfaces a pre-execution estimate (expected sub-agent count, static-frame
 * input tokens, web research queries, triage tier, duration) and a
 * post-execution actuals record so the iteration-summary "Fan-out + Cost"
 * section can show the delta. Designed to be called from `commands/hatch3r-*`
 * orchestrator wrap-up code via the helpers exported here.
 *
 * Pillar service:
 * - P7 (Speed & Token Efficiency) — exposes token + duration cost to the user
 *   so over-fan-out and runaway runs are visible.
 * - P5 (Governance Self-Quality) — every orchestrator measures itself.
 *
 * Silent Failure Contract: telemetry I/O failures NEVER throw. They route
 * through the `failureLog` channel per CONSTITUTION §2 P5 and Decision 27.
 *
 * @library_export_only — canonical helpers consumed by hatch3r-* orchestrator
 * commands at run time (inside the host coding tool); the CLI process itself
 * does not invoke these.
 */

import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

import { createFailureLogEntry, FAILURE_LOG_FILE, formatLogEntry } from "./failureLog.js";
// Type-only import (erased at compile — no runtime cycle with observability,
// which imports the USD-cost helpers below at run time). PipelineTokenSummary
// is the token-estimation aggregate produced by observability's token helpers.
import type { PipelineTokenSummary } from "./observability.js";

// ── Triage tier baselines ────────────────────────────────────────

/**
 * Triage tier — sets the default cost envelope used when an orchestrator does
 * not supply explicit sub-agent or web-research declarations.
 *
 * Baselines per Decision 24:
 * - light:    1-3 sub-agents,  8-15k static-frame tokens,  1-3 minute runs
 * - standard: 4-9 sub-agents, 25-60k static-frame tokens,  5-15 minute runs
 * - deep:    10+ sub-agents,  80k+ static-frame tokens,   20+ minute runs
 */
export type TriageTier = "light" | "standard" | "deep";

/**
 * Per-tier baseline envelope. Min/max bracket the expected band; the
 * midpoint becomes the single `expected_*` value reported up-front when the
 * orchestrator does not override. The orchestrator is free to override any
 * field via {@link EstimateCostOptions}.
 */
export interface TierBaseline {
  subAgentMin: number;
  subAgentMax: number;
  staticFrameTokensMin: number;
  staticFrameTokensMax: number;
  webResearchQueriesMin: number;
  webResearchQueriesMax: number;
  durationMinMin: number;
  durationMinMax: number;
}

/** Triage tier baselines per Decision 24 cost-visibility envelope. */
export const TIER_BASELINES: Readonly<Record<TriageTier, TierBaseline>> = {
  light: {
    subAgentMin: 1,
    subAgentMax: 3,
    staticFrameTokensMin: 8_000,
    staticFrameTokensMax: 15_000,
    webResearchQueriesMin: 0,
    webResearchQueriesMax: 1,
    durationMinMin: 1,
    durationMinMax: 3,
  },
  standard: {
    subAgentMin: 4,
    subAgentMax: 9,
    staticFrameTokensMin: 25_000,
    staticFrameTokensMax: 60_000,
    webResearchQueriesMin: 1,
    webResearchQueriesMax: 4,
    durationMinMin: 5,
    durationMinMax: 15,
  },
  deep: {
    subAgentMin: 10,
    subAgentMax: 20,
    staticFrameTokensMin: 80_000,
    staticFrameTokensMax: 160_000,
    webResearchQueriesMin: 3,
    webResearchQueriesMax: 12,
    durationMinMin: 20,
    durationMinMax: 60,
  },
} as const;

// ── Cost estimate + actuals types ────────────────────────────────

/**
 * Pre-execution cost estimate emitted in the iteration-summary's
 * Fan-out + Cost section under the `cost:` block. Field names match the
 * iteration-summary template verbatim so orchestrators can serialise this
 * shape directly into YAML/markdown without remapping.
 */
export interface CostEstimate {
  /** Triage tier used to derive the baseline (passes through from input). */
  triage_tier: TriageTier;
  /** Expected sub-agent fan-out count (explicit declaration > tier midpoint). */
  expected_sa_count: number;
  /** Estimated static-frame input tokens (explicit > tier midpoint). */
  estimated_input_tokens_static_frame: number;
  /** Estimated web-research queries (explicit > tier midpoint). */
  estimated_web_research_queries: number;
  /** Estimated wall-clock duration in minutes (tier midpoint). */
  estimated_duration_min: number;
}

/**
 * Post-execution actuals — recorded by the orchestrator at wrap-up time and
 * persisted under `.hatch3r/telemetry/<session-id>.json`. All five fields
 * mirror {@link CostEstimate} so the delta is well-defined.
 */
export interface CostActuals {
  /** Actual sub-agent spawn count observed at run-time. */
  actual_sa_count: number;
  /** Actual measured (or best-estimate) static-frame input tokens. */
  actual_input_tokens_static_frame: number;
  /** Actual number of web research queries the run issued. */
  actual_web_research_queries: number;
  /** Actual wall-clock duration in minutes. */
  actual_duration_min: number;
  /** ISO-8601 timestamp captured when the actuals were recorded. */
  recorded_at: string;
}

/**
 * Per-field delta between an estimate and the matching actuals, plus a
 * boolean `over_variance` flag set when any field exceeds the 25% threshold.
 * The threshold matches Decision 24's "flag overrun" requirement; consumers
 * use the flag to decide whether to escalate in the iteration summary.
 */
export interface CostDelta {
  sa_count_delta: number;
  sa_count_delta_percent: number;
  input_tokens_delta: number;
  input_tokens_delta_percent: number;
  web_research_delta: number;
  web_research_delta_percent: number;
  duration_delta_min: number;
  duration_delta_percent: number;
  /** True when any |delta_percent| > 25. */
  over_variance: boolean;
  /** Fields that triggered the over-variance flag (empty when not flagged). */
  flagged_fields: string[];
}

/** Variance threshold in percent — Decision 24 cost-overrun flag. */
export const VARIANCE_THRESHOLD_PERCENT = 25;

/** Telemetry directory under the project root. */
export const TELEMETRY_DIR_RELATIVE = ".hatch3r/telemetry";

// ── Input options ────────────────────────────────────────────────

/**
 * Inputs for {@link estimateCost}. The orchestrator passes the triage tier
 * it has computed; optionally overrides sub-agent count and web research
 * counts when it has a more specific estimate (e.g. derived from the
 * `sub_agents_spawned.count` field in its frontmatter).
 */
export interface EstimateCostOptions {
  triageTier: TriageTier;
  /** Override the tier midpoint when the orchestrator already knows fan-out. */
  subAgentDeclared?: number;
  /** Override the tier midpoint for web research queries. */
  webResearchDeclared?: number;
  /** Override the tier midpoint for static-frame token estimate. */
  inputTokensDeclared?: number;
  /** Override the tier midpoint for duration in minutes. */
  durationMinDeclared?: number;
}

// ── Core helpers ─────────────────────────────────────────────────

/** Midpoint of an inclusive range, rounded to the nearest integer. */
function midpoint(minVal: number, maxVal: number): number {
  return Math.round((minVal + maxVal) / 2);
}

/**
 * Compute the pre-execution cost estimate for a run.
 *
 * - Looks up the {@link TIER_BASELINES} envelope for the supplied tier.
 * - Uses explicit `*Declared` overrides when provided; otherwise emits the
 *   tier midpoint for each field.
 * - Negative overrides are clamped to 0 (a sub-agent count cannot be < 0).
 *
 * Pure function — no I/O, never throws.
 */
export function estimateCost(opts: EstimateCostOptions): CostEstimate {
  const baseline = TIER_BASELINES[opts.triageTier];
  if (!baseline) {
    // Defensive: TypeScript would normally prevent this, but at runtime the
    // tier could arrive from JSON. Fall back to "standard" so we still
    // produce a usable estimate rather than throwing.
    return estimateCost({ ...opts, triageTier: "standard" });
  }

  const clamp = (n: number | undefined, fallback: number): number => {
    if (typeof n !== "number" || Number.isNaN(n)) return fallback;
    return Math.max(0, Math.round(n));
  };

  return {
    triage_tier: opts.triageTier,
    expected_sa_count: clamp(
      opts.subAgentDeclared,
      midpoint(baseline.subAgentMin, baseline.subAgentMax),
    ),
    estimated_input_tokens_static_frame: clamp(
      opts.inputTokensDeclared,
      midpoint(baseline.staticFrameTokensMin, baseline.staticFrameTokensMax),
    ),
    estimated_web_research_queries: clamp(
      opts.webResearchDeclared,
      midpoint(baseline.webResearchQueriesMin, baseline.webResearchQueriesMax),
    ),
    estimated_duration_min: clamp(
      opts.durationMinDeclared,
      midpoint(baseline.durationMinMin, baseline.durationMinMax),
    ),
  };
}

/**
 * Compute per-field delta between an estimate and the measured actuals.
 *
 * Delta percent uses the estimate as the denominator. When the estimate is
 * 0 the percent is reported as 0 (avoiding division by zero) and the field
 * contributes to over-variance only when the actual is strictly positive.
 *
 * Pure function — no I/O, never throws.
 */
export function computeDelta(estimate: CostEstimate, actuals: CostActuals): CostDelta {
  const flagged: string[] = [];

  function pctOf(deltaAbs: number, denom: number): number {
    if (denom === 0) return 0;
    return Math.round((deltaAbs / denom) * 100);
  }

  function check(field: string, est: number, act: number): { delta: number; pct: number } {
    const delta = act - est;
    let pct: number;
    if (est === 0) {
      // Special case: 0 estimate, non-zero actual = automatic overrun.
      pct = 0;
      if (act > 0) flagged.push(field);
    } else {
      pct = pctOf(Math.abs(delta), est);
      if (pct > VARIANCE_THRESHOLD_PERCENT) flagged.push(field);
    }
    return { delta, pct };
  }

  const sa = check("sa_count", estimate.expected_sa_count, actuals.actual_sa_count);
  const tokens = check(
    "input_tokens",
    estimate.estimated_input_tokens_static_frame,
    actuals.actual_input_tokens_static_frame,
  );
  const web = check(
    "web_research",
    estimate.estimated_web_research_queries,
    actuals.actual_web_research_queries,
  );
  const dur = check(
    "duration",
    estimate.estimated_duration_min,
    actuals.actual_duration_min,
  );

  return {
    sa_count_delta: sa.delta,
    sa_count_delta_percent: sa.pct,
    input_tokens_delta: tokens.delta,
    input_tokens_delta_percent: tokens.pct,
    web_research_delta: web.delta,
    web_research_delta_percent: web.pct,
    duration_delta_min: dur.delta,
    duration_delta_percent: dur.pct,
    over_variance: flagged.length > 0,
    flagged_fields: flagged,
  };
}

// ── Persistence ──────────────────────────────────────────────────

/**
 * Telemetry record persisted under `.hatch3r/telemetry/<session-id>.json`.
 * Atomic write (tmp+rename) ensures partial writes never appear in the
 * iteration summary. Each call REWRITES the file with the latest snapshot.
 */
export interface CostTelemetryRecord {
  session_id: string;
  estimate?: CostEstimate;
  actuals?: CostActuals;
  delta?: CostDelta;
  /** Free-form sub-agent identity used to attribute the record. */
  orchestrator?: string;
  /** ISO-8601 timestamp of the most recent record update. */
  updated_at: string;
}

/**
 * Sanitise a session id for use as a filename. Allow `[A-Za-z0-9_.-]`, replace
 * everything else with `_`. Trim to 80 chars to keep the filename portable.
 */
function safeSessionFilename(sessionId: string): string {
  const trimmed = sessionId.slice(0, 80);
  const cleaned = trimmed.replace(/[^A-Za-z0-9_.\-]/g, "_");
  return cleaned.length > 0 ? cleaned : "session";
}

/**
 * Persist (or overwrite) actuals for a session via atomic write.
 *
 * Silent Failure Contract: I/O failures are caught and routed through the
 * failureLog channel; this function NEVER throws. Returns `true` when the
 * write succeeded, `false` when it failed (so callers can surface a warning
 * via `warnings[]` in their iteration summary).
 *
 * @param sessionId  Stable identifier for the orchestrator run (correlation id).
 * @param actuals    Measured post-execution numbers.
 * @param options.projectRoot  Project root; defaults to `process.cwd()`.
 * @param options.estimate     If supplied, the file is written with both the
 *                             estimate and the computed delta for one-stop
 *                             post-mortem inspection.
 * @param options.orchestrator Free-form sub-agent id (e.g. `hatch3r-feature-plan`).
 */
export function recordActuals(
  sessionId: string,
  actuals: CostActuals,
  options: {
    projectRoot?: string;
    estimate?: CostEstimate;
    orchestrator?: string;
  } = {},
): boolean {
  const projectRoot = options.projectRoot ?? process.cwd();
  const filename = safeSessionFilename(sessionId) + ".json";
  const filePath = join(projectRoot, TELEMETRY_DIR_RELATIVE, filename);

  const record: CostTelemetryRecord = {
    session_id: sessionId,
    actuals,
    updated_at: new Date().toISOString(),
  };
  if (options.estimate) {
    record.estimate = options.estimate;
    record.delta = computeDelta(options.estimate, actuals);
  }
  if (options.orchestrator) {
    record.orchestrator = options.orchestrator;
  }

  const payload = JSON.stringify(record, null, 2) + "\n";

  // Synchronous atomic write: tmp+rename ensures partial writes never appear.
  // Sync API matches the iteration-summary wrap-up call site, which runs
  // last-thing-before-summary-emission and does NOT want to manage a Promise.
  // Silent Failure Contract: any I/O failure routes through failureLog and
  // returns `false` so the caller can warn the user in the summary.
  const tmpPath = filePath + ".tmp." + randomBytes(4).toString("hex");
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(tmpPath, payload, "utf-8");
    renameSync(tmpPath, filePath);
    return true;
  } catch (err) {
    routeTelemetryFailure(projectRoot, "cost-record-actuals", err, {
      session: sessionId,
    });
    return false;
  }
}

/**
 * Append a snapshot record (estimate + actuals + delta) to the session log
 * synchronously via JSONL. Used for in-flight progress tracking when the
 * orchestrator wants more than one snapshot per run. NEVER throws.
 */
export function appendTelemetrySnapshot(
  sessionId: string,
  snapshot: { estimate?: CostEstimate; actuals?: CostActuals; phase?: string; note?: string },
  projectRoot: string = process.cwd(),
): boolean {
  const filename = safeSessionFilename(sessionId) + ".jsonl";
  const filePath = join(projectRoot, TELEMETRY_DIR_RELATIVE, filename);
  const line =
    JSON.stringify({
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      ...snapshot,
      delta:
        snapshot.estimate && snapshot.actuals
          ? computeDelta(snapshot.estimate, snapshot.actuals)
          : undefined,
    }) + "\n";
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    appendFileSync(filePath, line);
    return true;
  } catch (err) {
    routeTelemetryFailure(projectRoot, "cost-append-snapshot", err, {
      session: sessionId,
    });
    return false;
  }
}

/**
 * Internal — write a single failureLog entry when telemetry I/O fails.
 * Silent Failure Contract: this helper itself swallows any nested failure
 * (the failureLog file may also be unwritable) but does best-effort logging.
 */
function routeTelemetryFailure(
  projectRoot: string,
  phase: string,
  err: unknown,
  context: { session?: string } = {},
): void {
  try {
    const entry = createFailureLogEntry(phase, err, {
      tool: context.session ? `cost-telemetry:${context.session}` : "cost-telemetry",
    });
    const failureLine = formatLogEntry(entry) + "\n";
    const failurePath = join(projectRoot, ".hatch3r", FAILURE_LOG_FILE);
    mkdirSync(dirname(failurePath), { recursive: true });
    appendFileSync(failurePath, failureLine);
  } catch {
    // Nested failure — nothing more we can do without leaking errors.
    void err;
  }
}

// ── Iteration-summary formatting ─────────────────────────────────

/**
 * Format the `cost:` block for the iteration-summary's Fan-out + Cost
 * section. Produces the exact field names listed in
 * `rules/hatch3r-iteration-summary.md` so orchestrators can paste the
 * returned string verbatim. When `actuals` is omitted only the estimate
 * fields are emitted (pre-execution preview).
 */
export function formatCostBlock(estimate: CostEstimate, actuals?: CostActuals): string {
  const lines: string[] = [
    "cost:",
    `  triage_tier: ${estimate.triage_tier}`,
    `  expected_sa_count: ${estimate.expected_sa_count}`,
    `  estimated_input_tokens_static_frame: ${estimate.estimated_input_tokens_static_frame}`,
    `  estimated_web_research_queries: ${estimate.estimated_web_research_queries}`,
    `  estimated_duration_min: ${estimate.estimated_duration_min}`,
  ];

  if (actuals) {
    const delta = computeDelta(estimate, actuals);
    lines.push(
      `  actual_sa_count: ${actuals.actual_sa_count}`,
      `  actual_input_tokens_static_frame: ${actuals.actual_input_tokens_static_frame}`,
      `  actual_web_research_queries: ${actuals.actual_web_research_queries}`,
      `  actual_duration_min: ${actuals.actual_duration_min}`,
      `  delta_percent:`,
      `    sa_count: ${delta.sa_count_delta_percent}`,
      `    input_tokens: ${delta.input_tokens_delta_percent}`,
      `    web_research: ${delta.web_research_delta_percent}`,
      `    duration: ${delta.duration_delta_percent}`,
      `  over_variance: ${delta.over_variance}`,
    );
    if (delta.flagged_fields.length > 0) {
      lines.push(`  flagged_fields: [${delta.flagged_fields.join(", ")}]`);
    }
  }

  return lines.join("\n");
}

// ── Token → USD cost conversion (single source of truth) ─────────
// F3.4-F2 (Cycle 10 Wave 2): merged from pipeline/observability.ts so the
// canonical cost module (Decision 24) owns ALL cost computation. The
// observability copy predated Decision 24; it now re-exports the symbols below
// (estimateUsdCost as estimateCost, UsdCostEstimate as CostEstimate, the two
// DEFAULT_* rate constants) to preserve its public API. `hatch3r explain`
// imports estimateUsdCost from here so the user-facing cost block exercises the
// canonical module rather than the shadow copy.

/**
 * USD cost estimate derived from a {@link PipelineTokenSummary}. Distinct from
 * {@link CostEstimate} (the pre-execution fan-out estimate): this shape carries
 * input/output/total USD figures plus an optional budget-threshold warning.
 */
export interface UsdCostEstimate {
  /** Estimated input cost in `currency`. */
  inputCost: number;
  /** Estimated output cost in `currency`. */
  outputCost: number;
  /** Total estimated cost in `currency`. */
  totalCost: number;
  /** Currency code (default "USD"). */
  currency: string;
  /** Whether any budget threshold was exceeded. */
  budgetWarning: boolean;
  /** Warning message when a budget threshold was exceeded. */
  warningMessage?: string;
}

/** Default cost per 1M input tokens in USD. */
export const DEFAULT_INPUT_COST_PER_1M = 3.0;

/** Default cost per 1M output tokens in USD. */
export const DEFAULT_OUTPUT_COST_PER_1M = 15.0;

/**
 * Convert a token summary to a USD cost estimate using configurable per-1M
 * rates, optionally flagging budget-threshold breaches. Pure function — no
 * I/O, never throws.
 *
 * Behaviour is identical to the former `observability.estimateCost`: input and
 * output costs are `tokens * rate / 1_000_000`; when `budgetLimit` is supplied
 * the highest crossed threshold (default 0.5/0.75/0.9) sets `budgetWarning`.
 */
export function estimateUsdCost(
  summary: PipelineTokenSummary,
  options?: {
    inputCostPer1M?: number;
    outputCostPer1M?: number;
    currency?: string;
    budgetLimit?: number;
    warningThresholds?: number[];
  },
): UsdCostEstimate {
  const inputRate = (options?.inputCostPer1M ?? DEFAULT_INPUT_COST_PER_1M) / 1_000_000;
  const outputRate = (options?.outputCostPer1M ?? DEFAULT_OUTPUT_COST_PER_1M) / 1_000_000;
  const currency = options?.currency ?? "USD";

  const inputCost = summary.totalInputTokens * inputRate;
  const outputCost = summary.totalOutputTokens * outputRate;
  const totalCost = inputCost + outputCost;

  let budgetWarning = false;
  let warningMessage: string | undefined;

  if (options?.budgetLimit) {
    const thresholds = options.warningThresholds ?? [0.5, 0.75, 0.9];
    const ratio = totalCost / options.budgetLimit;
    for (const t of thresholds.sort((a, b) => b - a)) {
      if (ratio >= t) {
        budgetWarning = true;
        warningMessage = `Estimated cost (${totalCost.toFixed(4)} ${currency}) has reached ${(ratio * 100).toFixed(0)}% of budget (${options.budgetLimit} ${currency}).`;
        break;
      }
    }
  }

  return { inputCost, outputCost, totalCost, currency, budgetWarning, warningMessage };
}
