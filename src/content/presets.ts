import { HatchError } from "../types.js";
import {
  TAG_PLANNING,
  TAG_IMPLEMENTATION,
  TAG_REVIEW,
  TAG_DEVOPS,
  TAG_MAINTENANCE,
  TAG_ORCHESTRATION,
  TAG_BOARD,
  TAG_PERFORMANCE,
  TAG_AI,
} from "./tags.js";

export type PresetId =
  | "minimal"
  | "standard"
  | "full"
  | "custom"
  | "web-app"
  | "api-service"
  | "cli-tool"
  | "monorepo"
  | "legacy"
  | "security";

/**
 * Capability tags admitted as preset positive-list entries. Floor tags
 * (`floor:*`) are deliberately NOT included here — floor admission is a
 * structural invariant of `resolveSelection` and bypasses preset config.
 *
 * Deliberate narrowing (D2-20, Cycle 11 Wave 3): `tags.ts::TAG_REGISTRY` marks
 * 41 distinct tag values as facet `"capability"`, but this union — and every
 * `preset.capabilities` array below — lists only 9 of them (the lifecycle
 * clusters: planning, implementation, review, devops, maintenance,
 * orchestration, board, performance, ai). The other 32 capability-facet tags
 * (e.g. `security`, `reliability`, `testing`, `accessibility`, `spec`,
 * `migration`, `telemetry`, `proof`, `playwright`, …) are sub-facet refinements
 * that describe WHAT a content-quality or work-type artifact does within a
 * cluster; canonical artifacts carrying them ALSO carry either a `floor:*` tag
 * (the CQ specialists are `floor:content-quality`; security artifacts are
 * `floor:security`) or one of the 9 primary capability tags, so they are
 * admitted via floor admission (stage 2) or the 9-tag capability gate (stage 3)
 * regardless of the 32 refinement tags. Adding a refinement tag to this union
 * is therefore unnecessary AND would over-admit: a refinement-only preset would
 * shape a non-lifecycle slice the picker has no concept of.
 *
 * The unguarded risk this narrowing creates: an artifact whose ONLY capability
 * tags fall in the 32-tag refinement set, with no `floor:*` tag and
 * `protected !== true`, intersects no preset's `capabilities` and is dropped by
 * EVERY preset including `full` (a silent corpus hole — `full` is meant to ship
 * everything). The sanctioned escape for a deliberate refinement-only artifact
 * is a per-id `includeIds` entry on the preset(s) that should ship it — the
 * corpus has exactly one such artifact: `hatch3r-capability-matrix`, admitted
 * via `includeIds` on `full` (D5-SA5.4-09 + CI-RECON-05, Cycle 12) and — since
 * release/2.8.5 — on the `monorepo` and `web-app` archetypes, whose
 * descriptions promise full-parity minus named dials. The
 * "every canonical artifact is admitted by `full` OR floor-tagged OR protected"
 * guard in `src/__tests__/content/compound.test.ts` fails the build the moment
 * an UNSANCTIONED orphan is introduced, converting the silent drop into a CI
 * failure that names the offending file.
 */
export type CapabilityTag =
  | typeof TAG_PLANNING
  | typeof TAG_IMPLEMENTATION
  | typeof TAG_REVIEW
  | typeof TAG_DEVOPS
  | typeof TAG_MAINTENANCE
  | typeof TAG_ORCHESTRATION
  | typeof TAG_BOARD
  | typeof TAG_PERFORMANCE
  | typeof TAG_AI;

