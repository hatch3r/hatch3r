import { mkdtemp, mkdir, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CURRENT_INSIGHTS_VERSION,
  HISTORY_MAX,
  InsightsAccumulatorError,
  InsightsParseError,
  parseInsights,
  promote,
  promoteToHistory,
  readInsights,
  validateAccumulator,
  validateInsights,
  writeInsights,
  type CycleInsight,
  type InsightsPaths,
  type InsightsRing,
} from "../../audit/insights.js";

const FIXED_DATE = "2026-04-28T00:00:00.000Z";

interface Fixture {
  dir: string;
  paths: InsightsPaths;
}

async function makeFixture(): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), "hatch3r-insights-"));
  await mkdir(join(dir, "governance", "audit"), { recursive: true });
  await mkdir(join(dir, ".audit-workspace"), { recursive: true });
  return {
    dir,
    paths: {
      insightsFile: join(dir, "governance", "audit", "execution-insights.json"),
      currentFile: join(dir, ".audit-workspace", "current-insights.json"),
    },
  };
}

/* eslint-disable silent-failure/no-silent-catch -- test-helpers: existence
 * probes and tmpdir reap rely on intentional silent fallback. Surfacing
 * diagnostics on every absent-file check or stale-tmpdir reap floods output.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function cleanupFixture(fx: Fixture): Promise<void> {
  const { rm } = await import("node:fs/promises");
  try {
    await rm(fx.dir, { recursive: true, force: true });
  } catch {
    // OS reaps tmpdir eventually.
  }
}
/* eslint-enable silent-failure/no-silent-catch */

function cycle(overrides: Partial<CycleInsight> = {}): CycleInsight {
  return {
    cycle_date: "2026-04-19",
    cycle_number: 7,
    fix_success_rate: { code: { rate: 1.0 } },
    ...overrides,
  };
}

describe("parseInsights", () => {
  it("wraps a legacy single-cycle snapshot as history[0]", () => {
    const legacy = cycle({ cycle_number: 7 });
    const ring = parseInsights(legacy);
    expect(ring.schema_version).toBe(CURRENT_INSIGHTS_VERSION);
    expect(ring.current).toBeNull();
    expect(ring.history).toHaveLength(1);
    expect(ring.history[0].cycle_number).toBe(7);
  });

  it("round-trips a v2 envelope (parse → serialize → parse)", () => {
    const ring: InsightsRing = {
      schema_version: CURRENT_INSIGHTS_VERSION,
      current: null,
      history: [cycle({ cycle_number: 5 }), cycle({ cycle_number: 6 })],
    };
    const reparsed = parseInsights(JSON.parse(JSON.stringify(ring)));
    expect(reparsed.schema_version).toBe(CURRENT_INSIGHTS_VERSION);
    expect(reparsed.history).toHaveLength(2);
    expect(reparsed.history[0].cycle_number).toBe(5);
    expect(reparsed.history[1].cycle_number).toBe(6);
  });

  it("throws on a null root", () => {
    expect(() => parseInsights(null)).toThrow(InsightsParseError);
  });

  it("throws on a non-object root (array)", () => {
    expect(() => parseInsights([])).toThrow(InsightsParseError);
  });

  it("throws on a v2 envelope missing the history array", () => {
    expect(() =>
      parseInsights({
        schema_version: CURRENT_INSIGHTS_VERSION,
        current: null,
      }),
    ).toThrow(/history/);
  });

  it("throws on a v2 envelope with a non-array history", () => {
    expect(() =>
      parseInsights({
        schema_version: CURRENT_INSIGHTS_VERSION,
        current: null,
        history: { 0: cycle() },
      }),
    ).toThrow(/history.*not an array/);
  });

  it("throws on a v2 envelope whose history exceeds HISTORY_MAX", () => {
    const tooMany = Array.from({ length: HISTORY_MAX + 1 }, (_, i) =>
      cycle({ cycle_number: i }),
    );
    expect(() =>
      parseInsights({
        schema_version: CURRENT_INSIGHTS_VERSION,
        current: null,
        history: tooMany,
      }),
    ).toThrow(/HISTORY_MAX/);
  });

  it("throws on a v2 envelope with a non-object history entry", () => {
    expect(() =>
      parseInsights({
        schema_version: CURRENT_INSIGHTS_VERSION,
        current: null,
        history: [cycle(), null],
      }),
    ).toThrow(/history\[1\]/);
  });

  it("throws on a non-string schema_version", () => {
    expect(() =>
      parseInsights({
        schema_version: 2,
        current: null,
        history: [],
      }),
    ).toThrow(/schema_version/);
  });

  it("accepts both `current: null` and a non-null object for current", () => {
    const ringNull = parseInsights({
      schema_version: CURRENT_INSIGHTS_VERSION,
      current: null,
      history: [],
    });
    expect(ringNull.current).toBeNull();

    const ringObj = parseInsights({
      schema_version: CURRENT_INSIGHTS_VERSION,
      current: cycle({ cycle_number: 8 }),
      history: [],
    });
    expect(ringObj.current).not.toBeNull();
    expect((ringObj.current as CycleInsight).cycle_number).toBe(8);
  });

  it("rejects a `current` field that is neither null nor a non-null object", () => {
    expect(() =>
      parseInsights({
        schema_version: CURRENT_INSIGHTS_VERSION,
        current: "not-an-object",
        history: [],
      }),
    ).toThrow(/current/);
  });
});

