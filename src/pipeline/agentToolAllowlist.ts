/**
 * ASI02 tool allowlist enforcement per agent type.
 *
 * Each agent type has a defined allowlist of tools (capabilities) it is
 * permitted to use. Before an agent invokes a tool, the orchestrator
 * checks the allowlist. Any tool not on the list is rejected with a
 * descriptive error so the violation can be logged and investigated.
 *
 * Finding #79 (D15, High): Add tool allowlist per agent type (ASI02).
 *
 * Finding C7.5-W2B2-H44 (D15, High): Instrument allowlist denials with
 * structured observability emission so denied tool calls flow to a
 * diagnostic channel (e.g. failure-log.jsonl) rather than being rejected
 * silently. Satisfies the Silent Failure Contract (CONSTITUTION.md §2 P5,
 * C7-H11): every denial path emits a machine-readable event via the
 * optional `onDeny` callback passed to `checkToolAccess`.
 */

import { HatchError } from "../types.js";
import type { FailureLogEntry } from "./failureLog.js";

// ── Types ────────────────────────────────────────────────────────

export interface AgentToolPolicy {
  /** The agent identifier (e.g. "hatch3r-implementer"). */
  agentId: string;
  /** Tools this agent is allowed to invoke. */
  allowedTools: readonly string[];
  /** Human-readable description of the agent's capability scope. */
  description: string;
}

export interface ToolAccessResult {
  allowed: boolean;
  /** Present when access is denied. */
  reason?: string;
  /**
   * Structured denial event, populated only when `allowed === false`.
   * Safe to consume from observability channels without re-parsing `reason`.
   * Finding C7.5-W2B2-H44.
   */
  denial?: AllowlistDenialEvent;
}

/**
 * Finding C7.5-W2B2-H44 — denial-reason enum.
 *
 * Machine-readable codes so downstream consumers (failure-log.jsonl,
 * compliance dashboards, alert rules) do not need to string-match on
 * free-form reason text.
 */
export type AllowlistDenialReason =
  | "NO_POLICY" // No policy is registered for the agent (deny-by-default).
  | "TOOL_NOT_ALLOWED"; // Agent has a policy, but the requested tool is not on its allowlist.

/**
 * Finding C7.5-W2B2-H44 — structured denial event.
 *
 * Emitted to the `onDeny` observability callback whenever `checkToolAccess`
 * returns `allowed === false`. Mirrors `FailureLogEntry` fields so the
 * event can be persisted via `toFailureLogEntry()` without reshaping.
 */
export interface AllowlistDenialEvent {
  /** ISO-8601 timestamp of the denial. */
  timestamp: string;
  /** The agent that was denied. */
  agentId: string;
  /** The tool category that was requested. */
  tool: string;
  /** Machine-readable denial reason code. */
  reasonCode: AllowlistDenialReason;
  /** Human-readable denial reason (same string as `ToolAccessResult.reason`). */
  reason: string;
  /** Tools the agent is allowed to use, if a policy exists. Empty for NO_POLICY. */
  allowedTools: readonly string[];
}

/**
 * Observability callback signature used by `checkToolAccess`.
 * Finding C7.5-W2B2-H44.
 */
export type AllowlistDenialListener = (event: AllowlistDenialEvent) => void;

// ── Allowlists ───────────────────────────────────────────────────

/**
 * Default tool allowlists per agent type.
 *
 * The allowlists follow the principle of least privilege: each agent
 * is granted only the capabilities it needs for its defined role.
 *
 * Tool categories:
 *   read    — read files, search code, inspect project structure
 *   write   — create/modify/delete files
 *   execute — run shell commands, tests, linters
 *   web     — web search, HTTP requests, MCP server calls
 *   git     — git operations (branch, commit, push)
 *   board   — project board operations (issue, PR, status)
 */
