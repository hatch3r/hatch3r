import { getAllContentIds, TYPE_TO_SELECTION_KEY } from "../content/index.js";
import type { CliToolId, CliToolsConfig, ContentSelection, Features, McpConfig, ModelConfig, Platform, Tool } from "../types.js";
import type { WorkspaceDefaults, WorkspaceGroupDelta, WorkspaceRepoOverrides } from "./types.js";

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
 * Merge workspace defaults with the matched group-layer deltas and per-repo
 * overrides to produce effective config.
 *
 * Layer order (each later layer wins on conflict, per the
 * `WorkspaceDefaults.groups` / `WorkspaceRepoEntry.groups` contract):
 * `defaults` -> `groupDeltas[0..n-1]` (caller-resolved, in the repo's declared
 * group order) -> `overrides`.
 *
 * Per-field merge rules (applied uniformly across every layer):
 * - tools: a layer with `tools` replaces entirely (not merged); last layer wins
 * - features: partial merge (each layer's values override the prior layer)
 * - mcp: a layer with `mcp` replaces entirely; last layer wins
 * - content: base + include - exclude applied layer-by-layer; unconditionally
 *   admitted items (`protected` OR any `floor:*` tag) and workspace-locked
 *   items cannot be excluded by any layer
 * - models: deep merge (later-layer agent overrides take precedence)
 * - platform: a layer with `platform` replaces (groups carry no platform — only
 *   defaults + overrides — so this is unchanged by the group layer)
 *
 * @param unconditionalIds - IDs of items admitted unconditionally per the
 *   universal-floor invariant (built via `admitsUnconditionally` in `sync.ts`).
 *   A per-repo OR group-layer `exclude` entry naming one of these IDs is a no-op
 *   (D16-2, Cycle 11): the exclude path previously skipped only `protected`
 *   IDs, letting an override drop a `floor:*` artifact.
 * @param groupDeltas - The `WorkspaceGroupDelta` bundles matched to this repo,
 *   already resolved from `WorkspaceRepoEntry.groups[]` names to
 *   `WorkspaceDefaults.groups[name]` values in the caller (`sync.ts`), in the
 *   repo's declared order. Unknown group names are dropped (with a `verbose()`
 *   warning) before this function sees them. Omitted/empty = the legacy
 *   two-layer (defaults + overrides) merge (D14-M4; resolution-time wiring
 *   added D1-10, Cycle 11 — the deltas were validated and persisted but never
 *   applied before this).
 */
export function resolveRepoConfig(
  defaults: WorkspaceDefaults,
  overrides?: WorkspaceRepoOverrides,
  unconditionalIds?: Set<string>,
  groupDeltas?: WorkspaceGroupDelta[],
): ResolvedRepoConfig {
  const deltas = groupDeltas ?? [];

  // tools: last layer that declares `tools` wins (replace semantics). Walk
  // defaults -> groups -> overrides and keep the final declared array.
  let tools = defaults.tools;
  for (const delta of deltas) if (delta.tools) tools = delta.tools;
  if (overrides?.tools) tools = overrides.tools;

  // features: partial merge across every layer, later wins.
  let features = { ...defaults.features } as Features;
  for (const delta of deltas) features = { ...features, ...(delta.features ?? {}) } as Features;
  features = { ...features, ...(overrides?.features ?? {}) } as Features;

  // mcp: last layer that declares `mcp` wins (replace semantics).
  let mcp = defaults.mcp;
  for (const delta of deltas) if (delta.mcp) mcp = delta.mcp;
  if (overrides?.mcp) mcp = overrides.mcp;

  const platform = overrides?.platform ?? defaults.platform;

  // Models: deep merge (later-layer agent-level overrides take precedence).
  // D1-SA1.9-F9 (Cycle 10): structuredClone the assembled result so the
  // returned config shares no nested object references with `defaults.models`,
  // a group delta, or `overrides.models`. The object spread only copies one
  // level, so without the clone a caller mutating
  // `result.models.agents.<id>.<field>` would corrupt the workspace defaults
  // in memory across `syncSingleRepo` calls.
  const modelLayers = [defaults.models, ...deltas.map((d) => d.models), overrides?.models];
  let models: ModelConfig | undefined;
  if (modelLayers.some((m) => m)) {
    let merged: ModelConfig = {};
    for (const layer of modelLayers) {
      if (!layer) continue;
      merged = {
        ...merged,
        ...layer,
        agents: { ...merged.agents, ...layer.agents },
      };
    }
    models = structuredClone(merged);
    if (!models.default && (!models.agents || Object.keys(models.agents).length === 0)) {
      models = undefined;
    }
  }

  // Content: start from workspace, apply each layer's include/exclude in
  // order (groups in declared order, then the per-repo override). `contentIds`
  // is the authoritative effective set; `excludedContent` / `addedContent`
  // are net-delta reports (a later include that re-adds an earlier-excluded id
  // un-records the exclude, and vice versa) so they describe the final state.
  const contentIds = getAllContentIds(defaults.content);
  const excludedContent: string[] = [];
  const addedContent: string[] = [];

  // D14-M7 (Cycle 10): Locked content IDs from workspace defaults cannot be
  // excluded by any layer. The lock is checked alongside the protected-id
  // check below so team-lead-declared invariants behave the same way as
  // framework-declared invariants.
  const lockedContentSet = new Set<string>(defaults.lockedContent ?? []);

  const removeFrom = (arr: string[], id: string): void => {
    const i = arr.indexOf(id);
    if (i !== -1) arr.splice(i, 1);
  };

  const applyContentDelta = (
    co: { include?: string[]; exclude?: string[] } | undefined,
  ): void => {
    if (!co) return;
    for (const id of co.exclude ?? []) {
      // D16-2 (Cycle 11): unconditionally-admitted items (`protected` OR any
      // `floor:*` tag) cannot be excluded — the universal-floor invariant
      // outranks a per-repo OR group-layer exclude. Previously only
      // `protected` was honoured here, so an override could strip a
      // floor-tagged-unprotected security or UI/UX artifact.
      if (unconditionalIds?.has(id)) continue;
      // D14-M7: locked content set by the workspace lead cannot be excluded.
      if (lockedContentSet.has(id)) continue;
      if (contentIds.has(id)) {
        contentIds.delete(id);
        excludedContent.push(id);
        removeFrom(addedContent, id);
      }
    }
    for (const id of co.include ?? []) {
      if (!contentIds.has(id)) {
        contentIds.add(id);
        addedContent.push(id);
        removeFrom(excludedContent, id);
      }
    }
  };

  // Group layer first (declared order), then the per-repo override last so the
  // override remains the highest-priority content delta.
  for (const delta of deltas) applyContentDelta(delta.contentOverrides);
  applyContentDelta(overrides?.contentOverrides);

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
