import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, it, expect } from "vitest";
import {
  // Finding #63 — Reasoning block persistence
  createPhaseReasoning,
  appendReasoningBlock,
  summarizeReasoning,

  // Finding #64 — Per-phase token estimation
  estimateTokens,
  createPhaseTokenEstimate,
  createTokenSummary,
  formatTokenSummary,
  CHARS_PER_TOKEN,
  type PhaseTokenEstimate,

  // Finding #65 — Replay guidance
  createReplayGuidance,
  addReplayStep,
  formatReplayGuidance,
  type ReplayGuidance,

  // P7 — Efficiency telemetry
  isEfficiencyTelemetryEnabled,
  recordEfficiencyEvent,
  type EfficiencyEvent,

  // Decision 24 — Cost-visibility telemetry hooks
  // D15-SA15.3-03 — default-on spawn telemetry + sink reachability
  isSpawnTelemetryEnabled,
  recordSubAgentSpawn,
  recordPhaseDuration,
  recordTokenCost,
  checkSpawnTelemetryReachability,
  type SubAgentSpawnEvent,
  type PhaseDurationEvent,

  // D6-SA6.3-05 — observed output:input token ratio
  DEFAULT_OUTPUT_INPUT_TOKEN_RATIO,
  observedOutputInputRatio,

  // D7-SA7.4-F-6 / D7-25 — Phase handoff metrics
  createPhaseHandoffMetrics,
  formatPhaseHandoffWarning,
  PHASE_HANDOFF_LOSS_WARN_THRESHOLD,
} from "../../pipeline/observability.js";

// ── Reasoning Block Persistence (Finding #63) ────────────────────

describe("createPhaseReasoning", () => {
  it("should create an empty reasoning container", () => {
    const reasoning = createPhaseReasoning("review");
    expect(reasoning.phase).toBe("review");
    expect(reasoning.blocks).toHaveLength(0);
    expect(reasoning.totalChars).toBe(0);
  });

  it("should accept any valid PhaseName", () => {
    const phases = ["generation", "merge", "review", "fix", "validation", "integrity", "adapter"] as const;
    for (const phase of phases) {
      const r = createPhaseReasoning(phase);
      expect(r.phase).toBe(phase);
    }
  });
});

describe("appendReasoningBlock", () => {
  it("should append a block and update totalChars", () => {
    let reasoning = createPhaseReasoning("generation");
    reasoning = appendReasoningBlock(reasoning, "analysis", "File X needs refactoring.");
    expect(reasoning.blocks).toHaveLength(1);
    expect(reasoning.blocks[0].index).toBe(0);
    expect(reasoning.blocks[0].category).toBe("analysis");
    expect(reasoning.blocks[0].content).toBe("File X needs refactoring.");
    expect(reasoning.totalChars).toBe("File X needs refactoring.".length);
  });

  it("should auto-increment the block index", () => {
    let reasoning = createPhaseReasoning("merge");
    reasoning = appendReasoningBlock(reasoning, "decision", "Block A");
    reasoning = appendReasoningBlock(reasoning, "risk-assessment", "Block B");
    reasoning = appendReasoningBlock(reasoning, "analysis", "Block C");
    expect(reasoning.blocks.map((b) => b.index)).toEqual([0, 1, 2]);
  });

  it("should accumulate totalChars across blocks", () => {
    let reasoning = createPhaseReasoning("fix");
    reasoning = appendReasoningBlock(reasoning, "a", "1234");   // 4 chars
    reasoning = appendReasoningBlock(reasoning, "b", "567890"); // 6 chars
    expect(reasoning.totalChars).toBe(10);
  });

  it("should set a timestamp on each block", () => {
    let reasoning = createPhaseReasoning("validation");
    reasoning = appendReasoningBlock(reasoning, "analysis", "some content");
    expect(reasoning.blocks[0].timestamp).toBeTruthy();
    // Should be a valid ISO string
    expect(new Date(reasoning.blocks[0].timestamp).toISOString()).toBe(
      reasoning.blocks[0].timestamp,
    );
  });

  it("should not mutate the original reasoning object", () => {
    const original = createPhaseReasoning("integrity");
    const updated = appendReasoningBlock(original, "check", "hello");
    expect(original.blocks).toHaveLength(0);
    expect(original.totalChars).toBe(0);
    expect(updated.blocks).toHaveLength(1);
  });
});

