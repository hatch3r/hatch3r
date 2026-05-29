/**
 * Persistent audit trail for pipeline failures.
 *
 * #251 (D8-8.18): Records pipeline failures to a persistent log file
 * so failures can be reviewed after the fact. Each entry includes
 * timestamp, phase, error details, and context for debugging.
 *
 * The log is append-only and auto-rotated when it exceeds MAX_LOG_SIZE.
 */

import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";

import { warn } from "../cli/shared/ui.js";
import { safeWriteFile } from "../merge/safeWrite.js";

// ── Types ────────────────────────────────────────────────────────

export interface FailureLogEntry {
  /** ISO-8601 timestamp of the failure. */
  timestamp: string;
  /** Pipeline phase where the failure occurred. */
  phase: string;
  /** Which adapter/tool was involved (if applicable). */
  tool?: string;
  /** Error message. */
  error: string;
  /** Error code (if HatchError). */
  errorCode?: string;
  /** Correlation ID for the pipeline run (if available). */
  correlationId?: string;
  /** hatch3r version. */
  version?: string;
}

// ── Constants ────────────────────────────────────────────────────

/**
 * Default maximum log file size in bytes before rotation (500KB).
 *
 * D8-M6 (Cycle 10 rollover): the literal `MAX_LOG_SIZE` is preserved as the
 * compile-time default so callers that hard-coded it (e.g. existing tests)
 * keep working unchanged. The operator-facing budget is now resolved at
 * runtime via {@link getMaxLogSize}, which honours the
 * `HATCH3R_FAILURE_LOG_MAX_BYTES` env var. Use {@link DEFAULT_MAX_LOG_SIZE}
 * in new call sites and reserve {@link MAX_LOG_SIZE} for backward-compat
 * imports.
 */
export const DEFAULT_MAX_LOG_SIZE = 512 * 1024;
export const MAX_LOG_SIZE = DEFAULT_MAX_LOG_SIZE;

/**
 * Minimum retention floor for {@link rotateLog}: even at the smallest allowed
 * log budget, never drop below this many entries. Prevents the rotation from
 * discarding the failure that triggered an investigation when the budget is
 * tuned very low (e.g. embedded CI runners with strict disk quotas).
 *
 * Set to 10 (rather than 1) because a single retained entry would mean the
 * NEXT failure replaces the most recent one — so the operator who runs
 * `hatch3r --verbose` after a flaky run sees only the LAST failure, not the
 * sequence. 10 covers the typical "what just went wrong?" debugging window
 * without inflating the on-disk footprint materially even at MAX_LOG_SIZE=10.
 */
export const MIN_RETAINED_ENTRIES = 10;

/**
 * Env var that overrides {@link DEFAULT_MAX_LOG_SIZE}. Value parsed as bytes
 * (integer). Invalid or unset values fall back to the default.
 *
 * Example: `HATCH3R_FAILURE_LOG_MAX_BYTES=2097152` raises the rotation budget
 * to 2MB for an environment that needs deeper history (long-running CI shard).
 */
export const FAILURE_LOG_MAX_BYTES_ENV = "HATCH3R_FAILURE_LOG_MAX_BYTES";

/**
 * Resolve the active max-log-size budget. Honours
 * `HATCH3R_FAILURE_LOG_MAX_BYTES` when set to a positive integer; falls back
 * to {@link DEFAULT_MAX_LOG_SIZE} otherwise. Resolved at call time so unit
 * tests can mutate `process.env` between assertions without re-importing.
 */
export function getMaxLogSize(): number {
  const raw = process.env[FAILURE_LOG_MAX_BYTES_ENV];
  if (raw === undefined || raw === "") return DEFAULT_MAX_LOG_SIZE;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_LOG_SIZE;
  return parsed;
}

/** Default log file name within the .hatch3r/ user-state directory (Wave 6+ path). */
export const FAILURE_LOG_FILE = ".failure-log.jsonl";

// ── Implementation ───────────────────────────────────────────────

/**
 * Format a failure log entry as a single JSONL line.
 */
export function formatLogEntry(entry: FailureLogEntry): string {
  return JSON.stringify(entry);
}

/**
 * Create a failure log entry from an error and context.
 */
export function createFailureLogEntry(
  phase: string,
  error: unknown,
  options?: {
    tool?: string;
    correlationId?: string;
    version?: string;
  },
): FailureLogEntry {
  const entry: FailureLogEntry = {
    timestamp: new Date().toISOString(),
    phase,
    error: error instanceof Error ? error.message : String(error),
  };

  if (error instanceof Error && "errorCode" in error) {
    entry.errorCode = (error as { errorCode: string }).errorCode;
  }

  if (options?.tool) entry.tool = options.tool;
  if (options?.correlationId) entry.correlationId = options.correlationId;
  if (options?.version) entry.version = options.version;

  return entry;
}

