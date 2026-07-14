import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  countTrackedFiles,
  DEFAULT_INPUT_COST_PER_1M,
  DEFAULT_OUTPUT_COST_PER_1M,
  estimateCost,
  estimateUsdCost,
  formatCostBlock,
  MODEL_RATES,
  recordActuals,
  REPO_SIZE_ROWS,
  resolveModelRate,
  resolveRepoSizeRow,
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

  // ── D6-20: repository-size scaling ─────────────────────────────
  it("omits repo_size_row and leaves the static-frame estimate unscaled when no repoFileCount is passed", () => {
    const est = estimateCost({ triageTier: "standard" });
    const b = TIER_BASELINES.standard;
    // Byte-identical to the pre-D6-20 estimate: midpoint, no band field.
    expect(est.estimated_input_tokens_static_frame).toBe(
      Math.round((b.staticFrameTokensMin + b.staticFrameTokensMax) / 2),
    );
    expect(est.repo_size_row).toBeUndefined();
  });

  it("scales the static-frame component by the resolved band factor and surfaces the row (D6-20)", () => {
    const b = TIER_BASELINES.standard;
    const baseMidpoint = Math.round((b.staticFrameTokensMin + b.staticFrameTokensMax) / 2);
    // 30,000 tracked files -> "large" band (>20k, <=50k), factor 1.6.
    const est = estimateCost({ triageTier: "standard", repoFileCount: 30_000 });
    expect(est.repo_size_row).toEqual({ band: "large", tracked_files: 30_000, factor: 1.6 });
    expect(est.estimated_input_tokens_static_frame).toBe(Math.round(baseMidpoint * 1.6));
    // Repo-size scaling must be strictly larger than the unscaled midpoint here.
    expect(est.estimated_input_tokens_static_frame).toBeGreaterThan(baseMidpoint);
  });

  it("leaves the static-frame estimate unchanged for a tiny repo (factor 1.0) but still surfaces the band", () => {
    const b = TIER_BASELINES.light;
    const baseMidpoint = Math.round((b.staticFrameTokensMin + b.staticFrameTokensMax) / 2);
    const est = estimateCost({ triageTier: "light", repoFileCount: 50 });
    expect(est.repo_size_row).toEqual({ band: "tiny", tracked_files: 50, factor: 1.0 });
    expect(est.estimated_input_tokens_static_frame).toBe(baseMidpoint);
  });

  it("scales an explicit inputTokensDeclared override by the band factor too (D6-20)", () => {
    // 60,000 files -> "huge" band, factor 1.9; the override is the scaling base.
    const est = estimateCost({
      triageTier: "deep",
      inputTokensDeclared: 100_000,
      repoFileCount: 60_000,
    });
    expect(est.repo_size_row?.band).toBe("huge");
    expect(est.estimated_input_tokens_static_frame).toBe(Math.round(100_000 * 1.9));
  });

  it("treats a negative/non-finite repoFileCount as the tiny band, factor 1.0 (defensive)", () => {
    const neg = estimateCost({ triageTier: "standard", repoFileCount: -10 });
    expect(neg.repo_size_row).toEqual({ band: "tiny", tracked_files: 0, factor: 1.0 });
    const b = TIER_BASELINES.standard;
    expect(neg.estimated_input_tokens_static_frame).toBe(
      Math.round((b.staticFrameTokensMin + b.staticFrameTokensMax) / 2),
    );
  });
});

// ── resolveRepoSizeRow (D6-20) ───────────────────────────────────

describe("resolveRepoSizeRow", () => {
  it("maps a count to the correct band across every boundary", () => {
    expect(resolveRepoSizeRow(0).band).toBe("tiny");
    expect(resolveRepoSizeRow(200).band).toBe("tiny"); // inclusive upper bound
    expect(resolveRepoSizeRow(201).band).toBe("small");
    expect(resolveRepoSizeRow(2_000).band).toBe("small");
    expect(resolveRepoSizeRow(2_001).band).toBe("medium");
    expect(resolveRepoSizeRow(20_000).band).toBe("medium");
    expect(resolveRepoSizeRow(20_001).band).toBe("large");
    expect(resolveRepoSizeRow(50_000).band).toBe("large");
    expect(resolveRepoSizeRow(50_001).band).toBe("huge");
    expect(resolveRepoSizeRow(5_000_000).band).toBe("huge");
  });

  it("clamps negative / NaN / Infinity inputs to the tiny band", () => {
    expect(resolveRepoSizeRow(-5).band).toBe("tiny");
    expect(resolveRepoSizeRow(Number.NaN).band).toBe("tiny");
    // +Infinity is finite-false, so it clamps to 0 -> tiny (not "huge").
    expect(resolveRepoSizeRow(Number.POSITIVE_INFINITY).band).toBe("tiny");
  });

  it("exposes a monotonically non-decreasing factor ramp anchored at 1.0", () => {
    expect(REPO_SIZE_ROWS[0].factor).toBe(1.0);
    for (let i = 1; i < REPO_SIZE_ROWS.length; i++) {
      expect(REPO_SIZE_ROWS[i].factor).toBeGreaterThanOrEqual(REPO_SIZE_ROWS[i - 1].factor);
    }
    // The largest band's bound is open-ended.
    expect(REPO_SIZE_ROWS[REPO_SIZE_ROWS.length - 1].maxFiles).toBe(Number.POSITIVE_INFINITY);
  });
});

