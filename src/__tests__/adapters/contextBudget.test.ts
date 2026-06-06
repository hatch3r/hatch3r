import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  checkContextBudget,
  formatBudgetWarning,
  isAlwaysLoaded,
  CONTEXT_BUDGET_TOKENS,
} from "../../adapters/contextBudget.js";
import type { AdapterOutput, Tool } from "../../types.js";
import { TOOLS } from "../../types.js";

function out(path: string, content: string): AdapterOutput {
  return { path, content, action: "create" };
}

// Always-loaded output factories per adapter (the slice the budget gate counts).
function claudeAlways(content: string): AdapterOutput {
  return out("CLAUDE.md", content);
}
function cursorAlways(content: string): AdapterOutput {
  return out(".cursor/rules/hatch3r-bridge.mdc", `---\ndescription: x\nalwaysApply: true\n---\n\n${content}`);
}
function copilotAlways(content: string): AdapterOutput {
  return out(".github/copilot-instructions.md", content);
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
  });
});

describe("isAlwaysLoaded", () => {
  // claude
  it("counts CLAUDE.md as always-loaded", () => {
    expect(isAlwaysLoaded("claude", out("CLAUDE.md", "x"))).toBe(true);
  });
  it("counts an unscoped .claude/rules/*.md as always-loaded", () => {
    expect(
      isAlwaysLoaded("claude", out(".claude/rules/30-hatch3r-foo.md", "<!-- HATCH3R:BEGIN -->\nbody\n<!-- HATCH3R:END -->")),
    ).toBe(true);
  });
  it("excludes a paths:-scoped .claude/rules/*.md from always-loaded", () => {
    expect(
      isAlwaysLoaded("claude", out(".claude/rules/30-hatch3r-foo.md", '---\npaths: ["**/*.ts"]\n---\nbody')),
    ).toBe(false);
  });
  it("does not misclassify a claude rule whose BODY quotes paths:", () => {
    // A rule whose body text mentions `paths:` but has no leading paths: fence
    // is still always-loaded (frontmatter does not open with `---\npaths:`).
    expect(
      isAlwaysLoaded("claude", out(".claude/rules/30-hatch3r-foo.md", "body mentions paths: in prose")),
    ).toBe(true);
  });
  it("excludes claude agents/skills/commands/config from always-loaded", () => {
    expect(isAlwaysLoaded("claude", out(".claude/agents/hatch3r-impl.md", "x"))).toBe(false);
    expect(isAlwaysLoaded("claude", out(".claude/skills/hatch3r-foo/SKILL.md", "x"))).toBe(false);
    expect(isAlwaysLoaded("claude", out(".claude/commands/hatch3r-foo.md", "x"))).toBe(false);
    expect(isAlwaysLoaded("claude", out(".claude/settings.json", "{}"))).toBe(false);
  });

  // cursor
  it("counts an alwaysApply: true .cursor/rules/*.mdc as always-loaded", () => {
    expect(
      isAlwaysLoaded("cursor", out(".cursor/rules/50-hatch3r-foo.mdc", "---\ndescription: x\nalwaysApply: true\n---\n\nbody")),
    ).toBe(true);
  });
  it("excludes a globs:-scoped .cursor/rules/*.mdc from always-loaded", () => {
    expect(
      isAlwaysLoaded("cursor", out(".cursor/rules/50-hatch3r-foo.mdc", '---\ndescription: x\nglobs: ["**/*.ts"]\nalwaysApply: false\n---\n\nbody')),
    ).toBe(false);
  });
  it("does not misclassify a cursor rule whose BODY quotes alwaysApply: true", () => {
    expect(
      isAlwaysLoaded("cursor", out(".cursor/rules/50-hatch3r-foo.mdc", "---\ndescription: x\nalwaysApply: false\n---\n\nbody mentions alwaysApply: true here")),
    ).toBe(false);
  });
  it("excludes cursor agents and config from always-loaded", () => {
    expect(isAlwaysLoaded("cursor", out(".cursor/agents/hatch3r-impl.md", "x"))).toBe(false);
    expect(isAlwaysLoaded("cursor", out(".cursor/mcp.json", "{}"))).toBe(false);
  });

  // copilot
  it("counts .github/copilot-instructions.md as always-loaded", () => {
    expect(isAlwaysLoaded("copilot", out(".github/copilot-instructions.md", "x"))).toBe(true);
  });
  it("excludes applyTo-scoped .github/instructions/* from always-loaded", () => {
    expect(
      isAlwaysLoaded("copilot", out(".github/instructions/50-hatch3r-foo.instructions.md", '---\napplyTo: "**/*.ts"\n---\n\nbody')),
    ).toBe(false);
  });
  it("excludes copilot agents/prompts/workflows from always-loaded", () => {
    expect(isAlwaysLoaded("copilot", out(".github/agents/hatch3r-impl.agent.md", "x"))).toBe(false);
    expect(isAlwaysLoaded("copilot", out(".github/prompts/hatch3r-foo.prompt.md", "x"))).toBe(false);
    expect(isAlwaysLoaded("copilot", out(".github/workflows/copilot-setup-steps.yml", "x"))).toBe(false);
  });
});

