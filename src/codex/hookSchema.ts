import {
  CODEX_HOOK_EVENTS,
  CODEX_HOOKS_PATH,
  codexHooksError,
  type CodexCommandHookHandler,
  type CodexHookGroup,
  type CodexHookHandler,
  type CodexHooksDocument,
  type CodexHookEvent,
  type CodexSkippedHookHandler,
} from "./hookTypes.js";

const TOP_LEVEL_KEYS = new Set(["description", "hooks"]);
const GROUP_KEYS = new Set(["matcher", "hooks"]);
const COMMAND_HANDLER_KEYS = new Set([
  "type", "command", "commandWindows", "timeout", "statusMessage",
  "additionalContextLimit", "async",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertKnownKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  location: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw codexHooksError(`${CODEX_HOOKS_PATH} has unknown ${location} field(s): ${unknown.join(", ")}.`);
  }
}

function validateOptionalString(
  value: Record<string, unknown>,
  key: "commandWindows" | "statusMessage",
  location: string,
): void {
  if (value[key] !== undefined && typeof value[key] !== "string") {
    throw codexHooksError(`${CODEX_HOOKS_PATH} ${location}.${key} must be a string.`);
  }
}

function validateNumericFields(value: Record<string, unknown>, location: string): void {
  if (value.timeout !== undefined && (!Number.isInteger(value.timeout) || Number(value.timeout) <= 0)) {
    throw codexHooksError(`${CODEX_HOOKS_PATH} ${location}.timeout must be a positive integer.`);
  }
  if (value.additionalContextLimit !== undefined &&
      (!Number.isInteger(value.additionalContextLimit) || Number(value.additionalContextLimit) < 0)) {
    throw codexHooksError(
      `${CODEX_HOOKS_PATH} ${location}.additionalContextLimit must be a non-negative integer.`,
    );
  }
}

function validateCommandHandler(
  value: Record<string, unknown>,
  location: string,
): CodexCommandHookHandler {
  assertKnownKeys(value, COMMAND_HANDLER_KEYS, `${location} handler`);
  if (value.type !== "command" || typeof value.command !== "string" || value.command.length === 0) {
    throw codexHooksError(
      `${CODEX_HOOKS_PATH} ${location} must use a documented command, prompt, or agent handler type.`,
    );
  }
  validateOptionalString(value, "commandWindows", location);
  validateOptionalString(value, "statusMessage", location);
  validateNumericFields(value, location);
  if (value.async !== undefined && typeof value.async !== "boolean") {
    throw codexHooksError(`${CODEX_HOOKS_PATH} ${location}.async must be a boolean.`);
  }
  return value as unknown as CodexCommandHookHandler;
}

function validateHandler(value: unknown, location: string): CodexHookHandler {
  if (!isRecord(value)) throw codexHooksError(`${CODEX_HOOKS_PATH} ${location} is not an object.`);
  if (value.type === "prompt" || value.type === "agent") {
    return { ...value, type: value.type } as CodexSkippedHookHandler;
  }
  return validateCommandHandler(value, location);
}

function validateGroup(value: unknown, location: string): CodexHookGroup {
  if (!isRecord(value)) throw codexHooksError(`${CODEX_HOOKS_PATH} ${location} is not an object.`);
  assertKnownKeys(value, GROUP_KEYS, `${location} group`);
  if (value.matcher !== undefined && typeof value.matcher !== "string") {
    throw codexHooksError(`${CODEX_HOOKS_PATH} ${location}.matcher must be a string.`);
  }
  if (!Array.isArray(value.hooks) || value.hooks.length === 0) {
    throw codexHooksError(`${CODEX_HOOKS_PATH} ${location}.hooks must be a non-empty array.`);
  }
  return {
    ...(typeof value.matcher === "string" ? { matcher: value.matcher } : {}),
    hooks: value.hooks.map((handler, index) => validateHandler(handler, `${location}.hooks[${index}]`)),
  };
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch (err) {
    throw codexHooksError(
      `${CODEX_HOOKS_PATH} is malformed JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function validateHooksTable(value: unknown): CodexHooksDocument["hooks"] {
  if (!isRecord(value)) throw codexHooksError(`${CODEX_HOOKS_PATH} hooks must be an object.`);
  const hooks: CodexHooksDocument["hooks"] = {};
  for (const [event, groups] of Object.entries(value)) {
    if (!(CODEX_HOOK_EVENTS as readonly string[]).includes(event)) {
      throw codexHooksError(`${CODEX_HOOKS_PATH} uses unsupported event "${event}".`);
    }
    if (!Array.isArray(groups)) {
      throw codexHooksError(`${CODEX_HOOKS_PATH} hooks.${event} must be an array.`);
    }
    hooks[event as CodexHookEvent] = groups.map((group, index) =>
      validateGroup(group, `hooks.${event}[${index}]`));
  }
  return hooks;
}

export function parseCodexHooksJson(content: string): CodexHooksDocument {
  const parsed = parseJson(content);
  if (!isRecord(parsed)) throw codexHooksError(`${CODEX_HOOKS_PATH} must contain a JSON object.`);
  assertKnownKeys(parsed, TOP_LEVEL_KEYS, "top-level");
  if (parsed.description !== undefined && typeof parsed.description !== "string") {
    throw codexHooksError(`${CODEX_HOOKS_PATH} description must be a string.`);
  }
  return {
    ...(typeof parsed.description === "string" ? { description: parsed.description } : {}),
    hooks: validateHooksTable(parsed.hooks),
  };
}
