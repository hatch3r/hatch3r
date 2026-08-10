import { createHash, randomBytes } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { HatchError } from "../types.js";
import { recoverRacedQuarantineEntry } from "./repositoryQuarantineRecovery.js";
import { atomicWriteFile } from "./safeWrite.js";
import {
  normalizeRepositoryRelativePath,
  UnsafeRepositoryPathError,
} from "./repositoryPathValidation.js";

export {
  normalizeRepositoryRelativePath,
  UnsafeRepositoryPathError,
} from "./repositoryPathValidation.js";

export interface RepositoryFileIdentity {
  dev: bigint;
  ino: bigint;
  size: number;
  mtimeNs: bigint;
  sha256: string;
}

export interface RepositoryPathIdentity {
  dev: bigint;
  ino: bigint;
}

export interface RepositoryFileSnapshot {
  relativePath: string;
  absolutePath: string;
  content: Buffer;
  identity: RepositoryFileIdentity;
}

/** @internal Deterministic seam for exercising post-rename filesystem races. */
export interface RepositoryPathSafetyTestHooks {
  afterQuarantineRename?: (paths: {
    originalAbsolutePath: string;
    quarantineAbsolutePath: string;
    quarantineRelativePath: string;
  }) => Promise<void>;
}

function isContained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export interface SafeRepositoryPath {
  relativePath: string;
  absolutePath: string;
  canonicalRoot: string;
  exists: boolean;
}

