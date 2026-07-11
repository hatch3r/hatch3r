/**
 * Pipeline observability module.
 *
 * Provides four capabilities for pipeline instrumentation:
 *
 * 1. **Reasoning block persistence** -- captures and stores phase reasoning
 *    in a structured format for post-execution review. Each block includes
 *    category, content, and ISO-8601 timestamp.
 *
 * 2. **Per-phase token estimation** -- estimates token usage per phase using
 *    a character-based heuristic (default: 4 chars/token). Feeds cost tracking
 *    and context-window budgeting.
 *
 * 3. **Cost estimation** -- converts token estimates to USD cost using
 *    configurable per-1M-token rates, with threshold-based budget warnings.
 *
 * 4. **Replay guidance** -- produces structured reproduction steps for
 *    debugging failed pipeline executions, including environment snapshot
 *    and git ref capture.
 *
 * 5. **Spawn-telemetry reachability** -- probes that the default-on sub-agent
 *    spawn audit trail has a writable sink (D15-SA15.3-03, OWASP 2026
 *    Strong-Observability).
 *
 * 6. **Observed output:input token ratio** -- derives the output:input token
 *    ratio from recorded EfficiencyEvent telemetry so cost estimates can
 *    replace the unbased 0.25 constant with measurement (D6-SA6.3-05).
 *
 * Metric naming convention: all exported interfaces use `{Scope}{Metric}`
 * format (e.g. `PhaseTokenEstimate`, `PipelineTokenSummary`, `CostEstimate`).
 */