// ── countTrackedFiles (D6-20) ────────────────────────────────────

describe("countTrackedFiles", () => {
  it("returns null (Silent Failure Contract) for a non-git directory", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hatch3r-nongit-"));
    try {
      // A fresh tmp dir is outside any git tree -> git ls-files exits non-zero.
      expect(countTrackedFiles(tmp)).toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns a positive count for this repository's own working tree", () => {
    // The test runs inside the hatch3r git repo; ls-files must report >0 files
    // and the result must be a finite integer (the in-process NUL counter).
    const n = countTrackedFiles(process.cwd());
    expect(n).not.toBeNull();
    expect(Number.isInteger(n!)).toBe(true);
    expect(n!).toBeGreaterThan(0);
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

  it("omits the repo_size_row block when the estimate carries no band (D6-20)", () => {
    // The shared `estimate` fixture has no repo_size_row -> block must be absent.
    expect(formatCostBlock(estimate)).not.toContain("repo_size_row:");
  });

  it("emits the repo_size_row block when the estimate was repo-size-scaled (D6-20)", () => {
    const scaled = estimateCost({ triageTier: "standard", repoFileCount: 30_000 });
    const out = formatCostBlock(scaled);
    expect(out).toContain("repo_size_row:");
    expect(out).toContain("band: large");
    expect(out).toContain("tracked_files: 30000");
    expect(out).toContain("factor: 1.6");
  });
});

// ── resolveModelRate (D6-18) ─────────────────────────────────────

describe("resolveModelRate", () => {
  it("resolves tier aliases to a model rate (case-insensitive)", () => {
    expect(resolveModelRate("opus")).toEqual(MODEL_RATES["claude-opus-4-8"]);
    expect(resolveModelRate("Sonnet")).toEqual(MODEL_RATES["claude-sonnet-5"]);
    expect(resolveModelRate("  HAIKU  ")).toEqual(MODEL_RATES["claude-haiku-4-5"]);
    expect(resolveModelRate("fable")).toEqual(MODEL_RATES["claude-fable-5"]);
  });

  it("derives the four model-class words through CLAUDE_TIER_MODEL_MAP + alias expansion (release/2.7.0)", () => {
    // economy/standard/advanced/frontier price the exact model the Claude
    // emission path would run (class -> alias -> id), with no shadow map.
    expect(resolveModelRate("economy")).toEqual(MODEL_RATES["claude-haiku-4-5"]);
    expect(resolveModelRate("standard")).toEqual(MODEL_RATES["claude-sonnet-5"]);
    expect(resolveModelRate("advanced")).toEqual(MODEL_RATES["claude-opus-4-8"]);
    expect(resolveModelRate("frontier")).toEqual(MODEL_RATES["claude-fable-5"]);
    // The frontier class prices at the fable rates ($10/$50 per 1M in/out).
    expect(resolveModelRate("frontier")!.inputCostPer1M).toBe(10.0);
    expect(resolveModelRate("frontier")!.outputCostPer1M).toBe(50.0);
  });

  it("resolves the legacy class synonyms via normalizeModelClass (fast/default/strongest/reasoning)", () => {
    expect(resolveModelRate("fast")).toEqual(MODEL_RATES["claude-haiku-4-5"]);
    expect(resolveModelRate("default")).toEqual(MODEL_RATES["claude-sonnet-5"]);
    // 2.6.0 `strongest` normalizes to the frontier class, so it now prices at
    // the top-class (fable) rates rather than the old opus mapping.
    expect(resolveModelRate("strongest")).toEqual(MODEL_RATES["claude-fable-5"]);
    expect(resolveModelRate("reasoning")).toEqual(MODEL_RATES["claude-fable-5"]);
  });

  it("resolves exact model ids", () => {
    expect(resolveModelRate("claude-opus-4-8")).toEqual(MODEL_RATES["claude-opus-4-8"]);
    expect(resolveModelRate("claude-haiku-4-5")).toEqual(MODEL_RATES["claude-haiku-4-5"]);
    expect(resolveModelRate("claude-sonnet-5")).toEqual(MODEL_RATES["claude-sonnet-5"]);
    // The superseded sonnet id keeps its row (existing configs still price).
    expect(resolveModelRate("claude-sonnet-4-6")).toEqual(MODEL_RATES["claude-sonnet-4-6"]);
  });

  it("returns null for an unknown selector", () => {
    expect(resolveModelRate("gpt-4")).toBeNull();
    expect(resolveModelRate("")).toBeNull();
  });

  it("returns null for non-Claude aliases with no rate row (codex/gemini)", () => {
    // `codex`/`gemini-pro` ARE MODEL_ALIASES keys, but their expanded ids
    // carry no MODEL_RATES row — the derivation must fall through to null,
    // not invent a rate.
    expect(resolveModelRate("codex")).toBeNull();
    expect(resolveModelRate("gemini-pro")).toBeNull();
  });

  it("prices Opus higher than the Sonnet-biased default (the D6-18 bug)", () => {
    const opus = resolveModelRate("opus")!;
    // Opus input is $5/1M vs the $3/1M Sonnet default — ~67% higher.
    expect(opus.inputCostPer1M).toBe(5.0);
    expect(opus.inputCostPer1M / DEFAULT_INPUT_COST_PER_1M).toBeCloseTo(5 / 3, 5);
    expect(opus.outputCostPer1M).toBe(25.0);
  });

  it("every rate row carries a valid, non-future accessed date (D6-SA6.3-01)", () => {
    const now = Date.now();
    for (const [id, rate] of Object.entries(MODEL_RATES)) {
      expect(rate.accessed, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const ts = Date.parse(`${rate.accessed}T00:00:00Z`);
      expect(Number.isNaN(ts), `${id} accessed not parseable`).toBe(false);
      // A future provenance date is always wrong regardless of when this runs —
      // a stable invariant, NOT a freshness time-bomb. Row freshness itself is
      // gated by scripts/validate-pricing-currency.ts (D6-SA6.3-01), which now
      // scans MODEL_RATES on the 90-day currency window rather than a unit test.
      expect(ts, `${id} accessed is in the future`).toBeLessThanOrEqual(now);
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

// ── MODEL_RATES ↔ cost-tracking SKILL.md parity (D6-SA6.3-02) ─────
//
// MODEL_RATES (the code-side rate home) and the price table in
// skills/hatch3r-cost-tracking/SKILL.md (the human-facing home) are two physical
// copies, not one generated source. Before this test they had already drifted on
// their `accessed` provenance date (skill 2026-06-05 vs code 2026-06-06). This
// binds them: every model id the SKILL table prices must carry an identical input
// rate, output rate, and accessed date in MODEL_RATES. A re-price applied to one
// home without the other — the realized D6-6 3-5x mispricing class — fails here.

describe("MODEL_RATES ↔ cost-tracking SKILL.md parity (D6-SA6.3-02)", () => {
  interface SkillRateRow {
    id: string;
    inputCostPer1M: number;
    outputCostPer1M: number;
    accessed: string;
  }

  // Path anchored at this test file's own location (not process.cwd()) so it is
  // immune to any chdir a sibling test performs. repo root is three levels up
  // from src/__tests__/pipeline/.
  function parseSkillRateTable(): SkillRateRow[] {
    const skillPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "skills",
      "hatch3r-cost-tracking",
      "SKILL.md",
    );
    const md = readFileSync(skillPath, "utf-8");
    // Match one pricing row: | <name> | `claude-…` | $<in> | $<out> | <YYYY-MM-DD> |
    const rowRe =
      /`(claude-[a-z0-9-]+)`\s*\|\s*\$([\d.]+)\s*\|\s*\$([\d.]+)\s*\|\s*(\d{4}-\d{2}-\d{2})/g;
    const rows: SkillRateRow[] = [];
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(md)) !== null) {
      rows.push({
        id: m[1],
        inputCostPer1M: Number.parseFloat(m[2]),
        outputCostPer1M: Number.parseFloat(m[3]),
        accessed: m[4],
      });
    }
    return rows;
  }

  it("parses the SKILL.md price table (guards against a vacuous match)", () => {
    const rows = parseSkillRateTable();
    // A zero-length parse would make the parity assertions below vacuously pass,
    // so assert the current tier models were actually extracted.
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain("claude-opus-4-8");
    expect(ids).toContain("claude-sonnet-5");
    expect(ids).toContain("claude-sonnet-4-6");
    expect(ids).toContain("claude-haiku-4-5");
    expect(ids).toContain("claude-fable-5");
  });

  it("binds every SKILL.md model id to an identical MODEL_RATES row (rates + accessed date)", () => {
    for (const row of parseSkillRateTable()) {
      const codeRate = MODEL_RATES[row.id];
      // Every model the skill table prices must have a code-side home.
      expect(
        codeRate,
        `${row.id} present in SKILL.md price table but missing from MODEL_RATES`,
      ).toBeDefined();
      // Type-narrow for the property assertions (the toBeDefined above already
      // failed the test when codeRate is undefined, so this never continues).
      if (!codeRate) continue;
      expect(codeRate.inputCostPer1M, `${row.id} input rate drift (SKILL vs MODEL_RATES)`).toBe(
        row.inputCostPer1M,
      );
      expect(codeRate.outputCostPer1M, `${row.id} output rate drift (SKILL vs MODEL_RATES)`).toBe(
        row.outputCostPer1M,
      );
      expect(codeRate.accessed, `${row.id} accessed-date drift (SKILL vs MODEL_RATES)`).toBe(
        row.accessed,
      );
    }
  });
});
