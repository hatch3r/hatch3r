import {
  CODEX_HOOKS_PATH,
  codexHooksError,
  OWNERSHIP_PREFIX,
  SAFE_HOOK_ID_RE,
  type CodexHookHandler,
} from "./hookTypes.js";

const FIXED_HOOK_INSTRUCTIONS: Readonly<Record<string, string>> = {
  "session-start-learnings":
    "delegate this task to the hatch3r-learnings-loader custom subagent. If subagent delegation is unavailable, follow the equivalent repository instructions and report the result in plain text.",
};

/** Fixed inline JavaScript that never resolves or imports a project file. */
export function codexHookCommand(id: string): string {
  if (!SAFE_HOOK_ID_RE.test(id)) throw codexHooksError(`Unsafe Codex hook id "${id}".`);
  const action = FIXED_HOOK_INSTRUCTIONS[id] ??
    "follow the matching Hatcher repository instructions and report the result in plain text.";
  const instruction = `hatch3r hook bridge (${id}): ${action} ` +
    "The hook itself performs no repository mutation.\n";
  const jsLiteral = instruction
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
  return `node --input-type=module -e ${JSON.stringify(`process.stdout.write('${jsLiteral}')`)}`;
}

export function codexHookCommandWindows(id: string): string {
  return codexHookCommand(id);
}

export function codexHookOwnershipId(handler: CodexHookHandler): string | null {
  if (handler.type !== "command" || !handler.statusMessage?.startsWith(OWNERSHIP_PREFIX)) return null;
  const id = handler.statusMessage.slice(OWNERSHIP_PREFIX.length);
  if (!SAFE_HOOK_ID_RE.test(id)) {
    throw codexHooksError(`${CODEX_HOOKS_PATH} contains a malformed hatch3r ownership marker.`);
  }
  if (handler.command !== codexHookCommand(id) || handler.commandWindows !== codexHookCommandWindows(id)) {
    throw codexHooksError(
      `${CODEX_HOOKS_PATH} contains a hatch3r ownership collision for hook "${id}".`,
      "Remove the conflicting hatch3r:<id> statusMessage or restore the hatch3r command template.",
    );
  }
  return id;
}