import {
  accessSync,
  appendFileSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { createFailureLogEntry, formatLogEntry, FAILURE_LOG_FILE } from "./failureLog.js";
import type { PhaseName } from "./phaseTimeout.js";
// Cost-block dependencies (Decision 24): the canonical fan-out cost estimate
// type, actuals type, delta function, and triage-tier enum live in
// costEstimator.ts. Imported under disambiguating aliases because this module
// already re-exports `UsdCostEstimate as CostEstimate` (legacy public name for
// the token→USD shape — see "Token → USD cost conversion" section in
// costEstimator.ts).
import {
  computeDelta as computeCostDelta,
  type CostEstimate as CostEstimateData,
  type CostActuals as CostActualsData,
  type TriageTier,
} from "./costEstimator.js";

// ── Reasoning Block Persistence (Finding #63) ────────────────────

/**
 * A single reasoning block captured during a pipeline phase.
 *
 * Pipeline phases often produce intermediate analysis (thinking,
 * chain-of-thought, decision rationale). This structure persists
 * those blocks so they can be inspected post-execution.
 */
export interface ReasoningBlock {
  /** Sequential index within the phase (0-based). */
  index: number;
  /** Category of reasoning (e.g. "analysis", "decision", "risk-assessment"). */
  category: string;
  /** The reasoning text. */
  content: string;
  /** ISO-8601 timestamp when this block was captured. */
  timestamp: string;
}

/**
 * Phase reasoning output -- the collection of reasoning blocks
 * produced by a single pipeline phase.
 */
export interface PhaseReasoning {
  /** Which pipeline phase produced this reasoning. */
  phase: PhaseName;
  /** Ordered list of reasoning blocks. */
  blocks: ReasoningBlock[];
  /** Total character count across all blocks. */
  totalChars: number;
}

/**
 * Create an empty PhaseReasoning container for a given phase.
 */
export function createPhaseReasoning(phase: PhaseName): PhaseReasoning {
  return {
    phase,
    blocks: [],
    totalChars: 0,
  };
}

/**
 * Append a reasoning block to the phase reasoning container.
 *
 * Returns a new PhaseReasoning with the block appended (immutable).
 */
export function appendReasoningBlock(
  reasoning: PhaseReasoning,
  category: string,
  content: string,
): PhaseReasoning {
  const block: ReasoningBlock = {
    index: reasoning.blocks.length,
    category,
    content,
    timestamp: new Date().toISOString(),
  };

  return {
    ...reasoning,
    blocks: [...reasoning.blocks, block],
    totalChars: reasoning.totalChars + content.length,
  };
}

/**
 * Produce a plain-text summary of the reasoning blocks for a phase.
 *
 * Useful for logging or inclusion in pipeline reports.
 */
export function summarizeReasoning(reasoning: PhaseReasoning): string {
  if (reasoning.blocks.length === 0) {
    return `Phase "${reasoning.phase}": no reasoning blocks captured.`;
  }

  const lines: string[] = [
    `Phase "${reasoning.phase}": ${reasoning.blocks.length} reasoning block(s), ${reasoning.totalChars} chars total.`,
  ];

  for (const block of reasoning.blocks) {
    const preview =
      block.content.length > 120
        ? block.content.substring(0, 120) + "..."
        : block.content;
    lines.push(`  [${block.index}] (${block.category}) ${preview}`);
  }

  return lines.join("\n");
}

// ── Per-Phase Token Estimation (Finding #64) ─────────────────────

/**
 * Token estimate for a single pipeline phase.
 *
 * Token counts are estimates based on character-level heuristics
 * (not exact BPE tokenisation), suitable for cost tracking and
 * context-window budgeting.
 */
export interface PhaseTokenEstimate {
  /** Which pipeline phase. */
  phase: PhaseName;
  /** Estimated input tokens consumed by the phase. */
  inputTokens: number;
  /** Estimated output tokens produced by the phase. */
  outputTokens: number;
  /** Estimated total tokens (input + output). */
  totalTokens: number;
}

/**
 * Aggregate token estimates across all pipeline phases.
 */
export interface PipelineTokenSummary {
  /** Per-phase breakdowns. */
  phases: PhaseTokenEstimate[];
  /** Sum of all input tokens. */
  totalInputTokens: number;
  /** Sum of all output tokens. */
  totalOutputTokens: number;
  /** Grand total of all tokens. */
  grandTotal: number;
}

/**
 * Average characters per token for estimation purposes.
 *
 * English prose averages ~4 chars/token; code averages ~3.5.
 * We use 4 as a conservative default.
 */
export const CHARS_PER_TOKEN = 4;

/**
 * Estimate token count from a character count.
 *
 * Uses a simple chars / CHARS_PER_TOKEN heuristic. The divisor can be
 * overridden for language-specific tuning (e.g. 3.5 for code-heavy input).
 */
export function estimateTokens(
  charCount: number,
  charsPerToken: number = CHARS_PER_TOKEN,
): number {
  if (charCount <= 0) return 0;
  return Math.ceil(charCount / charsPerToken);
}

/**
 * Create a token estimate for a single pipeline phase.
 */
export function createPhaseTokenEstimate(
  phase: PhaseName,
  inputChars: number,
  outputChars: number,
  charsPerToken: number = CHARS_PER_TOKEN,
): PhaseTokenEstimate {
  const inputTokens = estimateTokens(inputChars, charsPerToken);
  const outputTokens = estimateTokens(outputChars, charsPerToken);

  return {
    phase,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

/**
 * Aggregate multiple phase estimates into a pipeline summary.
 */
export function createTokenSummary(
  phases: PhaseTokenEstimate[],
): PipelineTokenSummary {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const p of phases) {
    totalInputTokens += p.inputTokens;
    totalOutputTokens += p.outputTokens;
  }

  return {
    phases: [...phases],
    totalInputTokens,
    totalOutputTokens,
    grandTotal: totalInputTokens + totalOutputTokens,
  };
}

/**
 * Format a token summary as a human-readable string.
 */
export function formatTokenSummary(summary: PipelineTokenSummary): string {
  const lines: string[] = [
    `Token usage: ${summary.grandTotal} total (${summary.totalInputTokens} in, ${summary.totalOutputTokens} out)`,
  ];

  for (const p of summary.phases) {
    lines.push(
      `  ${p.phase}: ${p.totalTokens} (${p.inputTokens} in, ${p.outputTokens} out)`,
    );
  }

  return lines.join("\n");
}

// ── Phase Handoff Metrics (D7-SA7.4-F-6) ─────────────────────────
// Pillar P5 (Governance Self-Quality) + P7 (Speed & Token Efficiency).
//
// `rules/hatch3r-agent-orchestration-detail.md` § Context Token Optimization
// prescribes lossy compression strategies that fire when pipeline context
// exceeds 50% of the window (summarise Phase 1 output, prune resolved
// findings, collapse specialist results). The compression is lossy by design
// but the byte-loss between two phases was previously unmeasured, so a
// downstream phase could silently receive a summary when it needed the full
// upstream output. These types quantify the loss at each handoff so the
// orchestrator can surface a soft warning when too much context was dropped.

/** Soft-warning threshold: information loss above this fraction is flagged. */
export const PHASE_HANDOFF_LOSS_WARN_THRESHOLD = 0.3;

/**
 * Byte-loss measurement for a single phase-to-phase handoff.
 *
 * Captured when the orchestrator passes context from one phase to the next.
 *
 * D7-25 (Cycle 11 Wave 3, D7, P5): `informationLossEstimate` is a **byte-size
 * proxy**, not a semantic-importance measure — it counts bytes dropped, so by
 * itself a dropped security finding and dropped whitespace score identically.
 * The orchestration rule's compression strategy #4 ("never truncate security
 * findings", `rules/hatch3r-agent-orchestration-detail.md` § Context Token
 * Optimization) means those decision-critical bytes are NEVER part of the
 * lossy drop. `protectedByteCount` lets the caller declare how many of the
 * input bytes are protected-and-retained (security findings, unresolved
 * findings carried forward); those bytes are excluded from BOTH the numerator
 * (dropped bytes) and the denominator (droppable bytes), so the estimate
 * reflects loss over the bytes that were actually eligible to be compressed.
 * It remains a size proxy: a high value flags "a lot of droppable context was
 * compressed", a cue to verify critical context survived — it does not by
 * itself prove what was lost mattered.
 */
export interface PhaseHandoffMetrics {
  /** Phase producing the context (handoff source). */
  fromPhase: PhaseName;
  /** Phase receiving the context (handoff target). */
  toPhase: PhaseName;
  /** Byte count of the context entering the handoff. */
  inputBytes: number;
  /** Byte count of the context leaving the handoff (post-compression). */
  outputBytes: number;
  /**
   * Bytes that are protected-and-retained (compression strategy #4: security
   * findings + carried-forward unresolved findings). Excluded from the loss
   * estimate's numerator and denominator. 0 when no bytes are protected.
   */
  protectedByteCount: number;
  /** True when a compression strategy was applied at this handoff. */
  summarisationApplied: boolean;
  /**
   * Byte-SIZE-proxy loss fraction (0-1): dropped droppable bytes ÷ droppable
   * bytes (protected bytes excluded from both). NOT a semantic-importance
   * measure — see {@link PhaseHandoffMetrics} for the size-proxy disclaimer.
   */
  informationLossEstimate: number;
}

/**
 * Compute phase-handoff metrics from the input/output byte counts.
 *
 * `informationLossEstimate` is clamped to [0, 1]; an output larger than the
 * input (e.g. the phase added analysis rather than compressing) yields a loss
 * estimate of 0 — handoffs never report negative loss. Pure function; no I/O.
 *
 * D7-25: `protectedByteCount` (optional, default 0) declares input bytes that
 * compression strategy #4 protects-and-retains (security findings,
 * carried-forward unresolved findings). Those bytes are excluded from both the
 * dropped-byte numerator and the droppable-byte denominator, so the estimate
 * measures loss over the bytes that were eligible to be compressed — a dropped
 * whitespace byte counts, a (retained) protected byte does not. The value is
 * clamped to `[0, safeInput]`. It remains a byte-SIZE proxy, not a
 * semantic-importance measure (see {@link PhaseHandoffMetrics}).
 */
export function createPhaseHandoffMetrics(
  fromPhase: PhaseName,
  toPhase: PhaseName,
  inputBytes: number,
  outputBytes: number,
  summarisationApplied: boolean,
  protectedByteCount: number = 0,
): PhaseHandoffMetrics {
  const safeInput = inputBytes > 0 ? inputBytes : 0;
  const safeOutput = outputBytes > 0 ? outputBytes : 0;
  const safeProtected =
    protectedByteCount > 0 ? Math.min(protectedByteCount, safeInput) : 0;

  // Protected bytes are excluded from both sides: they are retained by design
  // (strategy #4), so they belong in neither the dropped count nor the
  // droppable base. droppableInput = input - protected; droppableOutput is the
  // output minus the retained protected bytes (clamped at 0).
  const droppableInput = safeInput - safeProtected;
  const droppableOutput = Math.max(0, safeOutput - safeProtected);
  const lost = droppableInput - droppableOutput;
  const informationLossEstimate =
    droppableInput <= 0 || lost <= 0 ? 0 : Math.min(1, lost / droppableInput);

  return {
    fromPhase,
    toPhase,
    inputBytes: safeInput,
    outputBytes: safeOutput,
    protectedByteCount: safeProtected,
    summarisationApplied,
    informationLossEstimate,
  };
}

/**
 * Produce a single-line health indicator for a phase handoff, or `null` when
 * the loss is within budget. The orchestrator surfaces the returned string in
 * the iteration summary (per `rules/hatch3r-agent-orchestration-detail.md`
 * § Context Token Optimization) when loss exceeds
 * {@link PHASE_HANDOFF_LOSS_WARN_THRESHOLD}. Pure function; never throws.
 */
export function formatPhaseHandoffWarning(
  metrics: PhaseHandoffMetrics,
): string | null {
  if (metrics.informationLossEstimate <= PHASE_HANDOFF_LOSS_WARN_THRESHOLD) {
    return null;
  }
  const pct = Math.round(metrics.informationLossEstimate * 100);
  return (
    `Phase ${metrics.fromPhase}→${metrics.toPhase} compressed input by ${pct}% ` +
    `(>${Math.round(PHASE_HANDOFF_LOSS_WARN_THRESHOLD * 100)}%) — ` +
    `downstream phases should validate critical context survived.`
  );
}

// ── Budget Tracking (D12 Medium: #315-#330) ──────────────────────
// F3.4-F2 (Cycle 10 Wave 2): the token→USD cost converter and its rate
// constants moved to pipeline/costEstimator.ts so the canonical cost module
// (Decision 24) is the single source of truth for ALL cost computation. This
// module re-exports them under their historical names (`estimateCost`,
// `CostEstimate`, `DEFAULT_INPUT_COST_PER_1M`, `DEFAULT_OUTPUT_COST_PER_1M`) so
// existing importers (e.g. wave3Medium tests) keep working unchanged. New
// callers should import `estimateUsdCost` / `UsdCostEstimate` from
// costEstimator.js directly. The function body now lives in exactly one place.
export {
  estimateUsdCost as estimateCost,
  DEFAULT_INPUT_COST_PER_1M,
  DEFAULT_OUTPUT_COST_PER_1M,
  type UsdCostEstimate as CostEstimate,
} from "./costEstimator.js";

// ── Replay Guidance (Finding #65) ────────────────────────────────

/**
 * Structured replay guidance for reproducing a pipeline execution.
 *
 * When debugging pipeline issues, this provides the information
 * needed to reproduce the exact execution context.
 */
export interface ReplayGuidance {
  /** The correlation ID of the original pipeline run. */
  correlationId: string;
  /** ISO-8601 timestamp of the original run. */
  originalRunTimestamp: string;
  /** Phase where the issue was observed. */
  failedPhase: PhaseName;
  /** Human-readable description of the failure. */
  failureDescription: string;
  /** Ordered steps to reproduce the issue. */
  replaySteps: ReplayStep[];
  /** Key-value pairs of environment/config needed for replay. */
  environmentSnapshot: Record<string, string>;
  /** Files that should be checked out / restored for replay. */
  relevantFiles: string[];
  /** Git ref (branch, commit SHA) at the time of the run. */
  gitRef?: string;
}

/**
 * A single step in the replay sequence.
 */
export interface ReplayStep {
  /** 1-based step number. */
  stepNumber: number;
  /** What to do in this step. */
  instruction: string;
  /** Expected outcome of this step. */
  expectedOutcome?: string;
}

/**
 * Create replay guidance for a failed pipeline execution.
 */
export function createReplayGuidance(
  correlationId: string,
  failedPhase: PhaseName,
  failureDescription: string,
  options?: {
    gitRef?: string;
    relevantFiles?: string[];
    environmentSnapshot?: Record<string, string>;
  },
): ReplayGuidance {
  const guidance: ReplayGuidance = {
    correlationId,
    originalRunTimestamp: new Date().toISOString(),
    failedPhase,
    failureDescription,
    replaySteps: buildDefaultReplaySteps(failedPhase, options?.gitRef),
    environmentSnapshot: options?.environmentSnapshot ?? {},
    relevantFiles: options?.relevantFiles ?? [],
    gitRef: options?.gitRef,
  };

  return guidance;
}

/**
 * Build default replay steps for a given failed phase.
 *
 * These are generic steps that apply to any phase failure.
 * Callers can customise them after creation.
 */
function buildDefaultReplaySteps(
  failedPhase: PhaseName,
  gitRef?: string,
): ReplayStep[] {
  const steps: ReplayStep[] = [];
  let n = 1;

  if (gitRef) {
    steps.push({
      stepNumber: n++,
      instruction: `Checkout the exact git ref: git checkout ${gitRef}`,
      expectedOutcome: "Working tree matches the state at time of failure.",
    });
  }

  steps.push({
    stepNumber: n++,
    instruction:
      "Ensure the environment matches the original run (see environmentSnapshot).",
    expectedOutcome: "All environment variables and config files are in place.",
  });

  steps.push({
    stepNumber: n++,
    instruction: "Install dependencies (npm install / equivalent).",
    expectedOutcome: "node_modules (or equivalent) is populated.",
  });

  steps.push({
    stepNumber: n++,
    instruction: `Re-run the pipeline up to and including the "${failedPhase}" phase.`,
    expectedOutcome: "The same failure should be reproducible.",
  });

  steps.push({
    stepNumber: n++,
    instruction:
      "Inspect the phase output and reasoning blocks for diagnostic clues.",
    expectedOutcome: "Root cause is identified or narrowed down.",
  });

  return steps;
}

/**
 * Add a custom replay step to existing guidance.
 *
 * Returns a new ReplayGuidance with the step appended (immutable).
 */
export function addReplayStep(
  guidance: ReplayGuidance,
  instruction: string,
  expectedOutcome?: string,
): ReplayGuidance {
  const nextStepNumber =
    guidance.replaySteps.length > 0
      ? guidance.replaySteps[guidance.replaySteps.length - 1].stepNumber + 1
      : 1;

  return {
    ...guidance,
    replaySteps: [
      ...guidance.replaySteps,
      {
        stepNumber: nextStepNumber,
        instruction,
        expectedOutcome,
      },
    ],
  };
}

/**
 * Format replay guidance as a human-readable string.
 *
 * Suitable for inclusion in error reports, logs, or developer output.
 */
export function formatReplayGuidance(guidance: ReplayGuidance): string {
  const lines: string[] = [
    `Replay Guidance for correlation ${guidance.correlationId}`,
    `  Failed phase: ${guidance.failedPhase}`,
    `  Failure: ${guidance.failureDescription}`,
    `  Original run: ${guidance.originalRunTimestamp}`,
  ];

  if (guidance.gitRef) {
    lines.push(`  Git ref: ${guidance.gitRef}`);
  }

  if (guidance.relevantFiles.length > 0) {
    lines.push(`  Relevant files: ${guidance.relevantFiles.join(", ")}`);
  }

  const envKeys = Object.keys(guidance.environmentSnapshot);
  if (envKeys.length > 0) {
    lines.push(`  Environment keys: ${envKeys.join(", ")}`);
  }

  lines.push("  Steps:");
  for (const step of guidance.replaySteps) {
    lines.push(`    ${step.stepNumber}. ${step.instruction}`);
    if (step.expectedOutcome) {
      lines.push(`       -> ${step.expectedOutcome}`);
    }
  }

  return lines.join("\n");
}

// ─── Efficiency telemetry (HATCH3R_EFFICIENCY_TELEMETRY: "1" opt-in / "0" opt-out) ───
// Pillars P7 + P6. Two channels share the JSONL sink with split default
// postures (D15-SA15.3-03, OWASP 2026 Strong-Observability):
//
// - Token/latency telemetry (`recordEfficiencyEvent`, `recordPhaseDuration`,
//   `recordTokenCost`) is higher-volume and stays OPT-IN — it records only
//   when HATCH3R_EFFICIENCY_TELEMETRY=1.
// - Sub-agent spawn telemetry (`recordSubAgentSpawn`) is low-volume (one
//   JSONL line per Task-tool fan-out), structured, and is the framework-owned
//   audit trail for how many agents ran with what delegated authority — it
//   records BY DEFAULT and is disabled only by the explicit opt-out
//   HATCH3R_EFFICIENCY_TELEMETRY=0.
//
// Failures on either channel are reported to the failureLog channel per the
// Silent Failure Contract (CONSTITUTION.md §2 P5).

export interface EfficiencyEvent {
  artifactId: string;       // canonical artifact ID, e.g. "hatch3r-quick-change"
  phase: string;            // "triage" | "plan" | "act" | "review" | <custom>
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  modelHint?: string;       // free-form, e.g. "claude-opus-4-7", optional
  cacheHit?: boolean;       // optional, provider-specific, never required
}

const EFFICIENCY_TELEMETRY_ENV = "HATCH3R_EFFICIENCY_TELEMETRY";
const EFFICIENCY_LOG_RELATIVE = ".hatch3r/efficiency-events.jsonl";

export function isEfficiencyTelemetryEnabled(): boolean {
  return process.env[EFFICIENCY_TELEMETRY_ENV] === "1";
}

/**
 * Spawn-telemetry gate — default ON (D15-SA15.3-03).
 *
 * The OWASP 2026 Strong-Observability principle asks that tool-use patterns
 * and decision pathways be logged with enough fidelity to reconstruct agent
 * behavior post-hoc (genai.owasp.org, OWASP Top 10 for Agentic Applications
 * 2026, accessed 2026-07-11). Sub-agent spawn events (count + P8 B2
 * rationale) are the lowest-volume hatch3r-owned observable meeting that bar
 * — one JSONL line per fan-out — so they record by default. Setting
 * `HATCH3R_EFFICIENCY_TELEMETRY=0` is the explicit opt-out; any other value
 * (unset, "1", ...) leaves spawn telemetry on. Token/latency telemetry keeps
 * the stricter `=1` opt-in gate ({@link isEfficiencyTelemetryEnabled}).
 */
export function isSpawnTelemetryEnabled(): boolean {
  return process.env[EFFICIENCY_TELEMETRY_ENV] !== "0";
}

/**
 * Append a single EfficiencyEvent as a JSONL line under
 * `<projectRoot>/.hatch3r/efficiency-events.jsonl`. No-op when the env var
 * gate is unset. Never throws — I/O failures are routed through the
 * failureLog channel per the Silent Failure Contract.
 *
 * `projectRoot` defaults to `process.cwd()`, matching the convention used
 * by sync.ts and update.ts. It is exposed for tests so the JSONL path can
 * be redirected to a temp directory.
 */
export function recordEfficiencyEvent(
  e: EfficiencyEvent,
  projectRoot: string = process.cwd(),
): void {
  if (!isEfficiencyTelemetryEnabled()) return;
  const logPath = join(projectRoot, EFFICIENCY_LOG_RELATIVE);
  const line = JSON.stringify(e) + "\n";
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, line);
  } catch (err) {
    // silent-failure: routed to failureLog (Silent Failure Contract — CONSTITUTION.md §2 P5)
    try {
      const entry = createFailureLogEntry("efficiency-telemetry", err, {
        tool: e.artifactId,
      });
      const failureLine = formatLogEntry(entry) + "\n";
      const failurePath = join(projectRoot, ".hatch3r", FAILURE_LOG_FILE);
      mkdirSync(dirname(failurePath), { recursive: true });
      appendFileSync(failurePath, failureLine);
    } catch {
      // silent-failure: routed to failureLog (Silent Failure Contract — CONSTITUTION.md §2 P5)
      void err;
    }
  }
}