describe("summarizeReasoning", () => {
  it("should report no blocks when empty", () => {
    const reasoning = createPhaseReasoning("adapter");
    const summary = summarizeReasoning(reasoning);
    expect(summary).toContain("adapter");
    expect(summary).toContain("no reasoning blocks captured");
  });

  it("should include block count and total chars", () => {
    let reasoning = createPhaseReasoning("review");
    reasoning = appendReasoningBlock(reasoning, "analysis", "Content here");
    const summary = summarizeReasoning(reasoning);
    expect(summary).toContain("1 reasoning block(s)");
    expect(summary).toContain(`${reasoning.totalChars} chars total`);
  });

  it("should preview long content with ellipsis", () => {
    let reasoning = createPhaseReasoning("generation");
    const longContent = "A".repeat(200);
    reasoning = appendReasoningBlock(reasoning, "analysis", longContent);
    const summary = summarizeReasoning(reasoning);
    expect(summary).toContain("...");
    // The preview should be 120 chars + "..."
    expect(summary).toContain("A".repeat(120) + "...");
  });

  it("should not add ellipsis for short content", () => {
    let reasoning = createPhaseReasoning("merge");
    reasoning = appendReasoningBlock(reasoning, "decision", "Short text");
    const summary = summarizeReasoning(reasoning);
    expect(summary).toContain("Short text");
    expect(summary).not.toContain("...");
  });

  it("should include category for each block", () => {
    let reasoning = createPhaseReasoning("fix");
    reasoning = appendReasoningBlock(reasoning, "risk-assessment", "Check this");
    const summary = summarizeReasoning(reasoning);
    expect(summary).toContain("(risk-assessment)");
  });
});

// ── Per-Phase Token Estimation (Finding #64) ─────────────────────

describe("estimateTokens", () => {
  it("should return 0 for 0 chars", () => {
    expect(estimateTokens(0)).toBe(0);
  });

  it("should return 0 for negative chars", () => {
    expect(estimateTokens(-100)).toBe(0);
  });

  it("should estimate using default CHARS_PER_TOKEN", () => {
    // 100 chars / 4 chars per token = 25 tokens
    expect(estimateTokens(100)).toBe(25);
  });

  it("should round up to the nearest integer", () => {
    // 5 chars / 4 = 1.25 -> ceil -> 2
    expect(estimateTokens(5)).toBe(2);
  });

  it("should use a custom chars-per-token ratio", () => {
    // 100 chars / 3.5 chars per token = 28.57 -> ceil -> 29
    expect(estimateTokens(100, 3.5)).toBe(29);
  });

  it("should handle 1 char input", () => {
    // 1 / 4 = 0.25 -> ceil -> 1
    expect(estimateTokens(1)).toBe(1);
  });
});

describe("CHARS_PER_TOKEN", () => {
  it("should be 4", () => {
    expect(CHARS_PER_TOKEN).toBe(4);
  });
});

describe("createPhaseTokenEstimate", () => {
  it("should compute token estimates from character counts", () => {
    const est = createPhaseTokenEstimate("generation", 400, 200);
    expect(est.phase).toBe("generation");
    expect(est.inputTokens).toBe(100);  // 400 / 4
    expect(est.outputTokens).toBe(50);  // 200 / 4
    expect(est.totalTokens).toBe(150);
  });

  it("should handle zero input/output", () => {
    const est = createPhaseTokenEstimate("merge", 0, 0);
    expect(est.inputTokens).toBe(0);
    expect(est.outputTokens).toBe(0);
    expect(est.totalTokens).toBe(0);
  });

  it("should accept custom charsPerToken", () => {
    const est = createPhaseTokenEstimate("review", 100, 50, 2);
    expect(est.inputTokens).toBe(50);   // 100 / 2
    expect(est.outputTokens).toBe(25);  // 50 / 2
    expect(est.totalTokens).toBe(75);
  });
});

describe("createTokenSummary", () => {
  it("should aggregate multiple phase estimates", () => {
    const phases: PhaseTokenEstimate[] = [
      createPhaseTokenEstimate("generation", 400, 200),  // 100 in, 50 out
      createPhaseTokenEstimate("review", 800, 400),      // 200 in, 100 out
    ];
    const summary = createTokenSummary(phases);
    expect(summary.phases).toHaveLength(2);
    expect(summary.totalInputTokens).toBe(300);
    expect(summary.totalOutputTokens).toBe(150);
    expect(summary.grandTotal).toBe(450);
  });

  it("should handle empty phases array", () => {
    const summary = createTokenSummary([]);
    expect(summary.phases).toHaveLength(0);
    expect(summary.grandTotal).toBe(0);
  });

  it("should not mutate the input array", () => {
    const phases: PhaseTokenEstimate[] = [
      createPhaseTokenEstimate("adapter", 100, 50),
    ];
    const summary = createTokenSummary(phases);
    expect(summary.phases).not.toBe(phases);
    expect(summary.phases).toEqual(phases);
  });
});

describe("formatTokenSummary", () => {
  it("should produce a readable summary", () => {
    const summary = createTokenSummary([
      createPhaseTokenEstimate("generation", 400, 200),
      createPhaseTokenEstimate("review", 800, 400),
    ]);
    const formatted = formatTokenSummary(summary);
    expect(formatted).toContain("Token usage: 450 total");
    expect(formatted).toContain("300 in");
    expect(formatted).toContain("150 out");
    expect(formatted).toContain("generation:");
    expect(formatted).toContain("review:");
  });

  it("should handle empty summary", () => {
    const summary = createTokenSummary([]);
    const formatted = formatTokenSummary(summary);
    expect(formatted).toContain("Token usage: 0 total");
  });
});

// ── Replay Guidance (Finding #65) ────────────────────────────────