export const AGENT_TOOL_POLICIES: readonly AgentToolPolicy[] = [
  {
    agentId: "hatch3r-researcher",
    allowedTools: ["read", "search", "web", "mcp"],
    description: "Read-only research: file reading, code search, web research, MCP queries. No write or execute.",
  },
  {
    agentId: "hatch3r-implementer",
    allowedTools: ["read", "search", "write", "execute"],
    description: "Code implementation: file read/write, code search, command execution (tests, linters). No git, board, or web.",
  },
  {
    agentId: "hatch3r-handoff-preparer",
    allowedTools: ["read", "search", "write"],
    description: "Handoff preparation: read session state, search git/files for context, write canonical handoff to .agents/handoffs/active/. No execute (filesystem-only).",
  },
  {
    agentId: "hatch3r-handoff-loader",
    allowedTools: ["read", "search"],
    description: "Session-start loader: read .agents/handoffs/active/ and search git for branch context to surface active handoffs. No write, execute, or external IO.",
  },
  {
    agentId: "hatch3r-reviewer",
    allowedTools: ["read", "search"],
    description: "Code review: file reading and code search only. No write, execute, git, or board.",
  },
  {
    agentId: "hatch3r-fixer",
    allowedTools: ["read", "search", "write", "execute"],
    description: "Fix application: file read/write, code search, command execution. No git, board, or web.",
  },
  {
    agentId: "hatch3r-test-writer",
    allowedTools: ["read", "search", "write", "execute"],
    description: "Test writing: file read/write, code search, test execution. No git, board, or web.",
  },
  {
    agentId: "hatch3r-security-auditor",
    allowedTools: ["read", "search", "execute"],
    description: "Security audit: file reading, code search, security tool execution. No write, git, board, or web.",
  },
  {
    agentId: "hatch3r-docs-writer",
    allowedTools: ["read", "search", "write"],
    description: "Documentation: file read/write, code search. No execute, git, board, or web.",
  },
  {
    agentId: "hatch3r-lint-fixer",
    allowedTools: ["read", "search", "write", "execute"],
    description: "Lint fixing: file read/write, code search, linter execution. No git, board, or web.",
  },
  {
    agentId: "hatch3r-a11y-auditor",
    allowedTools: ["read", "search", "execute"],
    description: "Accessibility audit: file reading, code search, a11y tool execution. No write, git, board, or web.",
  },
  {
    agentId: "hatch3r-perf-profiler",
    allowedTools: ["read", "search", "execute"],
    description: "Performance profiling: file reading, code search, profiler execution. No write, git, board, or web.",
  },
  {
    agentId: "hatch3r-dependency-auditor",
    allowedTools: ["read", "search", "execute"],
    description: "Dependency audit: file reading, code search, audit tool execution. No write, git, board, or web.",
  },
  {
    agentId: "hatch3r-architect",
    allowedTools: ["read", "search", "write"],
    description: "Architecture: file read/write (docs/ADRs), code search. No execute, git, board, or web.",
  },
  {
    agentId: "hatch3r-devops",
    allowedTools: ["read", "search", "write", "execute"],
    description: "DevOps: file read/write, code search, CI/CD command execution. No git, board, or web.",
  },
  {
    agentId: "hatch3r-ci-watcher",
    allowedTools: ["read", "search"],
    description: "CI monitoring: file reading, code search. No write, execute, git, board, or web.",
  },
  {
    agentId: "hatch3r-context-rules",
    allowedTools: ["read", "search"],
    description: "Context loading: file reading and code search only. No write, execute, git, board, or web.",
  },
  {
    agentId: "hatch3r-learnings-loader",
    allowedTools: ["read", "search"],
    description: "Learnings loading: file reading and code search only. No write, execute, git, board, or web.",
  },
  {
    agentId: "hatch3r-creator",
    allowedTools: ["read", "search", "write", "execute"],
    description: "User-content authoring: read templates, search for ID collisions, write artifacts under .agents/user/, execute mkdir -p for directory creation. No git, board, web, or mcp — external research is out of scope per the agent's documented tool allowlist (agents/hatch3r-creator.md §Tool Allowlist). Closes finding C9-C1 (ASI02 privilege-escalation gap).",
  },
] as const;

// ── Lookup helpers ───────────────────────────────────────────────

/** Map for O(1) lookup by agentId. */
const policyMap = new Map<string, AgentToolPolicy>(
  AGENT_TOOL_POLICIES.map((p) => [p.agentId, p]),
);

