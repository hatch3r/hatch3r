import type { CliToolsConfig, ContentSelection, Features, McpConfig, ModelConfig, Platform, Tool } from "../types.js";

// ── Workspace Manifest ──────────────────────────────────────────

export interface WorkspaceManifest {
  /** Workspace manifest schema version. */
  version: string;
  /** hatch3r version that created/last updated this workspace. */
  hatch3rVersion: string;
  /** Workspace display name. */
  name: string;
  /** Registered sub-repos. */
  repos: WorkspaceRepoEntry[];
  /** Default settings inherited by all sub-repos. */
  defaults: WorkspaceDefaults;
  /** When sub-repos are synced: "manual" or "on-sync" (cascade from hatch3r sync). */
  syncStrategy: "manual" | "on-sync";
}

export interface WorkspaceDefaults {
  platform?: Platform;
  tools: Tool[];
  features: Features;
  mcp: McpConfig;
  content: ContentSelection;
  models?: ModelConfig;
  /**
   * CLI-tooling pivot (1.7.5 / plan §4.8 workspace parity). Defaults applied
   * to every member at workspace sync time, subject to per-member
   * `localCliTools` / `excludedCliTools` overrides. Optional — pre-1.7.5
   * workspace manifests omit it and members fall back to their own selection.
   */
  cliTools?: CliToolsConfig;
  /**
   * D14-M4 (Cycle 10 rollover): Team / role groupings that sit between the
   * workspace defaults and per-repo overrides. Each group is a named bundle
   * of `Tool[]`, `Features` (partial), `mcp`, and `ContentSelection` deltas
   * applied to every repo that names the group in `WorkspaceRepoEntry.groups[]`.
   *
   * Layered merge order at sync time: workspace defaults -> matched
   * `groups[<name>]` deltas (in declared order) -> per-repo `overrides`. Each
   * later layer wins on conflict, mirroring the existing
   * defaults-then-overrides chain.
   *
   * Optional — pre-D14-M4 workspace manifests omit it and members fall back
   * to the two-layer (defaults + overrides) merge. Backwards-compatible
   * because the runtime treats the group layer as zero-deltas when absent.
   */
  groups?: Record<string, WorkspaceGroupDelta>;
  /**
   * D14-M7 (Cycle 10 rollover): Workspace-mandatory content IDs that no
   * per-repo override can drop. The workspace sync treats each entry as an
   * always-admitted item even if a repo's `contentOverrides.exclude` lists
   * it. Team leads use this to anchor a security baseline (`hatch3r-security-patterns`,
   * etc.) so a downstream repo cannot silently disable it via local
   * customization.
   *
   * Optional — empty/omitted = no locked items. The enforcement is a
   * structural filter applied after the per-repo override merge; see
   * `WorkspaceManifest.repos[].overrides.contentOverrides.exclude` for the
   * pairing.
   */
  lockedContent?: string[];
}

/**
 * D14-M4 (Cycle 10 rollover): Subset of `WorkspaceDefaults` applied as a
 * group-layer delta. Excludes the identity / structural fields (platform,
 * cliTools.enabled flag) so a group cannot redefine the project shape;
 * groups are scoped to *additive* configuration deltas.
 *
 * Fields are all optional — a group may carry only the deltas it needs
 * (e.g. a `security-lead` group might only set `mcp` + `tools[]`; a
 * `frontend` group might only inject `features.<flag>`).
 */
export interface WorkspaceGroupDelta {
  /** Replaces the previous-layer tools entirely. */
  tools?: Tool[];
  /** Partial merge on top of the previous-layer features. */
  features?: Partial<Features>;
  /** Replaces the previous-layer MCP config entirely. */
  mcp?: McpConfig;
  /**
   * Content additions / removals applied as deltas. Add-and-remove
   * semantics mirror `WorkspaceRepoOverrides.contentOverrides`.
   */
  contentOverrides?: {
    include?: string[];
    exclude?: string[];
  };
  models?: ModelConfig;
}

// ── Repo Entries ────────────────────────────────────────────────

export interface WorkspaceRepoEntry {
  /** Relative path from workspace root (e.g. "api-service"). */
  path: string;
  /** Display name (defaults to directory name). */
  name?: string;
  /** Whether workspace sync propagates content to this repo. */
  sync: boolean;
  /** Per-repo overrides merged on top of workspace defaults. */
  overrides?: WorkspaceRepoOverrides;
  /** ISO timestamp of last successful sync. */
  lastSync?: string;
  /** Git remote owner (org/user). Auto-detected from sub-repo remote. */
  owner?: string;
  /** Git remote repository name. Auto-detected from sub-repo remote. */
  repo?: string;
  /** Default branch for this repo. Auto-detected from sub-repo. */
  defaultBranch?: string;
  /** Platform for this repo. Auto-detected from remote URL. */
  platform?: Platform;
  /**
   * D14-M4 (Cycle 10 rollover): Named groups whose deltas apply to this
   * repo. Each name must match a key in `WorkspaceDefaults.groups`; unknown
   * names are skipped with a verbose() warning at sync time so a typo'd
   * group reference does not silently broaden a member's selection.
   *
   * Merge order: workspace defaults -> groups[entries[0]] -> ... ->
   * groups[entries[n-1]] -> per-repo `overrides`. Each later layer wins on
   * conflict, mirroring the existing two-layer chain.
   *
   * Optional / empty array means "no group memberships" — the repo gets
   * the legacy two-layer merge (defaults + overrides) unchanged.
   */
  groups?: string[];
}

export interface WorkspaceRepoOverrides {
  /** Replaces workspace tools entirely. */
  tools?: Tool[];
  /** Partial merge on top of workspace features. */
  features?: Partial<Features>;
  /** Replaces workspace MCP config entirely. */
  mcp?: McpConfig;
  /** Add or remove content IDs relative to workspace selection. */
  contentOverrides?: {
    /** Content IDs to add beyond workspace selection. */
    include?: string[];
    /** Content IDs to remove from workspace selection. */
    exclude?: string[];
  };
  models?: ModelConfig;
  platform?: Platform;
}

// ── Sync Results ────────────────────────────────────────────────

export interface WorkspaceSyncResult {
  repos: WorkspaceRepoSyncResult[];
}

export interface WorkspaceRepoSyncResult {
  path: string;
  added: string[];
  removed: string[];
  toolsSynced: string[];
  action: "synced" | "dry-run" | "skipped" | "error";
  error?: string;
  /** Estimated token count for content being synced (populated in dry-run mode). */
  estimatedTokens?: number;
}

// ── Constants ───────────────────────────────────────────────────

export const WORKSPACE_MANIFEST_FILE = "workspace.json";
export const WORKSPACE_MANIFEST_VERSION = "1.0.0";
