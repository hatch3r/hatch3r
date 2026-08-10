import { CHARS_PER_TOKEN } from "../pipeline/observability.js";
import type { AdapterOutput, Tool } from "../types.js";

/**
 * Per-adapter context budget in tokens — a deliberately conservative
 * single-window budget for the ALWAYS-LOADED instruction slice (CLAUDE.md +
 * unscoped rules / `alwaysApply` rules / copilot-instructions.md / AGENTS.md), not the
 * platform's absolute context ceiling. The slice shares the window with the
 * user's code and conversation, so each budget is set to the conservative
 * cross-model floor the platform documents — large enough not to false-alarm
 * on a lean rule set, small enough to warn when the always-on slice bloats.
 *
 * D6-14 (Cycle 11 Wave 3, D6, P3): re-verified against current vendor docs.
 * Sources (accessed 2026-06-06):
 *   - claude  = 200K. Conservative cross-model floor: Claude Sonnet 4.5 and the
 *     other 200K-window models still ship at 200K, while flagship coding models
 *     (Opus 4.6/4.7/4.8, Sonnet 4.6) reach a 1M-token window — GA since
 *     2026-03-13, no `anthropic-beta` header required, no price multiplier.
 *     Held at the 200K floor so the gate stays meaningful across every model a
 *     Claude Code user may select. Source:
 *     https://platform.claude.com/docs/en/build-with-claude/context-windows
 *   - cursor  = 120K. Sits inside Cursor's documented Normal-Mode range
 *     (8K-128K, model-dependent); Max Mode extends to the model max (up to 1M).
 *     Rules consistently get "less than half the advertised window" because
 *     Cursor reserves tokens for its system prompt + codebase index, so 120K
 *     is a conservative Normal-Mode instruction budget. Source:
 *     https://cursor.com/docs/context/max-mode (Max Mode + Normal Mode windows)
 *     D6-SA6.1-02 (Cycle 12): this 120K figure is the window-FIT budget
 *     (single-window OOM-avoidance headroom for the always-loaded slice). It is
 *     a DIFFERENT quantity from — and ~15x larger than — Cursor's ~30.7 KB
 *     (~7.7K-token) always-apply PERFORMANCE guidance, the soft per-turn
 *     ceiling above which always-on rule content degrades Cursor
 *     responsiveness, documented at `resolveRuleGlobs` in
 *     `src/adapters/canonical.ts`. The context-budget gate here answers "does
 *     the always-loaded slice fit the window?"; that separate figure answers
 *     "does it stay performant as always-apply content?" — do not conflate the
 *     two "budget" numbers.
 *   - copilot = 128K. Raised from the v1.9.0 value of 64K: the prior 64K floor
 *     was stale. GitHub Copilot now ships a 128K standard tier (GPT-4o extended)
 *     and a 1M-token window in VS Code, Copilot CLI, and the Copilot app
 *     (announced 2026-06-04); 128K is the conservative current standard. Source:
 *     https://github.blog/changelog/2026-06-04-larger-context-windows-and-configurable-reasoning-levels-for-github-copilot/
 *   - codex   = 128K. Conservative project default across configurable Codex
 *     models; the gate measures the always-loaded AGENTS.md slice rather than
 *     promising a model-specific maximum. Source:
 *     https://developers.openai.com/codex/config-reference
 *
 * Re-verify these against the cited vendor docs each cycle — tracked as a P3
 * per-cycle re-verification item in `governance/audit/domains/D09-platform-adapters.md`
 * §9.1-9.3 (the per-adapter currency checklist).
 *
 * Codex was restored as a fourth supported adapter in this release. The other
 * adapters removed by the v2.0.0 W1-A scope cut remain unsupported.
 */
export const CONTEXT_BUDGET_TOKENS: Record<Tool, number> = {
  claude: 200_000,
  cursor: 120_000,
  copilot: 128_000,
  codex: 128_000,
};

