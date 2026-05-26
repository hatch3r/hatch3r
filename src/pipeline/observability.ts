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
 * Metric naming convention: all exported interfaces use `{Scope}{Metric}`
 * format (e.g. `PhaseTokenEstimate`, `PipelineTokenSummary`, `CostEstimate`).
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { createFailureLogEntry, formatLogEntry, FAILURE_LOG_FILE } from "./failureLog.js";
import type { PhaseName } from "./phaseTimeout.js";

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

// ── Budget Tracking (D12 Medium: #315-#330) ──────────────────────

/**
 * Cost estimation for a pipeline run based on token counts.
 *
 * Uses configurable per-token rates to estimate costs.
 * Default rates are conservative estimates for typical LLM pricing.
 */
export interface CostEstimate {
  /** Estimated input cost. */
  inputCost: number;
  /** Estimated output cost. */
  outputCost: number;
  /** Total estimated cost. */
  totalCost: number;
  /** Currency code. */
  currency: string;
  /** Whether any budget threshold was exceeded. */
  budgetWarning: boolean;
  /** Warning message if budget threshold exceeded. */
  warningMessage?: string;
}

/** Default cost per 1M input tokens in USD. */
export const DEFAULT_INPUT_COST_PER_1M = 3.0;

/** Default cost per 1M output tokens in USD. */
export const DEFAULT_OUTPUT_COST_PER_1M = 15.0;

/**
 * Estimate cost from a token summary.
 */
export function estimateCost(
  summary: PipelineTokenSummary,
  options?: {
    inputCostPer1M?: number;
    outputCostPer1M?: number;
    currency?: string;
    budgetLimit?: number;
    warningThresholds?: number[];
  },
): CostEstimate {
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

// ─── Efficiency telemetry (opt-in via HATCH3R_EFFICIENCY_TELEMETRY=1) ───
// Pillar P7. Records token-level and latency telemetry for end-user agentic
// flows. Disabled by default; failures are reported to the failureLog channel
// per the Silent Failure Contract (CONSTITUTION.md §2 P5).

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
 * `<projectRoot>/.hatch3r/efficiency-events.jsonl` when the env-gate is
 * set; otherwise no-op. Silent Failure Contract on I/O failure.
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
  if (!isEfficiencyTelemetryEnabled()) return;
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