// ─── Cost-visibility telemetry hooks (Decision 24, 2.0.0 #29) ───
// Pillar P7 (Speed & Token Efficiency) + P5 (Governance Self-Quality).
//
// The cost section of the iteration summary needs two run-time signals from
// the orchestrator: (1) sub-agent spawn events (count + rationale) so
// `actual_sa_count` is grounded in observation, and (2) phase boundaries so
// `actual_duration_min` reflects measured wall-clock time. These hooks
// piggy-back on the existing efficiency-telemetry JSONL channel so a single
// log stream covers both efficiency and cost concerns.
//
// All hooks honour the Silent Failure Contract — failures are routed to the
// failureLog channel and NEVER throw.

/** A single sub-agent spawn record persisted alongside efficiency events. */
export interface SubAgentSpawnEvent {
  type: "subagent_spawn";
  sessionId: string;
  artifactId: string;
  /** Number of sub-agents spawned in this Task tool invocation. */
  count: number;
  /** One-sentence task-decomposition rationale per P8 B2. */
  rationale: string;
  /** ISO-8601 timestamp captured at spawn time. */
  timestamp: string;
}

/** A single phase-boundary record persisted alongside efficiency events. */
export interface PhaseDurationEvent {
  type: "phase_duration";
  sessionId: string;
  artifactId: string;
  /** Phase identifier — e.g. "triage", "plan", "act", "review", or a PhaseName. */
  phase: string;
  /** Wall-clock duration of the phase in milliseconds. */
  durationMs: number;
  /** ISO-8601 timestamp captured at phase end. */
  timestamp: string;
}

