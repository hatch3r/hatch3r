/**
 * Short alias -> full model ID mapping.
 * Used in hatch.json `models` configuration and .customize.yaml files
 * so users can write `"opus"` instead of `"claude-opus-4-8"`.
 *
 * P3 currency note (D1-25, Cycle 11): each Anthropic row points at the current
 * GA model in that tier; the `opus` row was two GA generations stale
 * (`claude-opus-4-6`, last verified 2026-04-13) before this bump to
 * `claude-opus-4-8`. Re-verify every row against the vendor's published model
 * list before a release — the `opus`/`sonnet`/`haiku` targets must stay in lock
 * with `MODEL_RATES`/`TIER_ALIASES` in `src/pipeline/costEstimator.ts` (the rate
 * map and this alias map both name `claude-opus-4-8` for the opus tier) and with
 * the user-facing table in `docs/model-selection.md`. Anthropic models last
 * verified 2026-06-09; codex/gemini rows last verified 2026-06-06.
 *
 * NOT aliases by design: the hatch3r-internal capacity-tier words `standard` and
 * `fast` (authored on 29 canonical agents' `model:` frontmatter) are NOT keys
 * here. They are triage/cost tiers (`TriageTier` in costEstimator.ts), not model
 * IDs, so `resolveModelAlias` passes them through verbatim. The Claude and
 * Copilot adapters gate native `model:` emission to recognizable values
 * (`isClaudeRecognizableModel` in src/adapters/claude.ts,
 * `isCopilotRecognizableModel` in src/adapters/copilot.ts), so an unmapped tier
 * word is omitted from native frontmatter rather than shipped as a dead field
 * (CONSTITUTION §2 P5 silent-failure avoidance; D9-16). Adding them here would
 * make them recognizable and re-introduce the dead-field emission those gates
 * removed — do not.
 */
export const MODEL_ALIASES: Record<string, string> = {
  "opus": "claude-opus-4-8",
  "sonnet": "claude-sonnet-4-6",
  "haiku": "claude-haiku-4-5",
  "codex": "gpt-5.3-codex",
  "codex-prev": "gpt-5.2-codex",
  "codex-mini": "gpt-5.1-codex-mini",
  "codex-spark": "gpt-5.3-codex-spark",
  "gemini-pro": "gemini-3.1-pro",
  "gemini-flash": "gemini-3-flash",
  "gemini-stable": "gemini-2.5-pro",
};

/** Expand a model alias to its full ID, or return the input if not an alias. */
export function resolveModelAlias(input: string): string {
  return MODEL_ALIASES[input] ?? input;
}
