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
 *   - Windsurf: ~128K context window
 *   - Codex: 200K context window
 *   - Gemini: 200K context window (Gemini 2.5 Pro)
 *   - Cline: ~128K (depends on model, conservative estimate)
 *   - Amp: ~128K context window
 *   - OpenCode: ~128K (model-dependent)
 *   - Aider: ~64K (CLI-based, model-dependent)
 *   - Kiro: ~128K context window
 *   - Goose: ~128K context window
 *   - Zed: ~64K (minimal adapter, limited instruction surface)
 *   - Amazon Q: ~128K context window
 *   - Antigravity: ~128K context window
 */
export const CONTEXT_BUDGET_TOKENS: Record<Tool, number> = {
  claude: 200_000,
  cursor: 120_000,
  copilot: 64_000,
  windsurf: 128_000,
  codex: 200_000,
  gemini: 200_000,
  cline: 128_000,
  amp: 128_000,
  opencode: 128_000,
  aider: 64_000,
  kiro: 128_000,
  goose: 128_000,
  zed: 64_000,
  "amazon-q": 128_000,
  antigravity: 128_000,
  "agents-md": 200_000,
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
 */
export function formatBudgetWarning(result: ContextBudgetResult): string | null {
  if (!result.exceedsBudget) return null;

  const estK = Math.round(result.estimatedTokens / 1000);
  const budgetK = Math.round(result.budgetTokens / 1000);

  return (
    `${result.tool}: generated output is ~${estK}K tokens, ` +
    `exceeding the estimated ${budgetK}K token context budget (${result.utilizationPercent}% utilization). ` +
    `Consider using a smaller content preset or disabling unused features to reduce output size.`
  );
}