describe("promote", () => {
  it("pushes the finished cycle to the end of history", () => {
    const ring: InsightsRing = {
      schema_version: CURRENT_INSIGHTS_VERSION,
      current: cycle({ cycle_number: 8 }),
      history: [cycle({ cycle_number: 7 })],
    };
    const next = promote(ring, cycle({ cycle_number: 8 }));
    expect(next.history.map((h) => h.cycle_number)).toEqual([7, 8]);
  });

  it("drops the oldest entry when at HISTORY_MAX", () => {
    const ring: InsightsRing = {
      schema_version: CURRENT_INSIGHTS_VERSION,
      current: null,
      history: [
        cycle({ cycle_number: 5 }),
        cycle({ cycle_number: 6 }),
        cycle({ cycle_number: 7 }),
      ],
    };
    expect(ring.history).toHaveLength(HISTORY_MAX);
    const next = promote(ring, cycle({ cycle_number: 8 }));
    expect(next.history).toHaveLength(HISTORY_MAX);
    expect(next.history.map((h) => h.cycle_number)).toEqual([6, 7, 8]);
  });

  it("clears `current` to null after promotion", () => {
    const ring: InsightsRing = {
      schema_version: CURRENT_INSIGHTS_VERSION,
      current: cycle({ cycle_number: 8 }),
      history: [],
    };
    const next = promote(ring, cycle({ cycle_number: 8 }));
    expect(next.current).toBeNull();
  });

  it("does not mutate the input ring or its history array", () => {
    const inputHistory = [cycle({ cycle_number: 7 })];
    const ring: InsightsRing = {
      schema_version: CURRENT_INSIGHTS_VERSION,
      current: null,
      history: inputHistory,
    };
    const snapshot = JSON.parse(JSON.stringify(ring));
    promote(ring, cycle({ cycle_number: 8 }));
    expect(JSON.parse(JSON.stringify(ring))).toEqual(snapshot);
    expect(ring.history).toBe(inputHistory);
    expect(ring.history).toHaveLength(1);
  });
});

describe("validateInsights", () => {
  it("returns no drift on a clean ring", () => {
    const ring: InsightsRing = {
      schema_version: CURRENT_INSIGHTS_VERSION,
      current: null,
      history: [cycle()],
    };
    expect(validateInsights(ring)).toEqual([]);
  });

  it("flags a schema_version mismatch", () => {
    const ring: InsightsRing = {
      schema_version: "1.0.0",
      current: null,
      history: [],
    };
    const drifts = validateInsights(ring);
    expect(drifts).toHaveLength(1);
    expect(drifts[0].reason).toBe("schema_version mismatch");
  });

  it("flags a history that exceeds HISTORY_MAX", () => {
    // Hand-build a too-large ring (parseInsights would have rejected it,
    // but validateInsights is a pure function callers may run independently).
    const ring: InsightsRing = {
      schema_version: CURRENT_INSIGHTS_VERSION,
      current: null,
      history: Array.from({ length: HISTORY_MAX + 1 }, () => cycle()),
    };
    const drifts = validateInsights(ring);
    expect(drifts.find((d) => d.reason === "history exceeds HISTORY_MAX")).toBeDefined();
  });
});

