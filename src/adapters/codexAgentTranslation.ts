import { translateStandaloneHatcherSlashInvocations } from "./codexInvocations.js";

const TOOL_VOCABULARY: ReadonlyArray<readonly [RegExp, string]> = [
  [/`?AskUserQuestion`?(?:\s+tool)?/g, "a plain-text question to the user"],
  [/\bClaude Code Task[\s/]+sub-?agents?\b/g, "Codex subagents"],
  [/\bTask[\s/]+sub-?agents?\b/g, "Codex subagents"],
  [/(?:the\s+)?`?Task`?[- ]tool(?:\s+(?:call|spawn|delegation))?/gi, "Codex subagent workflow"],
  [/`Task`/g, "Codex subagent delegation"],
  [/\bTask\s*\(/g, "delegate to a Codex subagent ("],
  [/\bTask(?=[\s/]+(?:call|per|dispatch|delegation|invocation)\b)/g, "subagent"],
  [/`?MultiEdit`?/g, "file editing"],
  [/`?NotebookEdit`?/g, "notebook editing"],
  [/`?WebFetch`?/g, "open the cited web source"],
  [/`?WebSearch`?/g, "web search"],
  [/`?TodoWrite`?/g, "task-list update"],
  [/`?TaskOutput`?/g, "subagent result retrieval"],
  [/`?TaskStop`?/g, "subagent cancellation"],
  [/`?TaskCreate`?/g, "task-list item creation"],
  [/`?TaskUpdate`?/g, "task-list item update"],
  [/`?TaskList`?/g, "task-list inspection"],
  [/`?TaskGet`?/g, "task-list item inspection"],
  [/`?EnterPlanMode`?/g, "planning mode"],
  [/`?ExitPlanMode`?/g, "leave planning mode"],
  [/`?KillShell`?/g, "shell process cancellation"],
  [/`?SlashCommand`?/g, "explicit skill invocation"],
  [/`Write`/g, "file editing"],
  [/`Edit`/g, "file editing"],
  [/`Read`/g, "file reading"],
  [/`Grep`/g, "text search"],
  [/`Glob`/g, "file search"],
  [/`Bash`/g, "shell commands"],
];

const CROSS_HARNESS_LABEL_RE = /cross[- ]harness\s+(?:example|source).*claude/i;
const AGENT_TYPE_ARGUMENT =
  String.raw`(?:subagent_type|agent type)\s*[:=]\s*["']?([A-Za-z0-9_-]+)["']?`;

function codexSubagentSelection(
  line: string,
  availableAgentIds: ReadonlySet<string>,
  requestedType?: string,
): string {
  const named = [...new Set(line.match(/\bhatch3r-[a-z0-9-]+\b/g) ?? [])]
    .filter((id) => availableAgentIds.has(id));
  if (requestedType && !/^(?:generalPurpose|general-purpose)$/i.test(requestedType)) {
    const requestedId = requestedType.startsWith("hatch3r-")
      ? requestedType
      : `hatch3r-${requestedType}`;
    if (availableAgentIds.has(requestedId) && !named.includes(requestedId)) named.push(requestedId);
  }
  if (named.length === 1) return `select the exact \`${named[0]}\` custom agent`;
  if (named.length > 1) {
    return `select the exact custom agent named for each task (${named.map((id) => `\`${id}\``).join(", ")})`;
  }
  return "ask Codex to delegate the work to suitable subagents";
}

/** Translate Claude's generic spawn-profile argument into Codex delegation. */
export function translateCodexSubagentVocabulary(
  line: string,
  availableAgentIds: ReadonlySet<string> = new Set(),
): string {
  if (/fall back to\s+`general-purpose`/i.test(line)) {
    const selection = codexSubagentSelection(line, availableAgentIds);
    return line
      .replace(
        /(?:use\s+)?(?:the\s+)?`?Task`?[- ]tool\s+to\s+invoke\s+the\s+`?(hatch3r-[a-z0-9-]+)`?\s+sub-agent/gi,
        `${selection}`,
      )
      .replace(
        /fall back to\s+`general-purpose`/gi,
        "ask Codex to delegate the role to a suitable subagent and report that the generated custom agent is unavailable",
      );
  }
  const argument = line.match(new RegExp(AGENT_TYPE_ARGUMENT, "i"));
  if (!argument) {
    if (!/\bsubagent_type\b/.test(line)) return line;
    const selection = codexSubagentSelection(line, availableAgentIds);
    if (/^\s*Use\s+(?:the\s+)?`?Task`?[- ]tool\s+with\s+`?subagent_type`?/i.test(line)) {
      const directive = selection.replace(/^ask\b/, "Ask").replace(/^select\b/, "Select");
      return line.replace(
        /^\s*Use\s+(?:the\s+)?`?Task`?[- ]tool\s+with\s+`?subagent_type`?/i,
        directive,
      );
    }
    return line
      .replace(/\bwith\s+`?subagent_type`?/gi, selection)
      .replace(/`?subagent_type`?/gi, selection);
  }
  if (/^\s*Use\s+`?subagent_type\s*:/i.test(line) && /for all delegations/i.test(line)) {
    return "When a workflow names an available Hatcher custom agent, delegate to that exact agent name. Otherwise ask Codex to delegate the work to suitable subagents without inventing an agent name.";
  }
  if (/Pipeline sub-agents spawn as generic types/i.test(line)) {
    return "Pipeline workflows select an emitted Hatcher custom agent by its exact name when the workflow names one. Otherwise, ask Codex to delegate the work and let Codex choose a suitable subagent; never invent an agent name. Generated custom-agent configuration supplies the model and reasoning settings for named agents.";
  }
  const selection = codexSubagentSelection(line, availableAgentIds, argument[1]);
  return line
    .replace(new RegExp(String.raw`\(\s*\`?${AGENT_TYPE_ARGUMENT}\`?\s*\)`, "gi"), `(${selection})`)
    .replace(new RegExp(String.raw`\bwith\s+\`?${AGENT_TYPE_ARGUMENT}\`?`, "gi"), selection)
    .replace(new RegExp(String.raw`\`?${AGENT_TYPE_ARGUMENT}\`?`, "gi"), selection);
}

