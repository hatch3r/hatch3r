import type { CanonicalFile } from "../types.js";
import { applyCustomization } from "./customization.js";
import { validateCodexText } from "./codexCompanion.js";
import type { CodexDiscoveryCatalog } from "./codexDiscovery.js";
import { buildCodexDiscoveryCatalog } from "./codexDiscovery.js";
import { assertSafeCodexRelativePath, extractStructuredCodexReferences } from "./codexReference.js";
import {
  buildCodexCommandSkillIds,
  type CodexTranslationContext,
  translateCodexNativeContent,
} from "./codexProjectionTranslation.js";

export const CODEX_REPORT_OMISSION_WARNING =
  "[codex] Skill \"hatch3r-report\" omitted: it depends on Claude Code JSONL transcripts and Claude-specific tool-result schemas; Codex has no compatible repository transcript contract.";

export interface CodexProjectedPrimary {
  file: CanonicalFile;
  id: string;
  description: string;
  body: string;
  outputPath: string;
  kind: "skill" | "command";
  structuredReferences: string[];
}

export interface CodexSurfacePlan {
  primaries: CodexProjectedPrimary[];
  translationContext: Omit<CodexTranslationContext, "kind">;
  discovery: CodexDiscoveryCatalog;
  commandSkillIds: ReadonlyMap<string, string>;
  warnings: string[];
  omitted: string[];
}

export interface CodexSurfacePlanOptions {
  projectRoot: string;
  skills: CanonicalFile[];
  commands?: CanonicalFile[];
  availableAgentIds?: ReadonlySet<string>;
  discoveryBudget?: number;
  transformContent?: (content: string, file: CanonicalFile) => string;
}

interface CustomizedFile {
  file: CanonicalFile;
  content: string;
  description: string;
}

function dedupeLast(files: CanonicalFile[], kind: string, warnings: string[]): CanonicalFile[] {
  const byId = new Map<string, CanonicalFile>();
  for (const file of files) {
    if (byId.has(file.id)) {
      warnings.push(
        `[codex] Duplicate ${kind} id "${file.id}" projected from the last selected source; earlier source omitted.`,
      );
    }
    byId.set(file.id, file);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

async function customizeFiles(
  projectRoot: string,
  files: CanonicalFile[],
  kind: string,
  warnings: string[],
): Promise<CustomizedFile[]> {
  const customized: CustomizedFile[] = [];
  for (const file of dedupeLast(files, kind, warnings)) {
    const result = await applyCustomization(projectRoot, file);
    warnings.push(...result.warnings.map((warning) => `[codex:${file.id}] ${warning}`));
    if (result.skip) continue;
    customized.push({
      file,
      content: result.content,
      description: result.overrides.description ?? file.description,
    });
  }
  return customized;
}

function makePrimary(
  customized: CustomizedFile,
  id: string,
  kind: "skill" | "command",
  context: Omit<CodexTranslationContext, "kind">,
  transform: (content: string, file: CanonicalFile) => string,
): CodexProjectedPrimary {
  const transformed = transform(customized.content, customized.file);
  validateCodexText(transformed, customized.file.sourcePath || customized.file.id);
  const label = kind === "skill" ? "Skill id" : "Command skill id";
  return {
    file: customized.file,
    id,
    description: translateCodexNativeContent(customized.description, { ...context, kind }),
    body: transformed,
    outputPath: `.agents/skills/${assertSafeCodexRelativePath(id, label)}/SKILL.md`,
    kind,
    structuredReferences: extractStructuredCodexReferences(customized.file.rawContent),
  };
}

function omitIncompatibleSkills(skills: CanonicalFile[], warnings: string[], omitted: string[]) {
  return skills.filter((skill) => {
    if (skill.id !== "hatch3r-report") return true;
    omitted.push(skill.id);
    warnings.push(CODEX_REPORT_OMISSION_WARNING);
    return false;
  });
}

function createPrimaryList(
  skills: CustomizedFile[],
  commands: CustomizedFile[],
  commandSkillIds: ReadonlyMap<string, string>,
  context: Omit<CodexTranslationContext, "kind">,
  transform: (content: string, file: CanonicalFile) => string,
): CodexProjectedPrimary[] {
  return [
    ...skills.map((item) => makePrimary(item, item.file.id, "skill", context, transform)),
    ...commands.map((item) => makePrimary(
      item,
      commandSkillIds.get(item.file.sourcePath || item.file.id)!,
      "command",
      context,
      transform,
    )),
  ];
}

/** Resolve selection, customization, command identities, and discovery metadata once. */
export async function planCodexSurfaces(
  options: CodexSurfacePlanOptions,
): Promise<CodexSurfacePlan> {
  const warnings: string[] = [];
  const omitted: string[] = [];
  const transform = options.transformContent ?? ((content: string) => content);
  const skills = await customizeFiles(
    options.projectRoot,
    omitIncompatibleSkills(options.skills, warnings, omitted),
    "skill",
    warnings,
  );
  const commands = await customizeFiles(
    options.projectRoot,
    options.commands ?? [],
    "command",
    warnings,
  );
  const skillIds = new Set(skills.map(({ file }) => file.id));
  const commandSkillIds = buildCodexCommandSkillIds(commands.map(({ file }) => file), skillIds);
  const commandIdsByCanonicalId = new Map(commands.map(({ file }) => [
    file.id,
    commandSkillIds.get(file.sourcePath || file.id)!,
  ]));
  const translationContext = {
    skillIds,
    commandIdsByCanonicalId,
    availableAgentIds: options.availableAgentIds,
  };
  const primaries = createPrimaryList(
    skills,
    commands,
    commandSkillIds,
    translationContext,
    transform,
  );
  const discovery = buildCodexDiscoveryCatalog(primaries.map((primary) => ({
    name: primary.id,
    description: primary.description,
    path: primary.outputPath,
  })), options.discoveryBudget);
  if (discovery.compacted) {
    warnings.push(
      `[codex] Skill discovery metadata compacted to ${discovery.characterCount}/${discovery.budget} fallback characters; SKILL.md bodies remain complete.`,
    );
  }
  return { primaries, translationContext, discovery, commandSkillIds, warnings, omitted };
}
