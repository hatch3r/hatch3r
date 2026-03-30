export { WORKSPACE_MANIFEST_FILE, WORKSPACE_MANIFEST_VERSION } from "./types.js";
export type {
  WorkspaceManifest,
  WorkspaceDefaults,
  WorkspaceRepoEntry,
  WorkspaceRepoOverrides,
  WorkspaceSyncResult,
  WorkspaceRepoSyncResult,
} from "./types.js";

export {
  readWorkspaceManifest,
  writeWorkspaceManifest,
  createWorkspaceManifest,
  isUnsafeRepoPath,
} from "./manifest.js";

export {
  detectSubRepos,
  detectWorkspaceContext,
  shouldSuggestWorkspace,
  isWorkspaceRoot,
} from "./detect.js";
export type { DetectedRepo, WorkspaceContext } from "./detect.js";

export { resolveRepoConfig, buildSelectionFromIds } from "./resolve.js";
export type { ResolvedRepoConfig } from "./resolve.js";

export { syncWorkspaceRepos } from "./sync.js";
export type { WorkspaceSyncOptions } from "./sync.js";

export {
  parseGitRemote,
  parseGitDefaultBranch,
  getGitRemoteUrl,
  detectPlatformFromRemote,
  detectRepoGitIdentity,
} from "./git.js";
export type { RepoGitIdentity } from "./git.js";
