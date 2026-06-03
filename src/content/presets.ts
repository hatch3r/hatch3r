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
   * the capability gate should cover the common case. Empty for all presets at
   * launch.
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
   * Human-readable names of the capability clusters this preset OMITS relative
   * to `full` (the capability superset). Lets the prompt renderer name what a
   * preset drops — e.g. "AI feature engineering", "performance" — instead of
   * only emitting a `(excludes N of M)` count (D10 F10.6-1 / F10.6-10). Empty
   * for `full` (omits nothing) and `custom` (user picks; nothing is implied).
   * Derived from the gap between this preset's `capabilities` and `full`'s; see
   * `omittedCapabilityClusters` for the audited invariant tying the two.
   */
  omits: ReadonlyArray<string>;
}

export const PRESETS: ContentPreset[] = [
  {
    id: "minimal",
    name: "Minimal",
    description:
      "Core orchestration pipeline plus the security & UI/UX floor. " +
      "Drops planning, review, devops, maintenance, board, AI, and " +
      "performance — pick Standard or Full to add them.",
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
      "maintenance, board, customize) plus the security & UI/UX floor. Drops " +
      "AI feature engineering + performance — pick Full if you need those.",
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
      "performance, plus floor and customize.",
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
      "performance, plus the floor. Drops AI feature engineering vs Full.",
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
    omits: ["AI feature engineering"],
  },
  {
    id: "api-service",
    name: "API Service",
    description:
      "Backend-service archetype — lifecycle with performance, plus the " +
      "floor. Drops board + AI feature engineering vs Full.",
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
      "plus the floor. Drops board + performance + AI feature engineering vs Full.",
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
      "superset) plus the floor. Drops nothing vs Full.",
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
    // Monorepo carries the full capability superset, so it omits nothing.
    omits: [],
  },
  {
    id: "legacy",
    name: "Legacy / Brownfield",
    description:
      "Brownfield-maintenance archetype — implementation through devops + " +
      "maintenance, plus the floor. Drops planning + board + performance + " +
      "AI feature engineering vs Full.",
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
      "maintenance, plus the floor:security + content-quality specialists. " +
      "Drops planning + devops + board + performance + AI feature engineering vs Full.",
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
 */
const FULL_CAPABILITY_SUPERSET: ReadonlyArray<CapabilityTag> =
  PRESETS.find((p) => p.id === "full")?.capabilities ?? [];

/**
 * Capability tags this preset drops relative to `full`. The single source of
 * truth tying the human-readable `omits` labels to the actual `capabilities`
 * arrays so the two cannot silently diverge (D10 F10.6-1: exclusion data must
 * be derivable, not implicit). `full` returns `[]`; `custom` returns `[]`
 * (no implied capabilities to omit). Verified against `omits` length in
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
 * the hand-written `omits` labels and `composePresets`-derived labels stay in
 * lockstep with `omittedCapabilityClusters`.
 */
function capabilityLabel(cap: CapabilityTag): string {
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
