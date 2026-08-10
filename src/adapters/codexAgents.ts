import {
  HatchError,
  sanitizeId,
  toPrefixedId,
  type AdapterOutput,
  type CanonicalFile,
} from "../types.js";
import { normalizeModelClass, type ModelClass } from "../models/tiers.js";
import { renderCodexMcpServers, type CodexAgentMcpServer } from "./codexMcp.js";
import {
  encodeCodexTomlString,
  parseCodexTomlDocument,
} from "./codexTomlCodec.js";
import {
  findCodexOperationalVocabularyIssues,
  translateCodexAgentReferences,
} from "./codexTomlCodecAgentReferences.js";
import { translateCodexAgentInstructions } from "./codexAgentTranslation.js";

export {
  translateCodexAgentInstructions,
  translateCodexSubagentVocabulary,
} from "./codexAgentTranslation.js";

export {
  findCodexHatcherReferenceIssues,
  findCodexOperationalVocabularyIssues,
} from "./codexTomlCodecAgentReferences.js";

/**
 * Codex custom-agent projection.
 *
 * Official contract: project agents are standalone `.codex/agents/*.toml`
 * files. `name`, `description`, and `developer_instructions` are required;
 * normal config keys such as `model`, `model_reasoning_effort`,
 * `sandbox_mode`, `mcp_servers`, and `skills.config` are also supported.
 * https://learn.chatgpt.com/docs/agent-configuration/subagents
 * (accessed 2026-08-09).
 */

export const CODEX_AGENT_DIR = ".codex/agents";

export type CodexSandboxMode = "read-only" | "workspace-write";
export type CodexReasoningEffort =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export interface CodexAgentSkillConfig {
  /** Path to the skill folder containing SKILL.md. */
  path: string;
  enabled?: boolean;
}

export type { CodexAgentMcpServer } from "./codexMcp.js";

export interface CodexAgentNativeConfig {
  /** Concrete Codex model id or `inherit`. Class words use `modelClassMap`. */
  model?: string;
  effort?: string;
  /** `workspace-write` is honored only when the canonical grant explicitly allows writes. */
  sandboxMode?: CodexSandboxMode;
  skills?: readonly CodexAgentSkillConfig[];
  mcpServers?: Readonly<Record<string, CodexAgentMcpServer>>;
}

export interface CodexAgentProjectionOptions {
  modelClassMap?: Partial<Record<ModelClass, string>>;
  agents?: Readonly<Record<string, CodexAgentNativeConfig>>;
  /** Canonical `agents|rules|commands/...md` path -> emitted support path. */
  referenceMap?: ReadonlyMap<string, string>;
  /** Skills emitted by the companion Codex content projection. */
  availableSkillIds?: ReadonlySet<string>;
  /** Exact custom-agent names emitted for this Codex projection. */
  availableAgentIds?: ReadonlySet<string>;
  /** Receives actionable omissions without making projection non-deterministic. */
  warnings?: string[];
}

const DEFAULT_CODEX_MODEL_CLASS_MAP: Readonly<Record<ModelClass, string>> = {
  economy: "gpt-5.6-luna",
  standard: "gpt-5.6-terra",
  advanced: "gpt-5.6-sol",
  frontier: "gpt-5.6-sol",
};

const SAFE_MODEL_RE = /^(?:gpt-|codex-|o\d)[A-Za-z0-9._/-]*$/;
const SAFE_EFFORTS = new Set<CodexReasoningEffort>([
  "minimal", "low", "medium", "high", "xhigh",
]);
const MODEL_DEPENDENT_EFFORTS = new Set<CodexReasoningEffort>(["xhigh"]);
const WRITE_CATEGORY = "write";
const WRITE_TOOL_RE = /^(?:Write|Edit|MultiEdit)(?::|$)/i;

function invalidAgentConfig(message: string): HatchError {
  return new HatchError(
    message,
    undefined,
    "VALIDATION_ERROR",
    "Fix the Codex agent projection input and run sync again.",
  );
}