describe("createReplayGuidance", () => {
  it("should create guidance with mandatory fields", () => {
    const guidance = createReplayGuidance(
      "abc-123",
      "review",
      "Review timed out after 10 minutes",
    );
    expect(guidance.correlationId).toBe("abc-123");
    expect(guidance.failedPhase).toBe("review");
    expect(guidance.failureDescription).toBe("Review timed out after 10 minutes");
    expect(guidance.originalRunTimestamp).toBeTruthy();
    expect(guidance.replaySteps.length).toBeGreaterThan(0);
    expect(guidance.environmentSnapshot).toEqual({});
    expect(guidance.relevantFiles).toEqual([]);
    expect(guidance.gitRef).toBeUndefined();
  });

  it("should include git ref in steps when provided", () => {
    const guidance = createReplayGuidance(
      "def-456",
      "generation",
      "OOM during generation",
      { gitRef: "abc1234" },
    );
    expect(guidance.gitRef).toBe("abc1234");
    const checkoutStep = guidance.replaySteps.find((s) =>
      s.instruction.includes("git checkout"),
    );
    expect(checkoutStep).toBeDefined();
    expect(checkoutStep!.instruction).toContain("abc1234");
  });

  it("should include relevant files when provided", () => {
    const guidance = createReplayGuidance(
      "ghi-789",
      "fix",
      "Fixer could not resolve type errors",
      { relevantFiles: ["src/foo.ts", "src/bar.ts"] },
    );
    expect(guidance.relevantFiles).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("should include environment snapshot when provided", () => {
    const guidance = createReplayGuidance(
      "jkl-012",
      "validation",
      "Tests failed",
      { environmentSnapshot: { NODE_ENV: "test", CI: "true" } },
    );
    expect(guidance.environmentSnapshot).toEqual({
      NODE_ENV: "test",
      CI: "true",
    });
  });

  it("should generate sequential step numbers", () => {
    const guidance = createReplayGuidance("seq-test", "merge", "Merge conflict");
    const stepNumbers = guidance.replaySteps.map((s) => s.stepNumber);
    for (let i = 1; i < stepNumbers.length; i++) {
      expect(stepNumbers[i]).toBe(stepNumbers[i - 1] + 1);
    }
  });

  it("should always include install and re-run steps", () => {
    const guidance = createReplayGuidance("basic", "adapter", "Adapter crashed");
    const instructions = guidance.replaySteps.map((s) => s.instruction);
    expect(instructions.some((i) => i.includes("Install dependencies"))).toBe(true);
    expect(instructions.some((i) => i.includes("Re-run the pipeline"))).toBe(true);
    expect(instructions.some((i) => i.includes("adapter"))).toBe(true);
  });
});

describe("addReplayStep", () => {
  it("should append a step and return new guidance", () => {
    const original = createReplayGuidance("add-step", "review", "Failed");
    const originalStepCount = original.replaySteps.length;
    const updated = addReplayStep(original, "Check the log file", "Find error trace");
    expect(updated.replaySteps).toHaveLength(originalStepCount + 1);
    const lastStep = updated.replaySteps[updated.replaySteps.length - 1];
    expect(lastStep.instruction).toBe("Check the log file");
    expect(lastStep.expectedOutcome).toBe("Find error trace");
  });

  it("should not mutate the original guidance", () => {
    const original = createReplayGuidance("immutable", "fix", "Failed");
    const originalCount = original.replaySteps.length;
    addReplayStep(original, "Extra step");
    expect(original.replaySteps).toHaveLength(originalCount);
  });

  it("should auto-increment step number", () => {
    let guidance = createReplayGuidance("inc-test", "validation", "Failed");
    const lastOriginal = guidance.replaySteps[guidance.replaySteps.length - 1].stepNumber;
    guidance = addReplayStep(guidance, "Step A");
    guidance = addReplayStep(guidance, "Step B");
    const addedSteps = guidance.replaySteps.slice(-2);
    expect(addedSteps[0].stepNumber).toBe(lastOriginal + 1);
    expect(addedSteps[1].stepNumber).toBe(lastOriginal + 2);
  });

  it("should allow undefined expectedOutcome", () => {
    const guidance = createReplayGuidance("opt", "merge", "Failed");
    const updated = addReplayStep(guidance, "Do something");
    const lastStep = updated.replaySteps[updated.replaySteps.length - 1];
    expect(lastStep.expectedOutcome).toBeUndefined();
  });

  it("should handle empty replaySteps gracefully", () => {
    // Construct guidance with no steps to test edge case
    const guidance: ReplayGuidance = {
      correlationId: "empty-steps",
      originalRunTimestamp: new Date().toISOString(),
      failedPhase: "review",
      failureDescription: "Failed",
      replaySteps: [],
      environmentSnapshot: {},
      relevantFiles: [],
    };
    const updated = addReplayStep(guidance, "First step");
    expect(updated.replaySteps).toHaveLength(1);
    expect(updated.replaySteps[0].stepNumber).toBe(1);
  });
});

describe("formatReplayGuidance", () => {
  it("should produce a readable multi-line string", () => {
    const guidance = createReplayGuidance(
      "fmt-test",
      "review",
      "Timeout in review phase",
      {
        gitRef: "deadbeef",
        relevantFiles: ["src/app.ts"],
        environmentSnapshot: { CI: "true" },
      },
    );
    const formatted = formatReplayGuidance(guidance);
    expect(formatted).toContain("fmt-test");
    expect(formatted).toContain("review");
    expect(formatted).toContain("Timeout in review phase");
    expect(formatted).toContain("deadbeef");
    expect(formatted).toContain("src/app.ts");
    expect(formatted).toContain("CI");
    expect(formatted).toContain("Steps:");
  });

  it("should omit git ref line when not provided", () => {
    const guidance = createReplayGuidance("no-ref", "merge", "Failure");
    const formatted = formatReplayGuidance(guidance);
    expect(formatted).not.toContain("Git ref:");
  });

  it("should omit relevant files line when empty", () => {
    const guidance = createReplayGuidance("no-files", "fix", "Failure");
    const formatted = formatReplayGuidance(guidance);
    expect(formatted).not.toContain("Relevant files:");
  });

  it("should omit environment keys line when empty", () => {
    const guidance = createReplayGuidance("no-env", "adapter", "Failure");
    const formatted = formatReplayGuidance(guidance);
    expect(formatted).not.toContain("Environment keys:");
  });

  it("should include expected outcomes with arrow prefix", () => {
    const guidance = createReplayGuidance("arrows", "validation", "Failure");
    const formatted = formatReplayGuidance(guidance);
    // The default steps have expectedOutcome values
    expect(formatted).toContain("->");
  });
});

// ── Efficiency telemetry (P7) ────────────────────────────────────

describe("recordEfficiencyEvent", () => {
  const ENV_KEY = "HATCH3R_EFFICIENCY_TELEMETRY";
  let tmpRoot: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "hatch3r-eff-"));
    originalEnv = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = originalEnv;
    }
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  const sampleEvent: EfficiencyEvent = {
    artifactId: "hatch3r-quick-change",
    phase: "triage",
    tokensIn: 1200,
    tokensOut: 350,
    latencyMs: 4200,
    modelHint: "claude-opus-4-7",
    cacheHit: true,
  };

  it("is a no-op when HATCH3R_EFFICIENCY_TELEMETRY is unset", () => {
    expect(isEfficiencyTelemetryEnabled()).toBe(false);
    recordEfficiencyEvent(sampleEvent, tmpRoot);
    const logPath = join(tmpRoot, ".hatch3r", "efficiency-events.jsonl");
    expect(existsSync(logPath)).toBe(false);
  });

  it("appends a JSONL line per event when telemetry is enabled", () => {
    process.env[ENV_KEY] = "1";
    expect(isEfficiencyTelemetryEnabled()).toBe(true);

    recordEfficiencyEvent(sampleEvent, tmpRoot);
    recordEfficiencyEvent(
      { ...sampleEvent, phase: "act", tokensIn: 800, tokensOut: 120 },
      tmpRoot,
    );

    const logPath = join(tmpRoot, ".hatch3r", "efficiency-events.jsonl");
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]) as EfficiencyEvent;
    expect(first.artifactId).toBe("hatch3r-quick-change");
    expect(first.phase).toBe("triage");
    expect(first.tokensIn).toBe(1200);
    expect(first.tokensOut).toBe(350);
    expect(first.latencyMs).toBe(4200);
    expect(first.modelHint).toBe("claude-opus-4-7");
    expect(first.cacheHit).toBe(true);

    const second = JSON.parse(lines[1]) as EfficiencyEvent;
    expect(second.phase).toBe("act");
    expect(second.tokensIn).toBe(800);
  });

  it("does not throw when the project root is unwritable", () => {
    process.env[ENV_KEY] = "1";
    // /dev/null is not a directory and cannot host a .hatch3r/ subtree, so
    // mkdirSync + appendFileSync inside recordEfficiencyEvent will fail.
    // The Silent Failure Contract requires we swallow without re-throwing.
    const unwritableRoot = "/dev/null/definitely-not-a-directory";
    expect(() => recordEfficiencyEvent(sampleEvent, unwritableRoot)).not.toThrow();
  });
});

