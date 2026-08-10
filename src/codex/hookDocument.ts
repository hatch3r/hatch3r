import { codexHookOwnershipId } from "./hookOwnership.js";
import { parseCodexHooksJson } from "./hookSchema.js";
import {
  CODEX_HOOK_EVENTS,
  type CodexHookAddition,
  type CodexHookGroup,
  type CodexHooksDocument,
} from "./hookTypes.js";

function retainUserGroups(groups: readonly CodexHookGroup[]): CodexHookGroup[] {
  const retained: CodexHookGroup[] = [];
  for (const group of groups) {
    const userHandlers = group.hooks.filter((handler) => codexHookOwnershipId(handler) === null);
    if (userHandlers.length > 0) retained.push({ ...group, hooks: userHandlers });
  }
  return retained;
}

export function mergeCodexHooksDocument(
  existing: CodexHooksDocument,
  additions: readonly CodexHookAddition[],
): CodexHooksDocument {
  const hooks: CodexHooksDocument["hooks"] = {};
  for (const event of CODEX_HOOK_EVENTS) {
    const retained = retainUserGroups(existing.hooks[event] ?? []);
    const appended = additions
      .filter((addition) => addition.event === event)
      .map((addition) => addition.group);
    if (retained.length > 0 || appended.length > 0) hooks[event] = [...retained, ...appended];
  }
  return {
    ...(existing.description !== undefined
      ? { description: existing.description }
      : { description: "Project hooks managed jointly by the user and hatch3r." }),
    hooks,
  };
}

function countOwnedHandlers(document: CodexHooksDocument): number {
  let count = 0;
  for (const groups of Object.values(document.hooks)) {
    for (const group of groups ?? []) {
      count += group.hooks.filter((handler) => codexHookOwnershipId(handler) !== null).length;
    }
  }
  return count;
}

export function removeCodexOwnedHookEntries(content: string): string | null {
  const existing = parseCodexHooksJson(content);
  if (countOwnedHandlers(existing) === 0) return content;
  const cleaned = mergeCodexHooksDocument(existing, []);
  if (Object.keys(cleaned.hooks).length === 0) return null;
  return `${JSON.stringify(cleaned, null, 2)}\n`;
}
