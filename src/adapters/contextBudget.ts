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

/**
 * Extract the leading YAML frontmatter fence (the text between a `---` on the
 * very first line and the next `---` line), or "" when the content does not
 * open with a fence. Used to classify always-loaded outputs by inspecting ONLY
 * the frontmatter, so a rule BODY that merely quotes `alwaysApply: true` or
 * `paths:` cannot be misclassified.
 */
function leadingFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) return "";
  const end = content.indexOf("\n---", 4);
  if (end === -1) return "";
  return content.slice(4, end);
}

/**
 * D6-2 (Cycle 11 Wave 2, D6, P7): classify an adapter output as part of the
 * "always-loaded" slice — the content each platform pulls into the model
 * context at session start, every session, regardless of which files the user
 * opens. The context-budget gate measures THIS slice against the single-window
 * budget, not the full generated corpus.
 *
 * The prior gate summed `out.content.length` over ALL outputs (232+ files: every
 * agent, skill, command, scoped rule, JSON config). That conflates the on-disk
 * artifact set with the per-session context footprint: scoped rules
 * (`paths:`/`globs:`/`applyTo:`), agents, skills, commands, and config JSON
 * load lazily — only when matched/invoked — so they never co-reside in one
 * context window. Summing them over-reported session-start utilization 3.7-11.4x
 * (claude 370%, cursor 611%, copilot 1140%) and tripped `--strict-budget` on
 * every sync even though the real always-on footprint (~151K) is under budget.
 *
 * Always-loaded slice per platform (derived from the adapter emission sites):
 *   - claude  (`src/adapters/claude.ts`): `CLAUDE.md` + every `.claude/rules/*`
 *     output with NO `paths:` frontmatter (`scope: always`/unscoped rules load
 *     unconditionally; `paths:`-scoped rules lazy-load on a matching file read).
 *   - cursor  (`src/adapters/cursor.ts`): every `.cursor/rules/*.mdc` whose
 *     frontmatter carries `alwaysApply: true` (includes the bridge and the
 *     tool-allowlist rule); `globs:`-scoped `.mdc` rules auto-attach lazily.
 *   - copilot (`src/adapters/copilot.ts`): `.github/copilot-instructions.md`;
 *     `.github/instructions/*` carry `applyTo` (path-scoped, lazy).
 *
 * Agents, skills, commands, prompts, hook scripts, and config JSON are excluded
 * for all three adapters — none of them sit in the always-on session prefix.
 */
export function isAlwaysLoaded(tool: Tool, output: AdapterOutput): boolean {
  const { path, content } = output;
  switch (tool) {
    case "claude": {
      if (path === "CLAUDE.md") return true;
      // `.claude/rules/<nn>-<id>.md` — always-loaded unless it opens with a
      // `paths:` frontmatter fence (claudeRulePathsFrontmatter prepends
      // `---\npaths: [...]\n---\n` only for glob-scoped rules).
      if (path.startsWith(".claude/rules/") && path.endsWith(".md")) {
        return !content.startsWith("---\npaths:");
      }
      return false;
    }
    case "cursor": {
      // `.cursor/rules/<id>.mdc` — always-loaded only when its leading
      // frontmatter declares `alwaysApply: true` (cursorRuleFrontmatter emits
      // this for `scope: always`; `globs:`-scoped rules get `alwaysApply: false`
      // or a `globs:` line and attach lazily).
      if (path.startsWith(".cursor/rules/") && path.endsWith(".mdc")) {
        return /^alwaysApply:\s*true\s*$/m.test(leadingFrontmatter(content));
      }
      return false;
    }
    case "copilot": {
      // Only the top-level instructions file is always-loaded; everything under
      // `.github/instructions/` is `applyTo`-scoped (path-conditional).
      return path === ".github/copilot-instructions.md";
    }
    default:
      return false;
  }
}

export interface ContextBudgetResult {
  tool: Tool;
  /**
   * Estimated tokens of the always-loaded slice — the content the platform pulls
   * into context every session. This is the number the budget gate compares
   * against {@link ContextBudgetResult.budgetTokens}.
   */
  estimatedTokens: number;
  /**
   * Estimated tokens of the FULL generated corpus across all outputs (every
   * agent/skill/command/scoped-rule/config file). Diagnostic only — most of this
   * loads lazily and never co-resides in one context window, so it is NOT gated.
   */
  totalCorpusTokens: number;
  budgetTokens: number;
  exceedsBudget: boolean;
  /** Percentage of budget used by the always-loaded slice (0-100+). */
  utilizationPercent: number;
}

/**
 * Check whether the always-loaded slice of the generated output for a tool
 * exceeds its single-window context budget. Returns a result object with
 * utilization details. The full-corpus token count is also reported (diagnostic)
 * so operators can see total generated size without it inflating the gate.
 */
export function checkContextBudget(
  tool: Tool,
  outputs: AdapterOutput[],
): ContextBudgetResult {
  const budgetTokens = CONTEXT_BUDGET_TOKENS[tool];
  let alwaysLoadedChars = 0;
  let totalChars = 0;
  for (const out of outputs) {
    totalChars += out.content.length;
    if (isAlwaysLoaded(tool, out)) {
      alwaysLoadedChars += out.content.length;
    }
  }
  const estimatedTokens = estimateTokens(alwaysLoadedChars);
  const totalCorpusTokens = estimateTokens(totalChars);
  const utilizationPercent = Math.round((estimatedTokens / budgetTokens) * 100);

  return {
    tool,
    estimatedTokens,
    totalCorpusTokens,
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
 * (P1 actionable errors). D6-3 (Cycle 11 Wave 2): the next step points at levers
 * that actually shrink the always-loaded slice — disabling the largest always-on
 * rules and deselecting content — NOT `--minimal`. Under Decision 16 every preset
 * ships the full corpus, and `--minimal` (BaseAdapter.stripMinimal) only removes
 * comments/blank-lines/horizontal-rules from that same corpus; on an already-lean
 * rule slice it trims well under 1% and can never clear an over-budget gate, so
 * suggesting it as the remedy was a dead-end next step (failed P1).
 */
export function formatBudgetWarning(result: ContextBudgetResult): string | null {
  if (!result.exceedsBudget) return null;

  const estK = Math.round(result.estimatedTokens / 1000);
  const budgetK = Math.round(result.budgetTokens / 1000);
  const overK = Math.max(1, Math.round((result.estimatedTokens - result.budgetTokens) / 1000));

  return (
    `${result.tool}: always-loaded output is ~${estK}K tokens, ` +
    `exceeding the estimated ${budgetK}K token context budget (${result.utilizationPercent}% utilization, ~${overK}K over). ` +
    `To get under budget, drop always-on rules from the slice: disable the largest ones via ` +
    `\`.hatch3r/rules/<id>.customize.yaml\` with \`enabled: false\` (protected/floor:* rules cannot be disabled), ` +
    `or deselect content with \`hatch3r config\`. ` +
    `\`hatch3r sync --minimal\` only strips comments/formatting (same corpus per Decision 16) and will not clear this gate. ` +
    `Use \`--strict-budget\` to fail the sync on overflow.`
  );
}
