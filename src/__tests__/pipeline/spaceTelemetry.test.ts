import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_RING_BUFFER_SIZE,
  SPACE_AXES,
  SPACE_TELEMETRY_DIR_RELATIVE,
  getSpaceMetricsSnapshot,
  getSpaceSummary,
  readSpaceMetricsForDay,
  recordFirstRunSuccess,
  recordSpaceMetric,
  resetSpaceMetricsBuffer,
  summarizeSpaceMetricRecords,
  type SpaceAxis,
  type SpaceMetric,
  type SpaceMetricRecord,
} from "../../pipeline/spaceTelemetry.js";
import { mkdirSync, writeFileSync } from "node:fs";

// ── Fixture helpers ─────────────────────────────────────────────

let tmpRoot: string;

beforeEach(() => {
  // Each test gets its own temp project root + a clean ring buffer so the
  // module-level state never leaks across describe blocks.
  tmpRoot = mkdtempSync(join(tmpdir(), "hatch3r-space-telemetry-"));
  resetSpaceMetricsBuffer();
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  resetSpaceMetricsBuffer();
});

function makeMetric(overrides: Partial<SpaceMetric> = {}): SpaceMetric {
  return {
    metricId: "test.metric",
    axis: "activity",
    value: 1,
    ...overrides,
  };
}

// ── SPACE_AXES constant ─────────────────────────────────────────

describe("SPACE_AXES", () => {
  it("lists the five canonical SPACE axes in Forsgren et al. order", () => {
    expect(SPACE_AXES).toEqual([
      "satisfaction",
      "performance",
      "activity",
      "communication",
      "efficiency",
    ]);
  });
});

// ── recordSpaceMetric ───────────────────────────────────────────

