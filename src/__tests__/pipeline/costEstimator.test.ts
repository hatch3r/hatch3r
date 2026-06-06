import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:fs so the Silent Failure Contract tests can inject a write failure
// at the fs boundary deterministically on every OS. Every call delegates to the
// real implementation by default; individual tests override `mockMkdirSync`
// to throw. (The prior tests pointed `projectRoot` at `/dev/null/<x>`, which
// fails ENOTDIR on POSIX but can mkdir-succeed under a drive root on Windows —
// making the assertion platform-dependent.)
const realNodeFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const mockMkdirSync = vi.fn<typeof realNodeFs.mkdirSync>();
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    mkdirSync: (...a: Parameters<typeof actual.mkdirSync>) => mockMkdirSync(...a),
  };
});

import {
  appendTelemetrySnapshot,
  CACHE_READ_MULTIPLIER,
  computeDelta,
  DEFAULT_INPUT_COST_PER_1M,
  DEFAULT_OUTPUT_COST_PER_1M,
  estimateCost,
  estimateUsdCost,
  formatCostBlock,
  MODEL_RATES,
  recordActuals,
  resolveModelRate,
  TELEMETRY_DIR_RELATIVE,
  TIER_BASELINES,
  VARIANCE_THRESHOLD_PERCENT,
  type CostActuals,
  type CostEstimate,
  type TriageTier,
} from "../../pipeline/costEstimator.js";
import type { PipelineTokenSummary } from "../../pipeline/observability.js";

// ── estimateCost ────────────────────────────────────────────────

describe("estimateCost", () => {
  it("returns the light-tier midpoint for an unadorned light triage", () => {
    const est = estimateCost({ triageTier: "light" });
    const b = TIER_BASELINES.light;
    expect(est.triage_tier).toBe("light");
    expect(est.expected_sa_count).toBe(Math.round((b.subAgentMin + b.subAgentMax) / 2));
    expect(est.estimated_input_tokens_static_frame).toBe(
      Math.round((b.staticFrameTokensMin + b.staticFrameTokensMax) / 2),
    );
    expect(est.estimated_web_research_queries).toBe(
      Math.round((b.webResearchQueriesMin + b.webResearchQueriesMax) / 2),
    );
    expect(est.estimated_duration_min).toBe(
      Math.round((b.durationMinMin + b.durationMinMax) / 2),
    );
  });

  it("returns the standard-tier midpoint when no overrides are given", () => {
    const est = estimateCost({ triageTier: "standard" });
    expect(est.triage_tier).toBe("standard");
    // Standard tier: 4-9 -> midpoint 7 (round((4+9)/2)=Math.round(6.5)=7)
    expect(est.expected_sa_count).toBe(7);
  });

  it("returns the deep-tier midpoint when no overrides are given", () => {
    const est = estimateCost({ triageTier: "deep" });
    expect(est.triage_tier).toBe("deep");
    // Deep tier baseline: 10-20 -> midpoint 15
    expect(est.expected_sa_count).toBe(15);
    expect(est.estimated_input_tokens_static_frame).toBeGreaterThanOrEqual(80_000);
  });

  it("uses explicit subAgentDeclared override when provided", () => {
    const est = estimateCost({ triageTier: "light", subAgentDeclared: 12 });
    expect(est.expected_sa_count).toBe(12);
  });

  it("uses explicit webResearchDeclared override when provided", () => {
    const est = estimateCost({ triageTier: "standard", webResearchDeclared: 7 });
    expect(est.estimated_web_research_queries).toBe(7);
  });

  it("uses explicit inputTokensDeclared override when provided", () => {
    const est = estimateCost({ triageTier: "standard", inputTokensDeclared: 50_000 });
    expect(est.estimated_input_tokens_static_frame).toBe(50_000);
  });

  it("uses explicit durationMinDeclared override when provided", () => {
    const est = estimateCost({ triageTier: "deep", durationMinDeclared: 45 });
    expect(est.estimated_duration_min).toBe(45);
  });

  it("clamps a negative subAgentDeclared override to 0", () => {
    const est = estimateCost({ triageTier: "light", subAgentDeclared: -5 });
    expect(est.expected_sa_count).toBe(0);
  });

  it("rounds a fractional override to the nearest integer", () => {
    const est = estimateCost({ triageTier: "light", subAgentDeclared: 3.7 });
    expect(est.expected_sa_count).toBe(4);
  });

  it("ignores NaN overrides and falls back to the tier midpoint", () => {
    const est = estimateCost({ triageTier: "light", subAgentDeclared: Number.NaN });
    const b = TIER_BASELINES.light;
    expect(est.expected_sa_count).toBe(Math.round((b.subAgentMin + b.subAgentMax) / 2));
  });

  it("falls back to standard tier when an unknown tier is passed (defensive cast)", () => {
    // Force-pass an invalid tier; in practice TypeScript blocks this.
    const est = estimateCost({ triageTier: "bogus" as unknown as TriageTier });
    expect(est.triage_tier).toBe("standard");
  });
});