/**
 * Get the tool policy for an agent.
 * Returns undefined for unknown agents (caller should deny by default).
 */
export function getAgentToolPolicy(agentId: string): AgentToolPolicy | undefined {
  return policyMap.get(agentId);
}

/**
 * Check whether an agent is allowed to use a specific tool category.
 *
 * Follows deny-by-default: if the agent has no registered policy,
 * access is denied. If the tool is not in the agent's allowlist,
 * access is denied.
 *
 * Finding C7.5-W2B2-H44: when access is denied, a structured
 * `AllowlistDenialEvent` is attached to the result and, if `onDeny` is
 * provided, pushed to that observability callback. This satisfies the
 * Silent Failure Contract — denials never flow through a purely
 * human-readable reason string; every denial surfaces a machine-readable
 * `reasonCode` plus `agentId`, `tool`, `reason`, and `allowedTools`.
 *
 * Listener exceptions propagate to the caller. The authorization
 * decision is ALREADY captured on the returned `ToolAccessResult`
 * before the listener is invoked, so callers that want to tolerate
 * a broken sink can wrap their own listener in a try/catch.
 */
export function checkToolAccess(
  agentId: string,
  tool: string,
  onDeny?: AllowlistDenialListener,
): ToolAccessResult {
  const policy = policyMap.get(agentId);

  if (!policy) {
    const reason = `No tool policy registered for agent "${agentId}". Access denied by default (deny-by-default policy).`;
    const denial: AllowlistDenialEvent = {
      timestamp: new Date().toISOString(),
      agentId,
      tool,
      reasonCode: "NO_POLICY",
      reason,
      allowedTools: [],
    };
    onDeny?.(denial);
    return { allowed: false, reason, denial };
  }

  if (!policy.allowedTools.includes(tool)) {
    const reason =
      `Agent "${agentId}" is not allowed to use tool "${tool}". ` +
      `Allowed tools: ${policy.allowedTools.join(", ")}. ` +
      `Policy: ${policy.description}`;
    const denial: AllowlistDenialEvent = {
      timestamp: new Date().toISOString(),
      agentId,
      tool,
      reasonCode: "TOOL_NOT_ALLOWED",
      reason,
      allowedTools: policy.allowedTools,
    };
    onDeny?.(denial);
    return { allowed: false, reason, denial };
  }

  return { allowed: true };
}

/**
 * Convert an `AllowlistDenialEvent` into a `FailureLogEntry` for persistence
 * via `failure-log.jsonl`. Finding C7.5-W2B2-H44.
 *
 * The resulting entry uses phase `"tool-allowlist"` so denials can be
 * filtered out of the log for compliance reporting.
 */
export function toFailureLogEntry(
  event: AllowlistDenialEvent,
  options?: { correlationId?: string; version?: string },
): FailureLogEntry {
  const entry: FailureLogEntry = {
    timestamp: event.timestamp,
    phase: "tool-allowlist",
    tool: event.tool,
    error: event.reason,
    errorCode: event.reasonCode,
  };
  if (options?.correlationId) entry.correlationId = options.correlationId;
  if (options?.version) entry.version = options.version;
  return entry;
}

/**
 * Canonical tool category registry. Adding a new runtime tool category
 * requires adding it here so `validateToolPolicies` accepts it.
 */
export const ALL_TOOL_CATEGORIES = [
  "read",
  "search",
  "write",
  "execute",
  "web",
  "mcp",
  "git",
  "board",
] as const;

/**
 * Compute Levenshtein distance between two strings for "Did you mean?"
 * suggestions when a policy references an unknown tool category.
 *
 * Finding C8-D15-M3: help operators recover from typos instead of leaving
 * them with a silent deny-all policy.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Two-row DP; enough for short category names.
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,      // insertion
        prev[j] + 1,          // deletion
        prev[j - 1] + cost,   // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
}

/**
 * Suggest the nearest known tool category within Levenshtein distance 2.
 * Returns undefined when no close match exists.
 */
