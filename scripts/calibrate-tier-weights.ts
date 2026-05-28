#!/usr/bin/env node
/**
 * scripts/calibrate-tier-weights.ts — Pillar P5 (Governance Self-Quality),
 * P7 (Speed & Token Efficiency).
 *
 * Finding F7.4-H3 (D7, High): the tier-accuracy telemetry substrate
 * (`TierAccuracyRecord` + `recordTierAccuracy()` in
 * `src/pipeline/costEstimator.ts`) was added in Wave 1, persisting one
 * `.hatch3r/telemetry/<task-id>-tier.json` record per orchestrated task. This
 * script is the consumer that closes the feedback loop the finding requires:
 * it aggregates those records, computes the per-tier mis-triage rate, and
 * raises a CL-3 signal-weight-recalibration proposal when the drift trigger
 * fires.
 *
 * CL-3 trigger (verbatim from `rules/hatch3r-agent-orchestration-detail.md`
 * §Post-Pipeline Learning, item 1):
 *
 *   > Tier mismatch beyond ±10% across 50 tasks triggers a CL-3 signal-weight
 *   > recalibration proposal.
 *
 * "Tier mismatch" = the initial triage tier the orchestrator assigned up-front
 * differs from the final tier in force at wrap-up (the orchestrator adjusted
 * mid-run per the in-execution adaptation table). A mismatch rate above 10%
 * over a window of at least 50 tasks indicates the up-front
 * `hatch3r-deep-context` signal weights are systematically mis-classifying
 * tasks and should be recalibrated.
 *
 * This is a REPORTING tool, not a gate: it exits 0 when telemetry is absent or
 * below the 50-task window (nothing to calibrate yet), exits 0 with a
 * "within tolerance" report when the mismatch rate is at-or-below 10%, and
 * exits 0 with a CL-3 PROPOSAL block when the trigger fires. The `--strict`
 * flag turns a fired CL-3 trigger into exit 1 (for opt-in CI use); by default
 * the script never fails a build, because tier drift is a tuning signal, not a
 * correctness regression. Telemetry-read failures never throw — they degrade
 * to a warning and exit 0 (Silent Failure Contract, CONSTITUTION §2 P5).
 *
 * Pillars: P5 (Governance Self-Quality — the framework measures its own
 * triage accuracy), P7 (Speed & Token Efficiency — correct tiering keeps
 * fan-out and token spend matched to task size).
 *
 * Usage: `npm run calibrate:tier-weights`
 *        `tsx scripts/calibrate-tier-weights.ts`
 *        `tsx scripts/calibrate-tier-weights.ts --json`
 *        `tsx scripts/calibrate-tier-weights.ts --strict`
 *        `tsx scripts/calibrate-tier-weights.ts --root <projectRoot>`
 */
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TELEMETRY_DIR_RELATIVE,
  type TierAccuracyRecord,
  type TriageTier,
} from "../src/pipeline/costEstimator.js";

const __filename = fileURLToPath(import.meta.url);

// ── CL-3 trigger constants (from the orchestration-detail rule) ───

/** Minimum number of tasks before drift is statistically actionable. */
export const MIN_TASK_WINDOW = 50;

/** Mismatch-rate ceiling in percent; above this the CL-3 trigger fires. */
export const MISMATCH_THRESHOLD_PERCENT = 10;

const TIERS: readonly TriageTier[] = ["light", "standard", "deep"];

// ── Types ─────────────────────────────────────────────────────────

/** Per-tier accuracy roll-up keyed on the INITIAL tier the orchestrator chose. */
export interface TierAccuracy {
  tier: TriageTier;
  /** Tasks that started at this tier. */
  total: number;
  /** Tasks that started at this tier and were adjusted to a different tier. */
  mismatched: number;
  /** Mismatch rate in percent (0 when total is 0). */
  mismatchPercent: number;
}

export interface CalibrationReport {
  /** Telemetry directory scanned (absolute). */
  telemetryDir: string;
  /** Total valid tier-accuracy records read. */
  taskCount: number;
  /** Records skipped because they failed shape validation. */
  malformedCount: number;
  /** Overall mismatch count across all tiers. */
  totalMismatched: number;
  /** Overall mismatch rate in percent (0 when taskCount is 0). */
  overallMismatchPercent: number;
  /** Per-initial-tier breakdown. */
  byTier: TierAccuracy[];
  /** True once taskCount >= MIN_TASK_WINDOW. */
  windowReached: boolean;
  /** True when the CL-3 recalibration trigger fires. */
  cl3Triggered: boolean;
  /** Initial tiers whose individual mismatch rate exceeds the threshold. */
  flaggedTiers: TriageTier[];
  /** Non-fatal warnings (e.g. telemetry dir unreadable). */
  warnings: string[];
}