// ── Cost-visibility telemetry hooks (Decision 24) ────────────────

describe("recordSubAgentSpawn", () => {
  const ENV_KEY = "HATCH3R_EFFICIENCY_TELEMETRY";
  let tmpRoot: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "hatch3r-spawn-"));
    originalEnv = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  // D15-SA15.3-03: spawn telemetry is ON by default (Strong-Observability
  // posture) — the old contract (no-op when the env-gate is unset) is
  // deliberately inverted here.
  it("records by default when the telemetry env var is unset", () => {
    expect(isSpawnTelemetryEnabled()).toBe(true);
    recordSubAgentSpawn("session-1", "hatch3r-feature-plan", 3, "parallel slices", tmpRoot);
    const logPath = join(tmpRoot, ".hatch3r", "efficiency-events.jsonl");
    expect(existsSync(logPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(logPath, "utf-8").trim()) as SubAgentSpawnEvent;
    expect(parsed.type).toBe("subagent_spawn");
    expect(parsed.count).toBe(3);
    expect(parsed.rationale).toBe("parallel slices");
  });

  it("is a no-op under the explicit HATCH3R_EFFICIENCY_TELEMETRY=0 opt-out", () => {
    process.env[ENV_KEY] = "0";
    expect(isSpawnTelemetryEnabled()).toBe(false);
    recordSubAgentSpawn("session-1", "hatch3r-feature-plan", 3, "parallel slices", tmpRoot);
    const logPath = join(tmpRoot, ".hatch3r", "efficiency-events.jsonl");
    expect(existsSync(logPath)).toBe(false);
  });

  it("keeps spawn ON while token/latency events stay opt-in when the env var is unset", () => {
    // Split-posture contract: with the env var unset, one spawn + one
    // efficiency event must yield exactly ONE line — the spawn.
    recordSubAgentSpawn("split-sess", "hatch3r-x", 2, "two slices", tmpRoot);
    recordEfficiencyEvent(
      { artifactId: "hatch3r-x", phase: "act", tokensIn: 100, tokensOut: 25, latencyMs: 10 },
      tmpRoot,
    );
    const logPath = join(tmpRoot, ".hatch3r", "efficiency-events.jsonl");
    const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect((JSON.parse(lines[0]) as SubAgentSpawnEvent).type).toBe("subagent_spawn");
  });

  it("appends a subagent_spawn JSONL line when telemetry is enabled", () => {
    process.env[ENV_KEY] = "1";
    recordSubAgentSpawn("session-2", "hatch3r-feature-plan", 4, "fan-out for 4 modules", tmpRoot);

    const logPath = join(tmpRoot, ".hatch3r", "efficiency-events.jsonl");
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as SubAgentSpawnEvent;
    expect(parsed.type).toBe("subagent_spawn");
    expect(parsed.sessionId).toBe("session-2");
    expect(parsed.artifactId).toBe("hatch3r-feature-plan");
    expect(parsed.count).toBe(4);
    expect(parsed.rationale).toBe("fan-out for 4 modules");
    expect(parsed.timestamp).toBeTruthy();
  });

  it("clamps negative count to 0", () => {
    process.env[ENV_KEY] = "1";
    recordSubAgentSpawn("neg-count", "hatch3r-x", -3, "bug", tmpRoot);

    const logPath = join(tmpRoot, ".hatch3r", "efficiency-events.jsonl");
    const parsed = JSON.parse(readFileSync(logPath, "utf-8").trim()) as SubAgentSpawnEvent;
    expect(parsed.count).toBe(0);
  });

  it("does not throw when the project root is unwritable", () => {
    process.env[ENV_KEY] = "1";
    const unwritable = "/dev/null/definitely-not-a-directory";
    expect(() =>
      recordSubAgentSpawn("sess", "hatch3r-x", 1, "test", unwritable),
    ).not.toThrow();
  });
});