// ── computeDelta ─────────────────────────────────────────────────

describe("computeDelta", () => {
  const baseEstimate: CostEstimate = {
    triage_tier: "standard",
    expected_sa_count: 8,
    estimated_input_tokens_static_frame: 40_000,
    estimated_web_research_queries: 3,
    estimated_duration_min: 10,
  };

  function actuals(overrides: Partial<CostActuals> = {}): CostActuals {
    return {
      actual_sa_count: 8,
      actual_input_tokens_static_frame: 40_000,
      actual_web_research_queries: 3,
      actual_duration_min: 10,
      recorded_at: new Date().toISOString(),
      ...overrides,
    };
  }

  it("reports zero delta and no flags when actuals match the estimate", () => {
    const delta = computeDelta(baseEstimate, actuals());
    expect(delta.sa_count_delta).toBe(0);
    expect(delta.input_tokens_delta).toBe(0);
    expect(delta.web_research_delta).toBe(0);
    expect(delta.duration_delta_min).toBe(0);
    expect(delta.over_variance).toBe(false);
    expect(delta.flagged_fields).toEqual([]);
  });

  it("flags sa_count when fan-out exceeds the 25% threshold", () => {
    // 8 -> 12 = +50% (above 25%)
    const delta = computeDelta(baseEstimate, actuals({ actual_sa_count: 12 }));
    expect(delta.sa_count_delta).toBe(4);
    expect(delta.sa_count_delta_percent).toBe(50);
    expect(delta.over_variance).toBe(true);
    expect(delta.flagged_fields).toContain("sa_count");
  });

  it("does NOT flag sa_count when within the 25% threshold", () => {
    // 8 -> 9 = +12.5%, |12| < 25
    const delta = computeDelta(baseEstimate, actuals({ actual_sa_count: 9 }));
    expect(delta.over_variance).toBe(false);
    expect(delta.flagged_fields).not.toContain("sa_count");
  });

  it("flags input_tokens when actual is 100% above estimate", () => {
    const delta = computeDelta(
      baseEstimate,
      actuals({ actual_input_tokens_static_frame: 80_000 }),
    );
    expect(delta.input_tokens_delta).toBe(40_000);
    expect(delta.input_tokens_delta_percent).toBe(100);
    expect(delta.flagged_fields).toContain("input_tokens");
  });

  it("flags duration when actual is far below estimate (absolute variance)", () => {
    // 10 -> 2 = -80%, |80| > 25, abs value triggers flag
    const delta = computeDelta(baseEstimate, actuals({ actual_duration_min: 2 }));
    expect(delta.duration_delta_min).toBe(-8);
    expect(delta.duration_delta_percent).toBe(80);
    expect(delta.flagged_fields).toContain("duration");
  });

  it("flags multiple fields when more than one exceeds the threshold", () => {
    const delta = computeDelta(
      baseEstimate,
      actuals({
        actual_sa_count: 20,
        actual_input_tokens_static_frame: 100_000,
      }),
    );
    expect(delta.flagged_fields).toContain("sa_count");
    expect(delta.flagged_fields).toContain("input_tokens");
    expect(delta.over_variance).toBe(true);
  });

  it("treats zero estimate with positive actual as automatic flag", () => {
    const zeroEstimate: CostEstimate = {
      ...baseEstimate,
      expected_sa_count: 0,
    };
    const delta = computeDelta(zeroEstimate, actuals({ actual_sa_count: 5 }));
    expect(delta.sa_count_delta).toBe(5);
    expect(delta.sa_count_delta_percent).toBe(0); // div-by-zero guard
    expect(delta.flagged_fields).toContain("sa_count");
    expect(delta.over_variance).toBe(true);
  });

  it("does NOT flag when both estimate and actual are zero", () => {
    const zeroEstimate: CostEstimate = {
      ...baseEstimate,
      expected_sa_count: 0,
      estimated_web_research_queries: 0,
    };
    const delta = computeDelta(
      zeroEstimate,
      actuals({ actual_sa_count: 0, actual_web_research_queries: 0 }),
    );
    expect(delta.flagged_fields).not.toContain("sa_count");
    expect(delta.flagged_fields).not.toContain("web_research");
  });

  it("variance threshold constant equals 25", () => {
    expect(VARIANCE_THRESHOLD_PERCENT).toBe(25);
  });
});

