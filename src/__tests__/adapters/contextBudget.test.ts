import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  checkContextBudget,
  formatBudgetWarning,
  CONTEXT_BUDGET_TOKENS,
} from "../../adapters/contextBudget.js";
import type { AdapterOutput, Tool } from "../../types.js";
import { TOOLS } from "../../types.js";

function makeOutput(content: string): AdapterOutput {
  return { path: "test.md", content, action: "create" };
}

describe("estimateTokens", () => {
  it("estimates 1 token per 4 characters", () => {
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(8)).toBe(2);
    expect(estimateTokens(100)).toBe(25);
  });

  it("rounds up for non-divisible lengths", () => {
    expect(estimateTokens(1)).toBe(1);
    expect(estimateTokens(5)).toBe(2);
    expect(estimateTokens(7)).toBe(2);
    expect(estimateTokens(9)).toBe(3);
  });

  it("returns 0 for empty input", () => {
    expect(estimateTokens(0)).toBe(0);
  });
});

describe("CONTEXT_BUDGET_TOKENS", () => {
  it("has an entry for every supported tool", () => {
    for (const tool of TOOLS) {
      expect(CONTEXT_BUDGET_TOKENS[tool]).toBeGreaterThan(0);
    }
  });

  it("has expected values for key platforms", () => {
    expect(CONTEXT_BUDGET_TOKENS.claude).toBe(200_000);
    expect(CONTEXT_BUDGET_TOKENS.cursor).toBe(120_000);
    expect(CONTEXT_BUDGET_TOKENS.copilot).toBe(64_000);
    expect(CONTEXT_BUDGET_TOKENS.codex).toBe(200_000);
    expect(CONTEXT_BUDGET_TOKENS.windsurf).toBe(128_000);
  });
});

describe("checkContextBudget", () => {
  it("reports under budget when output is small", () => {
    const outputs = [makeOutput("Hello world")]; // 11 chars -> ~3 tokens
    const result = checkContextBudget("claude", outputs);

    expect(result.tool).toBe("claude");
    expect(result.exceedsBudget).toBe(false);
    expect(result.estimatedTokens).toBeLessThan(result.budgetTokens);
    expect(result.budgetTokens).toBe(200_000);
    expect(result.utilizationPercent).toBeLessThan(1);
  });

  it("reports over budget when output exceeds context window", () => {
    // Create content that exceeds 64K tokens for copilot (~256K chars)
    const largeContent = "x".repeat(300_000);
    const outputs = [makeOutput(largeContent)];
    const result = checkContextBudget("copilot", outputs);

    expect(result.exceedsBudget).toBe(true);
    expect(result.estimatedTokens).toBe(75_000);
    expect(result.budgetTokens).toBe(64_000);
    expect(result.utilizationPercent).toBeGreaterThan(100);
  });

  it("sums content across multiple outputs", () => {
    // 2 outputs of 150K chars each = 300K chars total = 75K tokens
    // Should exceed copilot's 64K budget
    const outputs = [
      makeOutput("a".repeat(150_000)),
      makeOutput("b".repeat(150_000)),
    ];
    const result = checkContextBudget("copilot", outputs);

    expect(result.estimatedTokens).toBe(75_000);
    expect(result.exceedsBudget).toBe(true);
  });

  it("handles empty outputs", () => {
    const result = checkContextBudget("claude", []);

    expect(result.estimatedTokens).toBe(0);
    expect(result.exceedsBudget).toBe(false);
    expect(result.utilizationPercent).toBe(0);
  });

  it("reports exact boundary correctly", () => {
    // Exactly at budget: 64K tokens = 256K chars for copilot
    const exactContent = "x".repeat(256_000);
    const outputs = [makeOutput(exactContent)];
    const result = checkContextBudget("copilot", outputs);

    expect(result.estimatedTokens).toBe(64_000);
    expect(result.exceedsBudget).toBe(false);
    expect(result.utilizationPercent).toBe(100);
  });

  it("reports one char over budget as exceeding", () => {
    // One char over: 256001 chars -> 64001 tokens for copilot
    const content = "x".repeat(256_001);
    const outputs = [makeOutput(content)];
    const result = checkContextBudget("copilot", outputs);

    expect(result.exceedsBudget).toBe(true);
  });
});

describe("formatBudgetWarning", () => {
  it("returns null when budget is not exceeded", () => {
    const result = {
      tool: "claude" as Tool,
      estimatedTokens: 50_000,
      budgetTokens: 200_000,
      exceedsBudget: false,
      utilizationPercent: 25,
    };
    expect(formatBudgetWarning(result)).toBeNull();
  });

  it("returns a warning message when budget is exceeded", () => {
    const result = {
      tool: "copilot" as Tool,
      estimatedTokens: 80_000,
      budgetTokens: 64_000,
      exceedsBudget: true,
      utilizationPercent: 125,
    };
    const warning = formatBudgetWarning(result);

    expect(warning).not.toBeNull();
    expect(warning).toContain("copilot");
    expect(warning).toContain("~80K tokens");
    expect(warning).toContain("64K token context budget");
    expect(warning).toContain("125% utilization");
    // C7.5-W2B2-H22: warning now carries actionable next-step guidance
    expect(warning).toContain("hatch3r sync --minimal");
    expect(warning).toContain("--strict-budget");
  });

  it("includes the tool name in the warning", () => {
    const result = {
      tool: "cursor" as Tool,
      estimatedTokens: 150_000,
      budgetTokens: 120_000,
      exceedsBudget: true,
      utilizationPercent: 125,
    };
    const warning = formatBudgetWarning(result);
    expect(warning).toContain("cursor:");
  });
});