describe("recordPhaseDuration", () => {
  const ENV_KEY = "HATCH3R_EFFICIENCY_TELEMETRY";
  let tmpRoot: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "hatch3r-phase-"));
    originalEnv = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("is a no-op when telemetry is disabled", () => {
    recordPhaseDuration("session-x", "hatch3r-feature-plan", "triage", 4200, tmpRoot);
    const logPath = join(tmpRoot, ".hatch3r", "efficiency-events.jsonl");
    expect(existsSync(logPath)).toBe(false);
  });

  it("appends a phase_duration JSONL line when telemetry is enabled", () => {
    process.env[ENV_KEY] = "1";
    recordPhaseDuration("session-y", "hatch3r-bug-plan", "review", 65_000, tmpRoot);

    const logPath = join(tmpRoot, ".hatch3r", "efficiency-events.jsonl");
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as PhaseDurationEvent;
    expect(parsed.type).toBe("phase_duration");
    expect(parsed.sessionId).toBe("session-y");
    expect(parsed.artifactId).toBe("hatch3r-bug-plan");
    expect(parsed.phase).toBe("review");
    expect(parsed.durationMs).toBe(65_000);
    expect(parsed.timestamp).toBeTruthy();
  });

  it("clamps non-finite duration to 0", () => {
    process.env[ENV_KEY] = "1";
    recordPhaseDuration("sess", "hatch3r-x", "act", Number.NaN, tmpRoot);
    const logPath = join(tmpRoot, ".hatch3r", "efficiency-events.jsonl");
    const parsed = JSON.parse(readFileSync(logPath, "utf-8").trim()) as PhaseDurationEvent;
    expect(parsed.durationMs).toBe(0);
  });

  it("interleaves with subagent_spawn events in the same log file", () => {
    process.env[ENV_KEY] = "1";
    recordSubAgentSpawn("mixed-sess", "hatch3r-x", 2, "two slices", tmpRoot);
    recordPhaseDuration("mixed-sess", "hatch3r-x", "plan", 10_000, tmpRoot);
    recordSubAgentSpawn("mixed-sess", "hatch3r-x", 3, "three more", tmpRoot);

    const logPath = join(tmpRoot, ".hatch3r", "efficiency-events.jsonl");
    const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    const types = lines.map((l) => (JSON.parse(l) as { type: string }).type);
    expect(types).toEqual(["subagent_spawn", "phase_duration", "subagent_spawn"]);
  });
});

