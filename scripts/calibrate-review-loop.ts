#!/usr/bin/env node
/**
 * scripts/calibrate-review-loop.ts — review-loop cap calibration reader
 * (Finding D7-SA7.2-01, Cycle 12; CL-2 spec from D7-M4 / D7-SA7.2-1, Cycle 10).
 *
 * Reads the review-loop iteration ledger (JSONL of `ReviewLoopLedgerEntry`,
 * one terminated loop per line; entries are produced via
 * `reviewLoopLedgerEntry` + `serializeReviewLoopLedgerEntry` in
 * `src/pipeline/reviewLoop.ts`), derives the measured iteration split with
 * `deriveIterationSplit`, and reports it against the shipped CALIBRATION
 * informed estimate. Once the sample size crosses
 * CALIBRATION_SAMPLE_THRESHOLD (30), prints the candidate CALIBRATION update
 * (basis "measured", measuredAt set) for a maintainer PR — the CL-2
 * promotion path (spec point 3).
 *
 * Recalibration cadence (CL-2 spec point 4): run at every audit-cycle close
 * and release prep, and whenever a `CALIBRATION.recalibrationTriggers`
 * condition is observed at runtime.
 *
 * Pillars: P2 (Scientific Quality) — replaces the sampleSize-0 estimate with
 * measured data on hatch3r's own runs.
 *
 * Usage:
 *   npx tsx scripts/calibrate-review-loop.ts [--ledger <path>]
 *
 * Default ledger path: governance/audit/review-loop-ledger.jsonl
 * Exit codes: 0 = report printed (including the empty-ledger case),
 *             1 = unreadable or malformed ledger.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CALIBRATION,
  CALIBRATION_SAMPLE_THRESHOLD,
  deriveIterationSplit,
  parseReviewLoopLedger,
} from "../src/pipeline/reviewLoop.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const DEFAULT_LEDGER_PATH = join("governance", "audit", "review-loop-ledger.jsonl");

function resolveLedgerPath(argv: string[]): string {
  const flagIndex = argv.indexOf("--ledger");
  const raw = flagIndex >= 0 ? argv[flagIndex + 1] : undefined;
  if (flagIndex >= 0 && (raw === undefined || raw.startsWith("--"))) {
    console.error("--ledger requires a path argument.");
    console.error("Usage: npx tsx scripts/calibrate-review-loop.ts [--ledger <path>]");
    process.exit(1);
  }
  const chosen = raw ?? DEFAULT_LEDGER_PATH;
  return isAbsolute(chosen) ? chosen : join(ROOT, chosen);
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const ledgerPath = resolveLedgerPath(process.argv.slice(2));

  if (!existsSync(ledgerPath)) {
    console.log(`review-loop calibration: no ledger at ${ledgerPath}`);
    console.log(
      `sampleSize 0/${CALIBRATION_SAMPLE_THRESHOLD} — CALIBRATION stays basis="${CALIBRATION.basis}".`,
    );
    console.log(
      "To record a sample: build a ReviewLoopLedgerEntry from a terminated loop " +
        "(reviewLoopLedgerEntry + serializeReviewLoopLedgerEntry in src/pipeline/reviewLoop.ts) " +
        "and append the line to the ledger file.",
    );
    return;
  }

  const content = await readFile(ledgerPath, "utf-8");
  // Throws HatchError naming the 1-based line number on malformed input, so a
  // corrupted ledger fails the run loudly instead of skewing the split.
  const entries = parseReviewLoopLedger(content);
  const derived = deriveIterationSplit(entries);

  console.log(`review-loop calibration report — ledger: ${ledgerPath}`);
  console.log(
    `sampleSize: ${derived.sampleSize} (promotion threshold ${CALIBRATION_SAMPLE_THRESHOLD})`,
  );
  console.log("measured split vs shipped informed estimate:");
  const rows: Array<[name: string, measured: number, estimate: number]> = [
    [
      "iteration1CleanRate",
      derived.split.iteration1CleanRate,
      CALIBRATION.split.iteration1CleanRate,
    ],
    [
      "iteration2CleanRate",
      derived.split.iteration2CleanRate,
      CALIBRATION.split.iteration2CleanRate,
    ],
    [
      "iteration3CleanRate",
      derived.split.iteration3CleanRate,
      CALIBRATION.split.iteration3CleanRate,
    ],
    [
      "iteration4PlusRate",
      derived.split.iteration4PlusRate,
      CALIBRATION.split.iteration4PlusRate,
    ],
  ];
  for (const [name, measured, estimate] of rows) {
    console.log(
      `  ${name}: measured ${formatRate(measured)} | estimate ${formatRate(estimate)}`,
    );
  }

  const triggerHit =
    derived.sampleSize > 0 &&
    derived.split.iteration1CleanRate <
      CALIBRATION.recalibrationTriggers.iteration1CleanRateBelow;
  if (triggerHit) {
    console.log(
      `recalibration trigger observed: iteration1CleanRate ${formatRate(
        derived.split.iteration1CleanRate,
      )} < ${formatRate(
        CALIBRATION.recalibrationTriggers.iteration1CleanRateBelow,
      )} — the current default cap needs re-derivation (see CALIBRATION.recalibrationTriggers).`,
    );
  }

  if (!derived.promotable) {
    console.log(
      `below threshold (${derived.sampleSize}/${CALIBRATION_SAMPLE_THRESHOLD}) — keep basis="informed_estimate"; keep appending entries.`,
    );
    return;
  }

  const measuredAt = new Date().toISOString().slice(0, 10);
  console.log(
    "threshold reached — candidate CALIBRATION update for src/pipeline/reviewLoop.ts:",
  );
  console.log(
    JSON.stringify(
      {
        basis: "measured",
        source: `review-loop iteration ledger (${derived.sampleSize} loops) at ${DEFAULT_LEDGER_PATH}`,
        sampleSize: derived.sampleSize,
        measuredAt,
        split: derived.split,
      },
      null,
      2,
    ),
  );
  console.log("Open a PR updating CALIBRATION with the block above (CL-2 spec point 3).");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`review-loop calibration failed: ${message}`);
  process.exit(1);
});
