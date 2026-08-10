import { CODEX_SUPPORT_ROOT, resolveCodexReference } from "./codexReference.js";
import { HatchError } from "../types.js";

export interface CodexAgentReferenceOptions {
  referenceMap?: ReadonlyMap<string, string>;
  availableSkillIds?: ReadonlySet<string>;
}

const CROSS_HARNESS_LABEL_RE = /cross[- ]harness\s+(?:example|source).*claude/i;

/** Return harness-specific operational tokens that would be unsafe to ship to Codex. */
export function findCodexOperationalVocabularyIssues(content: string): string[] {
  const issues: string[] = [];
  const patterns: ReadonlyArray<readonly [RegExp, string]> = [
    [/\bsubagent_type\b/g, "subagent_type"],
    [/\bagent type\s*[:=]\s*[`"']*generalPurpose\b/gi, "undocumented generalPurpose agent type"],
    [/\bagent type\s*[:=]\s*[`"']*general-purpose\b/gi, "undocumented general-purpose agent type"],
    [/\bgeneralPurpose\b/g, "undocumented generalPurpose profile"],
    [/\bfall back to\s+`general-purpose`/gi, "undocumented general-purpose fallback profile"],
    [/\bAskUserQuestion\b/g, "AskUserQuestion"],
    [/\b(?:MultiEdit|NotebookEdit|WebFetch|WebSearch|TodoWrite|TaskOutput|TaskStop|TaskCreate|TaskUpdate|TaskList|TaskGet|EnterPlanMode|ExitPlanMode|KillShell|SlashCommand)\b/g, "Claude-only tool"],
    [/(?:`Task`|\bTask[- ]tool\b|\bTask[\s/]+(?:call|dispatch|delegation|invocation|sub-?agents?)\b|\bTask\s*\()/g, "Claude Task delegation"],
    [/`(?:Read|Write|Edit|Grep|Glob|Bash)`/g, "harness-specific tool name"],
    [/\.claude\//g, ".claude path"],
    [/\bClaude(?: Code|-only|-specific)?\b/g, "Claude-specific prose"],
  ];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (CROSS_HARNESS_LABEL_RE.test(line)) continue;
    const operationalLine = line.replace(/(?:\*\*\/)?\.claude\/\*\*/g, "");
    for (const [pattern, label] of patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(operationalLine)) issues.push(`line ${index + 1}: ${label}`);
    }
  }
  return [...new Set(issues)];
}

function referenceError(message: string): HatchError {
  return new HatchError(
    message,
    undefined,
    "VALIDATION_ERROR",
    "Fix the Codex agent projection input and run sync again.",
  );
}

function mappedReference(
  cls: "agents" | "rules" | "commands",
  relative: string,
  options: CodexAgentReferenceOptions,
): string | undefined {
  const resolution = resolveCodexReference(`${cls}/${relative}`, {
    targets: options.referenceMap ?? new Map(),
  });
  return resolution.status === "resolved" ? resolution.target : undefined;
}

function supportDirectoryForPattern(
  cls: "agents" | "rules" | "commands",
  relative: string,
  options: CodexAgentReferenceOptions,
): string | undefined {
  const firstMeta = relative.search(/[?*{]/);
  const stablePrefix = firstMeta < 0 ? relative : relative.slice(0, firstMeta);
  const slash = stablePrefix.lastIndexOf("/");
  const relativeDirectory = slash < 0 ? "" : stablePrefix.slice(0, slash + 1);
  const outputDirectory = `${CODEX_SUPPORT_ROOT}/${cls}/${relativeDirectory}`;
  return [...(options.referenceMap?.values() ?? [])].some((path) =>
    path.startsWith(outputDirectory) && path !== outputDirectory
  ) ? outputDirectory : undefined;
}

/** Return unresolved canonical Hatcher paths that would dangle in Codex output. */
export function findCodexHatcherReferenceIssues(content: string): string[] {
  const issues: string[] = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (CROSS_HARNESS_LABEL_RE.test(line)) continue;
    const operationalLine = line.replace(
      /\[(?:unsupported|unprojected) Hatcher[^\]]*\]|\[Hatcher development-only[^\]]*\]/g,
      "",
    );
    const raw = operationalLine.match(
      /(?<![A-Za-z0-9._/-])(?:(?:\.\.\/)+|\.\/)?(?:agents|rules|commands|checks|skills)\/(?:[A-Za-z0-9._,?*{}\/-]+\.md\b|[A-Za-z0-9._,?*{}\/-]*[?*{}][A-Za-z0-9._,?*{}\/-]*|(?=[`\s).,;:]|$))/,
    );
    if (raw) issues.push(`line ${index + 1}: unresolved Hatcher reference ${raw[0]}`);
    const relativeShared = operationalLine.match(
      /(?<![A-Za-z0-9._/-])(?:(?:\.\.\/)+|\.\/)?shared\/[A-Za-z0-9._/-]+\.md/,
    );
    if (relativeShared) {
      issues.push(`line ${index + 1}: unresolved relative Hatcher reference ${relativeShared[0]}`);
    }
  }
  return [...new Set(issues)];
}

function replaceCanonicalReferences(
  content: string,
  options: CodexAgentReferenceOptions,
): string {
  return content.replace(
    /(^|[\s([`"'→])(?:(?:\.\.\/)+|\.\/|\.claude\/)?(agents|rules|commands)\/([A-Za-z0-9._/-]+\.md)\b/gm,
    (_match: string, prefix: string, cls: "agents" | "rules" | "commands", relative: string) => {
      const target = mappedReference(cls, relative, options);
      if (target) return `${prefix}${target}`;
      if (cls === "commands" && relative.endsWith("/SKILL.md")) {
        const id = relative.split("/").at(-2);
        if (id && options.availableSkillIds?.has(id)) return `${prefix}.agents/skills/${id}/SKILL.md`;
      }
      return `${prefix}[unsupported Hatcher reference omitted: ${cls}/${relative}]`;
    },
  );
}

function replaceSkillAndSharedReferences(
  content: string,
  options: CodexAgentReferenceOptions,
): string {
  const skills = content.replace(
    /(^|[\s([`"'→])(?:(?:\.\.\/)+|\.\/|\.claude\/)?skills\/(hatch3r-[A-Za-z0-9._-]+)(?:\/SKILL\.md)?\b/gm,
    (_match: string, prefix: string, id: string) => options.availableSkillIds?.has(id)
      ? `${prefix}.agents/skills/${id}/SKILL.md`
      : `${prefix}[unsupported Hatcher skill omitted: ${id}]`,
  );
  return skills.replace(
    /(^|[\s([`"'→])(?:(?:\.\.\/)+|\.\/)?shared\/([A-Za-z0-9._/-]+\.md)\b/gm,
    (_match: string, prefix: string, relative: string) => {
      const target = mappedReference("agents", `shared/${relative}`, options);
      return target
        ? `${prefix}${target}`
        : `${prefix}[unsupported Hatcher reference omitted: agents/shared/${relative}]`;
    },
  );
}

function replacePatternReferences(
  content: string,
  options: CodexAgentReferenceOptions,
): string {
  return content.replace(
    /(^|[\s([`"'→])(?:(?:\.\.\/)+|\.\/)?(agents|rules|commands)\/([A-Za-z0-9._,?*{}\/-]*[?*{}][A-Za-z0-9._,?*{}\/-]*)/gm,
    (_match: string, prefix: string, cls: "agents" | "rules" | "commands", pattern: string) => {
      const directory = supportDirectoryForPattern(cls, pattern, options);
      return directory
        ? `${prefix}[select an emitted Hatcher support file under ${directory}]`
        : `${prefix}[unsupported Hatcher reference pattern omitted: ${cls}/${pattern}]`;
    },
  );
}

function replaceDirectoryAndCheckReferences(content: string): string {
  return content
    .replace(
      /(^|[\s([`"'→])(?:(?:\.\.\/)+|\.\/)?checks\/([A-Za-z0-9._/-]+\.md)\b/gm,
      (_match: string, prefix: string, relative: string) =>
        `${prefix}[unprojected Hatcher check reference omitted: checks/${relative}]`,
    )
    .replace(
      /(^|[\s([`"'→])(?:(?:\.\.\/)+|\.\/)?checks\/(?=[`\s).,;:]|$)/gm,
      "$1[unprojected Hatcher checks omitted]",
    )
    .replace(
      /(^|[\s([`"'→])(?:(?:\.\.\/)+|\.\/)?skills\/(?=[`\s).,;:]|$)/gm,
      "$1the selected Hatcher project skills under `.agents/skills/`",
    )
    .replace(
      /(^|[\s([`"'→])(?:(?:\.\.\/)+|\.\/)?(agents|rules|commands)\/(?=[`\s).,;:]|$)/gm,
      (_match: string, prefix: string, cls: "agents" | "rules" | "commands") =>
        `${prefix}${CODEX_SUPPORT_ROOT}/${cls}/`,
    );
}

export function translateCodexAgentReferences(
  content: string,
  options: CodexAgentReferenceOptions,
): string {
  const canonical = replaceCanonicalReferences(content, options);
  const direct = replaceSkillAndSharedReferences(canonical, options);
  const patterns = replacePatternReferences(direct, options);
  const translated = replaceDirectoryAndCheckReferences(patterns);
  const issues = findCodexHatcherReferenceIssues(translated);
  if (issues.length > 0) {
    throw referenceError(`Codex agent retains unresolved Hatcher references: ${issues.join("; ")}`);
  }
  return translated;
}