describe("recordTokenCost", () => {
  const ENV_KEY = "HATCH3R_EFFICIENCY_TELEMETRY";
  let tmpRoot: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "hatch3r-token-"));
    originalEnv = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("forwards to the existing efficiency-event channel as an EfficiencyEvent", () => {
    process.env[ENV_KEY] = "1";
    recordTokenCost("hatch3r-feature-plan", "act", 1200, 350, {
      latencyMs: 5_000,
      modelHint: "claude-opus-4-7",
      cacheHit: false,
      projectRoot: tmpRoot,
    });

    const logPath = join(tmpRoot, ".hatch3r", "efficiency-events.jsonl");
    expect(existsSync(logPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(logPath, "utf-8").trim()) as EfficiencyEvent;
    expect(parsed.artifactId).toBe("hatch3r-feature-plan");
    expect(parsed.phase).toBe("act");
    expect(parsed.tokensIn).toBe(1200);
    expect(parsed.tokensOut).toBe(350);
    expect(parsed.latencyMs).toBe(5_000);
    expect(parsed.modelHint).toBe("claude-opus-4-7");
    expect(parsed.cacheHit).toBe(false);
  });

  it("uses default latencyMs of 0 when unspecified", () => {
    process.env[ENV_KEY] = "1";
    recordTokenCost("hatch3r-x", "triage", 100, 50, { projectRoot: tmpRoot });
    const logPath = join(tmpRoot, ".hatch3r", "efficiency-events.jsonl");
    const parsed = JSON.parse(readFileSync(logPath, "utf-8").trim()) as EfficiencyEvent;
    expect(parsed.latencyMs).toBe(0);
  });

  it("clamps negative token counts to 0", () => {
    process.env[ENV_KEY] = "1";
    recordTokenCost("hatch3r-x", "act", -50, -10, { projectRoot: tmpRoot });
    const logPath = join(tmpRoot, ".hatch3r", "efficiency-events.jsonl");
    const parsed = JSON.parse(readFileSync(logPath, "utf-8").trim()) as EfficiencyEvent;
    expect(parsed.tokensIn).toBe(0);
    expect(parsed.tokensOut).toBe(0);
  });
});

// ── Telemetry gates (D15-SA15.3-03 split posture) ────────────────

describe("isSpawnTelemetryEnabled", () => {
  const ENV_KEY = "HATCH3R_EFFICIENCY_TELEMETRY";
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
  });

  it("defaults to true when the env var is unset", () => {
    expect(isSpawnTelemetryEnabled()).toBe(true);
  });

  it("is false only under the explicit '0' opt-out", () => {
    process.env[ENV_KEY] = "0";
    expect(isSpawnTelemetryEnabled()).toBe(false);
  });

  it("stays true for '1' and other values", () => {
    process.env[ENV_KEY] = "1";
    expect(isSpawnTelemetryEnabled()).toBe(true);
    process.env[ENV_KEY] = "off";
    expect(isSpawnTelemetryEnabled()).toBe(true);
  });

  it("token/latency gate stays strict opt-in (unset and '0' both disable)", () => {
    expect(isEfficiencyTelemetryEnabled()).toBe(false);
    process.env[ENV_KEY] = "0";
    expect(isEfficiencyTelemetryEnabled()).toBe(false);
    process.env[ENV_KEY] = "1";
    expect(isEfficiencyTelemetryEnabled()).toBe(true);
  });
});

// ── Spawn-telemetry sink reachability (D15-SA15.3-03) ────────────

describe("checkSpawnTelemetryReachability", () => {
  const ENV_KEY = "HATCH3R_EFFICIENCY_TELEMETRY";
  let tmpRoot: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "hatch3r-reach-"));
    originalEnv = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("reports reachable for a writable project root at default posture", () => {
    const result = checkSpawnTelemetryReachability(tmpRoot);
    expect(result.enabled).toBe(true);
    expect(result.sinkWritable).toBe(true);
    expect(result.reachable).toBe(true);
    expect(result.sinkPath).toBe(join(tmpRoot, ".hatch3r", "efficiency-events.jsonl"));
  });

  it("does not create the sink as a probe side effect", () => {
    checkSpawnTelemetryReachability(tmpRoot);
    expect(existsSync(join(tmpRoot, ".hatch3r"))).toBe(false);
  });

  it("reports reachable when the sink file already exists", () => {
    mkdirSync(join(tmpRoot, ".hatch3r"), { recursive: true });
    writeFileSync(join(tmpRoot, ".hatch3r", "efficiency-events.jsonl"), "");
    const result = checkSpawnTelemetryReachability(tmpRoot);
    expect(result.reachable).toBe(true);
    expect(result.detail).toContain("appendable");
  });

  it("reports not reachable under the '0' opt-out even when the sink is writable", () => {
    process.env[ENV_KEY] = "0";
    const result = checkSpawnTelemetryReachability(tmpRoot);
    expect(result.enabled).toBe(false);
    expect(result.sinkWritable).toBe(true);
    expect(result.reachable).toBe(false);
    expect(result.detail).toContain("opted out");
  });

  it("reports sink not writable when a file blocks the ancestor path", () => {
    // tmpRoot/blocker is a FILE, so .hatch3r/ can never be created below it.
    const blocker = join(tmpRoot, "blocker");
    writeFileSync(blocker, "");
    const result = checkSpawnTelemetryReachability(join(blocker, "sub"));
    expect(result.sinkWritable).toBe(false);
    expect(result.reachable).toBe(false);
    expect(result.detail).toContain("non-directory ancestor");
  });

  it("reports sink not writable when the sink path exists as a directory", () => {
    mkdirSync(join(tmpRoot, ".hatch3r", "efficiency-events.jsonl"), { recursive: true });
    const result = checkSpawnTelemetryReachability(tmpRoot);
    expect(result.sinkWritable).toBe(false);
    expect(result.detail).toContain("not a regular file");
  });

  it("never throws on hostile roots", () => {
    expect(() =>
      checkSpawnTelemetryReachability("/dev/null/definitely-not-a-directory"),
    ).not.toThrow();
  });
});