/**
 * Record that an orchestrator spawned `count` sub-agents in a single
 * Task-tool invocation. Persists a JSONL entry under
 * `<projectRoot>/.hatch3r/efficiency-events.jsonl`. Records BY DEFAULT
 * (D15-SA15.3-03 — Strong-Observability default posture); no-op only under
 * the explicit `HATCH3R_EFFICIENCY_TELEMETRY=0` opt-out
 * ({@link isSpawnTelemetryEnabled}). Silent Failure Contract on I/O failure.
 *
 * The orchestrator passes its own artifact id (e.g. `hatch3r-feature-plan`)
 * so consumers can attribute spawns to a specific command.
 */
export function recordSubAgentSpawn(
  sessionId: string,
  artifactId: string,
  count: number,
  rationale: string,
  projectRoot: string = process.cwd(),
): void {
  if (!isSpawnTelemetryEnabled()) return;
  const event: SubAgentSpawnEvent = {
    type: "subagent_spawn",
    sessionId,
    artifactId,
    count: Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0,
    rationale,
    timestamp: new Date().toISOString(),
  };
  appendCostTelemetry(event, projectRoot, artifactId);
}

/**
 * Record the wall-clock duration of a phase. Persists a JSONL entry under
 * `<projectRoot>/.hatch3r/efficiency-events.jsonl` when the env-gate is
 * set; otherwise no-op. Silent Failure Contract on I/O failure.
 */
