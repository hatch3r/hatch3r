import { describe, it, expect } from "vitest";
import {
  // Finding #63 — Reasoning block persistence
  createPhaseReasoning,
  appendReasoningBlock,
  summarizeReasoning,
  type PhaseReasoning,
  type ReasoningBlock,

  // Finding #64 — Per-phase token estimation
  estimateTokens,
  createPhaseTokenEstimate,
  createTokenSummary,
  formatTokenSummary,
  CHARS_PER_TOKEN,
  type PhaseTokenEstimate,
  type PipelineTokenSummary,

  // Finding #65 — Replay guidance
  createReplayGuidance,
  addReplayStep,
  formatReplayGuidance,
  type ReplayGuidance,
  type ReplayStep,
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