// ── Observed output:input token ratio (D6-SA6.3-05) ──────────────

describe("observedOutputInputRatio", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "hatch3r-ratio-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeEvents(lines: string[]): void {
    mkdirSync(join(tmpRoot, ".hatch3r"), { recursive: true });
    writeFileSync(
      join(tmpRoot, ".hatch3r", "efficiency-events.jsonl"),
      lines.join("\n") + "\n",
    );
  }

  function tokenLine(tokensIn: number, tokensOut: number): string {
    return JSON.stringify({
      artifactId: "hatch3r-x",
      phase: "act",
      tokensIn,
      tokensOut,
      latencyMs: 10,
    });
  }

  it("exports the fallback constant at its documented value", () => {
    expect(DEFAULT_OUTPUT_INPUT_TOKEN_RATIO).toBe(0.25);
  });

  it("falls back to the default when no sink exists", () => {
    const result = observedOutputInputRatio(tmpRoot);
    expect(result.basis).toBe("default");
    expect(result.ratio).toBe(DEFAULT_OUTPUT_INPUT_TOKEN_RATIO);
    expect(result.sampleEvents).toBe(0);
  });

  it("derives the observed ratio once the minimum sample is met", () => {
    writeEvents([
      tokenLine(1000, 500),
      tokenLine(1000, 500),
      tokenLine(1000, 500),
      tokenLine(1000, 500),
      tokenLine(1000, 500),
    ]);
    const result = observedOutputInputRatio(tmpRoot);
    expect(result.basis).toBe("observed");
    expect(result.ratio).toBeCloseTo(0.5, 5);
    expect(result.sampleEvents).toBe(5);
    expect(result.totalTokensIn).toBe(5000);
    expect(result.totalTokensOut).toBe(2500);
  });

  it("stays on the default basis below the minimum sample", () => {
    writeEvents([tokenLine(1000, 900), tokenLine(1000, 900), tokenLine(1000, 900)]);
    const result = observedOutputInputRatio(tmpRoot);
    expect(result.basis).toBe("default");
    expect(result.ratio).toBe(DEFAULT_OUTPUT_INPUT_TOKEN_RATIO);
    expect(result.sampleEvents).toBe(3);
  });

  it("skips spawn/duration events and malformed lines", () => {
    writeEvents([
      JSON.stringify({ type: "subagent_spawn", sessionId: "s", artifactId: "a", count: 9, rationale: "r", timestamp: "t" }),
      "{not json",
      JSON.stringify({ type: "phase_duration", sessionId: "s", artifactId: "a", phase: "act", durationMs: 5, timestamp: "t" }),
      tokenLine(100, 80),
      tokenLine(100, 80),
    ]);
    const result = observedOutputInputRatio(tmpRoot, { minSampleEvents: 2 });
    expect(result.basis).toBe("observed");
    expect(result.sampleEvents).toBe(2);
    expect(result.ratio).toBeCloseTo(0.8, 5);
  });

  it("aggregates only the most recent maxEvents lines", () => {
    writeEvents([tokenLine(1000, 100), tokenLine(1000, 500), tokenLine(1000, 500)]);
    const result = observedOutputInputRatio(tmpRoot, { minSampleEvents: 2, maxEvents: 2 });
    expect(result.sampleEvents).toBe(2);
    expect(result.ratio).toBeCloseTo(0.5, 5); // the 0.1-ratio line fell outside the window
  });

  it("ignores non-positive or non-finite token fields", () => {
    writeEvents([
      tokenLine(0, 500),
      JSON.stringify({ artifactId: "a", phase: "p", tokensIn: "many", tokensOut: 5, latencyMs: 1 }),
      tokenLine(200, 100),
      tokenLine(200, 100),
    ]);
    const result = observedOutputInputRatio(tmpRoot, { minSampleEvents: 2 });
    expect(result.sampleEvents).toBe(2);
    expect(result.ratio).toBeCloseTo(0.5, 5);
  });

  it("can report an observed ratio above 1.0 for output-heavy workloads", () => {
    writeEvents([
      tokenLine(100, 300),
      tokenLine(100, 300),
      tokenLine(100, 300),
      tokenLine(100, 300),
      tokenLine(100, 300),
    ]);
    const result = observedOutputInputRatio(tmpRoot);
    expect(result.basis).toBe("observed");
    expect(result.ratio).toBeCloseTo(3.0, 5);
  });

  it("surfaces a detail diagnostic when the sink exists but is unreadable", () => {
    // A directory at the sink path exists (so not ENOENT) but cannot be read
    // as a file — the fallback applies AND the failure is surfaced.
    mkdirSync(join(tmpRoot, ".hatch3r", "efficiency-events.jsonl"), { recursive: true });
    const result = observedOutputInputRatio(tmpRoot);
    expect(result.basis).toBe("default");
    expect(result.ratio).toBe(DEFAULT_OUTPUT_INPUT_TOKEN_RATIO);
    expect(result.detail).toContain("telemetry sink unreadable");
  });

  it("never throws on hostile roots", () => {
    expect(() => observedOutputInputRatio("/dev/null/not-a-dir")).not.toThrow();
  });
});