function suggestNearestCategory(tool: string): string | undefined {
  let bestMatch: string | undefined;
  let bestDistance = Infinity;
  for (const known of ALL_TOOL_CATEGORIES) {
    const dist = levenshtein(tool, known);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestMatch = known;
    }
  }
  return bestDistance <= 2 ? bestMatch : undefined;
}

/**
 * Validate all registered agent tool policies.
 *
 * Finding C8-D15-M3 (D15, Medium, CWE-1284 input validation): unknown tool
 * categories are now hard errors, not warnings. The previous warnings-only
 * behaviour let typos like `"read-ony"` silently deny access to the `"read"`
 * category at runtime — `checkToolAccess` matches by exact string equality
 * against `policy.allowedTools`, so a policy that names a non-existent
 * category can never authorise any real tool call, leaving the agent
 * functionally blocked with no actionable signal. Promoting typos to
 * `HatchError` (errorCode `VALIDATION_ERROR`) fails fast at startup and
 * prevents a broken policy from shipping.
 *
 * Returns warnings for empty allowlists and policies that grant overly
 * broad access (all categories). These remain warnings because they are
 * subjective privilege-tuning concerns, not configuration errors.
 *
 * @param policies Optional policy set to validate. Defaults to the module-level
 *   `AGENT_TOOL_POLICIES`. Exposed so tests can exercise the error path with
 *   typo'd fixtures without mutating the frozen production registry.
 * @throws {HatchError} when any policy references an unknown tool category.
 *   The thrown error includes the offending agentId, the unknown category,
 *   and a "Did you mean?" suggestion (Levenshtein distance ≤ 2) when one
 *   of the canonical categories is a close match.
 */
export function validateToolPolicies(
  policies: readonly AgentToolPolicy[] = AGENT_TOOL_POLICIES,
): string[] {
  const warnings: string[] = [];
  const knownCategories = new Set<string>(ALL_TOOL_CATEGORIES);

  for (const policy of policies) {
    if (policy.allowedTools.length === 0) {
      warnings.push(`Agent "${policy.agentId}" has an empty tool allowlist — it cannot invoke any tools.`);
    }

    const hasAll = ALL_TOOL_CATEGORIES.every((cat) =>
      policy.allowedTools.includes(cat),
    );
    if (hasAll) {
      warnings.push(
        `Agent "${policy.agentId}" has access to all tool categories — ` +
        `consider restricting to least privilege.`,
      );
    }

    // Hard error on unknown tool categories: typos silently deny-all at
    // runtime and must not reach production. See function JSDoc.
    for (const tool of policy.allowedTools) {
      if (!knownCategories.has(tool)) {
        const suggestion = suggestNearestCategory(tool);
        const didYouMean = suggestion ? ` Did you mean "${suggestion}"?` : "";
        throw new HatchError(
          `Invalid tool policy for agent "${policy.agentId}": ` +
            `unknown tool category "${tool}".${didYouMean} ` +
            `Valid categories: ${ALL_TOOL_CATEGORIES.join(", ")}.`,
          1,
          "VALIDATION_ERROR",
        );
      }
    }
  }

  return warnings;
}

// ── Adapter emission helpers (C9-H49, D15 P6) ────────────────────
//
// The canonical allowlist enforces ASI02 at the hatch3r orchestrator
// boundary via `checkToolAccess`. Once the generated agent files run
// inside a downstream tool runtime (Claude Code, Cursor, ...), the
// orchestrator is no longer in the loop — runtime enforcement must
// travel with the emitted artifacts. The helpers below render the
// policy registry into formats each adapter can carry forward:
//
//   - `buildAgentToolPoliciesJson()` — machine-readable JSON of the
//     full registry, written by adapters into `agent-tool-policies.json`
//     alongside their managed-hooks output.
//   - `buildClaudePreToolUseHookScript()` — Node ESM PreToolUse hook
//     script that Claude Code executes on every tool call; reads the
//     policy JSON and exits 2 to block out-of-policy invocations.
//   - `buildCursorAllowlistRule()` — Cursor `.mdc` rule body that
//     instructs the Cursor agent runtime to honour the registry
//     (Cursor lacks a PreToolUse hook surface, so enforcement is
//     rule-delegated; pairs with the existing `readonly: true`
//     primitive emitted by `toCursorReadonlyFrontmatter`).
//
// Reclassifies the allowlist as **Hybrid** per SECURITY.md §Allowlist
// Hybrid Contract.

