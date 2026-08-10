import { rmdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { HATCH3R_PREFIX } from "../types.js";
import {
  pathMatchesOutputPrefix,
  TOOL_PATH_PREFIXES,
} from "../codex/surfacePaths.js";
import {
  hasManagedBlock,
  isHealableManagedPrefix,
  splitAfterManagedBlock,
  splitAtManagedBlock,
} from "./managedBlocks.js";
import {
  assertRepositoryPathIdentity,
  inspectRepositoryPath,
  normalizeRepositoryRelativePath,
  readRepositoryPathIdentity,
} from "./repositoryPathSafety.js";
import { verbose } from "../cli/shared/ui.js";

const NN_HATCH3R_PREFIX_RE = /^\d{2}-hatch3r-/;

export interface OrphanCleanupEntry {
  adapter: string;
  path: string;
  removed: boolean;
  reason:
    | "unlinked"
    | "missing"
    | "not-managed-basename"
    | "outside-adapter-root"
    | "user-wrapped"
    | "symlink-skipped"
    | "unlink-failed"
    | "read-failed";
  error?: string;
}

export function isManagedOutputBasename(fileName: string, parentDirName?: string): boolean {
  if (fileName.startsWith(HATCH3R_PREFIX) || NN_HATCH3R_PREFIX_RE.test(fileName)) return true;
  return fileName === "SKILL.md" && parentDirName !== undefined &&
    (parentDirName.startsWith(HATCH3R_PREFIX) || NN_HATCH3R_PREFIX_RE.test(parentDirName));
}

export function diffOrphanCandidates(
  previousPaths: string[] | undefined,
  currentPaths: Iterable<string>,
): string[] {
  if (!previousPaths || previousPaths.length === 0) return [];
  const current = new Set<string>();
  for (const path of currentPaths) {
    try {
      current.add(normalizeRepositoryRelativePath(path));
    } catch {
      current.add(path);
    }
  }
  const orphans: string[] = [];
  for (const path of previousPaths) {
    let comparable = path;
    try {
      comparable = normalizeRepositoryRelativePath(path);
    } catch (err) {
      verbose(`orphanCleanup: retaining invalid previous path for rejection ${JSON.stringify(path)} — ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!current.has(comparable)) orphans.push(comparable);
  }
  return orphans;
}

export function buildAcceptedPrefixes(adapter: string, packageRoots?: readonly string[]): string[] {
  const adapterPrefixes = TOOL_PATH_PREFIXES[adapter as keyof typeof TOOL_PATH_PREFIXES] ?? [];
  const prefixes = [...adapterPrefixes];
  for (const root of packageRoots ?? []) {
    try {
      const normalized = normalizeRepositoryRelativePath(root.replace(/\/+$/, ""));
      for (const prefix of adapterPrefixes) prefixes.push(`${normalized}/${prefix}`);
    } catch {
      continue;
    }
  }
  return prefixes;
}

export function derivePackageRootsFromCandidates(
  candidates: readonly string[],
  adapter: string,
): string[] {
  const roots = new Set<string>();
  const adapterPrefixes = TOOL_PATH_PREFIXES[adapter as keyof typeof TOOL_PATH_PREFIXES] ?? [];
  for (const candidate of candidates) {
    let posix: string;
    try {
      posix = normalizeRepositoryRelativePath(candidate);
    } catch {
      continue;
    }
    for (const prefix of adapterPrefixes) {
      const index = posix.indexOf(`/${prefix}`);
      if (index <= 0) continue;
      const packageRoot = posix.slice(0, index);
      if (packageRoot && !packageRoot.startsWith("..") &&
          !packageRoot.includes("/..") && !packageRoot.startsWith("/")) {
        roots.add(packageRoot);
      }
    }
  }
  return [...roots];
}

export function isPathInKnownAdapterRoot(
  relPath: string,
  rootDir: string,
  acceptedPrefixes: readonly string[],
): boolean {
  let normalized: string;
  try {
    normalized = normalizeRepositoryRelativePath(relPath);
  } catch (err) {
    verbose(`orphanCleanup: rejected invalid recorded path ${JSON.stringify(relPath)} — ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
  const absolutePath = resolve(rootDir, normalized);
  const repositoryRelative = relative(rootDir, absolutePath);
  if (repositoryRelative.startsWith("..") || resolve(rootDir, repositoryRelative) !== absolutePath) {
    return false;
  }
  if (repositoryRelative === "" || repositoryRelative === ".") return false;
  const posix = repositoryRelative.replace(/\\/g, "/");
  return acceptedPrefixes.some((prefix) => pathMatchesOutputPrefix(posix, prefix));
}

export function fileContentIsUserWrapped(content: string, absPath: string): boolean {
  if (!hasManagedBlock(content, absPath)) return false;
  const prefixSplit = splitAtManagedBlock(content, absPath);
  const suffixSplit = splitAfterManagedBlock(content, absPath);
  const prefixIsUser = prefixSplit !== null && !isHealableManagedPrefix(prefixSplit.prefix);
  const suffixIsUser = suffixSplit !== null && suffixSplit.suffix.trim().length > 0;
  return prefixIsUser || suffixIsUser;
}

export async function pruneEmptyCodexSkillParents(rootDir: string, relPath: string): Promise<void> {
  const posix = normalizeRepositoryRelativePath(relPath);
  const skillRoot = posix.match(/^(\.agents\/skills\/hatch3r-[^/]+)\//)?.[1];
  if (!skillRoot) return;
  let current = dirname(posix).replace(/\\/g, "/");
  while (current === skillRoot || current.startsWith(`${skillRoot}/`)) {
    try {
      const inspected = await inspectRepositoryPath(rootDir, current);
      const identity = await readRepositoryPathIdentity(rootDir, current);
      await assertRepositoryPathIdentity(rootDir, current, identity);
      await rmdir(inspected.absolutePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTEMPTY") {
        verbose(`orphanCleanup: rmdir(${current}) skipped — ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }
    if (current === skillRoot) break;
    current = dirname(current).replace(/\\/g, "/");
  }
}