// ── recordActuals + appendTelemetrySnapshot persistence ─────────

// Default: the mocked mkdirSync delegates to the real implementation. Failure
// tests override it for their duration; this re-establishes the delegate before
// every test so the override never leaks.
beforeEach(() => {
  mockMkdirSync.mockImplementation((...a) => realNodeFs.mkdirSync(...a));
});

describe("recordActuals", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "hatch3r-cost-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  const sampleActuals: CostActuals = {
    actual_sa_count: 5,
    actual_input_tokens_static_frame: 22_000,
    actual_web_research_queries: 2,
    actual_duration_min: 6,
    recorded_at: "2026-05-26T12:00:00.000Z",
  };

  it("writes a JSON record under .hatch3r/telemetry/<session>.json", () => {
    const ok = recordActuals("test-session-001", sampleActuals, { projectRoot: tmpRoot });
    expect(ok).toBe(true);

    const expected = join(tmpRoot, TELEMETRY_DIR_RELATIVE, "test-session-001.json");
    expect(existsSync(expected)).toBe(true);
    const parsed = JSON.parse(readFileSync(expected, "utf-8"));
    expect(parsed.session_id).toBe("test-session-001");
    expect(parsed.actuals.actual_sa_count).toBe(5);
    expect(parsed.actuals.actual_input_tokens_static_frame).toBe(22_000);
    expect(parsed.updated_at).toBeTruthy();
  });

  it("includes estimate and computed delta when estimate is supplied", () => {
    const est = estimateCost({ triageTier: "standard" });
    const ok = recordActuals("test-session-002", sampleActuals, {
      projectRoot: tmpRoot,
      estimate: est,
      orchestrator: "hatch3r-feature-plan",
    });
    expect(ok).toBe(true);

    const expected = join(tmpRoot, TELEMETRY_DIR_RELATIVE, "test-session-002.json");
    const parsed = JSON.parse(readFileSync(expected, "utf-8"));
    expect(parsed.estimate).toBeDefined();
    expect(parsed.estimate.triage_tier).toBe("standard");
    expect(parsed.delta).toBeDefined();
    expect(typeof parsed.delta.sa_count_delta_percent).toBe("number");
    expect(parsed.orchestrator).toBe("hatch3r-feature-plan");
  });

  it("sanitises a session id with shell-unsafe characters into a portable filename", () => {
    const ok = recordActuals("bad/../session;rm", sampleActuals, { projectRoot: tmpRoot });
    expect(ok).toBe(true);

    const dir = join(tmpRoot, TELEMETRY_DIR_RELATIVE);
    // The file should exist with sanitised name (no path-traversal).
    // Input "bad/../session;rm" → replace `[^A-Za-z0-9_.-]` → "bad_.._session_rm".
    const expected = join(dir, "bad_.._session_rm.json");
    expect(existsSync(expected)).toBe(true);
  });

  it("returns false (no throw) when the project root is unwritable (Silent Failure Contract)", () => {
    // Inject the write failure at the fs boundary (mkdirSync throws) rather than
    // via a POSIX-only unwritable path. `/dev/null/<x>` fails ENOTDIR on POSIX
    // but resolves to a drive-relative `\dev\null\<x>` on Windows where mkdir can
    // SUCCEED, making the assertion platform-dependent. This exercises the same
    // Silent Failure Contract branch (catch → route → return false) on every OS.
    mockMkdirSync.mockImplementation(() => {
      throw Object.assign(new Error("mkdir denied"), { code: "EACCES" });
    });
    let ok: boolean | undefined;
    expect(() => {
      ok = recordActuals("oom-test", sampleActuals, { projectRoot: tmpRoot });
    }).not.toThrow();
    expect(ok).toBe(false);
  });
});

