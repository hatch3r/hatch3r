import { tomlKey, tomlString } from "./codexToml.js";
import {
  codexHooksError,
  type CodexCommandHookHandler,
  type CodexHookAddition,
} from "./codexHookTypes.js";

function renderCommandHandler(
  event: string,
  handler: CodexCommandHookHandler,
): string[] {
  const lines = [
    `[[hooks.${tomlKey(event)}.hooks]]`,
    `type = ${tomlString(handler.type)}`,
    `command = ${tomlString(handler.command)}`,
  ];
  if (handler.commandWindows) lines.push(`commandWindows = ${tomlString(handler.commandWindows)}`);
  if (handler.timeout) lines.push(`timeout = ${handler.timeout}`);
  if (handler.statusMessage) lines.push(`statusMessage = ${tomlString(handler.statusMessage)}`);
  if (handler.additionalContextLimit) {
    lines.push(`additionalContextLimit = ${handler.additionalContextLimit}`);
  }
  lines.push("async = false");
  return lines;
}

function renderHookGroup({ event, group }: CodexHookAddition): string {
  const lines = [`[[hooks.${tomlKey(event)}]]`];
  if (group.matcher !== undefined) lines.push(`matcher = ${tomlString(group.matcher)}`);
  for (const handler of group.hooks) {
    if (handler.type !== "command") {
      throw codexHooksError("Hatcher may emit only synchronous Codex command hook handlers.");
    }
    lines.push(...renderCommandHandler(event, handler));
  }
  return lines.join("\n");
}

export function renderCodexInlineHooksToml(additions: readonly CodexHookAddition[]): string {
  return additions.map(renderHookGroup).join("\n\n");
}
