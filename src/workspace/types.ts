import type { CliToolsConfig, ContentSelection, Features, HatchErrorCode, McpConfig, ModelConfig, Platform, Tool } from "../types.js";

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

/**
 * DD-B4 (release/2.8.5): aggregate disposition of one workspace cascade.
 * `passed` = zero `action: "error"` repos; `failed` = every targeted repo
 * errored; `partial` = a mix. Dry-run and skipped rows count as
 * non-failures. The CLI maps this onto the JSON envelope status and the
 * exit code (`hatch3r sync` now exits non-zero on `partial`/`failed` —
 * see the 2.8.5 CHANGELOG BREAKING note).
 */
export type WorkspaceSyncOutcome = "passed" | "partial" | "failed";

/** DD-B4: per-action tallies backing {@link WorkspaceSyncOutcome}. */
export interface WorkspaceSyncCounts {
  total: number;
  synced: number;
  failed: number;
  skipped: number;
  dryRun: number;
}

/**
 * DD-B2 (release/2.8.5): structured per-repo sync failure. Preserves the
 * fields a flattened `err.message` string used to destroy — the
 * machine-readable `errorCode`, the operator-facing `recoveryHint`, and the
 * `Error.cause` chain (outermost first, bounded) — so the CLI and JSON
 * consumers can branch on the failure class instead of grepping prose.
 */
export interface WorkspaceRepoSyncError {
  message: string;
  errorCode?: HatchErrorCode;
  recoveryHint?: string;
  causeChain?: string[];
}

export interface WorkspaceSyncResult {
  repos: WorkspaceRepoSyncResult[];
  /** DD-B4: aggregate disposition (computed in `syncWorkspaceRepos`). */
  outcome: WorkspaceSyncOutcome;
  /** DD-B4: per-action tallies backing `outcome`. */
  counts: WorkspaceSyncCounts;
}

export interface WorkspaceRepoSyncResult {
  path: string;
  added: string[];
  removed: string[];
  toolsSynced: string[];
  action: "synced" | "dry-run" | "skipped" | "error";
  /**
   * Flattened failure message. Kept as a plain string (not widened in
   * place, DD-B2 deviation) because renderers outside this slice
   * interpolate it directly (`init.ts:3646` template literal) — a silent
   * `[object Object]` regression. The structured twin is
   * {@link errorDetail}; the two are set together and `error` always equals
   * `errorDetail.message`.
   */
  error?: string;
  /** DD-B2: structured failure detail (errorCode / recoveryHint / causeChain). */
  errorDetail?: WorkspaceRepoSyncError;
  /** Estimated token count for content being synced (populated in dry-run mode). */
  estimatedTokens?: number;
}

// ── Constants ───────────────────────────────────────────────────

export const WORKSPACE_MANIFEST_FILE = "workspace.json";
export const WORKSPACE_MANIFEST_VERSION = "1.0.0";