describe("validateAccumulator", () => {
  it("accepts a complete accumulator (no errors, no warnings)", () => {
    const v = validateAccumulator({
      cycle_date: "2026-05-29",
      cycle_number: 10,
      fix_success_rate: { code: { rate: 1.0 } },
      cl2_artifact_closure: { P0: {}, P1: {}, P2: {}, P3: {} },
    });
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
  });

  it("accepts `cycle` (live-accumulator shape) as a cycle identifier", () => {
    const v = validateAccumulator({
      cycle_date: "2026-05-29",
      cycle: 10,
      fix_success_rate: {},
      cl2_artifact_closure: {},
    });
    expect(v.errors).toEqual([]);
  });

  it("errors when cycle_date is missing", () => {
    const v = validateAccumulator({
      cycle_number: 10,
      fix_success_rate: {},
    });
    expect(v.errors).toContain("missing required field `cycle_date`");
  });

  it("errors when fix_success_rate is missing", () => {
    const v = validateAccumulator({
      cycle_date: "2026-05-29",
      cycle_number: 10,
    });
    expect(v.errors).toContain("missing required field `fix_success_rate`");
  });

  it("errors when no cycle identifier is present", () => {
    const v = validateAccumulator({
      cycle_date: "2026-05-29",
      fix_success_rate: {},
    });
    expect(
      v.errors.some((e) => e.includes("missing cycle identifier")),
    ).toBe(true);
  });

  it("warns (does not error) when cl2_artifact_closure is missing", () => {
    const v = validateAccumulator({
      cycle_date: "2026-05-29",
      cycle_number: 10,
      fix_success_rate: {},
    });
    expect(v.errors).toEqual([]);
    expect(
      v.warnings.some((w) => w.includes("cl2_artifact_closure")),
    ).toBe(true);
  });
});

describe("readInsights / writeInsights round-trip", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await cleanupFixture(fx);
  });

  it("returns an empty ring when the insights file does not exist", async () => {
    const ring = await readInsights(fx.paths);
    expect(ring.schema_version).toBe(CURRENT_INSIGHTS_VERSION);
    expect(ring.current).toBeNull();
    expect(ring.history).toEqual([]);
  });

  it("round-trips a written ring through the file system", async () => {
    const ring: InsightsRing = {
      schema_version: CURRENT_INSIGHTS_VERSION,
      current: null,
      history: [cycle({ cycle_number: 7 }), cycle({ cycle_number: 8 })],
    };
    await writeInsights(fx.paths, ring);
    const reloaded = await readInsights(fx.paths);
    expect(reloaded.history).toHaveLength(2);
    expect(reloaded.history[1].cycle_number).toBe(8);
  });

  it("reads a legacy snapshot and promotes it into history[0]", async () => {
    const legacy = cycle({ cycle_number: 7 });
    await writeFile(fx.paths.insightsFile, JSON.stringify(legacy, null, 2));
    const ring = await readInsights(fx.paths);
    expect(ring.history).toHaveLength(1);
    expect(ring.history[0].cycle_number).toBe(7);
  });
});

