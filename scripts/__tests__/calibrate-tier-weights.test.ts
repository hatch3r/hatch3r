import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  computeReport,
  formatReport,
  MIN_TASK_WINDOW,
  MISMATCH_THRESHOLD_PERCENT,
  runCalibration,
} from "../calibrate-tier-weights.js";
import type { TierAccuracyRecord, TriageTier } from "../../src/pipeline/costEstimator.js";

// ── Fixture helpers ─────────────────────────────────────────────────

interface Fixture {
  rootDir: string;
  telemetryDir: string;
}

async function makeFixture(): Promise<Fixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "tier-calibrate-"));
  const telemetryDir = join(rootDir, ".hatch3r", "telemetry");
  await mkdir(telemetryDir, { recursive: true });
  return { rootDir, telemetryDir };
}

const TIERS: TriageTier[] = ["light", "standard", "deep"];

function makeRecord(i: number, initial: TriageTier, final: TriageTier): TierAccuracyRecord {
  return {
    taskId: `task-${i}`,
    initialTier: initial,
    finalTier: final,
    adjustmentReasons: initial !== final ? ["synthetic adjustment"] : [],
    correlationId: `corr-${i}`,
    ts: "2026-05-28T00:00:00.000Z",
  };
}

async function writeRecord(dir: string, rec: TierAccuracyRecord): Promise<void> {
  await writeFile(join(dir, `${rec.taskId}-tier.json`), JSON.stringify(rec, null, 2), "utf-8");
}

/**
 * Write `total` records, `mismatched` of which have initialTier != finalTier,
 * round-robining the initial tier so all three tiers get a sample.
 */
async function seed(dir: string, total: number, mismatched: number): Promise<void> {
  for (let i = 0; i < total; i++) {
    const initial = TIERS[i % 3];
    const isMismatch = i < mismatched;
    const final = isMismatch ? TIERS[(i + 1) % 3] : initial;
    await writeRecord(dir, makeRecord(i, initial, final));
  }
}

describe("calibrate-tier-weights — computeReport (pure)", () => {
  it("reports 0% mismatch and not-triggered for an empty set", () => {
    const r = computeReport([], "/tmp/x", 0, []);
    expect(r.taskCount).toBe(0);
    expect(r.overallMismatchPercent).toBe(0);
    expect(r.windowReached).toBe(false);
    expect(r.cl3Triggered).toBe(false);
    expect(r.byTier).toHaveLength(3);
  });

  it("does NOT trigger below the task window even at high mismatch", () => {
    const recs: TierAccuracyRecord[] = [];
    // 10 tasks, all mismatched (100%) — but below MIN_TASK_WINDOW.
    for (let i = 0; i < 10; i++) recs.push(makeRecord(i, "light", "deep"));
    const r = computeReport(recs, "/tmp/x", 0, []);
    expect(r.taskCount).toBe(10);
    expect(r.windowReached).toBe(false);
    expect(r.overallMismatchPercent).toBe(100);
    expect(r.cl3Triggered).toBe(false); // window gate dominates
  });

  it("does NOT trigger at the window when mismatch is within tolerance", () => {
    const recs: TierAccuracyRecord[] = [];
    // 50 tasks, 5 mismatched = 10% — at the boundary, not ABOVE it.
    for (let i = 0; i < 50; i++) {
      const mism = i < 5;
      recs.push(makeRecord(i, "standard", mism ? "deep" : "standard"));
    }
    const r = computeReport(recs, "/tmp/x", 0, []);
    expect(r.taskCount).toBe(MIN_TASK_WINDOW);
    expect(r.windowReached).toBe(true);
    expect(r.overallMismatchPercent).toBe(10);
    expect(r.cl3Triggered).toBe(false); // 10% is not > 10%
  });

  it("TRIGGERS CL-3 above tolerance once the window is reached", () => {
    const recs: TierAccuracyRecord[] = [];
    // 60 tasks, 12 mismatched = 20% > 10%.
    for (let i = 0; i < 60; i++) {
      const mism = i < 12;
      recs.push(makeRecord(i, TIERS[i % 3], mism ? TIERS[(i + 1) % 3] : TIERS[i % 3]));
    }
    const r = computeReport(recs, "/tmp/x", 0, []);
    expect(r.windowReached).toBe(true);
    expect(r.overallMismatchPercent).toBeGreaterThan(MISMATCH_THRESHOLD_PERCENT);
    expect(r.cl3Triggered).toBe(true);
    expect(r.totalMismatched).toBe(12);
  });

  it("attributes mismatches to the INITIAL tier in the per-tier breakdown", () => {
    const recs: TierAccuracyRecord[] = [
      makeRecord(0, "light", "deep"), // mismatch on light
      makeRecord(1, "light", "light"),
      makeRecord(2, "standard", "standard"),
    ];
    const r = computeReport(recs, "/tmp/x", 0, []);
    const light = r.byTier.find((t) => t.tier === "light")!;
    expect(light.total).toBe(2);
    expect(light.mismatched).toBe(1);
    expect(light.mismatchPercent).toBe(50);
    const standard = r.byTier.find((t) => t.tier === "standard")!;
    expect(standard.mismatched).toBe(0);
  });
});

