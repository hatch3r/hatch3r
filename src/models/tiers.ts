/**
 * Model-class machinery: the 4-class capability ladder
 * `economy < standard < advanced < frontier` plus the reasoning-effort axis
 * `low < medium < high < xhigh < max` (release/2.7.0; supersedes the 2.6.0
 * 3-class `economy | default | strongest` ladder — the 2.6.0 words live on as
 * {@link normalizeModelClass} legacy synonyms).
 *
 * Canonical agents declare a capability CLASS in `model:` frontmatter — and
 * optionally a reasoning-effort level in `effort:` — not a vendor model id.
 * Resolution (`resolveAgentModel` in ./resolve.ts) passes the class word
 * through verbatim — class words are deliberately NOT `MODEL_ALIASES` keys —
 * and each adapter maps the class to its own native vocabulary at emission
 * time via the maps below.
 *
 * Design notes:
 * - `frontier` is floor-only at runtime: verdict-class floor agents author
 *   `model: frontier` directly, while task-tier allocation tops out at
 *   `advanced` — orchestrators never up-allocate ordinary task work onto the
 *   top class.
 * - The Claude map targets ALIASES (`haiku`/`sonnet`/`opus`/`fable`), not
 *   pinned ids, so the platform tracks the current GA model in each tier
 *   without a per-release re-pin of every emitted agent file.
 * - Effort composition: an EXPLICIT per-agent effort (frontmatter or
 *   `.customize.yaml`, resolved by `resolveAgentEffort` in ./resolve.ts) wins;
 *   otherwise, and only when the emitted model came from a class mapping,
 *   adapters fall back to {@link defaultEffortForClass} — the
 *   `models.tierEfforts.<class>` pin, else {@link CLASS_DEFAULT_EFFORT_MAP}.
 *   `standard` has no built-in default: no `effort:` line, platform default.
 * - `models.tiers.<class>: "inherit"` is the per-class native-emission
 *   off-switch (release/2.7.0 adapter contract): adapters treat an inherit
 *   pin as "emit no native model field for this class".
 */
import type { HatchManifest } from "../types.js";
import {
  CLASS_HIGH,
  CLASS_LOW,
  CLASS_MID,
  CLASS_TOP,
  EFFORT_LEVELS,
  MODEL_CLASSES,
} from "../types.js";
import type { EffortLevel, ModelClass } from "../types.js";

// Re-export the ladder + effort symbols: src/types.ts owns the literals
// (swappable naming constants — renaming the ladder is a 4-line diff there),
// this module owns the semantics, and existing importers of
// MODEL_CLASSES/ModelClass from tiers.js keep resolving unchanged.
export { CLASS_HIGH, CLASS_LOW, CLASS_MID, CLASS_TOP, EFFORT_LEVELS, MODEL_CLASSES };
export type { EffortLevel, ModelClass };

/**
 * Legacy synonym -> class map. `fast`/`standard` are the pre-2.6.0 tier words
 * and `reasoning` the third pre-2.6.0 authoring-vocab word;
 * `default`/`strongest` are the 2.6.0 3-class ladder words superseded by the
 * 2.7.0 4-class ladder. All remain accepted on user overrides
 * (customize.yaml, manifest maps) so existing configs keep resolving across
 * both migrations.
 *
 * NOTE the `standard` row is shadowed by design: `standard` is BOTH canonical
 * (CLASS_MID) in the 2.7.0 ladder AND a pre-2.6.0 legacy word for the middle
 * tier. {@link normalizeModelClass} checks canonical membership FIRST, so the
 * canonical reading always wins and the row is harmless — keep that ordering.
 */
const LEGACY_CLASS_SYNONYMS: Readonly<Record<string, ModelClass>> = {
  fast: CLASS_LOW,
  standard: CLASS_MID,
  default: CLASS_MID,
  reasoning: CLASS_TOP,
  strongest: CLASS_TOP,
};