describe("appendTelemetrySnapshot", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "hatch3r-cost-jsonl-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("appends a JSONL line per call", () => {
    appendTelemetrySnapshot(
      "session-jsonl",
      { phase: "triage", estimate: estimateCost({ triageTier: "light" }) },
      tmpRoot,
    );
    appendTelemetrySnapshot("session-jsonl", { phase: "review", note: "fan-out" }, tmpRoot);

    const expected = join(tmpRoot, TELEMETRY_DIR_RELATIVE, "session-jsonl.jsonl");
    expect(existsSync(expected)).toBe(true);
    const lines = readFileSync(expected, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first.phase).toBe("triage");
    expect(first.estimate).toBeDefined();
    const second = JSON.parse(lines[1]);
    expect(second.phase).toBe("review");
    expect(second.note).toBe("fan-out");
  });

  it("returns true on successful write and false on failure", () => {
    const ok = appendTelemetrySnapshot("ok-session", { phase: "act" }, tmpRoot);
    expect(ok).toBe(true);
    // Inject the failure at the fs boundary (mkdirSync throws) instead of a
    // POSIX-only `/dev/null/<x>` path: that path fails ENOTDIR on POSIX but can
    // mkdir-succeed under a drive root on Windows. This drives the same catch →
    // route → return-false branch on every OS.
    mockMkdirSync.mockImplementation(() => {
      throw Object.assign(new Error("mkdir denied"), { code: "EACCES" });
    });
    const fail = appendTelemetrySnapshot("fail-session", { phase: "act" }, tmpRoot);
    expect(fail).toBe(false);
  });

  it("includes delta block when both estimate and actuals are supplied", () => {
    const est = estimateCost({ triageTier: "standard" });
    appendTelemetrySnapshot(
      "with-delta",
      {
        estimate: est,
        actuals: {
          actual_sa_count: est.expected_sa_count + 5,
          actual_input_tokens_static_frame: est.estimated_input_tokens_static_frame,
          actual_web_research_queries: est.estimated_web_research_queries,
          actual_duration_min: est.estimated_duration_min,
          recorded_at: new Date().toISOString(),
        },
      },
      tmpRoot,
    );

    const expected = join(tmpRoot, TELEMETRY_DIR_RELATIVE, "with-delta.jsonl");
    const line = readFileSync(expected, "utf-8").trim();
    const parsed = JSON.parse(line);
    expect(parsed.delta).toBeDefined();
    expect(parsed.delta.sa_count_delta).toBe(5);
  });
});

