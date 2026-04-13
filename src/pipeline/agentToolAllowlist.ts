/**
 * ASI02 tool allowlist enforcement per agent type.
 *
 * Each agent type has a defined allowlist of tools (capabilities) it is
 * permitted to use. Before an agent invokes a tool, the orchestrator
 * checks the allowlist. Any tool not on the list is rejected with a
 * descriptive error so the violation can be logged and investigated.
 *
 * Finding #79 (D15, High): Add tool allowlist per agent type (ASI02).
 */

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
}

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
 */
export function checkToolAccess(agentId: string, tool: string): ToolAccessResult {
  const policy = policyMap.get(agentId);

  if (!policy) {
    return {
      allowed: false,
      reason: `No tool policy registered for agent "${agentId}". Access denied by default (deny-by-default policy).`,
    };
  }

  if (!policy.allowedTools.includes(tool)) {
    return {
      allowed: false,
      reason:
        `Agent "${agentId}" is not allowed to use tool "${tool}". ` +
        `Allowed tools: ${policy.allowedTools.join(", ")}. ` +
        `Policy: ${policy.description}`,
    };
  }

  return { allowed: true };
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
