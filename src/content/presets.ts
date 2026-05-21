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
}

export const PRESETS: ContentPreset[] = [
  {
    id: "minimal",
    name: "Minimal",
    description:
      "Core orchestration pipeline plus the security & UI/UX floor. " +
      "Smallest viable preset that still ships the non-negotiable invariants.",
    capabilities: [TAG_ORCHESTRATION, TAG_IMPLEMENTATION],
    includeCustomize: false,
  },
  {
    id: "standard",
    name: "Standard (recommended)",
    description:
      "Full development lifecycle including board, customize, and the " +
      "security & UI/UX floor. The default for most projects.",
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
  },
];

/** Look up a content preset by ID. Throws if the preset does not exist. */
export function getPreset(id: PresetId): ContentPreset {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new HatchError(`Unknown preset: ${id}`, 1, "VALIDATION_ERROR");
  return preset;
}