export function recordPhaseDuration(
  sessionId: string,
  artifactId: string,
  phase: string,
  durationMs: number,
  projectRoot: string = process.cwd(),
): void {
  if (!isEfficiencyTelemetryEnabled()) return;
  const event: PhaseDurationEvent = {
    type: "phase_duration",
    sessionId,
    artifactId,
    phase,
    durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? Math.floor(durationMs) : 0,
    timestamp: new Date().toISOString(),
  };
  appendCostTelemetry(event, projectRoot, artifactId);
}

/**
 * Lightweight token-cost helper that reuses {@link recordEfficiencyEvent}.
 * Convenience wrapper for orchestrators that already know their tokens-in /
 * tokens-out for a given phase and want a one-call recording site. Honours
 * the same env-gate as `recordEfficiencyEvent`.
 */
export function recordTokenCost(
  artifactId: string,
  phase: string,
  tokensIn: number,
  tokensOut: number,
  options: {
    latencyMs?: number;
    modelHint?: string;
    cacheHit?: boolean;
    projectRoot?: string;
  } = {},
): void {
  recordEfficiencyEvent(
    {
      artifactId,
      phase,
      tokensIn: Math.max(0, Math.floor(tokensIn)),
      tokensOut: Math.max(0, Math.floor(tokensOut)),
      latencyMs: Math.max(0, Math.floor(options.latencyMs ?? 0)),
      modelHint: options.modelHint,
      cacheHit: options.cacheHit,
    },
    options.projectRoot ?? process.cwd(),
  );
}