// ── Phase Handoff Metrics (D7-SA7.4-F-6 / D7-25) ─────────────────

describe("createPhaseHandoffMetrics", () => {
  it("computes the byte-size loss fraction over droppable bytes", () => {
    // 1000 → 600 with no protected bytes: 400 dropped of 1000 droppable = 0.4.
    const m = createPhaseHandoffMetrics("research", "review", 1000, 600, true);
    expect(m.fromPhase).toBe("research");
    expect(m.toPhase).toBe("review");
    expect(m.inputBytes).toBe(1000);
    expect(m.outputBytes).toBe(600);
    expect(m.protectedByteCount).toBe(0);
    expect(m.summarisationApplied).toBe(true);
    expect(m.informationLossEstimate).toBeCloseTo(0.4, 5);
  });

  it("reports 0 loss when the output is not smaller than the input", () => {
    const m = createPhaseHandoffMetrics("research", "review", 500, 800, false);
    expect(m.informationLossEstimate).toBe(0);
  });

  it("reports 0 loss and clamps for zero / negative inputs", () => {
    expect(createPhaseHandoffMetrics("research", "review", 0, 0, false).informationLossEstimate).toBe(0);
    const neg = createPhaseHandoffMetrics("research", "review", -10, -5, false);
    expect(neg.inputBytes).toBe(0);
    expect(neg.outputBytes).toBe(0);
    expect(neg.informationLossEstimate).toBe(0);
  });

  it("clamps the loss fraction to a maximum of 1", () => {
    const m = createPhaseHandoffMetrics("research", "review", 1000, 0, true);
    expect(m.informationLossEstimate).toBe(1);
  });

  // D7-25: protected bytes (compression strategy #4 — security findings) are
  // excluded from both the dropped numerator and the droppable denominator, so
  // dropping whitespace and retaining a security finding no longer score the same.
  it("excludes protected bytes from both numerator and denominator", () => {
    // input 1000 with 200 protected-and-retained; output 600 (= 200 protected
    // + 400 of the 800 droppable). Loss over droppable = (800-400)/800 = 0.5,
    // NOT the naive (1000-600)/1000 = 0.4.
    const m = createPhaseHandoffMetrics("research", "review", 1000, 600, true, 200);
    expect(m.protectedByteCount).toBe(200);
    expect(m.informationLossEstimate).toBeCloseTo(0.5, 5);
  });

  it("reports 0 loss when only protected bytes would otherwise count as dropped", () => {
    // All droppable bytes survive; the size delta is entirely protected bytes
    // that were retained. droppableInput == droppableOutput → 0 loss.
    const m = createPhaseHandoffMetrics("research", "review", 1000, 1000, false, 300);
    expect(m.informationLossEstimate).toBe(0);
  });

  it("clamps protectedByteCount to the input size", () => {
    const m = createPhaseHandoffMetrics("research", "review", 500, 500, false, 9999);
    expect(m.protectedByteCount).toBe(500);
    expect(m.informationLossEstimate).toBe(0);
  });
});

describe("formatPhaseHandoffWarning", () => {
  it("returns null when loss is within the warn threshold", () => {
    const m = createPhaseHandoffMetrics("research", "review", 1000, 800, true); // 0.2
    expect(m.informationLossEstimate).toBeLessThanOrEqual(PHASE_HANDOFF_LOSS_WARN_THRESHOLD);
    expect(formatPhaseHandoffWarning(m)).toBeNull();
  });

  it("returns a one-line warning when loss exceeds the threshold", () => {
    const m = createPhaseHandoffMetrics("research", "review", 1000, 300, true); // 0.7
    const warning = formatPhaseHandoffWarning(m);
    expect(warning).not.toBeNull();
    expect(warning).toContain("research→review");
    expect(warning).toContain("70%");
    expect(warning).toContain("validate critical context survived");
  });

  it("protected-byte exclusion can push loss past the threshold", () => {
    // Same raw bytes as the within-threshold case, but flagging 200 protected
    // bytes raises the droppable-only loss above 0.3 → warning now fires.
    const m = createPhaseHandoffMetrics("research", "review", 1000, 650, true, 200);
    expect(m.informationLossEstimate).toBeGreaterThan(PHASE_HANDOFF_LOSS_WARN_THRESHOLD);
    expect(formatPhaseHandoffWarning(m)).not.toBeNull();
  });
});
