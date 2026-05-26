import type { AdapterOutput, Tool } from "../types.js";

/**
 * Per-adapter context budget in tokens. Based on each platform's documented
 * context window for rules/instructions input. These are conservative
 * estimates of how much instruction content each platform can accept
 * before degrading performance or truncating.
 *
 * Sources (as of 2026-04):
 *   - Claude Code: 200K context window
 *   - Cursor: ~120K effective for rules (model context shared with codebase)
 *   - Copilot: ~64K instruction budget (shared with workspace context)
 *
 * Trimmed to the three retained adapters in v2.0.0; the prior 15-adapter
 * list (windsurf/codex/gemini/cline/amp/opencode/aider/kiro/goose/zed/
 * amazon-q/antigravity) is gone after the W1-A adapter purge.
 */
export const CONTEXT_BUDGET_TOKENS: Record<Tool, number> = {
  claude: 200_000,
  cursor: 120_000,
  copilot: 64_000,
};

/**
 * Estimate token count from a character count.
 * Uses the standard rough approximation: 1 token ~ 4 characters.
 */
export function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / 4);
}

export interface ContextBudgetResult {
  tool: Tool;
  estimatedTokens: number;
  budgetTokens: number;
  exceedsBudget: boolean;
  /** Percentage of budget used (0-100+). */
  utilizationPercent: number;
}

/**
 * Check whether the generated output for a tool exceeds its context budget.
 * Returns a result object with utilization details.
 */
export function checkContextBudget(
  tool: Tool,
  outputs: AdapterOutput[],
): ContextBudgetResult {
  const budgetTokens = CONTEXT_BUDGET_TOKENS[tool];
  let totalChars = 0;
  for (const out of outputs) {
    totalChars += out.content.length;
  }
  const estimatedTokens = estimateTokens(totalChars);
  const utilizationPercent = Math.round((estimatedTokens / budgetTokens) * 100);

  return {
    tool,
    estimatedTokens,
    budgetTokens,
    exceedsBudget: estimatedTokens > budgetTokens,
    utilizationPercent,
  };
}

/**
 * Format a context budget warning message for display.
 * Returns null if the budget is not exceeded.
 *
 * C7.5-W2B2-H22 (D6-SA6.1-2): includes an actionable next-step suggestion
 * with a concrete `hatch3r sync --minimal` command (P1 actionable errors).
 */
export function formatBudgetWarning(result: ContextBudgetResult): string | null {
  if (!result.exceedsBudget) return null;

  const estK = Math.round(result.estimatedTokens / 1000);
  const budgetK = Math.round(result.budgetTokens / 1000);
  const overK = Math.max(1, Math.round((result.estimatedTokens - result.budgetTokens) / 1000));

  return (
    `${result.tool}: generated output is ~${estK}K tokens, ` +
    `exceeding the estimated ${budgetK}K token context budget (${result.utilizationPercent}% utilization, ~${overK}K over). ` +
    `Run \`hatch3r sync --minimal\` to reduce output size, or remove unused content via \`hatch3r config\`. ` +
    `Use \`--strict-budget\` to fail the sync on overflow.`
  );
}