/** Translate harness-specific vocabulary while preserving the full agent body. */
export function translateCodexAgentInstructions(
  content: string,
  availableAgentIds: ReadonlySet<string> = new Set(),
): string {
  return content.split(/\r?\n/).map((line) => {
    if (CROSS_HARNESS_LABEL_RE.test(line)) return line;
    if (/https?:\/\/(?:code\.claude\.com|github\.com\/anthropics\/claude-code)\b/i.test(line)) {
      return `Cross-harness source (Claude; not a Codex contract): ${line}`;
    }
    let translated = translateCodexSubagentVocabulary(line, availableAgentIds);
    for (const [pattern, replacement] of TOOL_VOCABULARY) {
      pattern.lastIndex = 0;
      translated = translated.replace(pattern, replacement);
    }
    translated = translateStandaloneHatcherSlashInvocations(
      translated,
      (id) => id.startsWith("hatch3r-") ? `$${id}` : `/${id}`,
    )
      .replace(/\.claude\/settings\.json/g, "source-harness configuration (not emitted for Codex)")
      .replace(/\.claude\/[A-Za-z0-9._{}*/-]+/g, "[unsupported source-harness path omitted]")
      .replace(/\.claude\//g, "[unsupported source-harness directory omitted]")
      .replace(/\bClaude Code\b/g, "the source harness")
      .replace(/\bClaude-(?:only|specific)\b/g, "source-harness-specific")
      .replace(/\bClaude\b/g, "the source harness");
    return translated;
  }).join("\n").trim();
}
