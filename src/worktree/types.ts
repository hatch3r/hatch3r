export interface WorktreeEntry {
  pattern: string;
  strategy: "copy" | "symlink";
  reason?: string;
}

/** Reason a destination path was skipped during `setupWorktree`. */
export type WorktreeSkipReason =
  /** The destination already existed and `--force` was not supplied (idempotent re-run). */
  | "exists"
  /**
   * A concurrent writer landed the destination after our atomic create lost
   * the race (EEXIST on symlink/copyFile, or another writer won after the
   * forced unlink). Distinguishes a TOCTOU outcome from an idempotent skip.
   */
  | "eexist-race";

/** One skipped destination with the reason it was skipped (F-1.10.12, D1 cycle 10 wave 4). */
export interface WorktreeSkippedEntry {
  path: string;
  reason: WorktreeSkipReason;
}

export interface WorktreeSetupResult {
  copied: string[];
  symlinked: string[];
  /**
   * Relative paths that were skipped. Kept as a flat `string[]` for backward
   * compatibility with existing consumers; see {@link skippedDetails} for the
   * per-path skip reason.
   */
  skipped: string[];
  /**
   * F-1.10.12 (D1 cycle 10 wave 4): per-path skip reason annotation so a
   * `--verbose` consumer can distinguish an idempotent re-run skip (`exists`)
   * from a TOCTOU race outcome (`eexist-race`). Indices are independent of
   * {@link skipped}; both arrays carry the same set of paths.
   */
  skippedDetails: WorktreeSkippedEntry[];
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