export interface ContentPreset {
  id: PresetId;
  name: string;
  description: string;
  /**
   * Positive capability list. An item is admitted by the capability gate when
   * any of its capability-tagged tags intersect this list. Floor:* tags are
   * NOT listed — they are admitted unconditionally for every non-custom preset.
   */
  capabilities: ReadonlyArray<CapabilityTag>;
  /**
   * Whether the customize family (TAG_CUSTOMIZE-tagged artifacts) is included.
   * Locked decision: false for `minimal`, true for `standard` and `full`,
   * false for `custom` (honoured only when the explicit ID list is empty).
   *
   * Why a typed boolean rather than just another capability tag (D2-SA2.6-F05):
   * capability tags express a semantic match against a *kind of work* the
   * preset asks for (planning, review, devops…), and the capability gate
   * admits an item when its tags intersect the preset's `capabilities`.
   * `customize` is not a kind of work — it is a workflow facet: the user
   * opting INTO the `.hatch3r/{type}/*.customize.yaml` authoring flow. Modeling
   * it as a per-preset boolean keeps that opt-in a maintainer-locked decision
   * (this field) instead of leaking it into the semantic-match capability set,
   * where a future preset could admit it implicitly. Do not migrate this into
   * `capabilities`; that would conflate workflow opt-in with work-type match.
   */
  includeCustomize: boolean;
  /**
   * Optional per-id additive override — admits a specific artifact whose
   * capability tags do not intersect the preset's capabilities. Used sparingly;
   * the capability gate should cover the common case. Registry uses:
   * `full.includeIds` carries `hatch3r-capability-matrix` (D5-SA5.4-09 +
   * CI-RECON-05), and — release/2.8.5 — `monorepo` and `web-app` carry the
   * same entry so their "vs Full" description claims are literally true
   * (without it both silently dropped exactly that one artifact); every other
   * registry preset leaves this unset.
   */
  includeIds?: ReadonlyArray<string>;
  /**
   * Optional per-id subtractive override — removes a specific artifact without
   * retagging it. Floor and protected items still survive — those invariants
   * cannot be reversed by a preset's excludeIds list. Empty for all presets at
   * launch.
   */
  excludeIds?: ReadonlyArray<string>;
  /**
   * Human-readable names of the capability clusters this preset's positive
   * `capabilities` list does NOT request relative to `full` — the capability
   * *intent* gap (e.g. "AI feature engineering", "performance"). Empty for
   * `full` (requests everything) and `custom` (user picks; nothing implied).
   * Derived from the gap between this preset's `capabilities` and `full`'s; see
   * `omittedCapabilityClusters` for the audited invariant tying the two.
   *
   * D10-12 (Cycle 11 Wave 2): this is intent, not realized exclusion. Floor
   * admission ships every `floor:*` item regardless of preset, so a cluster
   * named here can still ship most of its members. The picker's user-facing
   * "omits:" line is computed from the realized post-floor delta by
   * `presetOmittedClusters` (`content/index.ts`), NOT from this field. Kept for
   * the dial/intent view and the anti-drift length invariant.
   */
  omits: ReadonlyArray<string>;
}

