import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AdapterOutput } from "../types.js";
import { hasManagedBlock } from "../merge/managedBlocks.js";
import {
  CODEX_CONFIG_PATH,
  CODEX_HOOKS_PATH,
  isCodexSharedPath,
} from "../codex/surfacePaths.js";
import { isPathWithin } from "../codex/pathContainment.js";
import { codexProjectionIssues } from "./codexProjectionError.js";

function preflightError(issues: readonly string[]) {
  return codexProjectionIssues(
    "Codex project preflight failed",
    issues,
    "Repair the conflicting Codex file or managed region; hatch3r did not emit partial Codex output.",
  );
}

async function lstatIfPresent(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function readRegularFileIfPresent(path: string): Promise<string | undefined> {
  const stat = await lstatIfPresent(path);
  if (!stat) return undefined;
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw preflightError([`${path} must be a regular, non-symlink file.`]);
  }
  return readFile(path, "utf8");
}

async function assertDirectoryChainSafe(
  projectRoot: string,
  relativePath: string,
): Promise<void> {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw preflightError([`Unsafe Codex output path: ${relativePath}`]);
  }
  let current = resolve(projectRoot);
  if (!isPathWithin(projectRoot, current)) {
    throw preflightError([`Resolved Codex output root escapes the repository: ${current}`]);
  }
  for (const segment of normalized.split("/").slice(0, -1)) {
    current = join(current, segment);
    const stat = await lstatIfPresent(current);
    if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw preflightError([`${current} must be a regular directory, not a symlink or file.`]);
    }
  }
}

const PREFLIGHT_PATHS = [
  ".agents/skills/.preflight",
  ".codex/agents/.preflight",
  ".codex/hatch3r/hooks/.preflight",
  CODEX_CONFIG_PATH,
  CODEX_HOOKS_PATH,
  "AGENTS.md",
  "AGENTS.override.md",
] as const;

export async function preflightCodexProjectPaths(projectRoot: string) {
  for (const path of PREFLIGHT_PATHS) await assertDirectoryChainSafe(projectRoot, path);
  return {
    agentsMd: await readRegularFileIfPresent(join(projectRoot, "AGENTS.md")),
    agentsOverrideMd: await readRegularFileIfPresent(join(projectRoot, "AGENTS.override.md")),
  };
}

interface OwnershipContext {
  projectRoot: string;
  recordedPaths: ReadonlySet<string>;
}

async function outputOwnershipIssue(
  output: AdapterOutput,
  context: OwnershipContext,
): Promise<string | undefined> {
  await assertDirectoryChainSafe(context.projectRoot, output.path);
  const target = join(context.projectRoot, output.path);
  if (!isPathWithin(context.projectRoot, target)) {
    return `${output.path} escapes the repository root.`;
  }
  const stat = await lstatIfPresent(target);
  if (!stat) return undefined;
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return `${output.path} is not a regular, non-symlink file.`;
  }
  if (isCodexSharedPath(output.path)) return undefined;
  return inspectExistingOwnership(output, target, context.recordedPaths);
}

async function inspectExistingOwnership(
  output: AdapterOutput,
  target: string,
  recordedPaths: ReadonlySet<string>,
): Promise<string | undefined> {
  const existing = await readFile(target, "utf8");
  const ownedByMarker = output.managedContent !== undefined && hasManagedBlock(existing, target);
  const recorded = recordedPaths.has(output.path);
  if (!ownedByMarker && !recorded) {
    return `${output.path} already exists but is not recorded or marked as Hatcher-owned.`;
  }
  if (!ownedByMarker && recorded && (output.sourceFiles?.length ?? 0) > 0) {
    output.validatedFullDocument = true;
  }
  return undefined;
}

export async function preflightCodexOutputOwnership(
  projectRoot: string,
  outputs: readonly AdapterOutput[],
  recordedPaths: ReadonlySet<string>,
): Promise<void> {
  const context = { projectRoot, recordedPaths };
  const issues: string[] = [];
  for (const output of outputs) {
    const issue = await outputOwnershipIssue(output, context);
    if (issue) issues.push(issue);
  }
  if (issues.length > 0) throw preflightError(issues.sort());
}