/**
 * Shared writer for spawn + phase-duration events. Keeps a single JSONL
 * channel so the consumer side only needs one parser. Silent Failure
 * Contract: routes any I/O failure through the failureLog file.
 */
function appendCostTelemetry(
  event: SubAgentSpawnEvent | PhaseDurationEvent,
  projectRoot: string,
  artifactId: string,
): void {
  const logPath = join(projectRoot, EFFICIENCY_LOG_RELATIVE);
  const line = JSON.stringify(event) + "\n";
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, line);
  } catch (err) {
    try {
      const entry = createFailureLogEntry("cost-telemetry", err, {
        tool: artifactId,
      });
      const failureLine = formatLogEntry(entry) + "\n";
      const failurePath = join(projectRoot, ".hatch3r", FAILURE_LOG_FILE);
      mkdirSync(dirname(failurePath), { recursive: true });
      appendFileSync(failurePath, failureLine);
    } catch {
      // nested failure — nothing more we can do (Silent Failure Contract)
      void err;
    }
  }
}

// ─── Spawn-telemetry sink reachability (D15-SA15.3-03) ───
// Strong-Observability check surface: an unreachable sink means the
// default-on spawn audit trail silently records nothing (the Silent Failure
// Contract swallows the write error), so the posture claim "spawn telemetry
// is on by default" needs a probe that asserts the sink is actually
// writable. Designed for the compliance report
// (src/pipeline/complianceVerification.ts::runComplianceChecks) to consume
// as a named check.

/** Result of probing the spawn-telemetry sink. */
export interface SpawnTelemetryReachability {
  /** True when the spawn channel is enabled (no `HATCH3R_EFFICIENCY_TELEMETRY=0` opt-out). */
  enabled: boolean;
  /** True when the sink path can be created or appended to from this process. */
  sinkWritable: boolean;
  /** The Strong-Observability assertion: `enabled && sinkWritable`. */
  reachable: boolean;
  /** Absolute path of the JSONL sink probed. */
  sinkPath: string;
  /** One-line human-readable probe outcome. */
  detail: string;
}

/**
 * Probe whether the spawn-telemetry sink is reachable WITHOUT mutating it:
 * an existing sink file is checked for append access; a not-yet-created sink
 * is reachable when its nearest existing ancestor is a writable + traversable
 * directory (`mkdir -p` descends from there). Never throws — probe failures
 * report `sinkWritable: false` with the failure detail.
 *
 * Best-effort on Windows: `accessSync` write checks on directories are
 * advisory there (Node fs docs), but the structural checks (non-directory
 * ancestor, sink-is-a-directory) are exact on every platform.
 */