/**
 * Normalize a resolved `model:` value to a {@link ModelClass}, or `null` when
 * the value is not a class word (a concrete model id, an alias, `inherit`, or
 * anything else the adapter should handle on its existing non-class path).
 * Canonical membership is checked FIRST (so the shadowed `standard` legacy
 * row never applies), then the legacy synonyms
 * (`fast`->economy, `standard`/`default`->standard, `reasoning`/`strongest`->frontier).
 */
export function normalizeModelClass(value: string): ModelClass | null {
  const v = value.trim().toLowerCase();
  if ((MODEL_CLASSES as readonly string[]).includes(v)) return v as ModelClass;
  return LEGACY_CLASS_SYNONYMS[v] ?? null;
}

/**
 * Normalize a user-supplied effort value to an {@link EffortLevel}, or `null`
 * when the value is not one of the five levels (`inherit`, junk, or an
 * injection payload — callers own the drop-with-warning). Trim + lowercase
 * tolerant, mirroring {@link normalizeModelClass}.
 */
export function normalizeEffortLevel(value: string): EffortLevel | null {
  const v = value.trim().toLowerCase();
  return (EFFORT_LEVELS as readonly string[]).includes(v) ? (v as EffortLevel) : null;
}

/**
 * Effort ordering, weakest (`low` = 0) -> strongest (`max` = 4). Derived from
 * the {@link EFFORT_LEVELS} array order so a ladder edit cannot desynchronize
 * the ranks. Consumers compare ranks for floor checks (frontier-floor agents
 * author effort >= xhigh) and for the cursor adapter's bracket-effort clamp.
 */
export const EFFORT_RANK: Readonly<Record<EffortLevel, number>> = Object.fromEntries(
  EFFORT_LEVELS.map((level, i): [EffortLevel, number] => [level, i]),
) as Record<EffortLevel, number>;

/**
 * Class -> Claude Code subagent `model:` value. Aliases, not pinned ids (see
 * file header — the platform tracks the current GA model in each tier);
 * `fable` is a first-class Claude Code model alias alongside
 * `haiku`/`sonnet`/`opus` (code.claude.com/docs/en/sub-agents, accessed
 * 2026-07-14). Every value passes `isClaudeRecognizableModel`
 * (src/adapters/claude.ts) by construction.
 */
export const CLAUDE_TIER_MODEL_MAP: Readonly<Record<ModelClass, string>> = {
  [CLASS_LOW]: "haiku",
  [CLASS_MID]: "sonnet",
  [CLASS_HIGH]: "opus",
  [CLASS_TOP]: "fable",
};

/**
 * Class -> built-in default reasoning-effort level, adapter-agnostic. Applied
 * ONLY when the emitted model came from a class mapping (never for a
 * user-set concrete model, whose effort semantics hatch3r cannot assume) and
 * no explicit per-agent effort won — see {@link defaultEffortForClass} for
 * the pin-beats-builtin composition. `standard` (CLASS_MID) is deliberately
 * absent: no `effort:` line, the platform default applies. Values are members
 * of the platform effort vocabulary `low|medium|high|xhigh|max`
 * (platform.claude.com/docs/en/build-with-claude/effort.md, accessed
 * 2026-07-14).
 */
export const CLASS_DEFAULT_EFFORT_MAP: Readonly<Partial<Record<ModelClass, EffortLevel>>> = {
  [CLASS_LOW]: "medium",
  [CLASS_HIGH]: "high",
  [CLASS_TOP]: "xhigh",
};

/**
 * Class -> Cursor agent `model:` value. Cursor's native frontmatter keyword
 * vocabulary is `fast`, `inherit`, or a concrete model id, so only `economy`
 * has a keyword row. `standard` (CLASS_MID) is expressed by OMITTING the
 * field (inherit-by-omission). `advanced`/`frontier` have no rows here by
 * design: the cursor adapter pins them at emission time via alias expansion
 * to a concrete id plus the bracket-effort clamp — cursor.com/docs/subagents.md
 * documents the `claude-opus-4-8[effort=high]` form, and cursor.com/docs/models
 * lists Claude Fable 5 (both accessed 2026-07-14).
 */