// ── formatCostBlock ──────────────────────────────────────────────

describe("formatCostBlock", () => {
  const estimate: CostEstimate = {
    triage_tier: "standard",
    expected_sa_count: 7,
    estimated_input_tokens_static_frame: 40_000,
    estimated_web_research_queries: 3,
    estimated_duration_min: 10,
  };

  it("emits only the estimate fields when no actuals are supplied", () => {
    const out = formatCostBlock(estimate);
    expect(out).toContain("triage_tier: standard");
    expect(out).toContain("expected_sa_count: 7");
    expect(out).toContain("estimated_input_tokens_static_frame: 40000");
    expect(out).toContain("estimated_web_research_queries: 3");
    expect(out).toContain("estimated_duration_min: 10");
    expect(out).not.toContain("actual_sa_count");
    expect(out).not.toContain("over_variance");
  });

  it("emits actuals, delta percent block, and over_variance when actuals supplied", () => {
    const actuals: CostActuals = {
      actual_sa_count: 12, // +71% -> flagged
      actual_input_tokens_static_frame: 40_000,
      actual_web_research_queries: 3,
      actual_duration_min: 10,
      recorded_at: "2026-05-26T13:00:00.000Z",
    };
    const out = formatCostBlock(estimate, actuals);
    expect(out).toContain("actual_sa_count: 12");
    expect(out).toContain("delta_percent:");
    expect(out).toContain("sa_count: 71");
    expect(out).toContain("over_variance: true");
    expect(out).toContain("flagged_fields: [sa_count]");
  });

  it("does not list flagged_fields line when nothing is flagged", () => {
    const actuals: CostActuals = {
      actual_sa_count: 7,
      actual_input_tokens_static_frame: 40_000,
      actual_web_research_queries: 3,
      actual_duration_min: 10,
      recorded_at: "2026-05-26T13:00:00.000Z",
    };
    const out = formatCostBlock(estimate, actuals);
    expect(out).toContain("over_variance: false");
    expect(out).not.toContain("flagged_fields:");
  });
});

// ── resolveModelRate (D6-18) ─────────────────────────────────────

