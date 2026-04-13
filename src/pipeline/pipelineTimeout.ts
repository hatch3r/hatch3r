/**
 * Overall pipeline execution timeout with graceful termination.
 *
 * Enforces a maximum total execution time for the entire pipeline.
 * When the timeout is reached, the pipeline terminates gracefully:
 * saving progress, reporting what was completed, and providing
 * a summary of what remained.
 *
 * Finding #58 (D8, High): Add maximum pipeline execution time with graceful termination.
 */

import type { PhaseName } from "./phaseTimeout.js";

// ── Constants ────────────────────────────────────────────────────

/** Default maximum pipeline execution time in milliseconds (15 minutes). */
export const DEFAULT_PIPELINE_TIMEOUT_MS = 15 * 60 * 1000;

/** Minimum allowed pipeline timeout in milliseconds (30 seconds). */
export const MIN_PIPELINE_TIMEOUT_MS = 30_000;

/** Maximum allowed pipeline timeout in milliseconds (60 minutes). */
export const MAX_PIPELINE_TIMEOUT_MS = 60 * 60 * 1000;

// ── Types ────────────────────────────────────────────────────────

export interface PhaseProgress {
  phase: PhaseName;
  status: "completed" | "in_progress" | "pending" | "skipped" | "timed_out";
  startedAt?: string;
  completedAt?: string;
  elapsedMs?: number;
  /** Partial results for in-progress phases. */
  partialResult?: string;
}

export interface PipelineExecutionState {
  /** Whether the pipeline is currently running. */
  running: boolean;
  /** ISO timestamp of pipeline start. */
  startedAt: string;
  /** Maximum execution time in milliseconds. */
  timeoutMs: number;
  /** Progress of each phase. */
  phases: PhaseProgress[];
  /** Whether the pipeline was terminated due to timeout. */
  timedOut: boolean;
  /** ISO timestamp of termination, if applicable. */
  terminatedAt?: string;
  /** Summary of completed work at termination. */
  completionSummary?: string;
}

export interface PipelineTerminationReport {
  /** Whether the pipeline completed all phases. */
  completedAll: boolean;
  /** Total elapsed time in milliseconds. */
  totalElapsedMs: number;
  /** Phases that completed successfully. */
  completedPhases: PhaseName[];
  /** Phase that was in progress when timeout hit (if any). */
  interruptedPhase?: PhaseName;
  /** Phases that were never started. */
  pendingPhases: PhaseName[];
  /** Human-readable summary. */
  summary: string;
}

// ── Implementation ───────────────────────────────────────────────

/**
 * Clamp a pipeline timeout to the allowed range.
 */
export function clampPipelineTimeout(timeoutMs: number): number {
  return Math.max(MIN_PIPELINE_TIMEOUT_MS, Math.min(timeoutMs, MAX_PIPELINE_TIMEOUT_MS));
}

/**
 * Create a new pipeline execution state.
 */
export function createPipelineExecution(
  phases: PhaseName[],
  timeoutMs: number = DEFAULT_PIPELINE_TIMEOUT_MS,
): PipelineExecutionState {
  return {
    running: true,
    startedAt: new Date().toISOString(),
    timeoutMs: clampPipelineTimeout(timeoutMs),
    phases: phases.map((phase) => ({
      phase,
      status: "pending",
    })),
    timedOut: false,
  };
}

/**
 * Check if the pipeline has exceeded its timeout.
 */
export function isPipelineTimedOut(state: PipelineExecutionState): boolean {
  if (state.timedOut) return true;
  const elapsed = Date.now() - new Date(state.startedAt).getTime();
  return elapsed >= state.timeoutMs;
}

/**
 * Get remaining time in milliseconds for the pipeline.
 * Returns 0 if the timeout has been exceeded.
 */
export function getRemainingTime(state: PipelineExecutionState): number {
  const elapsed = Date.now() - new Date(state.startedAt).getTime();
  return Math.max(0, state.timeoutMs - elapsed);
}

/**
 * Mark a phase as started.
 */
export function markPhaseStarted(
  state: PipelineExecutionState,
  phase: PhaseName,
): PipelineExecutionState {
  return {
    ...state,
    phases: state.phases.map((p) =>
      p.phase === phase
        ? { ...p, status: "in_progress" as const, startedAt: new Date().toISOString() }
        : p,
    ),
  };
}

