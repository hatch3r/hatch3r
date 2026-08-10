import { createHash } from "node:crypto";
import type { CanonicalFile } from "../types.js";
import {
  findCodexHatcherReferenceIssues,
  findCodexOperationalVocabularyIssues,
  translateCodexAgentInstructions,
} from "./codexAgents.js";
import { CODEX_SUPPORT_ROOT } from "./codexReference.js";
import { translateStandaloneHatcherSlashInvocations } from "./codexInvocations.js";

export interface CodexTranslationContext {
  kind: "skill" | "command" | "support";
  skillIds: ReadonlySet<string>;
  commandIdsByCanonicalId: ReadonlyMap<string, string>;
  availableAgentIds?: ReadonlySet<string>;
}

function stableSuffix(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

/** Allocate command-derived skill names without colliding with native skills. */
export function buildCodexCommandSkillIds(
  commands: ReadonlyArray<Pick<CanonicalFile, "id" | "sourcePath">>,
  occupiedSkillIds: ReadonlySet<string>,
): ReadonlyMap<string, string> {
  const occupied = new Set(occupiedSkillIds);
  const result = new Map<string, string>();
  const sorted = [...commands].sort(
    (left, right) => left.id.localeCompare(right.id) || left.sourcePath.localeCompare(right.sourcePath),
  );
  for (const command of sorted) {
    const key = command.sourcePath || command.id;
    const base = `hatch3r-command-${command.id.replace(/^hatch3r-/, "")}`;
    let candidate = occupied.has(base) ? `${base}-${stableSuffix(key)}` : base;
    let ordinal = 2;
    while (occupied.has(candidate)) candidate = `${base}-${stableSuffix(key)}-${ordinal++}`;
    occupied.add(candidate);
    result.set(key, candidate);
  }
  return result;
}

function commandInvocationId(
  commandId: string,
  commandIds: ReadonlyMap<string, string>,
): string | undefined {
  return commandIds.get(commandId);
}

function translateSourceHarnessPaths(
  content: string,
  context: CodexTranslationContext,
): string {
  const paths = content
    .replace(/\.claude\/agents\/(?:h4tcher-|hatch3r-)?([A-Za-z0-9_<>.*{}-]+)\.md/g,
      (_match, id: string) => `.codex/agents/hatch3r-${id}.toml`)
    .replace(/\.claude\/commands\/hatch3r-([a-z0-9-]+)\.md/g, (_match, id: string) => {
      return `$${commandInvocationId(`hatch3r-${id}`, context.commandIdsByCanonicalId) ?? `hatch3r-command-${id}`}`;
    })
    .replace(/\.claude\/skills\/h4tcher-([a-z0-9-]+)\/SKILL\.md/g, (_match, id: string) => {
      return translateSourceSkill(id, context);
    });
  return translateStandaloneHatcherSlashInvocations(paths, (id) =>
    id.startsWith("hatch3r-") ? translateHatcherInvocation(id, context) : `/${id}`)
    .replace(/(?<![A-Za-z0-9._/-])(?:(?:\.\.\/)+|\.\/)?skills\/(hatch3r-[a-z0-9-]+)(?:\/SKILL\.md)?/g,
      (_match, id: string) => context.skillIds.has(id)
        ? `$${id}`
        : `[unsupported Hatcher skill omitted: ${id}]`)
    .replace(/(?<![A-Za-z0-9._/-])(?:(?:\.\.\/)+|\.\/)?commands\/(hatch3r-[a-z0-9-]+)\/SKILL\.md/g,
      (_match, id: string) => translateCommandSkill(id, context));
}

function translateSourceSkill(id: string, context: CodexTranslationContext): string {
  const projectedId = id === "release-prep" ? "release" : id;
  const skillId = `hatch3r-${projectedId}`;
  if (context.skillIds.has(skillId)) return `$${skillId}`;
  const commandId = commandInvocationId(skillId, context.commandIdsByCanonicalId);
  return commandId
    ? `$${commandId}`
    : `[unsupported source-harness skill omitted: h4tcher-${id}]`;
}

function translateHatcherInvocation(id: string, context: CodexTranslationContext): string {
  if (context.kind !== "command" && context.skillIds.has(id)) return `$${id}`;
  const commandId = commandInvocationId(id, context.commandIdsByCanonicalId);
  if (commandId) return `$${commandId}`;
  return context.skillIds.has(id)
    ? `$${id}`
    : `[unsupported Hatcher invocation omitted: ${id}]`;
}

function translateCommandSkill(id: string, context: CodexTranslationContext): string {
  if (context.skillIds.has(id)) return `$${id}`;
  const commandId = commandInvocationId(id, context.commandIdsByCanonicalId);
  return commandId
    ? `$${commandId}`
    : `[unsupported Hatcher command bridge omitted: ${id}]`;
}

function translateSubagentContract(line: string): string {
  if (!/Claude Code PreToolUse hook/.test(line) || !/subagent_type/.test(line)) return line;
  return "**Tool-allowlist enforcement boundary (ASI02/ASI03).** Codex subagents use their generated sandbox and permission configuration. The orchestrator still applies `checkToolAccess(roleId, toolCategory)` before delegation; deny by default and never widen permissions to compensate for a missing tool.";
}

function translateInteractiveAssumption(line: string): string | undefined {
  if (!/CLAUDE_AFK_TIMEOUT_MS|Cursor:\s*AskUserQuestion timeout/.test(line)) return undefined;
  return "1. **Detect non-response.** If the user does not answer, apply the documented default and state it; use an interactive-input tool only when the current Codex host exposes one, otherwise ask in plain text.";
}

function translateLineInvocations(line: string, context: CodexTranslationContext): string {
  let translated = translateStandaloneHatcherSlashInvocations(line, (id) =>
    id.startsWith("hatch3r-") ? translateHatcherInvocation(id, context) : `/${id}`);
  translated = translated.replace(
    /(?<![A-Za-z0-9._/-])`?skills\/(hatch3r-[a-z0-9-]+)(?:\/SKILL\.md)?`?/g,
    (_match, id: string) => context.skillIds.has(id)
      ? `$${id}`
      : `[unsupported Hatcher skill omitted: ${id}]`,
  );
  translated = translated.replace(
    /(^|[\s([{"'`>→,:;])\/release(?=$|[\s)\]}"'`,:;!?]|\.(?:$|\s))/gim,
    (_match, prefix: string) => {
    const fallback = context.kind === "command" ? "hatch3r-release" : "hatch3r-release";
    const id = context.kind === "command"
      ? commandInvocationId("hatch3r-release", context.commandIdsByCanonicalId) ?? fallback
      : fallback;
      return `${prefix}$${id}`;
    },
  );
  return translateStandaloneHatcherSlashInvocations(translated, (id) =>
    id.startsWith("h4tcher-")
      ? translateSourceInvocation(id.slice("h4tcher-".length), context)
      : `/${id}`);
}

function translateSourceInvocation(id: string, context: CodexTranslationContext): string {
  const projected = id === "release-prep" ? "release" : id;
  const skillId = `hatch3r-${projected}`;
  if (context.skillIds.has(skillId)) return `$${skillId}`;
  const commandId = commandInvocationId(skillId, context.commandIdsByCanonicalId);
  return commandId
    ? `$${commandId}`
    : `[unsupported source-harness invocation omitted: h4tcher-${id}]`;
}

function translateBareSourceArtifacts(
  content: string,
  context: CodexTranslationContext,
): string {
  return content.replace(
    /(?<!: )(?<![A-Za-z0-9_$/-])h4tcher-([a-z0-9-]+)/g,
    (_match, id: string) => {
      const translated = translateSourceInvocation(id, context);
      return translated.includes("invocation omitted")
        ? translated.replace("invocation", "artifact")
        : translated;
    },
  );
}

function translateGenericCorpusPaths(content: string): string {
  return content
    .replace(/\bhatch3r commands\/skills\/agents\b/g, "Hatcher command bridges, skills, and custom agents")
    .replace(/\bagents\/skills\/commands\b/g, "agents, skills, and command bridges")
    .replace(/(?<![A-Za-z0-9._/-])commands\/board\/shared-\{platform\}\.md/g, `${CODEX_SUPPORT_ROOT}/commands/board/shared-{platform}.md`)
    .replace(/(?<![A-Za-z0-9._/-])commands\/rework\//g, `${CODEX_SUPPORT_ROOT}/commands/rework/`)
    .replace(/(?<![A-Za-z0-9._/-])agents\/(hatch3r-\{[A-Za-z0-9_, -]+\}\.md)/g, `${CODEX_SUPPORT_ROOT}/agents/$1`)
    .replace(/(?<![A-Za-z0-9._/-])agents\/(hatch3r-\*\.md|\*\.md)/g, `${CODEX_SUPPORT_ROOT}/agents/$1`)
    .replace(/(?<![A-Za-z0-9._/-])rules\/(hatch3r-\*\.md|\*\.md)/g, `${CODEX_SUPPORT_ROOT}/rules/$1`)
    .replace(/(?<![A-Za-z0-9._/-])agents\/shared\/\*/g, `${CODEX_SUPPORT_ROOT}/agents/shared/*`)
    .replace(/(?<![A-Za-z0-9._/-])rules\/\*/g, `${CODEX_SUPPORT_ROOT}/rules/*`)
    .replace(/(?<![A-Za-z0-9._/-])skills\/\*/g, ".agents/skills/*")
    .replace(/(?<![A-Za-z0-9._/-])commands\/hatch3r-\*\.md/g, "generated `$hatch3r-command-*` skills")
    .replace(/(?<![A-Za-z0-9._/-])agents\/modes\//g, "the applicable generated Codex custom subagent mode")
    .replace(/(?<![A-Za-z0-9._/-])rules\/(?=[`\s).,;:]|$)/g, "the Hatcher rules indexed by the active repository instructions")
    .replace(/(?<![A-Za-z0-9._/-])commands\/(?=[`\s).,;:]|$)/g, "the generated Hatcher command-bridge skills")
    .replace(/(?<!: )(?<![A-Za-z0-9._/-])checks\/[A-Za-z0-9_.*{}\/-]+/g, "[unprojected Hatcher check reference omitted]")
    .replace(/(?<!: )(?<![A-Za-z0-9._/-])governance\/[A-Za-z0-9_.*{}\/-]+/g, "[unprojected Hatcher governance reference omitted]")
    .replace(/(?<!: )(?<![A-Za-z0-9._/-])scripts\/[A-Za-z0-9_.*{}\/-]+/g, "[Hatcher development-only script reference omitted]");
}

function translateOperationalLine(line: string, context: CodexTranslationContext): string {
  if (/cross[- ]harness example.*claude/i.test(line)) return line;
  const interactive = translateInteractiveAssumption(line);
  if (interactive) return interactive;
  const invocations = translateLineInvocations(line, context);
  const artifacts = translateBareSourceArtifacts(invocations, context);
  return translateGenericCorpusPaths(artifacts);
}

/** Translate harness-shaped tokens while preserving labeled cross-harness examples. */
export function translateCodexNativeContent(
  content: string,
  context: CodexTranslationContext,
): string {
  const specialized = translateSourceHarnessPaths(content, context)
    .split(/\r?\n/)
    .map(translateSubagentContract)
    .join("\n");
  const native = translateCodexAgentInstructions(specialized, context.availableAgentIds);
  return native.split("\n").map((line) => translateOperationalLine(line, context)).join("\n");
}

export function collectCodexVocabularyIssues(content: string): string[] {
  return findCodexOperationalVocabularyIssues(content);
}

export function collectCodexHatcherReferenceIssues(content: string): string[] {
  return findCodexHatcherReferenceIssues(content);
}