export const PRESETS: ContentPreset[] = [
  {
    id: "minimal",
    name: "Minimal",
    description:
      "Capability dial set to the core orchestration pipeline, plus the " +
      "security, UI/UX & content-quality floor (ships at every tier). " +
      "Non-floor planning/review/devops/board helpers are off — pick " +
      "Standard or Full to dial them in.",
    capabilities: [TAG_ORCHESTRATION, TAG_IMPLEMENTATION],
    includeCustomize: false,
    omits: [
      "planning",
      "review",
      "devops",
      "maintenance",
      "board",
      "AI feature engineering",
      "performance",
    ],
  },
  {
    id: "standard",
    name: "Standard (recommended)",
    description:
      "Full development lifecycle (planning, implementation, review, devops, " +
      "maintenance, board, customize) plus the security, UI/UX & " +
      "content-quality floor. The performance and AI feature-engineering dials " +
      "are off — pick Full to turn them on.",
    capabilities: [
      TAG_ORCHESTRATION,
      TAG_PLANNING,
      TAG_IMPLEMENTATION,
      TAG_REVIEW,
      TAG_DEVOPS,
      TAG_MAINTENANCE,
      TAG_BOARD,
    ],
    includeCustomize: true,
    omits: ["AI feature engineering", "performance"],
  },
  {
    id: "full",
    name: "Full",
    description:
      "Everything — every capability including AI feature engineering and " +
      "performance, plus the security, UI/UX & content-quality floor and " +
      "customize.",
    capabilities: [
      TAG_ORCHESTRATION,
      TAG_PLANNING,
      TAG_IMPLEMENTATION,
      TAG_REVIEW,
      TAG_DEVOPS,
      TAG_MAINTENANCE,
      TAG_BOARD,
      TAG_PERFORMANCE,
      TAG_AI,
    ],
    includeCustomize: true,
    // D5-SA5.4-09 reconciliation (CI-RECON-05, Cycle 12): the wave-3 fix
    // removed `floor:content-quality` from `rules/hatch3r-capability-matrix.md`
    // because the rule is framework-internal (it governs hatch3r's own
    // per-cycle adapter audit, inert in consumer repos) and must stay
    // user-disableable — a floor tag rejects `enabled: false` at customization
    // layer 2. Its remaining tags (adapters/currency/capability) are refinement
    // tags outside the 9-tag preset-positive union, so without this carve-out
    // NO preset would ship it. Per the finding's own intent ("until then it
    // ships as canonical content"), `full` — the everything preset — admits it
    // explicitly here; minimal/standard and the other archetypes deliberately
    // exclude it (release/2.8.5: `monorepo` and `web-app` carry the same
    // carve-out because their descriptions promise full-parity minus named
    // dials — see their includeIds comments).
    // Retagging with a lifecycle capability tag was rejected: capability tags
    // express a semantic work-type match (see CapabilityTag JSDoc), which a
    // framework-internal audit procedure does not have for end-user work.
    includeIds: ["hatch3r-capability-matrix"],
    // Full is the capability superset, so it omits nothing.
    omits: [],
    // v1.9.0 toolbox consolidation: tier-3 CLI tools are now sections inside
    // `hatch3r-cli-toolbox` (consolidated from the 25 former per-tool skill
    // files). The toolbox skill is itself capability-tagged so the gate
    // admits it without an explicit id override. The cliTools picker still
    // governs installation of the underlying binaries as tier-3 opt-in.
  },
  // ── Project-archetype presets ────────────────────────────────────
  // Each archetype is a capability subset of `full` shaped for one project
  // shape (web app, backend service, CLI, monorepo, brownfield, security).
  // The security & UI/UX & content-quality floor is admitted unconditionally
  // by `resolveSelection`, so floor capabilities are not listed here — only
  // the capability-gate positive list per archetype.
  {
    id: "web-app",
    name: "Web App",
    description:
      "Full-stack web archetype — the whole lifecycle including board + " +
      "performance, plus the security, UI/UX & content-quality floor. The AI " +
      "feature-engineering dial is off vs Full.",
    capabilities: [
      TAG_ORCHESTRATION,
      TAG_PLANNING,
      TAG_IMPLEMENTATION,
      TAG_REVIEW,
      TAG_DEVOPS,
      TAG_MAINTENANCE,
      TAG_BOARD,
      TAG_PERFORMANCE,
    ],
    includeCustomize: true,
    // release/2.8.5 copy-vs-actual reconciliation: the description claims only
    // the AI dial is off vs Full, but without full's includeIds carve-out this
    // archetype ALSO silently dropped `hatch3r-capability-matrix` (the one
    // refinement-only artifact, admitted to full by id — see full.includeIds).
    // Carry the same carve-out so the "only the AI dial differs" claim is
    // literally true; guarded by presets.test.ts + compound.test.ts.
    includeIds: ["hatch3r-capability-matrix"],
    omits: ["AI feature engineering"],
  },
  {
    id: "api-service",
    name: "API Service",
    description:
      "Backend-service archetype — lifecycle with performance, plus the " +
      "security, UI/UX & content-quality floor. The board and AI " +
      "feature-engineering dials are off vs Full.",
    capabilities: [
      TAG_ORCHESTRATION,
      TAG_PLANNING,
      TAG_IMPLEMENTATION,
      TAG_REVIEW,
      TAG_DEVOPS,
      TAG_MAINTENANCE,
      TAG_PERFORMANCE,
    ],
    includeCustomize: true,
    omits: ["board", "AI feature engineering"],
  },
  {
    id: "cli-tool",
    name: "CLI Tool",
    description:
      "Command-line-tool archetype — planning through devops + maintenance, " +
      "plus the security, UI/UX & content-quality floor. The board, " +
      "performance, and AI feature-engineering dials are off vs Full.",
    capabilities: [
      TAG_ORCHESTRATION,
      TAG_PLANNING,
      TAG_IMPLEMENTATION,
      TAG_REVIEW,
      TAG_DEVOPS,
      TAG_MAINTENANCE,
    ],
    includeCustomize: true,
    omits: ["board", "performance", "AI feature engineering"],
  },
  {
    id: "monorepo",
    name: "Monorepo",
    description:
      "Multi-package-workspace archetype — every capability (the Full " +
      "superset) plus the security, UI/UX & content-quality floor. Drops " +
      "nothing vs Full.",
    capabilities: [
      TAG_ORCHESTRATION,
      TAG_PLANNING,
      TAG_IMPLEMENTATION,
      TAG_REVIEW,
      TAG_DEVOPS,
      TAG_MAINTENANCE,
      TAG_BOARD,
      TAG_PERFORMANCE,
      TAG_AI,
    ],
    includeCustomize: true,
    // release/2.8.5 copy-vs-actual reconciliation: the description promises
    // "Drops nothing vs Full", but capability parity alone missed full's
    // per-id includeIds carve-out (`hatch3r-capability-matrix`), leaving the
    // realized selection at N-1 of full. Carry the same carve-out so the
    // promise is literally true; guarded by presets.test.ts + compound.test.ts.
    includeIds: ["hatch3r-capability-matrix"],
    // Monorepo carries the full capability superset, so it omits nothing.
    omits: [],
  },
  {
    id: "legacy",
    name: "Legacy / Brownfield",
    description:
      "Brownfield-maintenance archetype — implementation through devops + " +
      "maintenance, plus the security, UI/UX & content-quality floor. The " +
      "planning, board, performance, and AI feature-engineering dials are off " +
      "vs Full.",
    capabilities: [
      TAG_ORCHESTRATION,
      TAG_IMPLEMENTATION,
      TAG_REVIEW,
      TAG_DEVOPS,
      TAG_MAINTENANCE,
    ],
    includeCustomize: true,
    omits: ["planning", "board", "performance", "AI feature engineering"],
  },
  {
    id: "security",
    name: "Security-Focused",
    description:
      "Security review + hardening archetype — implementation, review, " +
      "maintenance, plus the security, UI/UX & content-quality floor. The " +
      "planning, devops, board, performance, and AI feature-engineering dials " +
      "are off vs Full.",
    capabilities: [
      TAG_ORCHESTRATION,
      TAG_IMPLEMENTATION,
      TAG_REVIEW,
      TAG_MAINTENANCE,
    ],
    includeCustomize: false,
    omits: ["planning", "devops", "board", "performance", "AI feature engineering"],
  },
  {
    id: "custom",
    name: "Custom",
    description: "Choose exactly what you need.",
    capabilities: [],
    includeCustomize: false,
    // Custom is user-driven; nothing is implied as omitted.
    omits: [],
  },
];