describe("checkContextBudget", () => {
  it("reports under budget when the always-loaded slice is small", () => {
    const result = checkContextBudget("claude", [claudeAlways("Hello world")]); // 11 chars -> ~3 tokens
    expect(result.tool).toBe("claude");
    expect(result.exceedsBudget).toBe(false);
    expect(result.estimatedTokens).toBeLessThan(result.budgetTokens);
    expect(result.budgetTokens).toBe(200_000);
    expect(result.utilizationPercent).toBeLessThan(1);
  });

  it("reports over budget when the always-loaded slice exceeds the context window", () => {
    // ~300K chars in the always-loaded copilot instructions -> 75K tokens > 64K
    const result = checkContextBudget("copilot", [copilotAlways("x".repeat(300_000))]);
    expect(result.exceedsBudget).toBe(true);
    expect(result.estimatedTokens).toBe(75_000);
    expect(result.budgetTokens).toBe(64_000);
    expect(result.utilizationPercent).toBeGreaterThan(100);
  });

  it("sums the always-loaded slice across multiple outputs", () => {
    // 2 always-loaded claude rule files of 400K chars each = 800K chars = 200K
    // tokens, exactly claude's 200K budget (not exceeding).
    const ruleBody = "a".repeat(400_000);
    const r1 = out(".claude/rules/30-hatch3r-a.md", ruleBody);
    const r2 = out(".claude/rules/30-hatch3r-b.md", "b".repeat(400_001));
    const result = checkContextBudget("claude", [r1, r2]);
    expect(result.estimatedTokens).toBe(estimateTokens(800_001));
    expect(result.exceedsBudget).toBe(true);
  });

  it("counts only the always-loaded slice, not lazy-loaded outputs (D6-2)", () => {
    // The always-loaded slice is small; the bulk of the corpus is lazy-loaded
    // scoped rules + agents that should NOT inflate the gated number.
    const alwaysLoaded = copilotAlways("y".repeat(40_000)); // 10K tokens
    const scopedRule = out(
      ".github/instructions/50-hatch3r-x.instructions.md",
      `---\napplyTo: "**/*.ts"\n---\n\n${"z".repeat(2_000_000)}`,
    );
    const agent = out(".github/agents/hatch3r-impl.agent.md", "w".repeat(2_000_000));
    const result = checkContextBudget("copilot", [alwaysLoaded, scopedRule, agent]);

    // Gated number reflects only the always-loaded slice -> under 64K budget.
    expect(result.estimatedTokens).toBe(10_000);
    expect(result.exceedsBudget).toBe(false);
    // The full corpus is reported (diagnostic) but does not gate.
    expect(result.totalCorpusTokens).toBeGreaterThan(result.estimatedTokens);
    expect(result.totalCorpusTokens).toBe(
      estimateTokens(alwaysLoaded.content.length + scopedRule.content.length + agent.content.length),
    );
  });

  it("handles empty outputs", () => {
    const result = checkContextBudget("claude", []);
    expect(result.estimatedTokens).toBe(0);
    expect(result.totalCorpusTokens).toBe(0);
    expect(result.exceedsBudget).toBe(false);
    expect(result.utilizationPercent).toBe(0);
  });

  it("reports exact boundary correctly", () => {
    // Exactly at budget: 64K tokens = 256K chars in the copilot always-loaded file
    const result = checkContextBudget("copilot", [copilotAlways("x".repeat(256_000))]);
    expect(result.estimatedTokens).toBe(64_000);
    expect(result.exceedsBudget).toBe(false);
    expect(result.utilizationPercent).toBe(100);
  });

  it("reports one char over budget as exceeding", () => {
    const result = checkContextBudget("copilot", [copilotAlways("x".repeat(256_001))]);
    expect(result.exceedsBudget).toBe(true);
  });

  // Finding D6-2: an under-budget test per adapter against a realistic
  // always-on footprint (~50K-chars instruction file, well under each budget).
  describe("under-budget per adapter (D6-2)", () => {
    const instructions = "i".repeat(50_000); // ~12.5K tokens

    it("claude is under its 200K budget for a realistic always-loaded slice", () => {
      const result = checkContextBudget("claude", [
        claudeAlways(instructions),
        out(".claude/rules/30-hatch3r-foo.md", "rule body ".repeat(500)),
        // lazy-loaded — excluded from the gate
        out(".claude/agents/hatch3r-impl.md", "x".repeat(500_000)),
      ]);
      expect(result.exceedsBudget).toBe(false);
      expect(result.utilizationPercent).toBeLessThan(100);
    });

    it("cursor is under its 120K budget for a realistic always-loaded slice", () => {
      const result = checkContextBudget("cursor", [
        cursorAlways(instructions),
        // lazy-loaded scoped rule + agent — excluded from the gate
        out(".cursor/rules/50-hatch3r-x.mdc", '---\ndescription: x\nglobs: ["**/*.ts"]\nalwaysApply: false\n---\n\n' + "x".repeat(500_000)),
        out(".cursor/agents/hatch3r-impl.md", "x".repeat(500_000)),
      ]);
      expect(result.exceedsBudget).toBe(false);
      expect(result.utilizationPercent).toBeLessThan(100);
    });

    it("copilot is under its 64K budget for a realistic always-loaded slice", () => {
      const result = checkContextBudget("copilot", [
        copilotAlways(instructions),
        // lazy-loaded path-scoped instructions + agents — excluded from the gate
        out(".github/instructions/50-hatch3r-x.instructions.md", '---\napplyTo: "**/*.ts"\n---\n\n' + "x".repeat(500_000)),
        out(".github/agents/hatch3r-impl.agent.md", "x".repeat(500_000)),
      ]);
      expect(result.exceedsBudget).toBe(false);
      expect(result.utilizationPercent).toBeLessThan(100);
    });
  });
});

describe("formatBudgetWarning", () => {
  it("returns null when budget is not exceeded", () => {
    const result = {
      tool: "claude" as Tool,
      estimatedTokens: 50_000,
      totalCorpusTokens: 600_000,
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
      totalCorpusTokens: 600_000,
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
      totalCorpusTokens: 600_000,
      budgetTokens: 120_000,
      exceedsBudget: true,
      utilizationPercent: 125,
    };
    const warning = formatBudgetWarning(result);
    expect(warning).toContain("cursor:");
  });
});
