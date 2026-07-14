/**
 * Model-class machinery: `economy | default | strongest` (release/2.6.0).
 *
 * Canonical agents declare a capability CLASS in `model:` frontmatter, not a
 * vendor model id. Resolution (`resolveAgentModel` in ./resolve.ts) passes the
 * class word through verbatim — class words are deliberately NOT
 * `MODEL_ALIASES` keys — and each adapter maps the class to its own native
 * vocabulary at emission time via the maps below. This replaces the legacy
 * `fast`/`standard` tier words, which no adapter could express natively:
 * Claude/Copilot silently omitted them and Cursor shipped a dead
 * `model: standard` field.
 *
 * Design notes:
 * - The Claude map targets ALIASES (`haiku`/`sonnet`/`opus`), not pinned ids,
 *   so the platform tracks the current GA model in each tier without a
 *   per-release re-pin of every emitted agent file.
 * - `strongest` maps to the top alias rather than `inherit`: `inherit` follows
 *   the parent session's model, which silently DOWNGRADES verdict-class agents
 *   (reviewer, CQ specialists) whenever the parent runs a cheaper model — the
 *   exact failure the floor exists to prevent. An operator who wants a
 *   specific top model (e.g. `fable`, or any concrete id) opts in via
 *   `models.tiers.strongest` in hatch.json, which wins over the adapter maps.
 * - `CLAUDE_TIER_EFFORT_MAP` has no `default` entry on purpose: the default
 *   class emits no `effort:` line, leaving the platform default in place.
 */
import type { HatchManifest } from "../types.js";

/** The three model capability classes authored on canonical agents. */
export type ModelClass = "economy" | "default" | "strongest";

/** All valid model-class words, for validators and pickers. */
export const MODEL_CLASSES: readonly ModelClass[] = ["economy", "default", "strongest"];

/**
 * Legacy synonym -> class map. `fast`/`standard` are the pre-2.6.0 tier words
 * authored on the canonical corpus; `reasoning` was the third authoring-vocab
 * word documented by hatch3r-creator/hatch3r-create. All three remain accepted
 * on user overrides (customize.yaml, manifest maps) so existing configs keep
 * resolving after the corpus migration.
 */
const LEGACY_CLASS_SYNONYMS: Readonly<Record<string, ModelClass>> = {
  fast: "economy",
  standard: "default",
  reasoning: "strongest",
};

/**
 * Normalize a resolved `model:` value to a {@link ModelClass}, or `null` when
 * the value is not a class word (a concrete model id, an alias, `inherit`, or
 * anything else the adapter should handle on its existing non-class path).
 * Accepts the three class words plus the legacy synonyms
 * (`fast`->economy, `standard`->default, `reasoning`->strongest).
 */
export function normalizeModelClass(value: string): ModelClass | null {
  const v = value.trim().toLowerCase();
  if ((MODEL_CLASSES as readonly string[]).includes(v)) return v as ModelClass;
  return LEGACY_CLASS_SYNONYMS[v] ?? null;
}

/**
 * Class -> Claude Code subagent `model:` value. Aliases, not pinned ids (see
 * file header); every value passes `isClaudeRecognizableModel`
 * (src/adapters/claude.ts) by construction.
 */
export const CLAUDE_TIER_MODEL_MAP: Readonly<Record<ModelClass, string>> = {
  economy: "haiku",
  default: "sonnet",
  strongest: "opus",
};

/**
 * Class -> Claude Code subagent `effort:` value, emitted ONLY when the model
 * value came from {@link CLAUDE_TIER_MODEL_MAP} (never for a user-set concrete
 * model, whose effort semantics hatch3r cannot assume). `default` is absent by
 * design — no `effort:` line, platform default applies. Values are members of
 * the platform effort vocabulary `low|medium|high|xhigh|max`
 * (platform.claude.com/docs/en/build-with-claude/effort.md, accessed
 * 2026-07-14).
 */
export const CLAUDE_TIER_EFFORT_MAP: Readonly<Partial<Record<ModelClass, string>>> = {
  economy: "medium",
  strongest: "high",
};

/**
 * Class -> Cursor agent `model:` value. Cursor's native vocabulary is only
 * `fast`, `inherit`, or a concrete model id (cursor.com/docs — mirrored in the
 * emitted bridge doc, src/adapters/cursor.ts), so only `economy` has a native
 * mapping. `default` is expressed by OMITTING the field (inherit-by-omission);
 * `strongest` has no native value and is surfaced as an advisory body line
 * unless `models.tiers.strongest` supplies a concrete id.
 */
export const CURSOR_TIER_MODEL_MAP: Readonly<Partial<Record<ModelClass, string>>> = {
  economy: "fast",
};

/**
 * Operator override for a model class: `hatch.json` -> `models.tiers.<class>`.
 * Returns the configured value VERBATIM when set — it wins over every adapter
 * tier map (the operator pins what each class means in their repo, e.g.
 * `{ "tiers": { "strongest": "fable" } }`) — else `undefined`, in which case
 * each adapter applies its own map above. Alias expansion is intentionally NOT
 * applied here so the resolver stays a pure config read; each adapter expands
 * the pin via `resolveModelAlias` at emission time (exactly as every
 * `resolveAgentModel` result is expanded before an adapter gate sees it), so a
 * pinned `fable` reaches the Claude gate as `claude-fable-5` and passes.
 */
export function resolveTierModel(cls: ModelClass, manifest: HatchManifest): string | undefined {
  return manifest.models?.tiers?.[cls];
}