/**
 * Mark a phase as completed.
 */
export function markPhaseCompleted(
  state: PipelineExecutionState,
  phase: PhaseName,
  elapsedMs: number,
): PipelineExecutionState {
  return {
    ...state,
    phases: state.phases.map((p) =>
      p.phase === phase
        ? {
            ...p,
            status: "completed" as const,
            completedAt: new Date().toISOString(),
            elapsedMs,
          }
        : p,
    ),
  };
}

/**
 * Mark a phase as skipped.
 */
export function markPhaseSkipped(
  state: PipelineExecutionState,
  phase: PhaseName,
): PipelineExecutionState {
  return {
    ...state,
    phases: state.phases.map((p) =>
      p.phase === phase
        ? { ...p, status: "skipped" as const }
        : p,
    ),
  };
}

/**
 * Gracefully terminate the pipeline due to timeout.
 *
 * Records what was completed, what was in progress, and what
 * was pending. Returns the updated state and a termination report.
 */
export function terminatePipeline(
  state: PipelineExecutionState,
  partialResult?: string,
): { state: PipelineExecutionState; report: PipelineTerminationReport } {
  const now = new Date().toISOString();
  const totalElapsedMs = Date.now() - new Date(state.startedAt).getTime();

  // Mark any in-progress phase as timed_out
  const updatedPhases = state.phases.map((p) => {
    if (p.status === "in_progress") {
      return {
        ...p,
        status: "timed_out" as const,
        completedAt: now,
        elapsedMs: p.startedAt
          ? Date.now() - new Date(p.startedAt).getTime()
          : undefined,
        partialResult,
      };
    }
    return p;
  });

  const completedPhases = updatedPhases
    .filter((p) => p.status === "completed")
    .map((p) => p.phase);

  const interruptedPhase = updatedPhases.find(
    (p) => p.status === "timed_out",
  )?.phase;

  const pendingPhases = updatedPhases
    .filter((p) => p.status === "pending")
    .map((p) => p.phase);

  const completedAll = pendingPhases.length === 0 && !interruptedPhase;

  // Build summary
  const summaryParts: string[] = [
    `Pipeline ${completedAll ? "completed" : "terminated after timeout"} ` +
    `(${Math.round(totalElapsedMs / 1000)}s / ${Math.round(state.timeoutMs / 1000)}s limit).`,
  ];

  if (completedPhases.length > 0) {
    summaryParts.push(`Completed phases: ${completedPhases.join(", ")}.`);
  }

  if (interruptedPhase) {
    summaryParts.push(`Interrupted phase: ${interruptedPhase}.`);
  }

  if (pendingPhases.length > 0) {
    summaryParts.push(`Pending phases: ${pendingPhases.join(", ")}.`);
  }

  const summary = summaryParts.join(" ");

  const updatedState: PipelineExecutionState = {
    ...state,
    running: false,
    phases: updatedPhases,
    timedOut: !completedAll,
    terminatedAt: now,
    completionSummary: summary,
  };

  const report: PipelineTerminationReport = {
    completedAll,
    totalElapsedMs,
    completedPhases,
    interruptedPhase,
    pendingPhases,
    summary,
  };

  return { state: updatedState, report };
}

/**
 * Generate a human-readable progress summary of the pipeline.
 */
export function pipelineProgressSummary(state: PipelineExecutionState): string {
  const elapsed = Date.now() - new Date(state.startedAt).getTime();
  const remaining = Math.max(0, state.timeoutMs - elapsed);
  const parts: string[] = [
    `Pipeline: ${Math.round(elapsed / 1000)}s elapsed, ${Math.round(remaining / 1000)}s remaining`,
  ];

  const completed = state.phases.filter((p) => p.status === "completed").length;
  const total = state.phases.length;
  parts.push(`Phases: ${completed}/${total} completed`);

  if (state.timedOut) {
    parts.push("Status: TIMED OUT");
  } else if (!state.running) {
    parts.push("Status: finished");
  } else {
    const current = state.phases.find((p) => p.status === "in_progress");
    parts.push(`Status: ${current ? `running ${current.phase}` : "idle"}`);
  }

  return parts.join(" | ");
}