function validId(id: string): string {
  const prefixed = toPrefixedId(id);
  if (sanitizeId(prefixed) !== prefixed || prefixed === "hatch3r-") {
    throw invalidAgentConfig(`Invalid Codex agent id: ${JSON.stringify(id)}`);
  }
  return prefixed;
}

function normalizedConfigFor(
  id: string,
  options: CodexAgentProjectionOptions,
): CodexAgentNativeConfig {
  return options.agents?.[id] ?? options.agents?.[toPrefixedId(id)] ?? {};
}

function hasExplicitWriteGrant(agent: CanonicalFile): boolean {
  const denied = [...(agent.toolsDenied ?? []), ...(agent.toolsDenyRaw ?? [])];
  // Codex custom agents expose a coarse sandbox, not a per-command deny list.
  // Any deny would be lost under workspace-write, so fail closed rather than
  // silently widening the canonical policy.
  if (denied.length > 0) return false;
  if (agent.readonly === true) return false;

  const allowed = [...(agent.toolsAllowed ?? []), ...(agent.toolsAllowRaw ?? [])];
  return allowed.some(
    (tool) => tool.toLowerCase() === WRITE_CATEGORY || WRITE_TOOL_RE.test(tool),
  );
}

/**
 * Resolve Codex's coarse sandbox without widening a canonical grant.
 * Ambiguous or unexpressible tool policies fail closed to `read-only`.
 */
export function resolveCodexAgentSandboxMode(
  agent: CanonicalFile,
  requested?: CodexSandboxMode,
): CodexSandboxMode {
  if (requested === "workspace-write" && hasExplicitWriteGrant(agent)) {
    return "workspace-write";
  }
  return "read-only";
}

function resolveModel(
  agent: CanonicalFile,
  config: CodexAgentNativeConfig,
  options: CodexAgentProjectionOptions,
): string | undefined {
  const requested = config.model ?? agent.model;
  if (!requested || requested.trim().toLowerCase() === "inherit") return undefined;
  const cls = normalizeModelClass(requested);
  const model = cls
    ? (options.modelClassMap?.[cls] ?? DEFAULT_CODEX_MODEL_CLASS_MAP[cls])
    : requested.trim();
  return SAFE_MODEL_RE.test(model) ? model : undefined;
}

function resolveEffort(
  agent: CanonicalFile,
  config: CodexAgentNativeConfig,
  model: string | undefined,
  options: CodexAgentProjectionOptions,
  id: string,
): CodexReasoningEffort | undefined {
  const requested = (config.effort ?? agent.effort)?.trim().toLowerCase();
  if (!requested) return undefined;
  const effort = requested as CodexReasoningEffort;
  if (!SAFE_EFFORTS.has(effort)) {
    options.warnings?.push(
      `[codex] Agent "${id}" omitted model_reasoning_effort=${JSON.stringify(requested)}: ` +
      "the documented Codex config enum is minimal | low | medium | high | xhigh; " +
      "the canonical effort remains available to adapters with a native equivalent.",
    );
    return undefined;
  }
  if (MODEL_DEPENDENT_EFFORTS.has(effort) && !model) {
    options.warnings?.push(
      `[codex] Agent "${id}" omitted model_reasoning_effort=${JSON.stringify(effort)}: ` +
      "this level is model-dependent and no valid explicit model is selected; configure both model and effort for the agent before syncing.",
    );
    return undefined;
  }
  return effort;
}

function validateSkill(skill: CodexAgentSkillConfig): void {
  if (!skill.path || /[\0\r\n]/.test(skill.path)) {
    throw invalidAgentConfig("Codex agent skill paths must be non-empty single-line paths");
  }
  const segments = skill.path.replace(/\\/g, "/").split("/");
  if (segments.includes("..")) {
    throw invalidAgentConfig(`Codex agent skill path may not traverse parents: ${skill.path}`);
  }
}

