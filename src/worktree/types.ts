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

/**
 * Per-worktree working-tree status. Counts are derived from
 * `git -C <wt> status --porcelain`, which is genuinely per-worktree.
 *
 * Stash count is deliberately absent: `git stash` writes to a single
 * repo-global `refs/stash`, so `git -C <wt> stash list` returns the SAME
 * shared stack from every linked worktree and the main repo. Git exposes no
 * reliable per-worktree stash ownership, so a stash created anywhere would
 * mis-badge every worktree as dirty and trigger a false destruction-confirm
 * prompt in `worktree-cleanup` (D1-32, Cycle 11 Wave 3).
 */
export interface WorktreeStatus {
  modified: number;
  untracked: number;
}
