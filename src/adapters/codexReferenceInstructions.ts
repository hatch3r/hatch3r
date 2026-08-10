import {
  sanitizeId,
  toPrefixedId,
  type AdapterOutput,
  type CanonicalFile,
} from "../types.js";
import { wrapManagedFor } from "../merge/managedBlocks.js";
import type {
  CodexInstructionCompanion,
  CodexInstructionProjectionInput,
} from "./codexInstructions.js";
import {
  assertSafeCodexRelativePath,
  CODEX_SUPPORT_ROOT,
  resolveCodexReference,
  type CodexReferenceResolver,
} from "./codexReference.js";
import { CodexProjectionError, codexProjectionIssues } from "./codexProjectionError.js";
import {
  collectCodexVocabularyIssues,
  translateCodexNativeContent,
} from "./codexProjectionTranslation.js";

type CodexSupportClass = "agents" | "rules" | "commands";

interface CodexSupportEntry {
  class: CodexSupportClass;
  relativePath: string;
  outputPath: string;
  content: string;
  sourcePath: string;
  canonical?: CanonicalFile;
}

function canonicalRelativePath(file: CanonicalFile, cls: CodexSupportClass): string {
  const source = file.sourcePath.replace(/\\/g, "/");
  const token = `/${cls}/`;
  const index = source.lastIndexOf(token);
  if (index >= 0) {
    return assertSafeCodexRelativePath(source.slice(index + token.length), "Unsafe support path");
  }
  const id = toPrefixedId(file.id);
  if (sanitizeId(id) !== id) {
    throw new CodexProjectionError(`Unsafe canonical id: ${JSON.stringify(file.id)}`);
  }
  return `${id}.md`;
}

function entryFromCanonical(
  file: CanonicalFile,
  cls: CodexSupportClass,
): CodexSupportEntry {
  const relativePath = canonicalRelativePath(file, cls);
  return {
    class: cls,
    relativePath,
    outputPath: `${CODEX_SUPPORT_ROOT}/${cls}/${relativePath}`,
    content: file.content,
    sourcePath: file.sourcePath,
    canonical: file,
  };
}

function entryFromCompanion(file: CodexInstructionCompanion): CodexSupportEntry {
  const relativePath = assertSafeCodexRelativePath(file.relativePath, "Unsafe support path");
  return {
    class: file.class,
    relativePath,
    outputPath: `${CODEX_SUPPORT_ROOT}/${file.class}/${relativePath}`,
    content: file.content,
    sourcePath: file.sourcePath,
  };
}

function collectCodexInstructionEntries(
  input: CodexInstructionProjectionInput,
): CodexSupportEntry[] {
  const entries = [
    ...(input.agents ?? []).map((file) => entryFromCanonical(file, "agents")),
    ...(input.rules ?? []).map((file) => entryFromCanonical(file, "rules")),
    ...(input.commands ?? []).map((file) => entryFromCanonical(file, "commands")),
    ...(input.companions ?? []).map(entryFromCompanion),
  ].sort((left, right) => left.outputPath.localeCompare(right.outputPath));
  const duplicates = entries
    .filter((entry, index) =>
      entries.findIndex((candidate) => candidate.outputPath === entry.outputPath) !== index)
    .map((entry) => `Duplicate support output: ${entry.outputPath}`);
  if (duplicates.length > 0) {
    throw codexProjectionIssues("Codex instruction projection failed", [...new Set(duplicates)]);
  }
  return entries;
}

/** Build the canonical-reference map consumed by native-agent projection. */
export function buildCodexInstructionReferenceMap(
  input: CodexInstructionProjectionInput,
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const entry of collectCodexInstructionEntries(input)) {
    const canonical = `${entry.class}/${entry.relativePath}`;
    result.set(canonical, entry.outputPath);
    addUnprefixedAlias(result, entry);
  }
  return result;
}

function addUnprefixedAlias(
  result: Map<string, string>,
  entry: CodexSupportEntry,
): void {
  const segments = entry.relativePath.split("/");
  const basename = segments.at(-1)!;
  if (!basename.startsWith("hatch3r-")) return;
  const relative = [...segments.slice(0, -1), basename.slice("hatch3r-".length)].join("/");
  const alias = `${entry.class}/${relative}`;
  if (!result.has(alias)) result.set(alias, entry.outputPath);
}

interface TranslationState {
  resolver: CodexReferenceResolver;
  availableSkills: ReadonlySet<string>;
  commandSkillIds: ReadonlyMap<string, string>;
  warnings: string[];
}