/**
 * Serialise the canonical `AGENT_TOOL_POLICIES` registry to a stable
 * JSON document for adapter consumption. The shape matches the
 * `AgentToolPolicy` interface plus a top-level `schema` discriminator
 * so downstream consumers (PreToolUse hook, Cursor rule, future
 * adapters) can detect drift.
 *
 * The JSON is deterministic — sort order matches registry insertion
 * order — so adapter outputs stay stable across runs.
 */
export function buildAgentToolPoliciesJson(): string {
  const doc = {
    schema: "hatch3r/agent-tool-policies/v1",
    generatedBy: "src/pipeline/agentToolAllowlist.ts",
    allToolCategories: ALL_TOOL_CATEGORIES,
    policies: AGENT_TOOL_POLICIES.map((p) => ({
      agentId: p.agentId,
      allowedTools: p.allowedTools,
      description: p.description,
    })),
  };
  return JSON.stringify(doc, null, 2);
}

/**
 * Render the Claude Code PreToolUse hook script (Node ESM). The script
 * reads the sibling `agent-tool-policies.json`, maps the Claude Code
 * tool name to a hatch3r category via a bundled table, and exits 2 to
 * block the tool call when the active sub-agent's policy does not
 * grant the requested category.
 *
 * Source: https://code.claude.com/docs/en/plugins-reference#hooks
 * (PreToolUse hooks read `CLAUDE_TOOL_NAME`, `CLAUDE_SUBAGENT_ID`, and
 * tool input from environment / stdin; exit 2 denies the call;
 * accessed 2026-04-19).
 *
 * The bundled tool→category table mirrors `adapterToolTranslator.ts`
 * `CLAUDE_CATEGORY_MAP` (reverse direction). Keeping the map inline
 * means the hook has zero external dependencies at runtime.
 */
export function buildClaudePreToolUseHookScript(): string {
  return `#!/usr/bin/env node
// hatch3r — Claude Code PreToolUse allowlist hook (C9-H49, D15 P6).
//
// This script is regenerated by \`npx hatch3r sync\`. Do not edit by hand;
// edit src/pipeline/agentToolAllowlist.ts::AGENT_TOOL_POLICIES instead.
//
// Contract:
//   - Reads \`agent-tool-policies.json\` from the same directory.
//   - Reads \`CLAUDE_TOOL_NAME\` and \`CLAUDE_SUBAGENT_ID\` from env.
//   - Maps the Claude Code tool name to a hatch3r tool category via
//     the bundled reverse map. Exits 2 (deny) when the active
//     sub-agent's policy does not grant the requested category.
//   - Emits a structured deny event to stderr so failure-log
//     pipelines can persist the denial.
//
// Deny-by-default: unknown sub-agent ids and unknown Claude tools
// both result in exit 2.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICY_FILE = join(__dirname, "agent-tool-policies.json");

// Claude Code tool → hatch3r category. Mirrors CLAUDE_CATEGORY_MAP
// in src/pipeline/adapterToolTranslator.ts (reverse direction).
const TOOL_TO_CATEGORY = {
  Read: "read",
  NotebookRead: "read",
  Grep: "search",
  Glob: "search",
  Edit: "write",
  MultiEdit: "write",
  Write: "write",
  NotebookEdit: "write",
  Bash: "execute",
  WebSearch: "web",
  WebFetch: "web",
};

function emitDeny(payload) {
  process.stderr.write(
    JSON.stringify({
      hook: "hatch3r-pretooluse-allowlist",
      timestamp: new Date().toISOString(),
      ...payload,
    }) + "\\n",
  );
}

const toolName = process.env.CLAUDE_TOOL_NAME ?? "";
const agentId = process.env.CLAUDE_SUBAGENT_ID ?? "";

// MCP tools follow the convention \`mcp__<server>__<tool>\`. Map any
// such tool to the \`mcp\` category. Git is driven via Bash; the
// translator emits \`Bash\` for both execute and git so we map Bash
// to execute and let policies that grant only \`git\` fall through.
let category = TOOL_TO_CATEGORY[toolName];
if (!category && toolName.startsWith("mcp__")) category = "mcp";

if (!category) {
  // Unknown Claude Code tool — deny by default so a new tool added
  // upstream cannot silently widen privilege until the table is
  // updated and re-emitted.
  emitDeny({
    reasonCode: "UNKNOWN_TOOL",
    agentId,
    tool: toolName,
    message: \`Unknown Claude Code tool "\${toolName}"; deny-by-default per ASI02.\`,
  });
  process.exit(2);
}

let policiesDoc;
try {
  policiesDoc = JSON.parse(readFileSync(POLICY_FILE, "utf-8"));
} catch (err) {
  emitDeny({
    reasonCode: "POLICY_FILE_MISSING",
    agentId,
    tool: toolName,
    message: \`Failed to read \${POLICY_FILE}: \${err.message}\`,
  });
  process.exit(2);
}

const policy = policiesDoc.policies.find((p) => p.agentId === agentId);
if (!policy) {
  emitDeny({
    reasonCode: "NO_POLICY",
    agentId,
    tool: toolName,
    message: \`No policy registered for agent "\${agentId}"; deny-by-default.\`,
  });
  process.exit(2);
}

if (!policy.allowedTools.includes(category)) {
  emitDeny({
    reasonCode: "TOOL_NOT_ALLOWED",
    agentId,
    tool: toolName,
    category,
    allowedTools: policy.allowedTools,
    message: \`Agent "\${agentId}" not allowed to use category "\${category}" (tool "\${toolName}"). Allowed: \${policy.allowedTools.join(", ")}.\`,
  });
  process.exit(2);
}

// Allowed — exit 0 lets Claude Code proceed with the tool call.
process.exit(0);
`;
}

