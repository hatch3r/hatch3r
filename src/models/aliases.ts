/**
 * Short alias -> full model ID mapping.
 * Used in hatch.json `models` configuration and .customize.yaml files
 * so users can write `"opus"` instead of `"claude-opus-4-8"`.
 *
 * P3 currency note (D1-25, Cycle 11; sonnet bump + fable row 2026-07-14): each
 * Anthropic row points at the current GA model in that tier; the `opus` row was
 * two GA generations stale (`claude-opus-4-6`, last verified 2026-04-13) before
 * the bump to `claude-opus-4-8`, and the `sonnet` row was one generation stale
 * (`claude-sonnet-4-6`, D1-SA1.6-03) before the bump to `claude-sonnet-5`.
 * Re-verify every row against the vendor's published model list before a
 * release — the `opus`/`sonnet`/`haiku`/`fable` targets must stay in lock with
 * `MODEL_RATES` in `src/pipeline/costEstimator.ts` (whose `resolveModelRate`
 * derives alias and class rates through THIS map, so every Anthropic alias
 * target here must carry a rate row there) and with the user-facing table in
 * `docs/model-selection.md`. Anthropic models last verified 2026-07-14;
 * codex/gemini rows last verified 2026-06-06.
 *
 * NOT aliases by design: the four model-class words
 * `economy`/`standard`/`advanced`/`frontier` (authored on the canonical
 * agents' `model:` frontmatter) and the five legacy class synonyms `fast`,
 * the pre-2.6.0 middle-tier `standard`, `default`, `reasoning`, and
 * `strongest` are NOT keys here. They are capability classes (`ModelClass` in
 * src/models/tiers.ts), not model IDs, so `resolveModelAlias` passes them
 * through verbatim and each adapter maps the class to its own native
 * vocabulary at emission time
 * (`normalizeModelClass` + the per-adapter tier maps in src/models/tiers.ts).
 * Adding them here would collapse every adapter onto one vendor mapping and
 * re-introduce the dead-field emission the class machinery removed
 * (CONSTITUTION §2 P5 silent-failure avoidance; D9-16) — do not.
 */
export const MODEL_ALIASES: Record<string, string> = {
  "opus": "claude-opus-4-8",
  "sonnet": "claude-sonnet-5",
  "haiku": "claude-haiku-4-5",
  "fable": "claude-fable-5",
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
