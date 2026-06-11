/**
 * SPACE-shaped activity/performance instrumentation (Cycle 10 / F10.8-1).
 *
 * SPACE = **S**atisfaction, **P**erformance, **A**ctivity, **C**ommunication,
 * **E**fficiency — the five-axis developer-productivity framework introduced
 * by Forsgren, Storey, Maddila, Zimmermann, Houck, and Butler (Microsoft
 * Research / GitHub Next, ACM Queue 19(1):20-48, 2021). The {@link SpaceAxis}
 * type carries all five axes so a record can name any of them, but only the
 * **activity** and **performance** axes have live feeders today: the primary
 * metric `firstRunSuccessRate` (performance) recorded from `init.ts`, and the
 * activity counts a future host-runtime bridge would emit. The
 * **satisfaction** and **communication** axes are reserved — no caller writes
 * them yet — so the "SPACE" label describes the data shape, not coverage of
 * all five axes (D10-40). `firstRunSuccessRate` is true if `npx hatch3r init`
 * completes without error AND the user reaches a first adapter output. Records
 * persist as JSONL under
 * `<projectRoot>/.hatch3r/telemetry/space-<YYYY-MM-DD>.jsonl` (gitignored).
 *
 * Pillar service:
 * - **P1 (CLI UX Excellence)** — `firstRunSuccessRate` is the canonical
 *   first-run-success measurement called out in `governance/CONSTITUTION.md`
 *   §6 P1 Measurement and §6 CQ2 Measurement ("first-run success rate per
 *   user task ≥80%"). This module is the recording site for that metric.
 * - **CQ4 (Reliability)** — the in-memory ring buffer + atomic JSONL append
 *   makes recording side-effect-free for callers and degrades silently when
 *   disk I/O fails (Silent Failure Contract, CONSTITUTION §2 P5).
 * - **CQ7 (Performance)** — bounded ring buffer (default 1000 entries)
 *   keeps memory footprint O(1) regardless of session length.
 *
 * Cross-reference: cost-visibility telemetry (Decision 24, CONSTITUTION §6
 * Key Design Decision #29) lives in `pipeline/costEstimator.ts`. SPACE
 * telemetry is the broader developer-productivity sibling — cost visibility
 * is one Efficiency axis input among many — and both write under the same
 * `.hatch3r/telemetry/` directory for consolidated post-run inspection.
 *
 * **Silent Failure Contract:** persistence I/O failures NEVER throw. They
 * route through the failureLog channel per CONSTITUTION §2 P5.
 *
 * CLI wiring (D10-17, D10-39): `recordFirstRunSuccess` is invoked from
 * `src/cli/commands/init.ts` on BOTH terminal outcomes of `runInitInner` —
 * `value=1` at the success terminus, and `value=0` at the all-adapters-failed
 * site immediately before the `ADAPTER_ERROR` throw (a total adapter failure
 * is the canonical first-run failure). The persisted JSONL is read back +
 * summarized by `src/cli/commands/status.ts` via {@link loadSpaceMetricsFromDisk}
 * + {@link summarizeSpaceMetricRecords}. The in-memory ring buffer is
 * process-local, so the status reporting surface reads the on-disk JSONL via
 * {@link loadSpaceMetricsFromDisk} (the across-runs reader) rather than
 * {@link getSpaceSummary}, which only sees the current process's records.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { createFailureLogEntry, FAILURE_LOG_FILE, formatLogEntry } from "./failureLog.js";

// ── SPACE axes ───────────────────────────────────────────────────

/**
 * The five SPACE axes per Forsgren et al. (ACM Queue, 2021). The "(reserved)"
 * marker flags an axis the type admits but no caller feeds yet (D10-40).
 *
 * - `satisfaction`  developer satisfaction / wellbeing signal (0-1 or 0-10) —
 *                   reserved; no feeder yet.
 * - `performance`   outcome quality — e.g. first-run success rate (boolean as
 *                   1.0/0.0), task completion %. Fed by `recordFirstRunSuccess`.
 * - `activity`      action counts — commands invoked, adapters generated.
 * - `communication` collaboration signal — handoff success, review turnaround —
 *                   reserved; no feeder yet.
 * - `efficiency`    flow signal — wall-clock minutes, token cost, latency.
 */
export type SpaceAxis =
  | "satisfaction"
  | "performance"
  | "activity"
  | "communication"
  | "efficiency";

/** Ordered list of all five SPACE axes — useful for iteration. */
export const SPACE_AXES: readonly SpaceAxis[] = [
  "satisfaction",
  "performance",
  "activity",
  "communication",
  "efficiency",
] as const;