describe("recordSpaceMetric", () => {
  it("appends a metric to the in-memory ring buffer", () => {
    recordSpaceMetric(makeMetric({ metricId: "ring.a", axis: "satisfaction", value: 0.8 }), tmpRoot);
    const snapshot = getSpaceMetricsSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].metricId).toBe("ring.a");
    expect(snapshot[0].axis).toBe("satisfaction");
    expect(snapshot[0].value).toBe(0.8);
  });

  it("auto-fills timestamp when caller omits it", () => {
    recordSpaceMetric(makeMetric(), tmpRoot);
    const snapshot = getSpaceMetricsSnapshot();
    expect(snapshot[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("preserves caller-supplied timestamp when present", () => {
    const ts = "2026-05-28T12:00:00.000Z";
    recordSpaceMetric(makeMetric({ timestamp: ts }), tmpRoot);
    const snapshot = getSpaceMetricsSnapshot();
    expect(snapshot[0].timestamp).toBe(ts);
  });

  it("persists the metric as a JSONL line under .hatch3r/telemetry/space-<date>.jsonl", () => {
    const ts = "2026-05-28T15:30:00.000Z";
    recordSpaceMetric(
      makeMetric({
        metricId: "persisted.metric",
        axis: "efficiency",
        value: 42,
        timestamp: ts,
        source: "hatch3r-init",
        tags: { adapter: "claude" },
      }),
      tmpRoot,
    );

    const filePath = join(tmpRoot, SPACE_TELEMETRY_DIR_RELATIVE, "space-2026-05-28.jsonl");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8").trim();
    const parsed = JSON.parse(content);
    expect(parsed).toMatchObject({
      metricId: "persisted.metric",
      axis: "efficiency",
      value: 42,
      timestamp: ts,
      source: "hatch3r-init",
      tags: { adapter: "claude" },
    });
  });

  it("appends multiple metrics on the same day to one JSONL file", () => {
    const ts = "2026-05-28T15:30:00.000Z";
    recordSpaceMetric(makeMetric({ metricId: "m1", timestamp: ts }), tmpRoot);
    recordSpaceMetric(makeMetric({ metricId: "m2", timestamp: ts }), tmpRoot);
    recordSpaceMetric(makeMetric({ metricId: "m3", timestamp: ts }), tmpRoot);

    const filePath = join(tmpRoot, SPACE_TELEMETRY_DIR_RELATIVE, "space-2026-05-28.jsonl");
    const lines = readFileSync(filePath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).metricId).toBe("m1");
    expect(JSON.parse(lines[1]).metricId).toBe("m2");
    expect(JSON.parse(lines[2]).metricId).toBe("m3");
  });

  it("uses a per-day filename derived from the metric timestamp", () => {
    recordSpaceMetric(makeMetric({ timestamp: "2026-05-28T23:59:59.999Z" }), tmpRoot);
    recordSpaceMetric(makeMetric({ timestamp: "2026-05-29T00:00:00.000Z" }), tmpRoot);

    expect(
      existsSync(join(tmpRoot, SPACE_TELEMETRY_DIR_RELATIVE, "space-2026-05-28.jsonl")),
    ).toBe(true);
    expect(
      existsSync(join(tmpRoot, SPACE_TELEMETRY_DIR_RELATIVE, "space-2026-05-29.jsonl")),
    ).toBe(true);
  });

  it("never throws when the persistence path cannot be created", () => {
    // Point projectRoot at a path under /dev/null (cannot be made a directory).
    // The Silent Failure Contract requires recordSpaceMetric to swallow this.
    expect(() =>
      recordSpaceMetric(makeMetric(), "/dev/null/forbidden"),
    ).not.toThrow();
    // Ring buffer still receives the record even when disk persistence fails.
    expect(getSpaceMetricsSnapshot()).toHaveLength(1);
  });
});

// ── Ring buffer eviction ────────────────────────────────────────

describe("ring buffer eviction", () => {
  it("caps the in-memory buffer at DEFAULT_RING_BUFFER_SIZE with FIFO eviction", () => {
    // Push DEFAULT_RING_BUFFER_SIZE + 5 entries and confirm the oldest 5 are evicted.
    const overshoot = 5;
    for (let i = 0; i < DEFAULT_RING_BUFFER_SIZE + overshoot; i += 1) {
      recordSpaceMetric(makeMetric({ metricId: `m${i}`, value: i }), tmpRoot);
    }
    const snapshot = getSpaceMetricsSnapshot();
    expect(snapshot).toHaveLength(DEFAULT_RING_BUFFER_SIZE);
    // First retained record should be m5 (the first 5 were evicted).
    expect(snapshot[0].metricId).toBe(`m${overshoot}`);
    expect(snapshot[snapshot.length - 1].metricId).toBe(
      `m${DEFAULT_RING_BUFFER_SIZE + overshoot - 1}`,
    );
  });

  it("getSpaceMetricsSnapshot returns a defensive copy", () => {
    recordSpaceMetric(makeMetric({ metricId: "snap.a" }), tmpRoot);
    const snap1 = getSpaceMetricsSnapshot();
    snap1.length = 0;
    const snap2 = getSpaceMetricsSnapshot();
    expect(snap2).toHaveLength(1);
    expect(snap2[0].metricId).toBe("snap.a");
  });
});

// ── recordFirstRunSuccess (primary metric) ──────────────────────

describe("recordFirstRunSuccess (primary P1 metric)", () => {
  it("records a success outcome as value=1 on the performance axis", () => {
    recordFirstRunSuccess(true, { projectRoot: tmpRoot, source: "hatch3r-init" });
    const snapshot = getSpaceMetricsSnapshot();
    expect(snapshot[0].metricId).toBe("firstRunSuccessRate");
    expect(snapshot[0].axis).toBe("performance");
    expect(snapshot[0].value).toBe(1);
    expect(snapshot[0].source).toBe("hatch3r-init");
  });

  it("records a failure outcome as value=0 on the performance axis", () => {
    recordFirstRunSuccess(false, { projectRoot: tmpRoot });
    const snapshot = getSpaceMetricsSnapshot();
    expect(snapshot[0].value).toBe(0);
    expect(snapshot[0].axis).toBe("performance");
  });

  it("propagates tags into the persisted record", () => {
    recordFirstRunSuccess(true, {
      projectRoot: tmpRoot,
      tags: { adapter: "cursor", nodeVersion: "22" },
    });
    const snapshot = getSpaceMetricsSnapshot();
    expect(snapshot[0].tags).toEqual({ adapter: "cursor", nodeVersion: "22" });
  });
});

// ── getSpaceSummary ─────────────────────────────────────────────

describe("getSpaceSummary", () => {
  it("returns one row per SPACE axis even when no metrics have been recorded", () => {
    const summary = getSpaceSummary();
    expect(summary).toHaveLength(5);
    const axes = summary.map((s) => s.axis);
    expect(axes).toEqual(SPACE_AXES);
    for (const row of summary) {
      expect(row.count).toBe(0);
      expect(row.mean).toBe(0);
    }
  });

  it("aggregates count and arithmetic mean per axis", () => {
    // satisfaction: [0.8, 0.6, 1.0] -> count 3, mean 0.8
    recordSpaceMetric(makeMetric({ axis: "satisfaction", value: 0.8 }), tmpRoot);
    recordSpaceMetric(makeMetric({ axis: "satisfaction", value: 0.6 }), tmpRoot);
    recordSpaceMetric(makeMetric({ axis: "satisfaction", value: 1.0 }), tmpRoot);
    // performance: [1, 1, 0, 1] -> count 4, mean 0.75 (firstRunSuccessRate scenario)
    recordSpaceMetric(makeMetric({ axis: "performance", value: 1 }), tmpRoot);
    recordSpaceMetric(makeMetric({ axis: "performance", value: 1 }), tmpRoot);
    recordSpaceMetric(makeMetric({ axis: "performance", value: 0 }), tmpRoot);
    recordSpaceMetric(makeMetric({ axis: "performance", value: 1 }), tmpRoot);
    // activity: [10, 20] -> count 2, mean 15
    recordSpaceMetric(makeMetric({ axis: "activity", value: 10 }), tmpRoot);
    recordSpaceMetric(makeMetric({ axis: "activity", value: 20 }), tmpRoot);
    // communication: untouched -> count 0, mean 0
    // efficiency: [120] -> count 1, mean 120
    recordSpaceMetric(makeMetric({ axis: "efficiency", value: 120 }), tmpRoot);

    const summary = getSpaceSummary();
    const byAxis = new Map<SpaceAxis, { count: number; mean: number }>();
    for (const row of summary) {
      byAxis.set(row.axis, { count: row.count, mean: row.mean });
    }

    expect(byAxis.get("satisfaction")).toEqual({ count: 3, mean: (0.8 + 0.6 + 1.0) / 3 });
    expect(byAxis.get("performance")).toEqual({ count: 4, mean: 0.75 });
    expect(byAxis.get("activity")).toEqual({ count: 2, mean: 15 });
    expect(byAxis.get("communication")).toEqual({ count: 0, mean: 0 });
    expect(byAxis.get("efficiency")).toEqual({ count: 1, mean: 120 });
  });

  it("computes firstRunSuccessRate as mean of performance-axis records", () => {
    // 3 successes + 1 failure -> mean 0.75 = 75% first-run success rate
    recordFirstRunSuccess(true, { projectRoot: tmpRoot });
    recordFirstRunSuccess(true, { projectRoot: tmpRoot });
    recordFirstRunSuccess(true, { projectRoot: tmpRoot });
    recordFirstRunSuccess(false, { projectRoot: tmpRoot });

    const perfRow = getSpaceSummary().find((r) => r.axis === "performance");
    expect(perfRow).toBeDefined();
    expect(perfRow?.count).toBe(4);
    expect(perfRow?.mean).toBeCloseTo(0.75, 5);
  });

  it("returns axes in canonical SPACE_AXES order regardless of insertion order", () => {
    recordSpaceMetric(makeMetric({ axis: "efficiency", value: 1 }), tmpRoot);
    recordSpaceMetric(makeMetric({ axis: "satisfaction", value: 1 }), tmpRoot);
    recordSpaceMetric(makeMetric({ axis: "communication", value: 1 }), tmpRoot);

    const summary = getSpaceSummary();
    expect(summary.map((s) => s.axis)).toEqual(SPACE_AXES);
  });
});

// ── summarizeSpaceMetricRecords (shared aggregator, D10-17) ──────

describe("summarizeSpaceMetricRecords", () => {
  it("aggregates an arbitrary record array independent of the ring buffer", () => {
    const records: SpaceMetricRecord[] = [
      { metricId: "a", axis: "performance", value: 1, timestamp: "2026-06-01T00:00:00.000Z" },
      { metricId: "b", axis: "performance", value: 0, timestamp: "2026-06-01T00:00:01.000Z" },
      { metricId: "c", axis: "satisfaction", value: 0.5, timestamp: "2026-06-01T00:00:02.000Z" },
    ];
    const summary = summarizeSpaceMetricRecords(records);
    const byAxis = new Map(summary.map((r) => [r.axis, r]));
    expect(byAxis.get("performance")).toEqual({ axis: "performance", count: 2, mean: 0.5 });
    expect(byAxis.get("satisfaction")).toEqual({ axis: "satisfaction", count: 1, mean: 0.5 });
    expect(byAxis.get("activity")).toEqual({ axis: "activity", count: 0, mean: 0 });
    // Ring buffer must be untouched by summarizing an external array.
    expect(getSpaceMetricsSnapshot()).toHaveLength(0);
  });

  it("returns all five axes in canonical order for an empty input", () => {
    const summary = summarizeSpaceMetricRecords([]);
    expect(summary.map((s) => s.axis)).toEqual(SPACE_AXES);
    expect(summary.every((s) => s.count === 0 && s.mean === 0)).toBe(true);
  });
});

// ── readSpaceMetricsForDay (cross-process JSONL read, D10-17) ────

describe("readSpaceMetricsForDay", () => {
  function writeJsonl(date: string, lines: string[]): void {
    const dir = join(tmpRoot, SPACE_TELEMETRY_DIR_RELATIVE);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `space-${date}.jsonl`), lines.map((l) => l + "\n").join(""));
  }

  it("round-trips records persisted by recordSpaceMetric", () => {
    const ts = "2026-06-01T09:00:00.000Z";
    recordSpaceMetric(
      makeMetric({ metricId: "rt.a", axis: "performance", value: 1, timestamp: ts }),
      tmpRoot,
    );
    recordSpaceMetric(
      makeMetric({ metricId: "rt.b", axis: "efficiency", value: 42, timestamp: ts }),
      tmpRoot,
    );
    // Fresh read from disk (does NOT consult the in-memory ring buffer).
    const records = readSpaceMetricsForDay("2026-06-01", tmpRoot);
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.metricId).sort()).toEqual(["rt.a", "rt.b"]);
    const perf = records.find((r) => r.metricId === "rt.a");
    expect(perf?.axis).toBe("performance");
    expect(perf?.value).toBe(1);
  });

  it("returns an empty array when no telemetry file exists for the day", () => {
    expect(readSpaceMetricsForDay("2026-06-02", tmpRoot)).toEqual([]);
  });

  it("skips malformed JSONL lines without throwing (torn final write)", () => {
    const valid = JSON.stringify({
      metricId: "ok",
      axis: "performance",
      value: 1,
      timestamp: "2026-06-03T00:00:00.000Z",
    });
    writeJsonl("2026-06-03", [valid, "{ this is not json", ""]);
    const records = readSpaceMetricsForDay("2026-06-03", tmpRoot);
    expect(records).toHaveLength(1);
    expect(records[0].metricId).toBe("ok");
  });

  it("drops records with an unknown axis or missing required fields", () => {
    const goodLine = JSON.stringify({
      metricId: "good",
      axis: "activity",
      value: 3,
      timestamp: "2026-06-04T00:00:00.000Z",
    });
    const badAxis = JSON.stringify({
      metricId: "badAxis",
      axis: "not-a-space-axis",
      value: 1,
      timestamp: "2026-06-04T00:00:01.000Z",
    });
    const missingValue = JSON.stringify({
      metricId: "noValue",
      axis: "performance",
      timestamp: "2026-06-04T00:00:02.000Z",
    });
    writeJsonl("2026-06-04", [goodLine, badAxis, missingValue]);
    const records = readSpaceMetricsForDay("2026-06-04", tmpRoot);
    expect(records).toHaveLength(1);
    expect(records[0].metricId).toBe("good");
  });

  it("feeds summarizeSpaceMetricRecords so the firstRunSuccessRate is recoverable cross-process", () => {
    // Simulate three init runs persisted by recordFirstRunSuccess on the same
    // day, two success + one failure -> 2/3 first-run success rate read back
    // from disk by a separate "process" (no ring-buffer state).
    // recordFirstRunSuccess stamps the current date, so read TODAY's file (the
    // default `date` arg) rather than a hard-coded day.
    recordFirstRunSuccess(true, { projectRoot: tmpRoot, tags: { run: "1" } });
    recordFirstRunSuccess(true, { projectRoot: tmpRoot, tags: { run: "2" } });
    recordFirstRunSuccess(false, { projectRoot: tmpRoot, tags: { run: "3" } });
    resetSpaceMetricsBuffer(); // wipe in-memory state to prove the read is disk-sourced
    const records = readSpaceMetricsForDay(undefined, tmpRoot);
    const perf = summarizeSpaceMetricRecords(records).find((r) => r.axis === "performance");
    expect(perf?.count).toBe(3);
    expect(perf?.mean).toBeCloseTo(2 / 3, 5);
  });
});
