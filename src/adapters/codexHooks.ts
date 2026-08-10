import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AdapterOutput } from "../types.js";
import type { HookDefinition } from "../hooks/types.js";
import { mapCodexHooks, type MappedCodexHook } from "./codexHookCommands.js";
import { mergeCodexHooksDocument } from "./codexHookMerge.js";
import { parseCodexHooksJson } from "./codexHookSchema.js";
import { renderCodexInlineHooksToml } from "./codexHookToml.js";
import type { CodexTomlPreflight } from "./codexToml.js";
import {
  CODEX_HOOKS_PATH,
  codexHooksError,
  type CodexHookAddition,
  type CodexHooksDocument,
  type CodexHooksProjection,
} from "./codexHookTypes.js";

export { codexHookCommand, codexHookCommandWindows } from "./codexHookCommands.js";
export { mergeCodexHooksDocument, removeCodexOwnedHookEntries } from "./codexHookMerge.js";
export { parseCodexHooksJson } from "./codexHookSchema.js";
export { CODEX_HOOKS_PATH, CODEX_HOOK_SUPPORT_DIR } from "./codexHookTypes.js";
export type {
  CodexCommandHookHandler,
  CodexHookGroup,
  CodexHookHandler,
  CodexHooksDocument,
  CodexHooksProjection,
  CodexSkippedHookHandler,
} from "./codexHookTypes.js";

interface ProjectionArtifacts {
  additions: CodexHookAddition[];
  outputs: AdapterOutput[];
  sourceFiles: string[];
}

function projectionArtifacts(mapped: readonly MappedCodexHook[]): ProjectionArtifacts {
  return {
    additions: mapped.map(({ event, group }) => ({ event, group })),
    outputs: mapped.map(({ output }) => output),
    sourceFiles: [...new Set(mapped.flatMap(({ output }) => output.sourceFiles ?? []))].sort(),
  };
}

function trustWarning(): string {
  return "[codex] Project hook commands run only after the user trusts the project and approves the changed hook hash via /hooks; hatch3r never writes trust state.";
}

function inlineProjection(
  artifacts: ProjectionArtifacts,
  hooksFileExists: boolean,
  warnings: string[],
): CodexHooksProjection {
  if (hooksFileExists) {
    warnings.push(
      `[codex] Both ${CODEX_HOOKS_PATH} and inline hooks in .codex/config.toml exist. ` +
        "The user hooks file is preserved; hatch3r appends its handlers only to the established inline config surface.",
    );
  }
  warnings.push(trustWarning());
  return {
    outputs: artifacts.outputs,
    inlineToml: renderCodexInlineHooksToml(artifacts.additions),
    sourceFiles: artifacts.sourceFiles,
    warnings,
    route: "inline-config",
  };
}

function hooksJsonProjection(
  artifacts: ProjectionArtifacts,
  existing: CodexHooksDocument,
  warnings: string[],
): CodexHooksProjection {
  const merged = mergeCodexHooksDocument(existing, artifacts.additions);
  artifacts.outputs.unshift({
    path: CODEX_HOOKS_PATH,
    content: `${JSON.stringify(merged, null, 2)}\n`,
    action: "create",
    sourceFiles: artifacts.sourceFiles,
  });
  warnings.push(trustWarning());
  return {
    outputs: artifacts.outputs,
    inlineToml: "",
    sourceFiles: artifacts.sourceFiles,
    warnings,
    route: "hooks-json",
  };
}

export async function readCodexHooksPreflight(
  projectRoot: string,
): Promise<{ exists: boolean; document: CodexHooksDocument }> {
  const path = join(projectRoot, CODEX_HOOKS_PATH);
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw codexHooksError(
        `${CODEX_HOOKS_PATH} must be a regular, non-symlink file.`,
        `Replace ${CODEX_HOOKS_PATH} with a regular file inside the repository; hatch3r does not follow shared-hook symlinks.`,
      );
    }
    return { exists: true, document: parseCodexHooksJson(await readFile(path, "utf-8")) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false, document: { hooks: {} } };
    }
    throw err;
  }
}

export async function projectCodexHooks(
  projectRoot: string,
  hooks: readonly HookDefinition[],
  configPreflight: CodexTomlPreflight,
): Promise<CodexHooksProjection> {
  const warnings: string[] = [];
  const mapped = mapCodexHooks(hooks, warnings);
  const existing = await readCodexHooksPreflight(projectRoot);
  if (mapped.length === 0) {
    return { outputs: [], inlineToml: "", sourceFiles: [], warnings, route: "none" };
  }
  const artifacts = projectionArtifacts(mapped);
  return configPreflight.hasInlineHooks
    ? inlineProjection(artifacts, existing.exists, warnings)
    : hooksJsonProjection(artifacts, existing.document, warnings);
}