/**
 * Render the Cursor allowlist rule body. Cursor's plugin runtime has
 * no PreToolUse hook surface (per cursor.com/docs/agents accessed
 * 2026-04-19), so enforcement is rule-delegated: the rule is
 * `alwaysApply: true` and instructs the Cursor agent runtime to
 * refuse tool calls that exceed the allowlist in the sibling
 * `agents-policy.json`. Pairs with the `readonly: true` frontmatter
 * primitive emitted by `toCursorReadonlyFrontmatter` for read-only
 * roles.
 *
 * The rule is deliberately short — Cursor enforces by reading rules
 * into the active context window, and verbose policy prose would
 * crowd out task content. The machine-readable JSON beside it
 * carries the full registry.
 */
export function buildCursorAllowlistRule(): string {
  const rows = AGENT_TOOL_POLICIES.map(
    (p) => `| \`${p.agentId}\` | ${p.allowedTools.join(", ")} |`,
  );
  return [
    "# Hatch3r Agent Tool Allowlist",
    "",
    "Per-agent tool allowlist enforcement (ASI02 / D15 / P6). When Cursor delegates a task to one of the agents below, constrain the agent's tool use to the listed categories. Out-of-policy tool calls must be refused.",
    "",
    "**Source of truth:** `.cursor/agents-policy.json` (machine-readable) — regenerated by `npx hatch3r sync`.",
    "",
    "## Categories",
    "",
    `Valid hatch3r tool categories: \`${ALL_TOOL_CATEGORIES.join("`, `")}\`.`,
    "",
    "## Per-Agent Allowlist",
    "",
    "| Agent | Allowed Categories |",
    "|-------|--------------------|",
    ...rows,
    "",
    "## Enforcement",
    "",
    "Cursor has no PreToolUse hook primitive, so enforcement is delegated to the agent runtime. Cursor's subagent frontmatter `readonly: true` (emitted automatically for agents whose policy lacks `write` and `execute`) blocks file edits and state-changing shell commands as a hard runtime guard. For richer category restrictions (e.g., denying `web` or `mcp`), the agent must refuse the call and surface a `TOOL_NOT_ALLOWED` rejection.",
    "",
    "Deny-by-default: unknown agent ids and unknown categories must be refused.",
  ].join("\n");
}