/** Look up a content preset by ID. Throws if the preset does not exist. */
export function getPreset(id: PresetId): ContentPreset {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new HatchError(`Unknown preset: ${id}`, 1, "VALIDATION_ERROR");
  return preset;
}

/**
 * Every registry preset id, derived from {@link PRESETS} so the CLI
 * `--preset` validation lists cannot drift from the array. Includes `custom`.
 */
export const KNOWN_PRESET_IDS: readonly PresetId[] = PRESETS.map((p) => p.id);

/**
 * Resolve a `--preset` CLI arg to a {@link ContentPreset}. A single id →
 * {@link getPreset}. A comma-list `"a,b"` → {@link composePresets} of each
 * part (each part must be a known non-custom preset id; composing with
 * `custom` throws, per `composePresets`). Trims parts, ignores empty segments.
 *
 * @throws {HatchError} VALIDATION_ERROR — via `getPreset`/`composePresets` —
 *   on an unknown id, on an empty/all-empty arg, or when a multi-part arg
 *   contains `custom`.
 */
export function resolvePresetArg(arg: string): ContentPreset {
  const ids = arg
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (ids.length === 0) {
    throw new HatchError(
      `Empty --preset: "${arg}". Pass one of ${KNOWN_PRESET_IDS.join(", ")} or a comma-list to compose.`,
      1,
      "VALIDATION_ERROR",
    );
  }
  if (ids.length === 1) {
    return getPreset(ids[0] as PresetId);
  }
  // getPreset throws on an unknown part; composePresets throws on `custom`.
  return composePresets(ids.map((id) => getPreset(id as PresetId)));
}

/**
 * Capability tags carried by `full` — the capability superset every other
 * preset is measured against. `custom` is excluded from the comparison set
 * because it carries no implied capabilities (the user picks explicitly).
 * Exported so the realized-exclusion derivation in `content/index.ts`
 * (`presetOmittedClusters`) can order its cluster labels in the same
 * superset order without redefining the list (P4 single-source-of-truth).
 */
export const FULL_CAPABILITY_SUPERSET: ReadonlyArray<CapabilityTag> =
  PRESETS.find((p) => p.id === "full")?.capabilities ?? [];

/**
 * Capability *intent* tags this preset drops relative to `full` — the
 * capability clusters absent from the preset's positive `capabilities` list.
 * The single source of truth tying the human-readable `omits` labels to the
 * actual `capabilities` arrays so the two cannot silently diverge (D10 F10.6-1:
 * exclusion data must be derivable). `full` returns `[]`; `custom` returns `[]`.
 *
 * D10-12 (Cycle 11 Wave 2): this is the capability *intent* gap, NOT the set of
 * clusters whose items are actually dropped from a generated repo. Floor
 * admission (`resolveSelection` stage 2) ships every `floor:*`-tagged item for
 * every preset, so a cluster listed here (e.g. "review" under `minimal`) can
 * still have most of its members shipped via floor — making this an over-count
 * of realized exclusion. The user-facing picker line is driven by
 * `presetOmittedClusters(preset, index)` in `content/index.ts`, which computes
 * the realized post-floor selection delta. Keep this function for the
 * intent/dial view + the anti-drift `omits`-length invariant; do not render it
 * to users as "what gets dropped". Verified in
 * `src/__tests__/content/presets.test.ts`.
 */
