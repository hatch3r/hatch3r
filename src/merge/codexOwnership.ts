import { removeCodexOwnedHookEntries } from "../codex/hookDocument.js";
import { removeCodexTomlManagedRegion } from "../codex/projectToml.js";
import {
  CODEX_CONFIG_PATH,
  CODEX_HOOKS_PATH,
} from "../codex/surfacePaths.js";
import { HatchError, MANAGED_BLOCK_VARIANTS } from "../types.js";
import {
  hasManagedBlock,
  isHealableManagedPrefix,
  splitAfterManagedBlock,
  splitAtManagedBlock,
} from "./managedBlocks.js";

export {
  fileMatchesTool,
  isCodexExclusivePath,
  isCodexSharedPath,
  TOOL_PATH_PREFIXES,
} from "../codex/surfacePaths.js";

export type CodexRemovalPlan =
  | { disposition: "foreign" }
  | { disposition: "remove" }
  | { disposition: "preserve"; content: string };

function hasAnyManagedMarkerToken(content: string): boolean {
  const markers = new Set(MANAGED_BLOCK_VARIANTS.flatMap(({ start, end }) => [start, end]));
  return content.split(/\r?\n/).some((line) => markers.has(line.trim()));
}

function invalidManagedBlock(path: string, message: string): HatchError {
  return new HatchError(
    `${path} ${message}`,
    1,
    "VALIDATION_ERROR",
    `Repair the managed block in ${path}; hatch3r left the file untouched.`,
  );
}

function planInstructionRemoval(path: string, absPath: string, content: string): string | undefined {
  if (!hasManagedBlock(content, absPath)) {
    if (hasAnyManagedMarkerToken(content)) {
      throw invalidManagedBlock(path, "has broken HATCH3R managed-block markers.");
    }
    return undefined;
  }
  const before = splitAtManagedBlock(content, absPath);
  const after = splitAfterManagedBlock(content, absPath);
  if (!before || !after) return undefined;
  const suffix = before.prefix.length === 0 && after.suffix.startsWith("\n\n")
    ? after.suffix.slice(2)
    : after.suffix;
  return before.prefix + suffix;
}

function planExclusiveRemoval(
  path: string,
  absPath: string,
  content: string,
  exactRecorded: boolean,
): string | null | undefined {
  if (!exactRecorded) return undefined;
  if (!hasManagedBlock(content, absPath)) {
    if (hasAnyManagedMarkerToken(content)) {
      throw invalidManagedBlock(path, "has broken HATCH3R managed-block markers.");
    }
    return null;
  }
  const before = splitAtManagedBlock(content, absPath);
  const after = splitAfterManagedBlock(content, absPath);
  if (!before || !after) {
    throw invalidManagedBlock(path, "has an unreadable HATCH3R managed block.");
  }
  const generatedStub = path.endsWith("/SKILL.md") && isHealableManagedPrefix(before.prefix);
  return (generatedStub ? "" : before.prefix) + after.suffix;
}

function removalPlan(remaining: string | null | undefined): CodexRemovalPlan {
  if (remaining === undefined) return { disposition: "foreign" };
  if (remaining === null || remaining.trim().length === 0) return { disposition: "remove" };
  return { disposition: "preserve", content: remaining };
}

/** Compute the non-mutating ownership subtraction plan for one Codex path. */
export function planCodexRemoval(
  relPath: string,
  absPath: string,
  content: string,
  exactRecorded: boolean,
): CodexRemovalPlan {
  const path = relPath.replace(/\\/g, "/");
  if (path === CODEX_CONFIG_PATH) {
    const remaining = removeCodexTomlManagedRegion(content);
    return removalPlan(remaining === content ? undefined : remaining);
  }
  if (path === CODEX_HOOKS_PATH) {
    const remaining = removeCodexOwnedHookEntries(content);
    return removalPlan(remaining === content ? undefined : remaining);
  }
  if (path === "AGENTS.md" || path === "AGENTS.override.md") {
    return removalPlan(planInstructionRemoval(path, absPath, content));
  }
  return removalPlan(planExclusiveRemoval(path, absPath, content, exactRecorded));
}
