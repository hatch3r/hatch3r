import type { AdapterOutput } from "../types.js";
import { HatchError } from "../types.js";
import { CODEX_HOOKS_PATH } from "./surfacePaths.js";

export { CODEX_HOOKS_PATH, CODEX_HOOK_SUPPORT_DIR } from "./surfacePaths.js";

export const CODEX_HOOK_EVENTS = [
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "SubagentStart",
  "SubagentStop",
  "Stop",
] as const;

export type CodexHookEvent = (typeof CODEX_HOOK_EVENTS)[number];

export interface CodexCommandHookHandler {
  type: "command";
  command: string;
  commandWindows?: string;
  timeout?: number;
  statusMessage?: string;
  additionalContextLimit?: number;
  async?: boolean;
}

export type CodexSkippedHookHandler = {
  type: "prompt" | "agent";
} & Record<string, unknown>;

export type CodexHookHandler = CodexCommandHookHandler | CodexSkippedHookHandler;

export interface CodexHookGroup {
  matcher?: string;
  hooks: CodexHookHandler[];
}

export interface CodexHooksDocument {
  description?: string;
  hooks: Partial<Record<CodexHookEvent, CodexHookGroup[]>>;
}

export interface CodexHookAddition {
  event: CodexHookEvent;
  group: CodexHookGroup;
}

export interface CodexHooksProjection {
  outputs: AdapterOutput[];
  inlineToml: string;
  sourceFiles: string[];
  warnings: string[];
  route: "hooks-json" | "inline-config" | "none";
}

export const SAFE_HOOK_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
export const OWNERSHIP_PREFIX = "hatch3r:";

export function codexHooksError(message: string, hint?: string): HatchError {
  return new HatchError(
    message,
    1,
    "VALIDATION_ERROR",
    hint ?? `Repair ${CODEX_HOOKS_PATH}; hatch3r will not emit partial Codex output.`,
  );
}
