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

export type PresetId = "minimal" | "standard" | "full" | "custom";

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