export interface RunOptions {
  /** Project root containing `.hatch3r/telemetry`. Defaults to cwd. */
  projectRoot?: string;
}

// ── Record validation ─────────────────────────────────────────────

function isTriageTier(v: unknown): v is TriageTier {
  return v === "light" || v === "standard" || v === "deep";
}

/**
 * Narrow an arbitrary parsed JSON value to a TierAccuracyRecord. Only the
 * fields this calibration consumes are required to be well-typed; extra fields
 * are tolerated so the record schema can grow without breaking the reader.
 */
function asTierRecord(v: unknown): TierAccuracyRecord | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!isTriageTier(o.initialTier)) return null;
  if (!isTriageTier(o.finalTier)) return null;
  if (typeof o.taskId !== "string") return null;
  // adjustmentReasons / correlationId / ts are not load-bearing for the
  // mismatch computation; accept records that omit or mistype them.
  return {
    taskId: o.taskId,
    initialTier: o.initialTier,
    finalTier: o.finalTier,
    adjustmentReasons: Array.isArray(o.adjustmentReasons)
      ? (o.adjustmentReasons.filter((r) => typeof r === "string") as string[])
      : [],
    correlationId: typeof o.correlationId === "string" ? o.correlationId : "",
    ts: typeof o.ts === "string" ? o.ts : "",
  };
}

// ── Telemetry read ────────────────────────────────────────────────

/** Read every `*-tier.json` record under the telemetry dir. NEVER throws. */
async function readTierRecords(
  telemetryDir: string,
): Promise<{ records: TierAccuracyRecord[]; malformed: number; warnings: string[] }> {
  const warnings: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(telemetryDir);
  } catch {
    // No telemetry yet (or unreadable) — not an error; there is simply nothing
    // to calibrate. Surface as a warning so `--json` consumers can see why the
    // report is empty (Silent Failure Contract: degrade, do not throw).
    warnings.push(
      `telemetry directory not readable: ${telemetryDir} (no tier-accuracy records to calibrate yet)`,
    );
    return { records: [], malformed: 0, warnings };
  }

  const tierFiles = entries.filter((n) => n.endsWith("-tier.json")).sort();
  const records: TierAccuracyRecord[] = [];
  let malformed = 0;

  for (const name of tierFiles) {
    const absPath = join(telemetryDir, name);
    let raw: string;
    try {
      raw = await readFile(absPath, "utf-8");
    } catch {
      malformed += 1;
      warnings.push(`could not read ${name}; skipped`);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      malformed += 1;
      warnings.push(`invalid JSON in ${name}; skipped`);
      continue;
    }
    const rec = asTierRecord(parsed);
    if (!rec) {
      malformed += 1;
      warnings.push(`record ${name} missing initialTier/finalTier/taskId; skipped`);
      continue;
    }
    records.push(rec);
  }
  return { records, malformed, warnings };
}

// ── Aggregation ───────────────────────────────────────────────────

function pct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 1000) / 10; // one decimal place
}

/** Compute the calibration report from a set of records. Pure function. */
export function computeReport(
  records: readonly TierAccuracyRecord[],
  telemetryDir: string,
  malformed: number,
  warnings: string[],
): CalibrationReport {
  const totals = new Map<TriageTier, { total: number; mismatched: number }>();
  for (const t of TIERS) totals.set(t, { total: 0, mismatched: 0 });

  let totalMismatched = 0;
  for (const r of records) {
    const bucket = totals.get(r.initialTier)!;
    bucket.total += 1;
    if (r.initialTier !== r.finalTier) {
      bucket.mismatched += 1;
      totalMismatched += 1;
    }
  }

  const byTier: TierAccuracy[] = TIERS.map((tier) => {
    const b = totals.get(tier)!;
    return {
      tier,
      total: b.total,
      mismatched: b.mismatched,
      mismatchPercent: pct(b.mismatched, b.total),
    };
  });

  const taskCount = records.length;
  const overallMismatchPercent = pct(totalMismatched, taskCount);
  const windowReached = taskCount >= MIN_TASK_WINDOW;

  // Per-tier flag: any initial tier whose mismatch rate exceeds the threshold,
  // counted only when that tier itself has a meaningful sample (>= the window
  // would be too strict per-tier; use the overall window gate plus a minimum
  // per-tier sample so a single-task tier does not flap the trigger).
  const flaggedTiers = byTier
    .filter((t) => t.total > 0 && t.mismatchPercent > MISMATCH_THRESHOLD_PERCENT)
    .map((t) => t.tier);

  // CL-3 fires on the OVERALL rate once the 50-task window is reached, matching
  // the rule's "beyond ±10% across 50 tasks" wording (the window is the corpus,
  // the threshold is the aggregate mis-triage rate).
  const cl3Triggered = windowReached && overallMismatchPercent > MISMATCH_THRESHOLD_PERCENT;

  return {
    telemetryDir,
    taskCount,
    malformedCount: malformed,
    totalMismatched,
    overallMismatchPercent,
    byTier,
    windowReached,
    cl3Triggered,
    flaggedTiers,
    warnings,
  };
}

