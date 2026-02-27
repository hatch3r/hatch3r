export type HookEvent =
  | "pre-commit"
  | "post-merge"
  | "ci-failure"
  | "file-save"
  | "session-start"
  | "pre-push";

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

export interface HookConfig {
  hooks: HookDefinition[];
}