function replacementForCanonical(
  cls: CodexSupportClass,
  relative: string,
  state: TranslationState,
): string {
  const normalized = assertSafeCodexRelativePath(relative, "Unsafe support path")
    .replace(/(^|\/)h4tcher-/, "$1hatch3r-");
  const resolution = resolveCodexReference(`${cls}/${normalized}`, state.resolver);
  if (resolution.status === "resolved") return resolution.target;
  if (resolution.status === "self") return state.resolver.selfReferenceText ?? resolution.target;
  if (cls === "commands" && relative.endsWith("/SKILL.md")) {
    const id = relative.split("/").at(-2);
    if (id && state.availableSkills.has(id)) return `.agents/skills/${id}/SKILL.md`;
  }
  const reference = `${cls}/${relative}`;
  state.warnings.push(
    `Unprojected optional internal reference ${reference} was replaced with an explicit omission marker.`,
  );
  return `[unsupported Hatcher reference omitted: ${reference}]`;
}

function translateCanonicalReferences(content: string, state: TranslationState): string {
  return content.replace(
    /(^|[\s([`"'→])(?:(?:\.\.\/)+|\.\/|\.claude\/)?(agents|rules|commands)\/([A-Za-z0-9._/-]+\.md)\b/gm,
    (_match, prefix: string, cls: CodexSupportClass, relative: string) =>
      `${prefix}${replacementForCanonical(cls, relative, state)}`,
  );
}

function translateRelativeShared(
  content: string,
  entry: CodexSupportEntry,
  state: TranslationState,
): string {
  return content.replace(
    /(^|[\s([`"'→])(?:(?:\.\.\/)+|\.\/)?shared\/([A-Za-z0-9._/-]+\.md)\b/gm,
    (_match, prefix: string, relative: string) => {
      const key = `${entry.class}/shared/${assertSafeCodexRelativePath(relative, "Unsafe support path")}`;
      const resolution = resolveCodexReference(key, state.resolver);
      if (resolution.status !== "unsupported") {
        const replacement = resolution.status === "self"
          ? state.resolver.selfReferenceText ?? resolution.target
          : resolution.target;
        return `${prefix}${replacement}`;
      }
      state.warnings.push(
        `Unprojected optional relative reference ${key} was replaced with an explicit omission marker.`,
      );
      return `${prefix}[unsupported Hatcher reference omitted: ${key}]`;
    },
  );
}

function translateSkillReferences(content: string, state: TranslationState): string {
  return content.replace(
    /(^|[\s([`"'→])(?:\.claude\/)?skills\/(hatch3r-[A-Za-z0-9._-]+)\/SKILL\.md\b/gm,
    (_match, prefix: string, id: string) => {
      if (state.availableSkills.has(id)) return `${prefix}.agents/skills/${id}/SKILL.md`;
      state.warnings.push(
        `Unprojected optional skill reference skills/${id}/SKILL.md was replaced with an explicit omission marker.`,
      );
      return `${prefix}[unsupported Hatcher skill omitted: ${id}]`;
    },
  );
}

export function projectCodexInstructionSupport(
  input: CodexInstructionProjectionInput,
): { entries: CodexSupportEntry[]; outputs: AdapterOutput[]; warnings: string[] } {
  const entries = collectCodexInstructionEntries(input);
  const warnings: string[] = [];
  const issues: string[] = [];
  const availableSkills = new Set(
    (input.availableSkillIds ?? []).map((id) => toPrefixedId(id)),
  );
  const targets = buildCodexInstructionReferenceMap(input);
  const commandSkillIds = input.commandSkillIds ?? new Map<string, string>();
  const outputs = entries.map((entry) => {
    const state: TranslationState = {
      resolver: { targets, currentTarget: entry.outputPath, selfReferenceText: "this support file" },
      availableSkills,
      commandSkillIds,
      warnings,
    };
    const canonical = translateCanonicalReferences(entry.content, state);
    const relative = translateRelativeShared(canonical, entry, state);
    const skills = translateSkillReferences(relative, state);
    const translated = translateCodexNativeContent(skills, {
      kind: "support",
      skillIds: availableSkills,
      commandIdsByCanonicalId: commandSkillIds,
    });
    issues.push(...collectCodexVocabularyIssues(translated).map(
      (issue) => `${entry.outputPath}: ${issue}`,
    ));
    return supportOutput(entry, translated);
  });
  if (issues.length > 0) {
    throw codexProjectionIssues(
      "Codex instruction projection failed",
      [...new Set(issues)].sort(),
    );
  }
  return { entries, outputs, warnings };
}

function supportOutput(entry: CodexSupportEntry, content: string): AdapterOutput {
  const managedContent = content.trim();
  return {
    path: entry.outputPath,
    content: wrapManagedFor(entry.outputPath, managedContent),
    managedContent,
    action: "create",
    sourceFiles: [entry.sourcePath],
  };
}