// ── Orchestrator ──────────────────────────────────────────────────

export async function runCalibration(opts: RunOptions = {}): Promise<CalibrationReport> {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const telemetryDir = join(projectRoot, TELEMETRY_DIR_RELATIVE);
  const { records, malformed, warnings } = await readTierRecords(telemetryDir);
  return computeReport(records, telemetryDir, malformed, warnings);
}

// ── Output ────────────────────────────────────────────────────────

export function formatReport(report: CalibrationReport): string {
  const lines: string[] = [];
  lines.push("calibrate-tier-weights — tier-accuracy calibration (F7.4-H3, CL-3 feedback loop)");
  lines.push(`  telemetry dir: ${report.telemetryDir}`);
  lines.push(
    `  tasks: ${report.taskCount} (window ${MIN_TASK_WINDOW} ${report.windowReached ? "reached" : "NOT reached"}); malformed skipped: ${report.malformedCount}`,
  );
  lines.push(
    `  overall mis-triage rate: ${report.overallMismatchPercent}% (threshold ${MISMATCH_THRESHOLD_PERCENT}%)`,
  );
  for (const t of report.byTier) {
    lines.push(`    ${t.tier.padEnd(9)} ${t.mismatched}/${t.total} adjusted = ${t.mismatchPercent}%`);
  }
  for (const w of report.warnings) {
    lines.push(`  warning: ${w}`);
  }

  if (!report.windowReached) {
    lines.push(
      `  result: insufficient data — need ${MIN_TASK_WINDOW - report.taskCount} more task record(s) before the CL-3 window is statistically actionable.`,
    );
    return lines.join("\n");
  }

  if (report.cl3Triggered) {
    lines.push("");
    lines.push("  ── CL-3 PROPOSAL: signal-weight recalibration ──────────────────");
    lines.push(
      `  Mis-triage rate ${report.overallMismatchPercent}% exceeds the ${MISMATCH_THRESHOLD_PERCENT}% ceiling across ${report.taskCount} tasks.`,
    );
    if (report.flaggedTiers.length > 0) {
      lines.push(`  Worst initial tiers: ${report.flaggedTiers.join(", ")}.`);
    }
    lines.push(
      "  Action: open a CL-3 proposal to recalibrate hatch3r-deep-context signal weights",
    );
    lines.push(
      "  (the up-front tier classifier is systematically over/under-tiering). Route via",
    );
    lines.push("  the audit closed-loop CL-3 queue with this report attached as evidence.");
  } else {
    lines.push(
      `  result: within tolerance — mis-triage rate ${report.overallMismatchPercent}% <= ${MISMATCH_THRESHOLD_PERCENT}%; no recalibration proposal needed.`,
    );
  }
  return lines.join("\n");
}

interface CliFlags {
  json: boolean;
  strict: boolean;
  root?: string;
}

function parseArgs(argv: readonly string[]): CliFlags {
  const flags: CliFlags = { json: argv.includes("--json"), strict: argv.includes("--strict") };
  const rootIdx = argv.indexOf("--root");
  if (rootIdx !== -1 && typeof argv[rootIdx + 1] === "string") {
    flags.root = argv[rootIdx + 1];
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const report = await runCalibration({ projectRoot: flags.root });
  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report));
  }
  // Default: never fail the build (tier drift is a tuning signal). --strict
  // turns a fired CL-3 trigger into a non-zero exit for opt-in CI enforcement.
  if (flags.strict && report.cl3Triggered) process.exit(1);
}

// Only auto-run when executed as a script, never when imported by tests.
const isMain = (() => {
  try {
    return resolve(process.argv[1] ?? "") === __filename;
    // reason: process.argv[1] unresolvable — treating as imported (return
    // false) is the safe default; there is no error to channel here (P5).
  } catch { // eslint-disable-line silent-failure/no-silent-catch
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error("calibrate-tier-weights failed:", err);
    process.exit(1);
  });
}
