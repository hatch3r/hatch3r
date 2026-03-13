export type HookEvent =
  | "pre-commit"
  | "post-merge"
  | "ci-failure"
  | "file-save"
  | "session-start"
  | "pre-push"
  | "worktree-create"
  | "worktree-remove";

export const VALID_HOOK_EVENTS = new Set<HookEvent>([
  "pre-commit",
  "post-merge",
  "ci-failure",
  "file-save",
  "session-start",
  "pre-push",
  "worktree-create",
  "worktree-remove",
]);

export function isValidHookEvent(event: string): event is HookEvent {
  return VALID_HOOK_EVENTS.has(event as HookEvent);
}

export interface HookDefinition {
  id: string;
  event: HookEvent;
  agent: string;
  description: string;
  condition?: HookCondition;
}

export interface HookCondition {
  globs?: string[];
  labels?: string[];
  branches?: string[];
}