describe("promoteToHistory — end-to-end", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await cleanupFixture(fx);
  });

  it("promotes the current-cycle file into the ring atomically", async () => {
    const initial: InsightsRing = {
      schema_version: CURRENT_INSIGHTS_VERSION,
      current: null,
      history: [cycle({ cycle_number: 6 }), cycle({ cycle_number: 7 })],
    };
    await writeInsights(fx.paths, initial);
    await writeFile(
      fx.paths.currentFile,
      JSON.stringify(cycle({ cycle_number: 8, cycle_date: FIXED_DATE })),
    );

    const result = await promoteToHistory(fx.paths);
    expect(result.promoted).toBe(true);
    expect(result.ring.history).toHaveLength(3);
    expect(result.ring.history[2].cycle_number).toBe(8);

    // Verify on disk.
    const onDisk = await readInsights(fx.paths);
    expect(onDisk.history.map((h) => h.cycle_number)).toEqual([6, 7, 8]);
  });

  it("evicts the oldest cycle when promoting at capacity", async () => {
    const initial: InsightsRing = {
      schema_version: CURRENT_INSIGHTS_VERSION,
      current: null,
      history: [
        cycle({ cycle_number: 5 }),
        cycle({ cycle_number: 6 }),
        cycle({ cycle_number: 7 }),
      ],
    };
    await writeInsights(fx.paths, initial);
    await writeFile(
      fx.paths.currentFile,
      JSON.stringify(cycle({ cycle_number: 8 })),
    );

    const result = await promoteToHistory(fx.paths);
    expect(result.promoted).toBe(true);
    expect(result.ring.history.map((h) => h.cycle_number)).toEqual([6, 7, 8]);
  });

  it("returns promoted=false and leaves the ring unchanged when currentFile is absent", async () => {
    const initial: InsightsRing = {
      schema_version: CURRENT_INSIGHTS_VERSION,
      current: null,
      history: [cycle({ cycle_number: 7 })],
    };
    await writeInsights(fx.paths, initial);

    expect(await fileExists(fx.paths.currentFile)).toBe(false);
    const result = await promoteToHistory(fx.paths);
    expect(result.promoted).toBe(false);
    expect(result.ring.history).toHaveLength(1);
    expect(result.ring.history[0].cycle_number).toBe(7);

    // On-disk content unchanged.
    const onDisk = await readInsights(fx.paths);
    expect(onDisk.history).toHaveLength(1);
    expect(onDisk.history[0].cycle_number).toBe(7);
  });

  it("throws InsightsParseError when currentFile is malformed JSON", async () => {
    await writeInsights(fx.paths, {
      schema_version: CURRENT_INSIGHTS_VERSION,
      current: null,
      history: [],
    });
    await writeFile(fx.paths.currentFile, "{not json");
    await expect(promoteToHistory(fx.paths)).rejects.toThrow(InsightsParseError);
  });

  it("throws InsightsAccumulatorError when the accumulator lacks required fields", async () => {
    await writeInsights(fx.paths, {
      schema_version: CURRENT_INSIGHTS_VERSION,
      current: null,
      history: [],
    });
    // Missing fix_success_rate AND any cycle identifier.
    await writeFile(
      fx.paths.currentFile,
      JSON.stringify({ cycle_date: "2026-05-29" }),
    );
    await expect(promoteToHistory(fx.paths)).rejects.toThrow(
      InsightsAccumulatorError,
    );

    // The ring is left untouched — promotion refused before any write.
    const onDisk = await readInsights(fx.paths);
    expect(onDisk.history).toEqual([]);
  });

  it("returns a warning (but still promotes) when cl2_artifact_closure is absent", async () => {
    await writeInsights(fx.paths, {
      schema_version: CURRENT_INSIGHTS_VERSION,
      current: null,
      history: [],
    });
    // Required fields present; the recommended cl2_artifact_closure is not.
    await writeFile(
      fx.paths.currentFile,
      JSON.stringify(cycle({ cycle_number: 9 })),
    );
    const result = await promoteToHistory(fx.paths);
    expect(result.promoted).toBe(true);
    expect(result.ring.history).toHaveLength(1);
    expect(
      result.warnings.some((w) => w.includes("cl2_artifact_closure")),
    ).toBe(true);
  });

  it("returns an empty warnings array on the no-op (absent currentFile) path", async () => {
    await writeInsights(fx.paths, {
      schema_version: CURRENT_INSIGHTS_VERSION,
      current: null,
      history: [],
    });
    const result = await promoteToHistory(fx.paths);
    expect(result.promoted).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("initializes a fresh ring when neither file exists then promotes", async () => {
    // No insights file, no current file → promoted=false, ring is fresh.
    expect(await fileExists(fx.paths.insightsFile)).toBe(false);
    const r1 = await promoteToHistory(fx.paths);
    expect(r1.promoted).toBe(false);
    expect(r1.ring.history).toEqual([]);

    // Now drop a current-cycle file and promote.
    await writeFile(
      fx.paths.currentFile,
      JSON.stringify(cycle({ cycle_number: 1 })),
    );
    const r2 = await promoteToHistory(fx.paths);
    expect(r2.promoted).toBe(true);
    expect(r2.ring.history).toHaveLength(1);
    expect(r2.ring.history[0].cycle_number).toBe(1);
  });
});