export const CURSOR_TIER_MODEL_MAP: Readonly<Partial<Record<ModelClass, string>>> = {
  [CLASS_LOW]: "fast",
};

/**
 * Class -> GitHub Copilot custom-agent `model:` display name. Copilot agent
 * frontmatter takes a SINGLE display-name string — the Copilot CLI rejects
 * the array form — matching the rows in the supported-models reference
 * (docs.github.com/en/copilot/reference/ai-models/supported-models, accessed
 * 2026-07-14). `standard` (CLASS_MID) is absent: omit the field and the
 * model-picker default applies.
 */
export const COPILOT_TIER_MODEL_MAP: Readonly<Partial<Record<ModelClass, string>>> = {
  [CLASS_TOP]: "Claude Fable 5",
  [CLASS_HIGH]: "Claude Opus 4.8",
  [CLASS_LOW]: "Claude Haiku 4.5",
};

/**
 * Operator override for a model class: `hatch.json` -> `models.tiers.<key>`.
 * Returns the configured value VERBATIM when set — it wins over every adapter
 * tier map (the operator pins what each class means in their repo, e.g.
 * `{ "tiers": { "frontier": "fable" } }`) — else `undefined`, in which case
 * each adapter applies its own map above.
 *
 * Key matching: the CANONICAL class key wins on exact match; otherwise the
 * first `tiers` entry whose key normalizes to `cls` (2.6.0 legacy
 * `default`/`strongest`, pre-2.6.0 `fast`/`reasoning`) is honored, so
 * pre-2.7.0 manifests keep resolving without a rewrite. Pure config read — no
 * warnings here; the legacy-key rename lint lives in `hatch3r validate`
 * (src/cli/commands/validate.ts::validateModels).
 *
 * Alias expansion is intentionally NOT applied here so the resolver stays a
 * pure config read; each adapter expands the pin via `resolveModelAlias` at
 * emission time (exactly as every `resolveAgentModel` result is expanded
 * before an adapter gate sees it), so a pinned `fable` reaches the Claude
 * gate as `claude-fable-5` and passes.
 */
export function resolveTierModel(cls: ModelClass, manifest: HatchManifest): string | undefined {
  const tiers = manifest.models?.tiers;
  if (!tiers) return undefined;
  const exact = tiers[cls];
  if (exact !== undefined) return exact;
  for (const [key, value] of Object.entries(tiers)) {
    if (typeof value === "string" && normalizeModelClass(key) === cls) return value;
  }
  return undefined;
}

/**
 * Operator reasoning-effort pin for a model class: `hatch.json` ->
 * `models.tierEfforts.<class>`. CANONICAL class keys only — the field
 * postdates the 4-class ladder, so no legacy-key normalization applies
 * (unknown/legacy keys are rejected by `hatch3r validate`). Returns the pin
 * verbatim; enum gating is the caller's job.
 */
export function resolveTierEffort(cls: ModelClass, manifest: HatchManifest): string | undefined {
  return manifest.models?.tierEfforts?.[cls];
}

/**
 * Effective class-level effort for `cls`: the operator pin
 * ({@link resolveTierEffort}) when set, else the built-in
 * {@link CLASS_DEFAULT_EFFORT_MAP} default — which omits `standard`, so the
 * platform default applies there. This composes only the CLASS half of effort
 * resolution: an explicit per-agent effort
 * (src/models/resolve.ts::resolveAgentEffort) beats it, and adapters apply
 * this fallback ONLY when the emitted model came from a class mapping.
 */
export function defaultEffortForClass(cls: ModelClass, manifest: HatchManifest): string | undefined {
  return resolveTierEffort(cls, manifest) ?? CLASS_DEFAULT_EFFORT_MAP[cls];
}