describe("calibrate-tier-weights — runCalibration (I/O)", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  it("returns an empty within-window report when telemetry dir is absent", async () => {
    // Point at a root whose .hatch3r/telemetry does not exist.
    const missingRoot = await mkdtemp(join(tmpdir(), "tier-calibrate-empty-"));
    try {
      const r = await runCalibration({ projectRoot: missingRoot });
      expect(r.taskCount).toBe(0);
      expect(r.cl3Triggered).toBe(false);
      expect(r.warnings.some((w) => /not readable/.test(w))).toBe(true);
    } finally {
      await rm(missingRoot, { recursive: true, force: true });
    }
  });

  it("reads records and TRIGGERS CL-3 on a 60-task/20% corpus", async () => {
    await seed(fx.telemetryDir, 60, 12);
    const r = await runCalibration({ projectRoot: fx.rootDir });
    expect(r.taskCount).toBe(60);
    expect(r.cl3Triggered).toBe(true);
    expect(r.overallMismatchPercent).toBe(20);
  });

  it("reports within-tolerance on a 55-task/low-mismatch corpus", async () => {
    await seed(fx.telemetryDir, 55, 2);
    const r = await runCalibration({ projectRoot: fx.rootDir });
    expect(r.taskCount).toBe(55);
    expect(r.windowReached).toBe(true);
    expect(r.cl3Triggered).toBe(false);
  });

  it("skips malformed records and counts them, without throwing", async () => {
    await seed(fx.telemetryDir, 5, 0);
    // missing initialTier
    await writeFile(
      join(fx.telemetryDir, "bad-missing-tier.json"),
      JSON.stringify({ taskId: "bad", finalTier: "deep" }),
      "utf-8",
    );
    // invalid JSON
    await writeFile(join(fx.telemetryDir, "bad-json-tier.json"), "{not valid", "utf-8");

    const r = await runCalibration({ projectRoot: fx.rootDir });
    expect(r.taskCount).toBe(5);
    expect(r.malformedCount).toBe(2);
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("ignores telemetry files that are not *-tier.json", async () => {
    await seed(fx.telemetryDir, 3, 0);
    // A cost-telemetry file and a JSONL snapshot — must be ignored.
    await writeFile(
      join(fx.telemetryDir, "session-abc.json"),
      JSON.stringify({ session_id: "abc" }),
      "utf-8",
    );
    await writeFile(join(fx.telemetryDir, "session-abc.jsonl"), "{}\n", "utf-8");

    const r = await runCalibration({ projectRoot: fx.rootDir });
    expect(r.taskCount).toBe(3);
    expect(r.malformedCount).toBe(0);
  });
});

describe("calibrate-tier-weights — formatReport", () => {
  it("renders an insufficient-data message below the window", () => {
    const r = computeReport([makeRecord(0, "light", "light")], "/tmp/x", 0, []);
    const out = formatReport(r);
    expect(out).toMatch(/insufficient data/);
    expect(out).toMatch(/more task record/);
  });

  it("renders a CL-3 PROPOSAL block when triggered", () => {
    const recs: TierAccuracyRecord[] = [];
    for (let i = 0; i < 60; i++) {
      recs.push(makeRecord(i, TIERS[i % 3], i < 20 ? TIERS[(i + 1) % 3] : TIERS[i % 3]));
    }
    const r = computeReport(recs, "/tmp/x", 0, []);
    const out = formatReport(r);
    expect(out).toMatch(/CL-3 PROPOSAL/);
    expect(out).toMatch(/recalibrate hatch3r-deep-context signal weights/);
  });

  it("renders a within-tolerance message when not triggered at the window", () => {
    const recs: TierAccuracyRecord[] = [];
    for (let i = 0; i < 55; i++) recs.push(makeRecord(i, "standard", "standard"));
    const r = computeReport(recs, "/tmp/x", 0, []);
    const out = formatReport(r);
    expect(out).toMatch(/within tolerance/);
  });
});