/**
 * Claude-tuned chars/token divisor for the context-budget gate.
 *
 * D6-13 (Cycle 11 Wave 3, D6, P2): the generic ~4 chars/token approximation
 * (`CHARS_PER_TOKEN`, imported from `pipeline/observability.ts` — single source
 * of truth, no longer a duplicated literal here) UNDER-counts Claude tokens by
 * ~10-25% on prose and more on code. Anthropic's own guidance is that a
 * char-ratio heuristic always under-counts Claude tokens and the only exact
 * count is the `count_tokens` API (`POST /v1/messages/count_tokens`,
 * https://platform.claude.com/docs/en/build-with-claude/token-counting,
 * accessed 2026-06-09). 3.6 is the conservative Claude-tuned divisor: it biases
 * the always-loaded-slice estimate UP so the budget gate triggers slightly
 * early rather than silently under-reporting an over-budget slice. cursor and
 * copilot keep the generic ~4 divisor — their windows are not Claude-tokenized,
 * and the budget gate is a soft warning, not a billing figure.
 */
export const CLAUDE_CHARS_PER_TOKEN = 3.6;

/**
 * Resolve the chars/token divisor for a tool's context-budget estimate.
 * Claude uses the Claude-tuned {@link CLAUDE_CHARS_PER_TOKEN}; cursor/copilot/codex
 * use the generic {@link CHARS_PER_TOKEN}. Both remain estimates — see
 * {@link CLAUDE_CHARS_PER_TOKEN} for the exact-count path (`count_tokens`).
 */
export function charsPerTokenFor(tool: Tool): number {
  return tool === "claude" ? CLAUDE_CHARS_PER_TOKEN : CHARS_PER_TOKEN;
}

/**
 * Estimate token count from a character count.
 *
 * Rough char-ratio heuristic, NOT exact BPE tokenisation: tokens ≈
 * charCount / charsPerToken. The divisor defaults to the generic
 * {@link CHARS_PER_TOKEN} (~4) and is overridden per tool by
 * {@link charsPerTokenFor} (Claude tokenises denser, so it passes the smaller
 * {@link CLAUDE_CHARS_PER_TOKEN}). For an exact count use Anthropic's
 * `count_tokens` API — see {@link CLAUDE_CHARS_PER_TOKEN}.
 */
export function estimateTokens(
  charCount: number,
  charsPerToken: number = CHARS_PER_TOKEN,
): number {
  return Math.ceil(charCount / charsPerToken);
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
 *   - codex (`src/adapters/codex.ts`): root `AGENTS.md`; projected skills and
 *     subagents load only when activated/delegated.
 *
 * Agents, skills, commands, prompts, hook scripts, and config JSON are excluded
 * for all four adapters — none of them sit in the always-on session prefix.
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
    case "codex":
      return path === "AGENTS.md";
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
  const charsPerToken = charsPerTokenFor(tool);
  let alwaysLoadedChars = 0;
  let totalChars = 0;
  for (const out of outputs) {
    totalChars += out.content.length;
    if (isAlwaysLoaded(tool, out)) {
      alwaysLoadedChars += out.content.length;
    }
  }
  // D6-13: use the per-tool divisor (Claude tokenises denser than the generic
  // ~4 chars/token) so the gate doesn't under-report Claude's always-loaded slice.
  const estimatedTokens = estimateTokens(alwaysLoadedChars, charsPerToken);
  const totalCorpusTokens = estimateTokens(totalChars, charsPerToken);
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
    `${result.tool}: always-loaded output is ~${estK}K tokens (rough estimate — ` +
    `char-ratio heuristic, not exact tokenisation; run Anthropic's count_tokens API for an exact count), ` +
    `exceeding the estimated ${budgetK}K token context budget (${result.utilizationPercent}% utilization, ~${overK}K over). ` +
    `To get under budget, drop always-on rules from the slice: disable the largest ones via ` +
    `\`.hatch3r/rules/<id>.customize.yaml\` with \`enabled: false\` (protected/floor:* rules cannot be disabled), ` +
    `or deselect content with \`hatch3r config\`. ` +
    `\`hatch3r sync --minimal\` only strips comments/formatting (same corpus per Decision 16) and will not clear this gate. ` +
    `Use \`--strict-budget\` to fail the sync on overflow.`
  );
}
