/**
 * Persistent audit trail for pipeline failures.
 *
 * #251 (D8-8.18): Records pipeline failures to a persistent log file
 * so failures can be reviewed after the fact. Each entry includes
 * timestamp, phase, error details, and context for debugging.
 *
 * The log is append-only and auto-rotated when it exceeds MAX_LOG_SIZE.
 */

import { verbose } from "../cli/shared/ui.js";

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

/** Maximum log file size in bytes before rotation (500KB). */
export const MAX_LOG_SIZE = 512 * 1024;

/** Default log file name within the .agents directory. */
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
 * Tolerant of malformed lines (skips them silently).
 */
export function parseFailureLog(content: string): FailureLogEntry[] {
  const entries: FailureLogEntry[] = [];
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
      // Surface under --verbose so operators see the underlying corruption.
      const message = err instanceof Error ? err.message : String(err);
      verbose(`failureLog: parseFailureLog skipped malformed line — ${message}`);
    }
  }
  return entries;
}

/**
 * Check whether the log content exceeds the max size and needs rotation.
 */
export function shouldRotateLog(content: string): boolean {
  return Buffer.byteLength(content, "utf-8") > MAX_LOG_SIZE;
}

/**
 * Rotate the log by keeping only the most recent half of entries.
 */
export function rotateLog(content: string): string {
  const entries = parseFailureLog(content);
  if (entries.length <= 1) return content;
  const keepCount = Math.ceil(entries.length / 2);
  const kept = entries.slice(-keepCount);
  return kept.map(formatLogEntry).join("\n") + "\n";
}
