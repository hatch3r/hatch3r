import {
  MANAGED_BLOCK_END,
  MANAGED_BLOCK_START,
  toPrefixedId,
  type AdapterOutput,
  type CanonicalFile,
} from "../types.js";
import { hasManagedBlock, insertManagedBlock, wrapManagedFor } from "../merge/managedBlocks.js";
import { resolveRuleGlobs, sortByPrecedence } from "./canonical.js";
import { CODEX_SUPPORT_ROOT } from "./codexReference.js";
import { CodexProjectionError, codexProjectionIssues } from "./codexProjectionError.js";
import {
  projectCodexInstructionSupport,
} from "./codexReferenceInstructions.js";

export { CODEX_SUPPORT_ROOT } from "./codexReference.js";
export { buildCodexInstructionReferenceMap } from "./codexReferenceInstructions.js";

/** Default aggregate project-instruction limit documented by Codex. */
export const CODEX_PROJECT_INSTRUCTION_LIMIT_BYTES = 32 * 1024;

type SupportClass = "agents" | "rules" | "commands";

export interface CodexInstructionCompanion {
  class: SupportClass;
  relativePath: string;
  content: string;
  sourcePath: string;
}

export interface CodexInstructionProjectionInput {
  agents?: readonly CanonicalFile[];
  rules?: readonly CanonicalFile[];
  commands?: readonly CanonicalFile[];
  companions?: readonly CodexInstructionCompanion[];
  availableSkillIds?: readonly string[];
  commandSkillIds?: ReadonlyMap<string, string>;
  /** Enables the tested Hatcher handoff bridge through the projected command skill. */
  handoffsEnabled?: boolean;
}

export type CodexInstructionPreflightCode =
  | "BROKEN_MANAGED_REGION"
  | "DUPLICATE_MANAGED_REGION";

export interface CodexInstructionPreflightIssue {
  code: CodexInstructionPreflightCode;
  path: "AGENTS.md" | "AGENTS.override.md";
  message: string;
}

export interface CodexInstructionPreflightResult {
  ok: boolean;
  issues: CodexInstructionPreflightIssue[];
  activePath: "AGENTS.md" | "AGENTS.override.md";
  existingContent?: string;
}

export interface CodexInstructionExistingFiles {
  agentsMd?: string;
  agentsOverrideMd?: string;
}

export interface CodexInstructionProjection {
  outputs: AdapterOutput[];
  warnings: string[];
}