export function omittedCapabilityClusters(
  preset: ContentPreset,
): ReadonlyArray<CapabilityTag> {
  if (preset.id === "custom") return [];
  const present = new Set<string>(preset.capabilities);
  return FULL_CAPABILITY_SUPERSET.filter((cap) => !present.has(cap));
}

/**
 * Human-readable label for a capability tag, as it appears in the `omits`
 * arrays and prompt-renderer exclusion text. Every capability is its own
 * label except `TAG_AI`, which expands to "AI feature engineering" (the bare
 * tag value "ai" reads as an acronym in the picker). Single source of truth so
 * the hand-written `omits` labels, `composePresets`-derived labels, and the
 * realized-exclusion labels in `content/index.ts` (`presetOmittedClusters`)
 * stay in lockstep. Exported (not file-private) for that third consumer.
 */
export function capabilityLabel(cap: CapabilityTag): string {
  return cap === TAG_AI ? "AI feature engineering" : cap;
}

/**
 * Derive the `omits` label list for a capability set, in `full`-superset order,
 * using {@link capabilityLabel}. A capability is omitted when it is absent from
 * `capabilities`. Backs both the per-preset `omits` invariant (via
 * `omittedCapabilityClusters`) and the `composePresets` recomputation so the
 * two derivations cannot diverge.
 */
function deriveOmitLabels(
  capabilities: ReadonlyArray<CapabilityTag>,
): string[] {
  const present = new Set<string>(capabilities);
  return FULL_CAPABILITY_SUPERSET.filter((cap) => !present.has(cap)).map(
    capabilityLabel,
  );
}

/**
 * Compose 2+ (or a single) presets into one synthetic preset for the
 * `--preset a,b` CLI flow. Pure and total over valid input:
 *
 * - `capabilities` — de-duplicated union of all inputs' capabilities, in
 *   `full`-superset order so the result is deterministic regardless of input
 *   order.
 * - `includeCustomize` — true when ANY input opts in (OR).
 * - `includeIds` / `excludeIds` — de-duplicated union of each, omitted when
 *   the union is empty.
 * - `omits` — recomputed from the union via {@link deriveOmitLabels}: a
 *   capability is omitted only when NONE of the composed presets carry it.
 * - `id` — always "custom" (the composite is synthetic, not a registry id);
 *   the inputs' names are joined with " + " into `name` (e.g. "Web App +
 *   Security-Focused") so the picker can label the composite.
 *
 * A single-preset input returns an equivalent preset (same capability set,
 * customize flag, and omits).
 *
 * @throws {HatchError} VALIDATION_ERROR when fewer than 1 preset is supplied,
 *   or when any input is the `custom` preset (custom is user-driven per-item
 *   selection, not a composable capability subset).
 */
export function composePresets(presets: ContentPreset[]): ContentPreset {
  if (presets.length < 1) {
    throw new HatchError(
      "composePresets requires at least 1 preset",
      1,
      "VALIDATION_ERROR",
    );
  }
  const customInput = presets.find((p) => p.id === "custom");
  if (customInput) {
    throw new HatchError(
      "composePresets cannot compose the `custom` preset (custom is user-driven, not composable)",
      1,
      "VALIDATION_ERROR",
    );
  }

  const capabilitySet = new Set<string>();
  for (const preset of presets) {
    for (const cap of preset.capabilities) capabilitySet.add(cap);
  }
  // Emit in full-superset order so the union is order-independent.
  const capabilities = FULL_CAPABILITY_SUPERSET.filter((cap) =>
    capabilitySet.has(cap),
  );

  const includeIds = unionIds(presets.map((p) => p.includeIds));
  const excludeIds = unionIds(presets.map((p) => p.excludeIds));

  return {
    id: "custom",
    name: presets.map((p) => p.name).join(" + "),
    description: `Composed preset: ${presets.map((p) => p.name).join(" + ")}.`,
    capabilities,
    includeCustomize: presets.some((p) => p.includeCustomize),
    ...(includeIds.length > 0 ? { includeIds } : {}),
    ...(excludeIds.length > 0 ? { excludeIds } : {}),
    omits: deriveOmitLabels(capabilities),
  };
}

/** De-duplicated union of zero-or-more optional id lists, preserving first-seen order. */
function unionIds(
  lists: ReadonlyArray<ReadonlyArray<string> | undefined>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const id of list ?? []) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}