export function checkSpawnTelemetryReachability(
  projectRoot: string = process.cwd(),
): SpawnTelemetryReachability {
  const sinkPath = join(projectRoot, EFFICIENCY_LOG_RELATIVE);
  const enabled = isSpawnTelemetryEnabled();
  let sinkWritable = false;
  let detail: string;

  try {
    if (existsSync(sinkPath)) {
      if (!statSync(sinkPath).isFile()) {
        detail = `sink exists but is not a regular file: ${sinkPath}`;
      } else {
        accessSync(sinkPath, fsConstants.W_OK);
        sinkWritable = true;
        detail = "sink file exists and is appendable";
      }
    } else {
      const ancestor = nearestExistingAncestor(dirname(sinkPath));
      if (ancestor === null) {
        detail = `no existing ancestor directory for ${sinkPath}`;
      } else if (!statSync(ancestor).isDirectory()) {
        detail = `path blocked by non-directory ancestor: ${ancestor}`;
      } else {
        accessSync(ancestor, fsConstants.W_OK | fsConstants.X_OK);
        sinkWritable = true;
        detail = `sink creatable under ${ancestor}`;
      }
    }
  } catch (err) {
    sinkWritable = false;
    detail = `sink probe failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  return {
    enabled,
    sinkWritable,
    reachable: enabled && sinkWritable,
    sinkPath,
    detail: enabled
      ? detail
      : `spawn telemetry opted out (${EFFICIENCY_TELEMETRY_ENV}=0); ${detail}`,
  };
}

/** Walk up from `p` to the nearest path segment that exists on disk. */
function nearestExistingAncestor(p: string): string | null {
  let current = p;
  for (;;) {
    if (existsSync(current)) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

// ─── Observed output:input token ratio (D6-SA6.3-05) ───
// Pillar CQ7 (Performance) + P2 (measurable criteria). `explain --cost`
// previously fixed output tokens at input/4 — a constant with no published
// basis: Anthropic's token-counting endpoint returns INPUT token counts only,
// so an output:input ratio cannot be pre-computed from vendor tooling and
// must be observed from runtime usage
// (platform.claude.com/docs/en/docs/build-with-claude/token-counting,
// accessed 2026-07-11 — the 301 target of the former docs.anthropic.com
// path). This helper derives the ratio from the EfficiencyEvent telemetry
// this module records, falling back to the labeled heuristic constant when
// the sample is too small.

/**
 * Fallback output:input token ratio used when no (or too little) observed
 * telemetry exists.
 *
 * Basis: heuristic assumption (one part output per four parts input),
 * retained for continuity with the pre-existing `explain --cost` estimate
 * surface — NOT a vendor-published figure. No output:input ratio is
 * published for Claude-family models; the token-counting endpoint counts
 * input tokens only (platform.claude.com/docs/en/docs/build-with-claude/
 * token-counting, accessed 2026-07-11), so output volume must be measured
 * from runtime usage — which is what {@link recordEfficiencyEvent} captures.
 * Code-heavy tasks can invert the ratio past 1.0; consumers should prefer
 * {@link observedOutputInputRatio}, which supersedes this constant as soon
 * as enough events are recorded.
 */
export const DEFAULT_OUTPUT_INPUT_TOKEN_RATIO = 0.25;

/** Minimum token-bearing events before the observed ratio supersedes the default. */
const RATIO_MIN_SAMPLE_EVENTS = 5;

/** Recency window: only the most recent N token-bearing events are aggregated. */
const RATIO_MAX_RECENT_EVENTS = 200;

/** Outcome of deriving the output:input token ratio from telemetry. */
export interface ObservedTokenRatio {
  /** Output:input ratio — observed when the sample sufficed, else the default. */
  ratio: number;
  /** Whether `ratio` came from telemetry or the fallback constant. */
  basis: "observed" | "default";
  /**
   * Token-bearing EfficiencyEvent lines inside the recency window — also
   * populated when the sample was too small for the observed basis.
   */
  sampleEvents: number;
  /** Sum of `tokensIn` across the aggregated sample. */
  totalTokensIn: number;
  /** Sum of `tokensOut` across the aggregated sample. */
  totalTokensOut: number;
  /**
   * Populated when the sink existed but could not be read (the fallback
   * ratio still applies) — Silent Failure Contract diagnostic channel.
   * Absent on the normal paths (no sink yet, or a clean read).
   */
  detail?: string;
}

/**
 * Derive the output:input token ratio from recorded EfficiencyEvent
 * telemetry (`<projectRoot>/.hatch3r/efficiency-events.jsonl`).
 *
 * Aggregates the most recent `maxEvents` token-bearing EfficiencyEvent lines
 * (spawn / phase-duration lines carry a `type` discriminant and are skipped;
 * malformed lines are tolerated, mirroring the read-side tolerance of
 * `explain --efficiency`). When fewer than `minSampleEvents` qualifying
 * events exist, returns {@link DEFAULT_OUTPUT_INPUT_TOKEN_RATIO} with
 * `basis: "default"`. Never throws — a missing or unreadable sink yields the
 * fallback.
 */
export function observedOutputInputRatio(
  projectRoot: string = process.cwd(),
  options: { minSampleEvents?: number; maxEvents?: number } = {},
): ObservedTokenRatio {
  const minSample = options.minSampleEvents ?? RATIO_MIN_SAMPLE_EVENTS;
  const maxEvents = options.maxEvents ?? RATIO_MAX_RECENT_EVENTS;
  const fallback: ObservedTokenRatio = {
    ratio: DEFAULT_OUTPUT_INPUT_TOKEN_RATIO,
    basis: "default",
    sampleEvents: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
  };

  let raw: string;
  try {
    raw = readFileSync(join(projectRoot, EFFICIENCY_LOG_RELATIVE), "utf-8");
  } catch (err) {
    // ENOENT = no telemetry recorded yet — the designed fallback path, not a
    // failure. Any other read error is surfaced to the caller via `detail`
    // (Silent Failure Contract — CONSTITUTION.md §2 P5).
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    return {
      ...fallback,
      detail: `telemetry sink unreadable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const samples: Array<{ tokensIn: number; tokensOut: number }> = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof evt.type === "string") continue; // spawn / phase-duration event
    const { tokensIn, tokensOut } = evt;
    if (
      typeof tokensIn !== "number" ||
      !Number.isFinite(tokensIn) ||
      tokensIn <= 0 ||
      typeof tokensOut !== "number" ||
      !Number.isFinite(tokensOut) ||
      tokensOut < 0
    ) {
      continue;
    }
    samples.push({ tokensIn, tokensOut });
  }

  const recent = samples.slice(-Math.max(1, Math.floor(maxEvents)));
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  for (const s of recent) {
    totalTokensIn += s.tokensIn;
    totalTokensOut += s.tokensOut;
  }

  if (recent.length < minSample || totalTokensIn <= 0) {
    return { ...fallback, sampleEvents: recent.length, totalTokensIn, totalTokensOut };
  }

  return {
    ratio: totalTokensOut / totalTokensIn,
    basis: "observed",
    sampleEvents: recent.length,
    totalTokensIn,
    totalTokensOut,
  };
}

