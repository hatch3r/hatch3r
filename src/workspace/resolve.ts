import { getAllContentIds, TYPE_TO_SELECTION_KEY } from "../content/index.js";
import type { CliToolId, CliToolsConfig, ContentSelection, Features, McpConfig, ModelConfig, Platform, Tool } from "../types.js";
import type { WorkspaceDefaults, WorkspaceRepoOverrides } from "./types.js";

export interface ResolvedRepoConfig {
  platform?: Platform;
  tools: Tool[];
  features: Features;
  mcp: McpConfig;
  models?: ModelConfig;
  /** Effective content IDs after merge (workspace base + include - exclude). */
  contentIds: Set<string>;
  /** Content IDs excluded by the repo override. */
  excludedContent: string[];
  /** Content IDs added by the repo override. */
  addedContent: string[];
  /**
   * Effective CLI tools after applying workspace defaults plus per-member
   * `localCliTools` / `excludedCliTools`. Absent when the workspace has no
   * `defaults.cliTools` configured.
   */
  cliTools?: CliToolsConfig;
}

/**
 * Merge workspace defaults with per-repo overrides to produce effective config.
 *
 * Merge rules:
 * - tools: repo overrides replace entirely (not merged)
 * - features: partial merge (repo values override workspace values)
 * - mcp: repo overrides replace entirely
 * - content: workspace base + include - exclude (protected items cannot be excluded)
 * - models: deep merge (repo agent overrides take precedence)
 * - platform: repo overrides replace
 */
export function resolveRepoConfig(
  defaults: WorkspaceDefaults,
  overrides?: WorkspaceRepoOverrides,
  protectedIds?: Set<string>,
): ResolvedRepoConfig {
  const tools = overrides?.tools ?? defaults.tools;
  const features = { ...defaults.features, ...(overrides?.features ?? {}) } as Features;
  const mcp = overrides?.mcp ?? defaults.mcp;
  const platform = overrides?.platform ?? defaults.platform;

  // Models: deep merge (agent-level overrides take precedence)
  let models: ModelConfig | undefined;
  if (defaults.models || overrides?.models) {
    models = {
      ...defaults.models,
      ...overrides?.models,
      agents: {
        ...defaults.models?.agents,
        ...overrides?.models?.agents,
      },
    };
    if (!models.default && !models.agents) models = undefined;
  }

  // Content: start from workspace, apply include/exclude
  const contentIds = getAllContentIds(defaults.content);
  const excludedContent: string[] = [];
  const addedContent: string[] = [];

  // D14-M7 (Cycle 10): Locked content IDs from workspace defaults cannot be
  // excluded by a per-repo override. The lock is checked alongside the
  // protected-id check below so team-lead-declared invariants behave the
  // same way as framework-declared invariants.
  const lockedContentSet = new Set<string>(defaults.lockedContent ?? []);

  if (overrides?.contentOverrides?.exclude) {
    for (const id of overrides.contentOverrides.exclude) {
      // Protected items cannot be excluded
      if (protectedIds?.has(id)) continue;
      // D14-M7: locked content set by the workspace lead cannot be excluded.
      if (lockedContentSet.has(id)) continue;
      if (contentIds.has(id)) {
        contentIds.delete(id);
        excludedContent.push(id);
      }
    }
  }

  if (overrides?.contentOverrides?.include) {
    for (const id of overrides.contentOverrides.include) {
      if (!contentIds.has(id)) {
        contentIds.add(id);
        addedContent.push(id);
      }
    }
  }

  // D14-M7: Make sure every locked content ID is admitted, even if the
  // workspace base selection somehow omitted it (e.g. a workspace
  // operator added `lockedContent` after the base selection was
  // computed).
  for (const id of lockedContentSet) {
    if (!contentIds.has(id)) {
      contentIds.add(id);
      addedContent.push(id);
    }
  }

  return {
    platform,
    tools,
    features,
    mcp,
    models,
    contentIds,
    excludedContent,
    addedContent,
    cliTools: defaults.cliTools,
  };
}

/**
 * Apply workspace `defaults.cliTools` to a member's effective selection,
 * honouring member-local `localCliTools` (added) and `excludedCliTools`
 * (removed). Mirrors the content `localContent` / `excludedContent`
 * semantics: exclusion wins (consistent with plan §4.8).
 */
export function applyMemberCliToolsOverrides(
  workspaceDefault: CliToolsConfig | undefined,
  memberLocal: CliToolId[] | undefined,
  memberExcluded: CliToolId[] | undefined,
): CliToolsConfig | undefined {
  if (!workspaceDefault && (!memberLocal || memberLocal.length === 0)) {
    return undefined;
  }
  const base = new Set<CliToolId>(workspaceDefault?.selected ?? []);
  for (const id of memberLocal ?? []) base.add(id);
  for (const id of memberExcluded ?? []) base.delete(id);
  const selected = [...base];
  return {
    enabled: selected.length > 0,
    selected,
  };
}

/**
 * Build a ContentSelection object from a set of content IDs and the
 * workspace base selection (to preserve preset/projectType/teamSize metadata).
 */
export function buildSelectionFromIds(
  ids: Set<string>,
  baseSelection: ContentSelection,
  allItems: { id: string; type: string }[],
): ContentSelection {
  const items: ContentSelection["items"] = {
    agents: [],
    skills: [],
    rules: [],
    commands: [],
    prompts: [],
    hooks: [],
    githubAgents: [],
  };

  for (const item of allItems) {
    if (!ids.has(item.id)) continue;
    const key = TYPE_TO_SELECTION_KEY[item.type];
    if (key) items[key].push(item.id);
  }

  return {
    preset: "custom",
    projectType: baseSelection.projectType,
    teamSize: baseSelection.teamSize,
    items,
  };
}