function buildCodexAgentInstructions(
  agent: CanonicalFile,
  options: CodexAgentProjectionOptions,
  sandboxMode: CodexSandboxMode,
): string {
  const translated = translateCodexAgentInstructions(
    translateCodexAgentReferences(agent.content, options),
    options.availableAgentIds,
  );
  const denied = [...(agent.toolsDenied ?? []), ...(agent.toolsDenyRaw ?? [])];
  const permissionNote = sandboxMode === "read-only"
    ? [
        "This custom subagent is read-only. Report proposed changes to the parent agent instead of editing files.",
        ...(denied.length > 0
          ? ["The canonical agent has granular tool or command denies that Codex cannot mechanically represent; read-only mode prevents those restrictions from being widened."]
          : []),
      ].join(" ")
    : "This custom subagent may edit files inside the workspace only; do not expand beyond the delegated scope.";
  return [
    translated,
    permissionNote,
    "When input is required, ask the user a concise plain-text question; do not assume a harness-specific question tool exists.",
  ].filter(Boolean).join("\n\n");
}

function assertPortableAgentText(id: string, field: string, value: string): void {
  const issues = findCodexOperationalVocabularyIssues(value);
  if (issues.length > 0) {
    throw invalidAgentConfig(
      `Codex agent ${id}${field} retains unsupported operational vocabulary: ${issues.join("; ")}`,
    );
  }
}

function appendCodexAgentSkills(lines: string[], skills: readonly CodexAgentSkillConfig[]): void {
  for (const skill of [...skills].sort((a, b) => a.path.localeCompare(b.path))) {
    validateSkill(skill);
    lines.push("", "[[skills.config]]", `path = ${encodeCodexTomlString(skill.path)}`);
    if (skill.enabled !== undefined) lines.push(`enabled = ${skill.enabled}`);
  }
}

/** Serialize one canonical agent as a deterministic, parser-friendly TOML document. */
export function serializeCodexAgentToml(
  agent: CanonicalFile,
  options: CodexAgentProjectionOptions = {},
): string {
  const id = validId(agent.id);
  const config = normalizedConfigFor(agent.id, options);
  const model = resolveModel(agent, config, options);
  const effort = resolveEffort(agent, config, model, options, id);
  const sandboxMode = resolveCodexAgentSandboxMode(agent, config.sandboxMode);
  const instructions = buildCodexAgentInstructions(agent, options, sandboxMode);
  assertPortableAgentText(id, "", instructions);
  const description = translateCodexAgentInstructions(agent.description)
    .replace(/\s+/g, " ")
    .trim();
  assertPortableAgentText(id, " description", description);

  const lines = [
    `name = ${encodeCodexTomlString(id)}`,
    `description = ${encodeCodexTomlString(description)}`,
    `developer_instructions = ${encodeCodexTomlString(instructions)}`,
  ];
  if (model) lines.push(`model = ${encodeCodexTomlString(model)}`);
  if (effort) lines.push(`model_reasoning_effort = ${encodeCodexTomlString(effort)}`);
  lines.push(`sandbox_mode = ${encodeCodexTomlString(sandboxMode)}`);

  const mcp = renderCodexMcpServers(config.mcpServers ?? {}, "custom-agent").body;
  if (mcp) lines.push("", mcp);
  appendCodexAgentSkills(lines, config.skills ?? []);
  const document = `${lines.join("\n")}\n`;
  parseCodexTomlDocument(document, { schema: "custom-agent", source: `${id}.toml` });
  return document;
}

/** Project selected canonical agents into Hatcher-owned Codex agent files. */
export function projectCodexAgents(
  agents: readonly CanonicalFile[],
  options: CodexAgentProjectionOptions = {},
): AdapterOutput[] {
  const availableAgentIds = options.availableAgentIds ?? new Set(
    agents.map((agent) => validId(agent.id)),
  );
  return [...agents]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((agent) => {
      const id = validId(agent.id);
      return {
        path: `${CODEX_AGENT_DIR}/${id}.toml`,
        content: serializeCodexAgentToml(agent, { ...options, availableAgentIds }),
        action: "create" as const,
        sourceFiles: [agent.sourcePath],
      };
    });
}
