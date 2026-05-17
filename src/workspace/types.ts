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
