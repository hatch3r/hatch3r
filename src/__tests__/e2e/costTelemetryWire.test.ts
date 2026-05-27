// F3.4-F2 (D3 Cycle 10 Wave 2): integration coverage for the cost-telemetry
// estimate↔actuals wire.
//
// Decision 24 ships costEstimator.ts as the canonical pre-execution-estimate +
// post-execution-actuals module. The finding observed that recordActuals /
// appendTelemetrySnapshot (which gate the iteration-summary cost actuals per
// Decision 28) had no end-to-end test proving the persisted telemetry file
// carries BOTH the estimate and the actuals (plus the computed delta) after a
// run completes. Unit tests cover each helper in isolation; this test exercises
// the full orchestrator-wrap-up path against a real temp project root and reads
// the JSON back from disk.
//
// `hatch3r explain --cost` is a pre-execution PREVIEW and intentionally writes
// no telemetry — the estimate→actuals persistence is an orchestrator wrap-up
// responsibility. This test models that wrap-up: estimate up-front, run, then
// recordActuals with the estimate so the file ends with estimate + actuals +
// delta on one session id.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  estimateCost,
  recordActuals,
  appendTelemetrySnapshot,
  TELEMETRY_DIR_RELATIVE,
} from "../../pipeline/costEstimator.js";

describe("cost telemetry estimate↔actuals wire (Decision 24 / 28)", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "hatch3r-cost-wire-"));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("persists estimate + actuals + delta to .hatch3r/telemetry/<session>.json after a simulated run", () => {
    const sessionId = "wire-session-001";

    // 1. Pre-execution estimate (the figure surfaced up-front in the summary).
    const estimate = estimateCost({ triageTier: "standard", subAgentDeclared: 6 });
    expect(estimate.expected_sa_count).toBe(6);

    // 2. Run completes → orchestrator records actuals WITH the estimate so the
    //    writer computes and persists the delta in the same file.
    const actuals = {
      actual_sa_count: 9, // +50% over the 6 estimate → over_variance
      actual_input_tokens_static_frame: estimate.estimated_input_tokens_static_frame,
      actual_web_research_queries: estimate.estimated_web_research_queries,
      actual_duration_min: estimate.estimated_duration_min,
      recorded_at: new Date().toISOString(),
    };
    const ok = recordActuals(sessionId, actuals, {
      projectRoot,
      estimate,
      orchestrator: "hatch3r-feature-plan",
    });
    expect(ok).toBe(true);

    // 3. Read the telemetry file back from disk and assert it carries BOTH the
    //    estimate and the actuals plus the computed delta and attribution.
    const filePath = join(projectRoot, TELEMETRY_DIR_RELATIVE, `${sessionId}.json`);
    expect(existsSync(filePath)).toBe(true);
    const record = JSON.parse(readFileSync(filePath, "utf-8"));

    expect(record.session_id).toBe(sessionId);
    expect(record.estimate).toBeDefined();
    expect(record.estimate.expected_sa_count).toBe(6);
    expect(record.actuals).toBeDefined();
    expect(record.actuals.actual_sa_count).toBe(9);
    expect(record.delta).toBeDefined();
    // 6 → 9 is +50%, which exceeds the 25% variance threshold.
    expect(record.delta.sa_count_delta).toBe(3);
    expect(record.delta.over_variance).toBe(true);
    expect(record.delta.flagged_fields).toContain("sa_count");
    expect(record.orchestrator).toBe("hatch3r-feature-plan");
    expect(record.updated_at).toBeTruthy();
  });

  it("appendTelemetrySnapshot writes a JSONL stream carrying estimate then estimate+actuals+delta", () => {
    const sessionId = "wire-session-jsonl";
    const estimate = estimateCost({ triageTier: "light" });

    // Phase 1: estimate-only snapshot (pre-execution).
    expect(appendTelemetrySnapshot(sessionId, { phase: "triage", estimate }, projectRoot)).toBe(true);
    // Phase 2: estimate + actuals snapshot (post-execution) → delta computed.
    expect(
      appendTelemetrySnapshot(
        sessionId,
        {
          phase: "review",
          estimate,
          actuals: {
            actual_sa_count: estimate.expected_sa_count,
            actual_input_tokens_static_frame: estimate.estimated_input_tokens_static_frame,
            actual_web_research_queries: estimate.estimated_web_research_queries,
            actual_duration_min: estimate.estimated_duration_min,
            recorded_at: new Date().toISOString(),
          },
        },
        projectRoot,
      ),
    ).toBe(true);

    const filePath = join(projectRoot, TELEMETRY_DIR_RELATIVE, `${sessionId}.jsonl`);
    const lines = readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first.phase).toBe("triage");
    expect(first.estimate).toBeDefined();
    expect(first.actuals).toBeUndefined();
    expect(first.delta).toBeUndefined();

    const second = JSON.parse(lines[1]);
    expect(second.phase).toBe("review");
    expect(second.estimate).toBeDefined();
    expect(second.actuals).toBeDefined();
    expect(second.delta).toBeDefined();
    // Estimate == actuals here → zero delta, no over-variance.
    expect(second.delta.over_variance).toBe(false);

    // The JSONL and the per-session JSON share the same session-id namespace.
    expect(first.session_id).toBe(sessionId);
    expect(second.session_id).toBe(sessionId);
  });
});
