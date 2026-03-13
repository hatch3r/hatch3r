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