/**
 * Parse a JSONL failure log into entries.
 *
 * Tolerant of malformed lines (skips them rather than throwing).
 *
 * F8.3.7 (Cycle 10 D8, P5): corruption of the audit trail itself is
 * operator-relevant regardless of the `--verbose` flag — an operator who
 * does not yet know the log is corrupt has no reason to re-run with verbose.
 * Each malformed line therefore emits via {@link warn} (stderr, always on)
 * rather than the prior `verbose()` (stderr, flag-gated). The first malformed
 * line keeps its specific parse error for diagnosis; a trailing summary
 * self-describes how many lines were dropped so the warning is self-contained
 * without the pure parser acquiring a file-write side effect.
 */
export function parseFailureLog(content: string): FailureLogEntry[] {
  const entries: FailureLogEntry[] = [];
  let skipped = 0;
  let firstError = "";
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as FailureLogEntry;
      if (parsed.timestamp && parsed.phase && parsed.error) {
        entries.push(parsed);
      }
    } catch (err) {
      // Skip malformed lines -- do not let log parsing errors break the pipeline.
      skipped += 1;
      if (!firstError) firstError = err instanceof Error ? err.message : String(err);
    }
  }
  if (skipped > 0) {
    warn(
      `failureLog: parseFailureLog skipped ${skipped} malformed line${skipped === 1 ? "" : "s"} ` +
        `in the failure log (audit trail may be corrupt) — first error: ${firstError}`,
    );
  }
  return entries;
}

/**
 * Check whether the log content exceeds the max size and needs rotation.
 *
 * D8-M6: budget is resolved at call time via {@link getMaxLogSize} so
 * `HATCH3R_FAILURE_LOG_MAX_BYTES` overrides take effect without a process
 * restart.
 */
export function shouldRotateLog(content: string): boolean {
  return Buffer.byteLength(content, "utf-8") > getMaxLogSize();
}

/**
 * Rotate the log by keeping only the most recent half of entries.
 *
 * D8-M6: enforces {@link MIN_RETAINED_ENTRIES} as a minimum-retention floor —
 * even when the half-split would drop below that count, we retain at least
 * the floor's worth of most-recent entries so a tightly-tuned log budget
 * does not erase the failure being investigated. The floor is capped at the
 * actual entry count so a log with fewer entries than the floor returns
 * unchanged (semantically equivalent to the prior "<=1" carve-out).
 */
export function rotateLog(content: string): string {
  const entries = parseFailureLog(content);
  if (entries.length <= 1) return content;
  const halfCount = Math.ceil(entries.length / 2);
  const flooredCount = Math.min(entries.length, Math.max(halfCount, MIN_RETAINED_ENTRIES));
  const kept = entries.slice(-flooredCount);
  return kept.map(formatLogEntry).join("\n") + "\n";
}

/**
 * Result of a {@link writeFailureLog} call.
 *
 * `written` is `true` when the entry reached disk. When `false`, `warning`
 * carries an operator-facing message naming the underlying fs error so the
 * caller can surface it (via the `warn()` UI helper + end-of-command summary)
 * rather than the audit trail silently losing the entry.
 */
export interface WriteFailureLogResult {
  written: boolean;
  warning?: string;
}

/**
 * Append a failure entry to the persistent failure log under `agentsDir`,
 * rotating when the log exceeds the configured budget.
 *
 * F8.4.5 (Cycle 10 D8, P5): this is the single-source writer for the failure
 * log. Previously `appendFailure` was reimplemented in both `sync.ts` and
 * `update.ts`, each swallowing write failures (the inner `catch` emitted only
 * a `console.error`/`verbose` line). Centralising here removes the duplication
 * (CONSTITUTION §2 P5 single-source-of-truth) and, per the Silent Failure
 * Contract, RETURNS the failure as `{ written: false, warning }` instead of
 * swallowing it — so the caller can route it through the `warn()` channel and
 * the end-of-command summary. The function never throws: failure-log I/O must
 * not break the command it instruments, but the operator must still learn the
 * audit trail did not persist.
 */
export async function writeFailureLog(
  agentsDir: string,
  phase: string,
  error: unknown,
  options?: { tool?: string; correlationId?: string; version?: string },
): Promise<WriteFailureLogResult> {
  const logPath = join(agentsDir, FAILURE_LOG_FILE);
  let preRotateWarning: string | undefined;
  try {
    const entry = createFailureLogEntry(phase, error, options);
    const line = formatLogEntry(entry) + "\n";

    // Check whether rotation is needed before appending. A read failure other
    // than ENOENT (the normal first-run path) may indicate disk corruption or
    // a permission issue; capture it so it is surfaced alongside any later
    // append failure rather than dropped.
    try {
      const existing = await readFile(logPath, "utf-8");
      if (shouldRotateLog(existing + line)) {
        const rotated = rotateLog(existing);
        await safeWriteFile(logPath, rotated + line);
        return { written: true };
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        const message = err instanceof Error ? err.message : String(err);
        preRotateWarning =
          `Failure-log read-before-rotate failed for ${logPath} — ${message}. ` +
          `Rotation skipped; appending without it.`;
      }
    }

    await appendFile(logPath, line);
    return { written: true, warning: preRotateWarning };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      written: false,
      warning:
        `Failure-log entry was NOT persisted to ${logPath} — ${message}. ` +
        `The audit trail is incomplete; check write permission / disk space on the .hatch3r/ directory.`,
    };
  }
}