/**
 * A single SPACE measurement.
 *
 * `value` is intentionally a number so all five axes share one shape. Boolean
 * outcomes (e.g. first-run success) are recorded as `1` (success) or `0`
 * (failure); rate metrics as `0..1`; count metrics as non-negative integers;
 * latency in milliseconds. The semantic is carried by `metricId` + `axis`.
 */
export interface SpaceMetric {
  /** Stable identifier for the metric (e.g. `firstRunSuccessRate`). */
  metricId: string;
  /** Which SPACE axis this metric serves. */
  axis: SpaceAxis;
  /** Numeric value — units are metric-specific (booleans as 1/0). */
  value: number;
  /** ISO-8601 timestamp; defaults to `new Date().toISOString()` when omitted. */
  timestamp?: string;
  /** Free-form attribution — e.g. CLI command name, adapter id. */
  source?: string;
  /** Optional dimensions for grouping/filtering downstream. */
  tags?: Record<string, string>;
}

/** Persisted form — same shape as {@link SpaceMetric} with a guaranteed timestamp. */
export interface SpaceMetricRecord extends SpaceMetric {
  timestamp: string;
}

/** Aggregate summary per axis returned by {@link getSpaceSummary}. */
export interface SpaceAxisSummary {
  axis: SpaceAxis;
  count: number;
  mean: number;
}

// ── In-memory ring buffer ────────────────────────────────────────

/** Maximum number of metric records held in the in-memory ring buffer. */
export const DEFAULT_RING_BUFFER_SIZE = 1000;

/** Telemetry sub-directory under the project root (shared with costEstimator). */
export const SPACE_TELEMETRY_DIR_RELATIVE = ".hatch3r/telemetry";

/**
 * Bounded ring buffer for in-process metric retention. Sized at module init
 * to {@link DEFAULT_RING_BUFFER_SIZE} so memory usage is O(1) regardless of
 * session length. When the buffer is full, the oldest entry is overwritten
 * (FIFO eviction).
 */
const ringBuffer: SpaceMetricRecord[] = [];

/**
 * Append a record to the ring buffer, evicting the oldest entry when full.
 *
 * Pure-with-side-effect: the only side effect is mutating the module-level
 * buffer. Never throws.
 */
function pushToRing(record: SpaceMetricRecord): void {
  if (ringBuffer.length >= DEFAULT_RING_BUFFER_SIZE) {
    ringBuffer.shift();
  }
  ringBuffer.push(record);
}

/**
 * Drain a snapshot of the ring buffer. Returns a defensive copy so callers
 * cannot mutate the underlying storage.
 *
 * Exposed for tests and for in-process consumers (e.g. iteration-summary
 * builders) that want the live record set without touching disk.
 */
export function getSpaceMetricsSnapshot(): SpaceMetricRecord[] {
  return ringBuffer.slice();
}

/**
 * Clear the in-memory ring buffer. Used by tests to isolate runs; not
 * intended for production callers.
 */
