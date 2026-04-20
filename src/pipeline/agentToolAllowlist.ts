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
 * Validate all registered agent tool policies.
 *
 * Returns warnings for any agents with empty allowlists or
 * policies that grant overly broad access (all categories).
 */
export function validateToolPolicies(): string[] {
  const ALL_TOOL_CATEGORIES = ["read", "search", "write", "execute", "web", "mcp", "git", "board"];
  const warnings: string[] = [];

  for (const policy of AGENT_TOOL_POLICIES) {
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

    // Check for unknown tool categories
    for (const tool of policy.allowedTools) {
      if (!ALL_TOOL_CATEGORIES.includes(tool)) {
        warnings.push(`Agent "${policy.agentId}" references unknown tool category "${tool}".`);
      }
    }
  }

  return warnings;
}