async function inspectPathSegment(
  path: string,
  allowMissing: boolean,
): Promise<BigIntStats | undefined> {
  try {
    return await lstat(path, { bigint: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT" && allowMissing) return undefined;
    throw err;
  }
}

async function assertSafePathSegment(
  requestedPath: string,
  current: string,
  segmentPath: string,
  final: boolean,
  canonicalRoot: string,
  info: BigIntStats,
): Promise<void> {
  if (info.isSymbolicLink()) {
    throw new UnsafeRepositoryPathError(requestedPath, "symlink", `${segmentPath} is a symlink`);
  }
  if (!final && !info.isDirectory()) {
    throw new UnsafeRepositoryPathError(requestedPath, "invalid-path", `${segmentPath} is not a directory`);
  }
  if (!isContained(canonicalRoot, await realpath(current))) {
    throw new UnsafeRepositoryPathError(
      requestedPath,
      "outside-root",
      "an ancestor resolves outside the repository",
    );
  }
}

/**
 * Resolve a repository-relative path and reject symlinks in every existing
 * component, including a dangling symlink. Existing components are also
 * realpath-checked against the canonical project root.
 */
export async function inspectRepositoryPath(
  rootDir: string,
  path: string,
  options: { allowMissing?: boolean } = {},
): Promise<SafeRepositoryPath> {
  const relativePath = normalizeRepositoryRelativePath(path);
  const canonicalRoot = await realpath(rootDir);
  const absolutePath = resolve(canonicalRoot, ...relativePath.split("/"));
  if (!isContained(canonicalRoot, absolutePath) || absolutePath === canonicalRoot) {
    throw new UnsafeRepositoryPathError(path, "outside-root", "the resolved path is outside the repository");
  }

  const segments = relativePath.split("/");
  let current = canonicalRoot;
  for (let index = 0; index < segments.length; index++) {
    current = resolve(current, segments[index]!);
    const info = await inspectPathSegment(current, options.allowMissing === true);
    if (!info) return { relativePath, absolutePath, canonicalRoot, exists: false };
    await assertSafePathSegment(
      path,
      current,
      segments.slice(0, index + 1).join("/"),
      index === segments.length - 1,
      canonicalRoot,
      info,
    );
  }

  return { relativePath, absolutePath, canonicalRoot, exists: true };
}

/** Create a repository-relative directory one component at a time without following symlinks. */
export async function ensureSafeRepositoryDirectory(rootDir: string, path: string): Promise<string> {
  const relativePath = normalizeRepositoryRelativePath(path);
  const canonicalRoot = await realpath(rootDir);
  let current = canonicalRoot;
  for (const [index, segment] of relativePath.split("/").entries()) {
    current = resolve(current, segment);
    try {
      await mkdir(current);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const info = await lstat(current, { bigint: true });
    if (info.isSymbolicLink()) {
      throw new UnsafeRepositoryPathError(path, "symlink", `${relativePath.split("/").slice(0, index + 1).join("/")} is a symlink`);
    }
    if (!info.isDirectory()) {
      throw new UnsafeRepositoryPathError(path, "invalid-path", `${relativePath.split("/").slice(0, index + 1).join("/")} is not a directory`);
    }
    const canonicalCurrent = await realpath(current);
    if (!isContained(canonicalRoot, canonicalCurrent)) {
      throw new UnsafeRepositoryPathError(path, "outside-root", "a created directory resolves outside the repository");
    }
  }
  return current;
}

export async function readRepositoryPathIdentity(
  rootDir: string,
  path: string,
): Promise<RepositoryPathIdentity> {
  const inspected = await inspectRepositoryPath(rootDir, path);
  const stat = await lstat(inspected.absolutePath, { bigint: true });
  return { dev: stat.dev, ino: stat.ino };
}

export async function assertRepositoryPathIdentity(
  rootDir: string,
  path: string,
  expected: RepositoryPathIdentity,
): Promise<void> {
  const current = await readRepositoryPathIdentity(rootDir, path);
  if (current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new UnsafeRepositoryPathError(path, "changed", "the path identity changed after it was inspected");
  }
}

function identityFromStat(
  stat: Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>>,
  sha256: string,
): RepositoryFileIdentity {
  return {
    dev: BigInt(stat.dev),
    ino: BigInt(stat.ino),
    size: Number(stat.size),
    mtimeNs: "mtimeNs" in stat ? BigInt(stat.mtimeNs) : BigInt(Math.trunc(Number(stat.mtimeMs) * 1_000_000)),
    sha256,
  };
}

/** Read bytes from a regular file while binding them to its inode identity. */
export async function readRepositoryFileSnapshot(
  rootDir: string,
  path: string,
): Promise<RepositoryFileSnapshot> {
  const inspected = await inspectRepositoryPath(rootDir, path);
  const handle = await open(inspected.absolutePath, "r");
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile()) {
      throw new UnsafeRepositoryPathError(path, "invalid-path", "the final target is not a regular file");
    }
    const content = await handle.readFile();
    const sha256 = createHash("sha256").update(content).digest("hex");

    // A rename between the initial ancestor walk and open() must not bind the
    // plan to one inode while a later unlink/rewrite targets another.
    const current = await lstat(inspected.absolutePath, { bigint: true });
    if (current.isSymbolicLink() || current.dev !== stat.dev || current.ino !== stat.ino) {
      throw new UnsafeRepositoryPathError(path, "changed", "the file identity changed while it was inspected");
    }

    return {
      relativePath: inspected.relativePath,
      absolutePath: inspected.absolutePath,
      content,
      identity: identityFromStat(stat, sha256),
    };
  } finally {
    await handle.close();
  }
}

/**
 * Re-walk ancestors and verify inode plus bytes immediately before a mutation.
 */
export async function assertRepositoryFileUnchanged(
  rootDir: string,
  path: string,
  expected: RepositoryFileIdentity,
): Promise<void> {
  const current = await readRepositoryFileSnapshot(rootDir, path);
  if (
    current.identity.dev !== expected.dev ||
    current.identity.ino !== expected.ino ||
    current.identity.size !== expected.size ||
    current.identity.mtimeNs !== expected.mtimeNs ||
    current.identity.sha256 !== expected.sha256
  ) {
    throw new UnsafeRepositoryPathError(path, "changed", "the file changed after the lifecycle plan was computed");
  }
}

function sameFileIdentity(a: RepositoryFileIdentity, b: RepositoryFileIdentity): boolean {
  return a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.sha256 === b.sha256;
}

async function quarantineRepositoryFile(
  rootDir: string,
  path: string,
  expected: RepositoryFileIdentity,
  hooks: RepositoryPathSafetyTestHooks = {},
): Promise<RepositoryFileSnapshot> {
  const relativePath = normalizeRepositoryRelativePath(path);
  await assertRepositoryFileUnchanged(rootDir, relativePath, expected);
  const parent = dirname(relativePath).replace(/\\/g, "/");
  const quarantineName = `.${basename(relativePath)}.hatch3r-quarantine-${randomBytes(8).toString("hex")}`;
  const quarantinePath = parent === "." ? quarantineName : `${parent}/${quarantineName}`;
  const original = await inspectRepositoryPath(rootDir, relativePath);
  const quarantine = await inspectRepositoryPath(rootDir, quarantinePath, { allowMissing: true });
  if (quarantine.exists) {
    throw new UnsafeRepositoryPathError(path, "changed", "the unique quarantine target already exists");
  }
  await rename(original.absolutePath, quarantine.absolutePath);

  try {
    await hooks.afterQuarantineRename?.({
      originalAbsolutePath: original.absolutePath,
      quarantineAbsolutePath: quarantine.absolutePath,
      quarantineRelativePath: quarantine.relativePath,
    });
    const moved = await readRepositoryFileSnapshot(rootDir, quarantinePath);
    if (sameFileIdentity(moved.identity, expected)) return moved;
  } catch (inspectionError) {
    await recoverRacedQuarantineEntry(path, original, quarantine, inspectionError);
    throw inspectionError;
  }

  return recoverRacedQuarantineEntry(
    path,
    original,
    quarantine,
    new UnsafeRepositoryPathError(path, "changed", "the quarantined file identity changed after rename"),
  );
}

/** Remove only the inode whose identity/content the caller planned against. */
export async function removeRepositoryFileIfUnchanged(
  rootDir: string,
  path: string,
  expected: RepositoryFileIdentity,
  hooks: RepositoryPathSafetyTestHooks = {},
): Promise<void> {
  const quarantined = await quarantineRepositoryFile(rootDir, path, expected, hooks);
  await assertRepositoryFileUnchanged(rootDir, quarantined.relativePath, quarantined.identity);
  await unlink(quarantined.absolutePath);
}

/** Replace a planned file while retaining its verified old inode until the new bytes land. */
export async function replaceRepositoryFileIfUnchanged(
  rootDir: string,
  path: string,
  expected: RepositoryFileIdentity,
  content: string | Buffer,
  hooks: RepositoryPathSafetyTestHooks = {},
): Promise<void> {
  const relativePath = normalizeRepositoryRelativePath(path);
  const quarantined = await quarantineRepositoryFile(rootDir, relativePath, expected, hooks);
  try {
    const target = await inspectRepositoryPath(rootDir, relativePath, { allowMissing: true });
    if (target.exists) {
      throw new UnsafeRepositoryPathError(path, "changed", "a new owner appeared while the replacement was prepared");
    }
    await atomicWriteFile(target.absolutePath, content);
    await assertRepositoryFileUnchanged(rootDir, quarantined.relativePath, quarantined.identity);
    await unlink(quarantined.absolutePath);
  } catch (err) {
    // Restore the verified original only if the target is still absent. Never
    // overwrite a path another actor created during the failed replacement.
    try {
      const target = await inspectRepositoryPath(rootDir, relativePath, { allowMissing: true });
      if (!target.exists) await rename(quarantined.absolutePath, target.absolutePath);
    } catch (restoreErr) {
      throw new HatchError(
        `Repository replacement failed for ${JSON.stringify(path)} and the verified original remains at ${quarantined.relativePath}: ` +
          `${err instanceof Error ? err.message : String(err)}; restoration also failed: ` +
          `${restoreErr instanceof Error ? restoreErr.message : String(restoreErr)}`,
        1,
        "FS_ERROR",
      );
    }
    throw err;
  }
}