describe("resolveModelRate", () => {
  it("resolves tier aliases to a model rate (case-insensitive)", () => {
    expect(resolveModelRate("opus")).toEqual(MODEL_RATES["claude-opus-4-8"]);
    expect(resolveModelRate("Sonnet")).toEqual(MODEL_RATES["claude-sonnet-4-6"]);
    expect(resolveModelRate("  HAIKU  ")).toEqual(MODEL_RATES["claude-haiku-4-5"]);
  });

  it("resolves exact model ids", () => {
    expect(resolveModelRate("claude-opus-4-8")).toEqual(MODEL_RATES["claude-opus-4-8"]);
    expect(resolveModelRate("claude-haiku-4-5")).toEqual(MODEL_RATES["claude-haiku-4-5"]);
  });

  it("returns null for an unknown selector", () => {
    expect(resolveModelRate("gpt-4")).toBeNull();
    expect(resolveModelRate("")).toBeNull();
  });

  it("prices Opus higher than the Sonnet-biased default (the D6-18 bug)", () => {
    const opus = resolveModelRate("opus")!;
    // Opus input is $5/1M vs the $3/1M Sonnet default — ~67% higher.
    expect(opus.inputCostPer1M).toBe(5.0);
    expect(opus.inputCostPer1M / DEFAULT_INPUT_COST_PER_1M).toBeCloseTo(5 / 3, 5);
    expect(opus.outputCostPer1M).toBe(25.0);
  });

  it("every rate row carries an accessed date", () => {
    for (const rate of Object.values(MODEL_RATES)) {
      expect(rate.accessed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

// ── estimateUsdCost — model rates + cache discount (D6-18 / D6-19) ─

describe("estimateUsdCost cache + model rates", () => {
  function summaryOf(input: number, output: number): PipelineTokenSummary {
    return {
      phases: [{ phase: "generation", inputTokens: input, outputTokens: output, totalTokens: input + output }],
      totalInputTokens: input,
      totalOutputTokens: output,
      grandTotal: input + output,
    };
  }

  it("defaults to the Sonnet-biased rates when no rate is supplied", () => {
    const cost = estimateUsdCost(summaryOf(1_000_000, 0));
    expect(cost.inputCost).toBeCloseTo(DEFAULT_INPUT_COST_PER_1M, 6);
  });

  it("uses a resolved Opus rate to cost input correctly (D6-18)", () => {
    const opus = resolveModelRate("opus")!;
    const cost = estimateUsdCost(summaryOf(1_000_000, 1_000_000), {
      inputCostPer1M: opus.inputCostPer1M,
      outputCostPer1M: opus.outputCostPer1M,
    });
    expect(cost.inputCost).toBeCloseTo(5.0, 6);
    expect(cost.outputCost).toBeCloseTo(25.0, 6);
    expect(cost.totalCost).toBeCloseTo(30.0, 6);
  });

  it("bills cached input at CACHE_READ_MULTIPLIER and leaves output full (D6-19)", () => {
    // 1M input @ $3/1M, 90% cache hit: 100k uncached @ full + 900k @ 0.1x.
    const cost = estimateUsdCost(summaryOf(1_000_000, 0), { cacheHitRatio: 0.9 });
    const expected = 0.1 * 3.0 + 0.9 * 3.0 * CACHE_READ_MULTIPLIER;
    expect(cost.inputCost).toBeCloseTo(expected, 6);
    // 90% hit ≈ a 1 − (0.1 + 0.9·0.1) = 81% reduction vs the uncached figure.
    expect(cost.inputCost).toBeCloseTo(3.0 * (0.1 + 0.9 * 0.1), 6);
  });

  it("does not discount output tokens for a cache hit", () => {
    const uncached = estimateUsdCost(summaryOf(0, 1_000_000));
    const cached = estimateUsdCost(summaryOf(0, 1_000_000), { cacheHitRatio: 1 });
    expect(cached.outputCost).toBeCloseTo(uncached.outputCost, 6);
  });

  it("full cache hit bills input at exactly 0.1x base", () => {
    const cost = estimateUsdCost(summaryOf(1_000_000, 0), { cacheHitRatio: 1 });
    expect(cost.inputCost).toBeCloseTo(3.0 * CACHE_READ_MULTIPLIER, 6);
  });

  it("clamps an out-of-range or non-finite cacheHitRatio to [0,1]", () => {
    const over = estimateUsdCost(summaryOf(1_000_000, 0), { cacheHitRatio: 5 });
    expect(over.inputCost).toBeCloseTo(3.0 * CACHE_READ_MULTIPLIER, 6); // clamped to 1
    const under = estimateUsdCost(summaryOf(1_000_000, 0), { cacheHitRatio: -1 });
    expect(under.inputCost).toBeCloseTo(3.0, 6); // clamped to 0
    const nan = estimateUsdCost(summaryOf(1_000_000, 0), { cacheHitRatio: Number.NaN });
    expect(nan.inputCost).toBeCloseTo(3.0, 6); // treated as 0
  });

  it("zero cacheHitRatio matches the no-cache path exactly", () => {
    const a = estimateUsdCost(summaryOf(500_000, 200_000), { cacheHitRatio: 0 });
    const b = estimateUsdCost(summaryOf(500_000, 200_000));
    expect(a.totalCost).toBeCloseTo(b.totalCost, 9);
  });

  it("keeps DEFAULT_OUTPUT_COST_PER_1M usable as the Sonnet output rate", () => {
    const cost = estimateUsdCost(summaryOf(0, 1_000_000), {
      outputCostPer1M: DEFAULT_OUTPUT_COST_PER_1M,
    });
    expect(cost.outputCost).toBeCloseTo(15.0, 6);
  });
});
