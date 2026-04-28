export interface WorktreeEntry {
  pattern: string;
  strategy: "copy" | "symlink";
  reason?: string;
}

export interface WorktreeSetupResult {
  copied: string[];
  symlinked: string[];
  skipped: string[];
  errors: string[];
}

export interface WorktreeListEntry {
  path: string;
  head?: string;
  branch?: string;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
}

export interface WorktreeStatus {
  modified: number;
  untracked: number;
  stashes: number;
}