// ─── Structured cost-block serialisation (Decision 24, 2.0.0 #29) ───
// Pillar P7 (Speed & Token Efficiency) + CQ4 (Reliability).
//
// `formatCostBlock(estimate, actuals?)` in costEstimator.ts returns the
// YAML *string* form embedded directly in stderr / log output. Orchestrator
// command runners that build the §2 "Fan-out + Cost" section of an iteration
// summary need the same data as a *structured object* so they can splice it
// into a larger YAML/JSON payload without round-tripping through a string.
// `buildCostBlock` returns that object using the canonical iteration-summary
// field names from `rules/hatch3r-iteration-summary.md`:
//   {expected_sa_count, estimated_input_tokens_static_frame, triage_tier,
//    web_research_budget, estimated_duration_min}
// — note: the iteration-summary schema canonicalises the web-research field
// as `web_research_budget`, whereas {@link CostEstimate} uses the internal
// name `estimated_web_research_queries`. This helper performs that rename so
// orchestrators emit the canonical name without extra mapping at the call
// site.

/**
 * Estimate side of the iteration-summary cost block — canonical 5 fields
 * per CONSTITUTION §6 Decision 24 / Bucket 29.
 */
export interface CostBlockEstimate {
  expected_sa_count: number;
  estimated_input_tokens_static_frame: number;
  triage_tier: TriageTier;
  web_research_budget: number;
  estimated_duration_min: number;
}

/**
 * Actuals side of the iteration-summary cost block — 5 fields mirroring
 * {@link CostBlockEstimate} so the per-field delta is well-defined.
 */
export interface CostBlockActuals {
  actual_sa_count: number;
  actual_input_tokens_static_frame: number;
  actual_web_research_queries: number;
  actual_duration_min: number;
  recorded_at: string;
}

/**
 * Per-field delta-percent map plus the over-variance flag, matching the
 * `delta_percent:` sub-block in the iteration-summary YAML template.
 */
export interface CostBlockDelta {
  sa_count: number;
  input_tokens: number;
  web_research: number;
  duration: number;
  /** True when any |delta_percent| exceeds {@link VARIANCE_THRESHOLD_PERCENT}. */
  over_variance: boolean;
  /** Fields that triggered the over-variance flag (empty when not flagged). */
  flagged_fields: string[];
}

/**
 * Structured cost block ready to be serialised into an orchestrator's
 * iteration summary. The estimate side is always present; the actuals +
 * delta sides are populated only when the orchestrator records actuals.
 */
export interface CostBlock {
  estimate: CostBlockEstimate;
  actuals?: CostBlockActuals;
  delta?: CostBlockDelta;
}

/**
 * Build the structured cost block for an orchestrator's iteration summary.
 *
 * Returns an object — NOT a string — so command runners can splice it into
 * a larger YAML/JSON payload without re-parsing. Field names match the
 * canonical iteration-summary schema in `rules/hatch3r-iteration-summary.md`
 * (notably `web_research_budget`, not `estimated_web_research_queries`).
 *
 * When `actuals` is omitted only the estimate side is emitted (pre-execution
 * preview). When supplied, the helper additionally fills in the matching
 * `actuals` block and a `delta` object derived via {@link computeDelta}.
 *
 * Cite: CONSTITUTION §6 Decision 24 / Bucket 29 — every orchestrator emits
 * at plan time `{expected_sa_count, estimated_input_tokens_static_frame,
 * triage_tier, web_research_budget, estimated_duration_min}`; post-execution
 * actuals + delta close the loop in the §2 "Fan-out + Cost" section of the
 * iteration summary.
 *
 * Pure function — no I/O, never throws.
 */
export function buildCostBlock(input: {
  estimate: CostEstimateData;
  actuals?: CostActualsData;
}): CostBlock {
  const block: CostBlock = {
    estimate: {
      expected_sa_count: input.estimate.expected_sa_count,
      estimated_input_tokens_static_frame:
        input.estimate.estimated_input_tokens_static_frame,
      triage_tier: input.estimate.triage_tier,
      web_research_budget: input.estimate.estimated_web_research_queries,
      estimated_duration_min: input.estimate.estimated_duration_min,
    },
  };

  if (input.actuals) {
    const delta = computeCostDelta(input.estimate, input.actuals);
    block.actuals = {
      actual_sa_count: input.actuals.actual_sa_count,
      actual_input_tokens_static_frame:
        input.actuals.actual_input_tokens_static_frame,
      actual_web_research_queries: input.actuals.actual_web_research_queries,
      actual_duration_min: input.actuals.actual_duration_min,
      recorded_at: input.actuals.recorded_at,
    };
    block.delta = {
      sa_count: delta.sa_count_delta_percent,
      input_tokens: delta.input_tokens_delta_percent,
      web_research: delta.web_research_delta_percent,
      duration: delta.duration_delta_percent,
      over_variance: delta.over_variance,
      flagged_fields: delta.flagged_fields,
    };
  }

  return block;
}
