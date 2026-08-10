import { lstat, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isPathWithin } from "../codex/pathContainment.js";
import {
  assertSafeCodexRelativePath,
  extractCodexCanonicalReferences,
  extractStructuredCodexReferences,
  normalizeCodexRelativePath,
  topLevelPrefixedReferenceAlias,
} from "./codexReference.js";
import { CodexProjectionError } from "./codexProjectionError.js";

export interface CodexTextFile {
  absolutePath: string;
  relativePath: string;
  content: string;
}

export interface CodexSupportClosure {
  support: ReadonlyMap<string, CodexTextFile>;
  aliases: ReadonlyMap<string, string>;
  unresolved: ReadonlySet<string>;
  warnings: string[];
}

export function validateCodexText(content: string, source: string): void {
  if (content.includes("\uFFFD")) {
    throw new CodexProjectionError(
      `${source} is not valid UTF-8 text (replacement character detected)`,
    );
  }
  const control = content.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/);
  if (!control) return;
  const byte = control[0].charCodeAt(0).toString(16).padStart(2, "0");
  throw new CodexProjectionError(`${source} is not safe text (control byte 0x${byte})`);
}

async function readCodexTextFile(
  absolutePath: string,
  root: string,
): Promise<string> {
  if (!isPathWithin(root, absolutePath)) {
    throw new CodexProjectionError(`${absolutePath} escapes the allowed source root ${root}`);
  }
  const stat = await lstat(absolutePath);
  if (stat.isSymbolicLink()) {
    throw new CodexProjectionError(
      `${absolutePath} is a symbolic link; Codex projection accepts regular text files only`,
    );
  }
  if (!stat.isFile()) throw new CodexProjectionError(`${absolutePath} is not a regular file`);
  const bytes = await readFile(absolutePath);
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new CodexProjectionError(
      `${absolutePath} is not valid UTF-8 text`,
      undefined,
    );
  }
  validateCodexText(content, absolutePath);
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

export async function walkCodexCompanionFiles(
  root: string,
  baseRoot = root,
): Promise<CodexTextFile[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const results: CodexTextFile[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = join(root, entry.name);
    assertCompanionEntry(entry, absolutePath);
    if (entry.isDirectory()) {
      results.push(...await walkCodexCompanionFiles(absolutePath, baseRoot));
    } else {
      results.push({
        absolutePath,
        relativePath: normalizeCodexRelativePath(absolutePath.slice(baseRoot.length + 1)),
        content: await readCodexTextFile(absolutePath, baseRoot),
      });
    }
  }
  return results;
}

function assertCompanionEntry(
  entry: { isSymbolicLink(): boolean; isDirectory(): boolean; isFile(): boolean },
  absolutePath: string,
): void {
  if (entry.isSymbolicLink()) {
    throw new CodexProjectionError(
      `${absolutePath} is a symbolic link; companion projection fails closed`,
    );
  }
  if (!entry.isDirectory() && !entry.isFile()) {
    throw new CodexProjectionError(`${absolutePath} is not a regular file`);
  }
}

export async function collectCodexSupportClosure(
  canonicalRoot: string,
  initialReferences: Iterable<string>,
): Promise<CodexSupportClosure> {
  const state = createClosureState(initialReferences);
  while (state.pending.size > 0) {
    const reference = [...state.pending].sort()[0]!;
    state.pending.delete(reference);
    if (state.support.has(reference) || state.unresolved.has(reference)) continue;
    await resolveClosureReference(canonicalRoot, reference, state);
  }
  return {
    support: state.support,
    aliases: state.aliases,
    unresolved: state.unresolved,
    warnings: state.warnings,
  };
}

interface ClosureState {
  support: Map<string, CodexTextFile>;
  aliases: Map<string, string>;
  unresolved: Set<string>;
  pending: Set<string>;
  warnings: string[];
}

function createClosureState(initialReferences: Iterable<string>): ClosureState {
  return {
    support: new Map(),
    aliases: new Map(),
    unresolved: new Set(),
    pending: new Set([...initialReferences].map(normalizeCodexRelativePath)),
    warnings: [],
  };
}

async function resolveClosureReference(
  canonicalRoot: string,
  reference: string,
  state: ClosureState,
): Promise<void> {
  const safe = assertSafeCodexRelativePath(reference, "Canonical support reference");
  const loaded = await loadSupportCandidate(canonicalRoot, safe);
  if (loaded) {
    addClosureFile(loaded.key, loaded.file, canonicalRoot, state);
    if (loaded.key !== safe) state.aliases.set(safe, loaded.key);
    return;
  }
  state.unresolved.add(safe);
  state.warnings.push(
    `[codex] Referenced canonical support file "${safe}" does not exist; the reference was replaced with an explicit unsupported marker.`,
  );
}

async function loadSupportCandidate(
  canonicalRoot: string,
  reference: string,
): Promise<{ key: string; file: CodexTextFile } | undefined> {
  for (const key of [reference, topLevelPrefixedReferenceAlias(reference)].filter(
    (candidate): candidate is string => candidate !== undefined,
  )) {
    const absolutePath = resolve(canonicalRoot, key);
    try {
      const content = await readCodexTextFile(absolutePath, canonicalRoot);
      return { key, file: { absolutePath, relativePath: key, content } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return undefined;
}

function addClosureFile(
  key: string,
  file: CodexTextFile,
  canonicalRoot: string,
  state: ClosureState,
): void {
  state.support.set(key, file);
  const nested = [
    ...extractCodexCanonicalReferences(file.content, file.absolutePath, canonicalRoot),
    ...extractStructuredCodexReferences(file.content),
  ];
  for (const reference of nested) {
    if (!state.support.has(reference)) state.pending.add(reference);
  }
}