export function resetSpaceMetricsBuffer(): void {
  ringBuffer.length = 0;
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Record a SPACE metric.
 *
 * Performs two operations:
 * 1. Appends to the in-memory ring buffer (always — synchronous, never fails).
 * 2. Persists a JSONL line to
 *    `<projectRoot>/.hatch3r/telemetry/space-<YYYY-MM-DD>.jsonl`. The
 *    directory is gitignored via the existing `.hatch3r/` rule in
 *    `.gitignore`. Persistence honours the Silent Failure Contract — I/O
 *    failures route through `failureLog` and this function NEVER throws.
 *
 * `projectRoot` defaults to `process.cwd()`, matching the convention used by
 * `costEstimator.recordActuals` and `observability.recordEfficiencyEvent`.
 * Tests override it to redirect persistence into a temp directory.
 */
export function recordSpaceMetric(
  metric: SpaceMetric,
  projectRoot: string = process.cwd(),
): void {
  const record: SpaceMetricRecord = {
    ...metric,
    timestamp: metric.timestamp ?? new Date().toISOString(),
  };

  pushToRing(record);

  const date = record.timestamp.slice(0, 10); // YYYY-MM-DD
  const filename = `space-${date}.jsonl`;
  const filePath = join(projectRoot, SPACE_TELEMETRY_DIR_RELATIVE, filename);
  const line = JSON.stringify(record) + "\n";

  try {
    mkdirSync(dirname(filePath), { recursive: true });
    appendFileSync(filePath, line);
  } catch (err) {
    // Silent Failure Contract: route through failureLog and swallow.
    try {
      const entry = createFailureLogEntry("space-telemetry", err, {
        tool: `space:${record.metricId}`,
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
}

/**
 * Convenience wrapper for the **primary metric** `firstRunSuccessRate`.
 *
 * Records a single boolean outcome — true if `npx hatch3r init` completed
 * without error AND the user reached a first adapter output — on the
 * `performance` axis. This is the canonical first-run-success recording
 * site referenced by `governance/CONSTITUTION.md` §6 P1 Measurement
 * ("first-run success rate") and §6 CQ2 Measurement ("first-run success
 * rate per user task ≥80%"). `init.ts` calls it on both terminal outcomes —
 * `true` at the success terminus and `false` at the all-adapters-failed site
 * (D10-39) — so the recorded rate is not survivorship-biased to 1.
 *
 * Defining a typed helper (rather than asking callers to assemble the
 * generic `SpaceMetric` shape inline) means the metric id and axis cannot
 * drift across call sites; the post-run aggregator can rely on a single
 * canonical `metricId` for the primary metric.
 */
export function recordFirstRunSuccess(
  success: boolean,
  options: {
    source?: string;
    tags?: Record<string, string>;
    projectRoot?: string;
  } = {},
): void {
  recordSpaceMetric(
    {
      metricId: "firstRunSuccessRate",
      axis: "performance",
      value: success ? 1 : 0,
      source: options.source,
      tags: options.tags,
    },
    options.projectRoot ?? process.cwd(),
  );
}

/**
 * Aggregate an arbitrary record set into a per-axis summary.
 *
 * Returns one row per SPACE axis containing the record count and the
 * arithmetic mean of `value` over those records. An axis with zero
 * recorded metrics produces `{count: 0, mean: 0}` (not omitted) so
 * downstream callers can iterate over all five axes unconditionally.
 *
 * Pure function — reads only its argument, never throws. Shared by
 * {@link getSpaceSummary} (in-memory ring buffer) and the status reporting
 * surface (records read from disk via {@link readSpaceMetricsForDay}) so the
 * per-axis count/mean logic lives in one place (CONSTITUTION §2 P4 — single
 * source of truth).
 */
export function summarizeSpaceMetricRecords(
  records: readonly SpaceMetricRecord[],
): SpaceAxisSummary[] {
  const totals: Record<SpaceAxis, { count: number; sum: number }> = {
    satisfaction: { count: 0, sum: 0 },
    performance: { count: 0, sum: 0 },
    activity: { count: 0, sum: 0 },
    communication: { count: 0, sum: 0 },
    efficiency: { count: 0, sum: 0 },
  };

  for (const record of records) {
    if (totals[record.axis]) {
      totals[record.axis].count += 1;
      totals[record.axis].sum += record.value;
    }
  }

  return SPACE_AXES.map((axis) => {
    const t = totals[axis];
    return {
      axis,
      count: t.count,
      mean: t.count === 0 ? 0 : t.sum / t.count,
    };
  });
}

/**
 * Aggregate the in-memory ring buffer into a per-axis summary. Thin wrapper
 * over {@link summarizeSpaceMetricRecords} bound to the live ring buffer.
 *
 * Pure function — reads only the ring buffer, never throws. The ring buffer is
 * process-local, so this only reflects metrics recorded in the CURRENT process;
 * a separate reporting process (e.g. `hatch3r status`) or the audit cycle that
 * wants the AGGREGATE across runs must read the persisted JSONL via
 * {@link loadSpaceMetricsFromDisk} instead.
 */
export function getSpaceSummary(): SpaceAxisSummary[] {
  return summarizeSpaceMetricRecords(ringBuffer);
}

/**
 * Internal — record a genuine read I/O fault (not a missing file) through the
 * failureLog channel, mirroring {@link recordSpaceMetric}'s write-failure
 * routing. Best-effort: swallows any nested failure (the failureLog file may
 * also be unwritable) so it never re-raises into the read path.
 */
function routeReadFailure(projectRoot: string, err: unknown, filePath: string): void {
  try {
    const entry = createFailureLogEntry("space-telemetry-read", err, {
      tool: `space:read:${filePath}`,
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

/**
 * Read the persisted SPACE metric records for a single calendar day from
 * `<projectRoot>/.hatch3r/telemetry/space-<YYYY-MM-DD>.jsonl`.
 *
 * This is the cross-process read counterpart to {@link recordSpaceMetric}'s
 * write: a fresh CLI process (e.g. `hatch3r status`) has an empty ring buffer,
 * so it reconstructs the day's metrics from disk. Malformed JSONL lines are
 * skipped (a partially-written final line from a crashed writer never aborts the
 * read), and any axis value outside {@link SPACE_AXES} is dropped so a corrupted
 * record cannot inject an unknown axis downstream.
 *
 * `date` defaults to today (`YYYY-MM-DD`, local-to-UTC slice matching the write
 * path). Returns `[]` when the file is absent or unreadable — the reporting
 * surface degrades to "no telemetry yet" rather than throwing (Silent Failure
 * Contract, CONSTITUTION §2 P5). `projectRoot` defaults to `process.cwd()`.
 */
export function readSpaceMetricsForDay(
  date: string = new Date().toISOString().slice(0, 10),
  projectRoot: string = process.cwd(),
): SpaceMetricRecord[] {
  const filePath = join(projectRoot, SPACE_TELEMETRY_DIR_RELATIVE, `space-${date}.jsonl`);
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    // A missing telemetry file is the EXPECTED negative case (telemetry not yet
    // written, or the dir was cleaned) — return empty silently. Any OTHER read
    // fault (EACCES, EISDIR, …) is a genuine I/O failure, so route it through
    // the failureLog channel per the module's Silent Failure Contract
    // (CONSTITUTION §2 P5) before degrading to empty — never throw.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      routeReadFailure(projectRoot, err, filePath);
    }
    return [];
  }

  const validAxes = new Set<string>(SPACE_AXES);
  const records: SpaceMetricRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Skip a malformed line (e.g. a torn final write) rather than failing the
      // whole read.
      continue;
    }
    if (parsed === null || typeof parsed !== "object") continue;
    const candidate = parsed as Partial<SpaceMetricRecord>;
    if (
      typeof candidate.metricId !== "string" ||
      typeof candidate.axis !== "string" ||
      !validAxes.has(candidate.axis) ||
      typeof candidate.value !== "number" ||
      typeof candidate.timestamp !== "string"
    ) {
      continue;
    }
    records.push(candidate as SpaceMetricRecord);
  }
  return records;
}

/** Default trailing-day window for {@link loadSpaceMetricsFromDisk}. */
export const DEFAULT_SPACE_LOAD_WINDOW_DAYS = 7;

/**
 * Load persisted SPACE metric records ACROSS RUNS from disk (D10-38).
 *
 * `getSpaceSummary` reads only the process-local ring buffer, which is empty in
 * any fresh process, so it can never report the aggregate "across runs". This
 * is the cross-process, multi-day reader the across-runs claim depends on: it
 * walks one `space-<YYYY-MM-DD>.jsonl` file per calendar day over a trailing
 * window (or an explicit `[from, to]` date range) and concatenates every valid
 * record via {@link readSpaceMetricsForDay}. A reporting process (`hatch3r
 * status`) or the audit cycle feeds the result into
 * {@link summarizeSpaceMetricRecords} to recover the firstRunSuccessRate and
 * per-axis counts observed across all those runs.
 *
 * Day selection:
 * - default: the trailing {@link DEFAULT_SPACE_LOAD_WINDOW_DAYS} days ending
 *   today (`windowDays` overrides the count);
 * - explicit range: `from`/`to` (inclusive, `YYYY-MM-DD`) takes precedence over
 *   `windowDays`. A `from` later than `to` yields `[]` (no days iterated).
 *
 * Best-effort and side-effect-free: {@link readSpaceMetricsForDay} swallows
 * missing/unreadable/corrupt files (Silent Failure Contract, CONSTITUTION §2
 * P5), so this returns the records it could read rather than throwing when some
 * or all day-files are absent. `projectRoot` defaults to `process.cwd()`.
 */
export function loadSpaceMetricsFromDisk(
  projectRoot: string = process.cwd(),
  options: { windowDays?: number; from?: string; to?: string } = {},
): SpaceMetricRecord[] {
  const days = resolveLoadDays(options);
  const records: SpaceMetricRecord[] = [];
  for (const day of days) {
    for (const rec of readSpaceMetricsForDay(day, projectRoot)) {
      records.push(rec);
    }
  }
  return records;
}

/**
 * Internal — resolve the ordered (newest-first) list of `YYYY-MM-DD` day keys
 * {@link loadSpaceMetricsFromDisk} will read, from either an explicit inclusive
 * `[from, to]` range or a trailing-day window ending today. Pure; never throws.
 */
function resolveLoadDays(options: {
  windowDays?: number;
  from?: string;
  to?: string;
}): string[] {
  const MS_PER_DAY = 86_400_000;
  if (options.from !== undefined || options.to !== undefined) {
    const fromMs = Date.parse(`${options.from ?? options.to}T00:00:00.000Z`);
    const toMs = Date.parse(`${options.to ?? options.from}T00:00:00.000Z`);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs > toMs) return [];
    const days: string[] = [];
    for (let t = toMs; t >= fromMs; t -= MS_PER_DAY) {
      days.push(new Date(t).toISOString().slice(0, 10));
    }
    return days;
  }
  const windowDays = Math.max(1, options.windowDays ?? DEFAULT_SPACE_LOAD_WINDOW_DAYS);
  const now = Date.now();
  const days: string[] = [];
  for (let i = 0; i < windowDays; i += 1) {
    days.push(new Date(now - i * MS_PER_DAY).toISOString().slice(0, 10));
  }
  return days;
}
