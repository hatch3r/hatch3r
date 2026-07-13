/**
 * Lifecycle events that hooks can attach to.
 *
 * Adapters map these to their native hook mechanism (e.g. Cursor rules,
 * Kiro lifecycle hooks, Codex shell hooks).
 */
export type HookEvent =
  | "pre-commit"
  | "post-merge"
  | "ci-failure"
  | "file-save"
  | "session-start"
  | "pre-push"
  // worktree-create / worktree-remove are feature-emitted, not hook-file-declared:
  // the claude adapter hardcodes them from the worktree feature (src/adapters/
  // claude.ts), and no canonical hooks/*.md file declares either event (the 7 hook
  // files cover the other 7 events). They stay in the union to satisfy the
  // Record<NativeHookEvent, string> completeness check in the adapter event-maps;
  // no hook-file emission path is expected to use them (D11-SA11.4-04, Cycle 12).
  | "worktree-create"
  | "worktree-remove"
  | "review-loop-cap";

/** Set of all valid hook event names for runtime validation. */
export const VALID_HOOK_EVENTS = new Set<HookEvent>([
  "pre-commit",
  "post-merge",
  "ci-failure",
  "file-save",
  "session-start",
  "pre-push",
  "worktree-create",
  "worktree-remove",
  "review-loop-cap",
]);

/** Type guard: check if a string is a valid hook event name. */
export function isValidHookEvent(event: string): event is HookEvent {
  return VALID_HOOK_EVENTS.has(event as HookEvent);
}

/** A canonical hook definition parsed from `.agents/hooks/*.md` frontmatter. */
export interface HookDefinition {
  /** Unique hook identifier (sanitized for shell safety). */
  id: string;
  /** Lifecycle event this hook listens for. */
  event: HookEvent;
  /** Agent ID to dispatch when the hook fires. */
  agent: string;
  /** Human-readable description of the hook's purpose. */
  description: string;
  /** Optional conditions that narrow when the hook fires. */
  condition?: HookCondition;
}

/** Conditions that control when a hook fires beyond the event trigger. */
export interface HookCondition {
  /** File glob patterns -- hook fires only when matching files are affected. */
  globs?: string[];
  /** Issue/PR labels -- hook fires only when matching labels are present. */
  labels?: string[];
  /** Branch name patterns -- hook fires only on matching branches. */
  branches?: string[];
}