function fencedLineNumbers(lines: readonly string[]): ReadonlySet<number> {
  const fenced = new Set<number>();
  let open: { character: "`" | "~"; length: number; start: number } | undefined;
  for (const [index, line] of lines.entries()) {
    const fence = line.trim().match(/^(`{3,}|~{3,})/);
    if (!fence) continue;
    const token = fence[1]!;
    const character = token[0] as "`" | "~";
    if (!open) {
      open = { character, length: token.length, start: index };
    } else if (character === open.character && token.length >= open.length) {
      for (let current = open.start; current <= index; current += 1) fenced.add(current);
      open = undefined;
    }
  }
  return open ? new Set<number>() : fenced;
}

function markerPositions(content: string, marker: string): number[] {
  const lines = content.split(/\r?\n/);
  const fenced = fencedLineNumbers(lines);
  const positions: number[] = [];
  let offset = 0;
  for (const [index, line] of lines.entries()) {
    if (!fenced.has(index) && line.trim() === marker) positions.push(offset);
    offset += line.length + 1;
  }
  return positions;
}

/** Select and validate the active root instruction file. */
export function preflightCodexInstructions(
  existing: CodexInstructionExistingFiles,
): CodexInstructionPreflightResult {
  const issues: CodexInstructionPreflightIssue[] = [];
  const activePath = existing.agentsOverrideMd?.trim() ? "AGENTS.override.md" : "AGENTS.md";
  const existingContent = activePath === "AGENTS.override.md"
    ? existing.agentsOverrideMd
    : existing.agentsMd;
  if (existingContent !== undefined) {
    const starts = markerPositions(existingContent, MANAGED_BLOCK_START);
    const ends = markerPositions(existingContent, MANAGED_BLOCK_END);
    const duplicate = starts.length > 1 || ends.length > 1;
    const broken = starts.length !== ends.length ||
      (starts.length === 1 && starts[0]! >= ends[0]!);
    if (duplicate) {
      issues.push(preflightIssue("DUPLICATE_MANAGED_REGION", activePath));
    } else if (broken) {
      issues.push(preflightIssue("BROKEN_MANAGED_REGION", activePath));
    }
  }
  return { ok: issues.length === 0, issues, activePath, existingContent };
}

function preflightIssue(
  code: CodexInstructionPreflightCode,
  path: CodexInstructionPreflightIssue["path"],
): CodexInstructionPreflightIssue {
  const detail = code === "DUPLICATE_MANAGED_REGION"
    ? "duplicate Hatcher managed-region markers"
    : "an incomplete or reversed Hatcher managed region";
  return { code, path, message: `${path} contains ${detail}.` };
}

function canonicalRulePath(rule: CanonicalFile): string {
  const source = rule.sourcePath.replace(/\\/g, "/");
  const marker = "/rules/";
  const index = source.lastIndexOf(marker);
  const relative = index >= 0
    ? source.slice(index + marker.length)
    : `${toPrefixedId(rule.id)}.md`;
  return `${CODEX_SUPPORT_ROOT}/rules/${relative}`;
}

function compactRuleRows(
  rules: readonly CanonicalFile[],
): { always: string[]; conditional: string[]; requested: string[] } {
  const rows = { always: [] as string[], conditional: [] as string[], requested: [] as string[] };
  for (const rule of sortByPrecedence([...rules])) {
    const id = toPrefixedId(rule.id);
    const path = canonicalRulePath(rule);
    const precedence = rule.precedence ?? "normal";
    const globs = resolveRuleGlobs(rule);
    if (rule.scope === "agent-requested") {
      rows.requested.push(`- ${id} (${precedence}): read \`${path}\` when its topic is relevant.`);
    } else if (globs.length > 0) {
      rows.conditional.push(`- \`${globs.join(", ")}\` → \`${path}\` (${precedence}).`);
    } else {
      rows.always.push(`- Read \`${path}\` (${precedence}).`);
    }
  }
  return rows;
}

function appendRuleSections(
  sections: string[],
  rows: ReturnType<typeof compactRuleRows>,
): void {
  if (rows.always.length > 0) {
    sections.push("", "### Always-applicable Hatcher rules", "", ...rows.always);
  }
  if (rows.conditional.length > 0) {
    sections.push(
      "", "### Conditional rule bridge (glob limitation)", "",
      "Codex has no native repository glob-scoped rule file. Before changing a matching path, read the mapped support file:",
      "", ...rows.conditional,
    );
  }
  if (rows.requested.length > 0) {
    sections.push("", "### Relevance-triggered rule bridge", "", ...rows.requested);
  }
}

function appendSurfaceSections(
  sections: string[],
  input: CodexInstructionProjectionInput,
): void {
  if ((input.agents?.length ?? 0) > 0) {
    sections.push(
      "", "### Custom subagents", "",
      `Hatcher custom agents are defined in \`.codex/agents/hatch3r-*.toml\`; supporting source projections are under \`${CODEX_SUPPORT_ROOT}/agents/\`.`,
    );
  }
  if ((input.commands?.length ?? 0) > 0) {
    sections.push(
      "", "### Command bridge", "",
      `Codex has no repository-defined slash-command surface. Hatcher command workflows are invoked as \`$hatch3r-*\` skills; support projections are under \`${CODEX_SUPPORT_ROOT}/commands/\`.`,
    );
  }
  const handoffSkill = input.commandSkillIds?.get("hatch3r-handoff");
  if (input.handoffsEnabled === true && handoffSkill) {
    sections.push(
      "", "### Handoff bridge", "",
      `Use \`$${handoffSkill}\` to prepare, resume, list, complete, or prune Hatcher handoffs stored under \`.hatch3r/handoffs/\`.`,
    );
  }
}

/** Build the compact body placed inside the Hatcher-owned root region. */
export function buildCodexManagedInstructionBody(
  input: CodexInstructionProjectionInput,
): string {
  const sections = [
    "## Hatcher Codex instructions", "", "### Universal floor", "",
    "- Preserve user-authored content and keep changes inside the requested scope.",
    "- Never hardcode secrets; use environment-variable indirection.",
    "- Ask a concise plain-text question before irreversible work or when two interpretations produce different artifacts.",
    "- Run the repository's relevant tests and report the command and result.",
    "- Use Codex subagents for bounded delegation and `$skill-name` for explicit skill activation.",
  ];
  appendRuleSections(sections, compactRuleRows(input.rules ?? []));
  appendSurfaceSections(sections, input);
  return sections.join("\n");
}

function mergeManagedInstructions(
  body: string,
  preflight: CodexInstructionPreflightResult,
): { wrapped: string; merged: string } {
  const wrapped = wrapManagedFor(preflight.activePath, body);
  if (preflight.existingContent === undefined) return { wrapped, merged: wrapped };
  if (hasManagedBlock(preflight.existingContent, preflight.activePath)) {
    return {
      wrapped,
      merged: insertManagedBlock(preflight.existingContent, body, preflight.activePath),
    };
  }
  let merged = [wrapped.trim(), "", preflight.existingContent.trimStart()].join("\n");
  if (!merged.endsWith("\n")) merged += "\n";
  return { wrapped, merged };
}

function validateInstructionBudget(
  merged: string,
  activePath: CodexInstructionPreflightResult["activePath"],
): number {
  const bytes = Buffer.byteLength(merged, "utf8");
  if (bytes > CODEX_PROJECT_INSTRUCTION_LIMIT_BYTES) {
    throw new CodexProjectionError(
      `Codex instruction projection failed:\n- Active ${activePath} would be ${bytes} bytes after preserving user content, exceeding Codex's ${CODEX_PROJECT_INSTRUCTION_LIMIT_BYTES}-byte project-instruction limit`,
    );
  }
  return bytes;
}

/** Project root managed instructions plus Hatcher-owned support files. */
export function projectCodexInstructions(
  input: CodexInstructionProjectionInput,
  preflight: CodexInstructionPreflightResult = {
    ok: true,
    issues: [],
    activePath: "AGENTS.md",
  },
): CodexInstructionProjection {
  if (!preflight.ok) {
    throw codexProjectionIssues(
      "Codex instruction projection failed",
      preflight.issues.map((issue) => issue.message),
    );
  }
  const support = projectCodexInstructionSupport(input);
  const body = buildCodexManagedInstructionBody(input);
  const { wrapped, merged } = mergeManagedInstructions(body, preflight);
  const bytes = validateInstructionBudget(merged, preflight.activePath);
  const warning =
    `Active ${preflight.activePath} uses ${bytes}/${CODEX_PROJECT_INSTRUCTION_LIMIT_BYTES} bytes after merge. Codex applies the limit across active root and nested instruction files; nested user files are outside Hatcher's byte count.`;
  const root: AdapterOutput = {
    path: preflight.activePath,
    content: wrapped,
    managedContent: body,
    action: "create",
    sourceFiles: [...new Set(support.entries.map((entry) => entry.sourcePath))].sort(),
  };
  return {
    outputs: [root, ...support.outputs],
    warnings: [...new Set([...support.warnings, warning])].sort(),
  };
}
