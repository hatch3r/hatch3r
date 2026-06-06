// Last updated: 2026-06-06 (P3 currency anchor; per-platform PreToolUse /
// askUser surface access dates inside this file remain authoritative for
// individual claims. D9-4 Cycle 11 Wave-2 re-verified the Cursor hook surface
// against cursor.com/docs/agent/hooks accessed 2026-06-06: `subagentStart`
// carries `subagent_type` and denies with `{permission: "deny"}`, so Cursor
// now gets the `buildCursorSubagentGuardHookScript` hard runtime block —
// previous "Cursor has no PreToolUse hook primitive" prose was false.).

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
  /**
   * Optional write-scope qualifier. When present, the agent's `write` /
   * `execute` privileges are CONTRACTUALLY bounded to the named scope
   * (the runtime gate is the diff-hash review contract in `diffHash.ts`,
   * not this field — this field is a machine-readable assertion that
   * the boundary EXISTS so compliance can verify implementer + fixer do
   * not share an identical unbounded policy).
   *
   * D15-M6: implementer and fixer previously declared identical
   * `["read","search","write","execute"]` with no surface difference. The
   * fixer's policy now carries `writeScope: "diff-hash-review"` to make
   * the bounded write surface explicit. `complianceVerification.ts`
   * verifies that implementer + fixer no longer share a byte-identical
   * write+execute policy contract.
   */
  writeScope?: "diff-hash-review";
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
    description: "Handoff preparation: read session state, search git/files for context, write canonical handoff to .hatch3r/handoffs/active/. No execute (filesystem-only).",
  },
  {
    agentId: "hatch3r-handoff-loader",
    allowedTools: ["read", "search"],
    description: "Session-start loader: read .hatch3r/handoffs/active/ and search git for branch context to surface active handoffs. No write, execute, or external IO.",
  },
  {
    agentId: "hatch3r-reviewer",
    allowedTools: ["read", "search"],
    description: "Code review: file reading and code search only. No write, execute, git, or board.",
  },
  {
    agentId: "hatch3r-fixer",
    allowedTools: ["read", "search", "write", "execute"],
    description: "Fix application: file read/write, code search, command execution. No git, board, or web. Write scope is bounded by the diff-hash review contract (src/pipeline/diffHash.ts) — the fixer rewrites only the files cited in the reviewer's structured findings, and the resulting diff is hashed and verified back to the reviewer (D15-M6).",
    writeScope: "diff-hash-review",
  },
  {
    // D5-2 (Cycle 11 Wave 2, High): the prior `["read","search","write"]` policy
    // omitted the `execute` (markdown-lint command, agents/hatch3r-docs-writer.md
    // §Commands `npx markdownlint docs/`), `web` (§Web research focus), and `mcp`
    // (§External Knowledge Context7 `resolve-library-id`/`query-docs`) categories
    // the body instructs. Under the Claude PreToolUse hook those calls denied
    // silently (TOOL_NOT_ALLOWED). Grant the three categories the body exercises;
    // `validateAgentBodyCapabilityCoverage` (src/cli/commands/validate.ts) now
    // regression-locks body⊆policy for this agent.
    agentId: "hatch3r-docs-writer",
    allowedTools: ["read", "search", "write", "execute", "web", "mcp"],
    description: "Documentation: file read/write, code search, markdown-lint execution, web research, and Context7 MCP library-docs lookups. No git or board.",
  },
  {
    // D5-2 (Cycle 11 Wave 2, High): added `web` (agents/hatch3r-lint-fixer.md
    // §Web research focus) and `mcp` (§Workflow step 2 + §External Knowledge
    // Context7 `resolve-library-id`/`query-docs`) — the body instructed both but
    // the policy granted neither, so the Claude PreToolUse hook denied them
    // silently. `execute` was already present (linter auto-fix + typecheck/test).
    agentId: "hatch3r-lint-fixer",
    allowedTools: ["read", "search", "write", "execute", "web", "mcp"],
    description: "Lint fixing: file read/write, code search, linter execution, web research for fix patterns, and Context7 MCP lint-rule docs. No git or board.",
  },
  // F16.3-H1 (Cycle 10 Wave 1C): the 5 legacy meta-agents (hatch3r-test-writer,
  // hatch3r-security-auditor, hatch3r-a11y-auditor, hatch3r-perf-profiler,
  // hatch3r-dependency-auditor) were retired. Their tool-allowlist scope
  // collapsed into the CQ specialists below (hatch3r-testability /
  // hatch3r-security / hatch3r-ui / hatch3r-performance, plus
  // hatch3r-security for supply-chain). The CQ specialists are review-only
  // (read+search) by §Boundaries; fix authorship delegates to producer agents
  // (hatch3r-fixer, hatch3r-implementer) under the orchestrator's Phase 3+4.
  {
    // D5-2 (Cycle 11 Wave 2, High): added `web` (agents/hatch3r-architect.md
    // §Web research focus + Architecture Protocol step 2 "Use web research for
    // architecture pattern comparisons") and `mcp` (step 2 "Use Context7 MCP
    // (`resolve-library-id` then `query-docs`)" + §External Knowledge). The body
    // instructed both; the policy granted neither, so the Claude PreToolUse hook
    // denied them silently. `write` remains for ADRs; `execute` stays denied
    // (architecture only — no shell). Regression-locked by
    // `validateAgentBodyCapabilityCoverage` (src/cli/commands/validate.ts).
    agentId: "hatch3r-architect",
    allowedTools: ["read", "search", "write", "web", "mcp"],
    description: "Architecture: file read/write (docs/ADRs), code search, web research for pattern/scalability comparison, and Context7 MCP API-surface lookups. No execute, git, or board.",
  },
  {
    // D5-24 (Cycle 11 Wave 3, Medium): added `web` (agents/hatch3r-devops.md
    // §Design step "Use web research for deployment strategy best practices…" +
    // §External Knowledge "Web research focus for this agent:" + the `WebSearch`
    // token in the agent's `tools.allow` frontmatter and §Allowed Tools table)
    // and `mcp` (§Design step "Use Context7 MCP (`resolve-library-id` then
    // `query-docs`)…" + §External Knowledge "Context7 focus for this agent:").
    // The body instructed both; the prior `["read","search","write","execute"]`
    // policy granted neither, so the emitted Claude allowlist dropped WebSearch
    // and the PreToolUse hook denied every web/Context7 call silently
    // (TOOL_NOT_ALLOWED) — the self-contradiction this finding closes. `write`
    // (IaC/CI authoring) and `execute` (dry-run validation: terraform validate/
    // plan, kubectl get, docker build, aws/gcloud --dry-run) were already present.
    // Granting all six functional categories trips the advisory least-privilege
    // warning in validateToolPolicies (expected — same posture as the docs-writer
    // and lint-fixer producer agents). Regression-locked by
    // `validateAgentBodyCapabilityCoverage` (src/cli/commands/validate.ts), which
    // now scans hatch3r-devops via the D5_2_BODY_CAPABILITY_AGENTS literal.
    agentId: "hatch3r-devops",
    allowedTools: ["read", "search", "write", "execute", "web", "mcp"],
    description: "DevOps: file read/write, code search, CI/CD command execution (dry-run validation only), web research for deployment strategy + cloud-service docs, and Context7 MCP IaC/CI action-API lookups. No git or board.",
  },
  {
    // D5-2 (Cycle 11 Wave 2, High): added `execute` (agents/hatch3r-ci-watcher.md
    // §Commands platform-CLI `gh run list`/`az pipelines`/`glab ci` + local
    // reproduce `lint`/`typecheck`/test runs), `web` (§Web research focus), and
    // `mcp` (§External Knowledge Context7 `resolve-library-id`/`query-docs`).
    // The body instructed all three; the prior `["read","search"]` policy granted
    // none, so the Claude PreToolUse hook denied every CLI/research call silently.
    // Granting `execute` makes this agent state-changing on Cursor (readonly:false)
    // — that is correct: it runs shell commands. `write` stays denied (no file
    // mutation; it suggests fixes, the fixer/lint-fixer apply them). Regression-
    // locked by `validateAgentBodyCapabilityCoverage` (src/cli/commands/validate.ts).
    agentId: "hatch3r-ci-watcher",
    allowedTools: ["read", "search", "execute", "web", "mcp"],
    description: "CI monitoring: file reading, code search, platform-CLI + local lint/typecheck/test execution, web research for CI errors, and Context7 MCP action/task docs. No write, git, or board.",
  },
  {
    // D5-2 (Cycle 11 Wave 2, High): added `web` (agents/hatch3r-context-rules.md
    // §Web research focus) and `mcp` (§External Knowledge Context7 focus). The
    // body instructed both; the policy granted neither, so the Claude PreToolUse
    // hook denied them silently. `write`/`execute` stay denied — this agent
    // reports rule violations inline and never mutates code. Regression-locked by
    // `validateAgentBodyCapabilityCoverage` (src/cli/commands/validate.ts).
    agentId: "hatch3r-context-rules",
    allowedTools: ["read", "search", "web", "mcp"],
    description: "Context loading: file reading, code search, web research for evolving coding standards, and Context7 MCP framework-convention lookups. No write, execute, git, or board.",
  },
  {
    agentId: "hatch3r-learnings-loader",
    allowedTools: ["read", "search"],
    description: "Learnings loading: file reading and code search only. No write, execute, git, board, or web.",
  },
  {
    agentId: "hatch3r-creator",
    allowedTools: ["read", "search", "write", "execute"],
    description: "User-content authoring: read templates, search for ID collisions, write artifacts under .hatch3r/overrides/, execute mkdir -p for directory creation. No git, board, web, or mcp — external research is out of scope per the agent's documented tool allowlist (agents/hatch3r-creator.md §Tool Allowlist). Closes finding C9-C1 (ASI02 privilege-escalation gap).",
  },
  // ── 2.0.0 quality-vector specialists (Finding F2.4-F1, Cycle 10 Wave 1) ──
  //
  // The 9 quality specialists below own the CQ1–CQ9 content-quality vectors
  // (CONSTITUTION §2B). Each agent's `## Boundaries` section in
  // agents/hatch3r-{vector}.md declares the agent as a *review-only* gate
  // that delegates fix authorship to producer agents (hatch3r-fixer,
  // hatch3r-implementer); see also CLAUDE.md §Two-Axis Pillar Framework.
  // Least-privilege allowlist is therefore `["read", "search"]`: read
  // source/proof_trace artefacts and grep across the codebase, but never
  // mutate files or invoke shells. Closes the F2.4-F1 NO_POLICY denial path
  // for these 9 ids under the Claude PreToolUse hook.
  {
    agentId: "hatch3r-ui",
    allowedTools: ["read", "search"],
    description: "CQ1 UI quality-vector specialist (review-only): read components/tokens/proof_trace artefacts and search for design-system + four-state contract coverage. No write/execute — fix authorship delegates to producer agents per agents/hatch3r-ui.md §Boundaries.",
  },
  {
    agentId: "hatch3r-ux",
    allowedTools: ["read", "search"],
    description: "CQ2 UX quality-vector specialist (review-only): read flow definitions, focus-order traces, and aria-live audit reports and search for decision-budget overruns. No write/execute — fix authorship delegates to producer agents per agents/hatch3r-ux.md §Boundaries.",
  },
  {
    agentId: "hatch3r-security",
    allowedTools: ["read", "search"],
    description: "CQ3 security quality-vector specialist (review-only): read authn/authz configs, container manifests, and proof_trace artefacts and search for exploit paths. No write/execute — fix authorship delegates to hatch3r-fixer and hatch3r-implementer per agents/hatch3r-security.md §Boundaries.",
  },
  {
    agentId: "hatch3r-reliability",
    allowedTools: ["read", "search"],
    description: "CQ4 reliability quality-vector specialist (review-only): read SLO configs, OTel attribute keys, and RFC 9457 error envelopes and search for instrumentation gaps. No write/execute — fix authorship delegates to producer agents per agents/hatch3r-reliability.md §Boundaries.",
  },
  {
    agentId: "hatch3r-testability",
    allowedTools: ["read", "search"],
    description: "CQ5 testability quality-vector specialist (review-only): read test artefacts, mutation reports, and contract-test ledgers and search for unjustified mocks. No write/execute — fix authorship delegates to hatch3r-fixer and hatch3r-implementer per agents/hatch3r-testability.md §Boundaries.",
  },
  {
    agentId: "hatch3r-edge-case-analyst",
    allowedTools: ["read", "search"],
    description: "CQ4+CQ5 supporting edge-case/error-handling correctness analyst (review-only): read diffs, entity relations, state machines, and test sets and search for unenumerated edge cases. No write/execute — fix authorship delegates to hatch3r-implementer / hatch3r-fixer per agents/hatch3r-edge-case-analyst.md Boundaries.",
  },
  {
    agentId: "hatch3r-scalability",
    allowedTools: ["read", "search"],
    description: "CQ6 scalability quality-vector specialist (review-only): read pool configs, queue topologies, Idempotency-Key adoption, and load-test artefacts and search for sticky-session assumptions. No write/execute — fix authorship delegates to producer agents per agents/hatch3r-scalability.md §Boundaries.",
  },
  {
    agentId: "hatch3r-performance",
    allowedTools: ["read", "search"],
    description: "CQ7 performance quality-vector specialist (review-only): read Lighthouse CI reports, RUM aggregations, and bundle-analyzer output and search for CWV regressions. No write/execute — fix authorship delegates to hatch3r-fixer and hatch3r-implementer per agents/hatch3r-performance.md §Boundaries.",
  },
  {
    agentId: "hatch3r-maintainability",
    allowedTools: ["read", "search"],
    description: "CQ8 maintainability quality-vector specialist (review-only): read jscpd/oasdiff/buf-breaking output, ADR ledger, and complexity scans and search for premature-DRY refactors. No write/execute — refactor authorship delegates to producer agents per agents/hatch3r-maintainability.md §Boundaries.",
  },
  {
    agentId: "hatch3r-enhancability",
    allowedTools: ["read", "search"],
    description: "CQ9 enhancability quality-vector specialist (review-only): read feature-flag configs, consumer-driven contract reports, and spec-diff gates and search for premature flag retirement. No write/execute — fix authorship delegates to producer agents per agents/hatch3r-enhancability.md §Boundaries.",
  },
  // ── 2.0.0 spec agents (Finding F2.4-F1, Cycle 10 Wave 1) ──
  //
  // The 2 spec agents below author one-pager / PRD / brownfield-spec
  // deliverables under .hatch3r/spec/ (or wherever the project surfaces
  // them). Each agent's `## Boundaries` section explicitly forbids
  // implementation work ("spec only — architecture work routes to
  // hatch3r-architect") but DOES allow writing the spec artefacts
  // themselves. Least-privilege allowlist is therefore
  // `["read", "search", "write"]`: read project context, search for
  // existing patterns and consumer sets, and write the spec document.
  // No execute/git/board — spec agents do not run tests or open PRs.
  {
    agentId: "hatch3r-greenfield-spec",
    allowedTools: ["read", "search", "write"],
    description: "Greenfield spec authoring: read project bootstrap context, search reference stacks/competitors, and write the 8 PRD deliverables. No execute/git/board/web — spec only, architecture work routes to hatch3r-architect per agents/hatch3r-greenfield-spec.md §Boundaries.",
  },
  {
    agentId: "hatch3r-brownfield-spec",
    allowedTools: ["read", "search", "write"],
    description: "Brownfield spec authoring: read existing patterns, search consumer set via grep, and write migration-aware spec/ADR artefacts. No execute/git/board/web — spec only, replacement adoption routes to producer agents per agents/hatch3r-brownfield-spec.md §Boundaries.",
  },
  // ── 2.0.0 supply-chain / incident / dependency agents (Finding F2.4-F1) ──
  //
  // Three net-new top-level agents (`type: agent`) added after the spec
  // agents. The F2.4-F1 filesystem-enumeration test asserts every
  // agents/*.md id has a policy here; without these three the Claude
  // PreToolUse hook denies them all tool calls (NO_POLICY). Each allowlist
  // is the least-privilege envelope that matches the agent's own `## Boundaries`
  // + `tools:` frontmatter — the category model is coarse (read/search/write/
  // execute/web/mcp), so any allowed `Bash:<cmd>` maps to `execute` and
  // `WebSearch` maps to `web`; the agent's own `tools.deny` frontmatter is the
  // fine-grained sub-command gate (mirrors how hatch3r-creator is modeled).
  {
    agentId: "hatch3r-pack-installer",
    allowedTools: ["read", "search", "write", "execute", "web"],
    description: "Verified pack installer (post trust-gate): read/search the candidate pack, write pack content atomically (safeWrite temp+rename, managed blocks), execute verification commands only (npm audit signatures, cosign verify-blob, hatch3r add --dry-run / status / verify, git status/diff) and web-research signing/transparency-log references. No mcp. Its `tools.deny` frontmatter blocks `hatch3r add`, `npm install/publish`, `git push`, `rm -rf`, `chmod`, `curl`/`wget`, and pack lifecycle scripts per agents/hatch3r-pack-installer.md §Boundaries (\"Never: run a pack's lifecycle scripts\").",
  },
  {
    agentId: "hatch3r-incident-responder",
    allowedTools: ["read", "search", "write", "execute", "web"],
    description: "Incident-response coordinator: read/search telemetry + topology, write the blameless post-mortem + alert-linked runbook, execute reversible mitigations behind a diff-preview-then-gate discipline (flag flip, kill-switch, config revert, scale-up, rollback) and file follow-ups via the platform CLI (gh/az/glab), and web-research incident-command conventions + vendor advisories. No mcp. Bounded-autonomy gate on P0/P1 + irreversible mutations per agents/hatch3r-incident-responder.md §Boundaries (\"Ask first\" before any data-writing or P0 mutation; \"Never\" auto-apply low-confidence/irreversible mitigation on P0/P1).",
  },
  {
    agentId: "hatch3r-dependency-drafter",
    allowedTools: ["read", "search", "execute", "web"],
    description: "Dependency-change drafter (drafts only, never applies): read manifests/lockfiles, search consumer call sites, execute read-only inspection commands only (npm outdated/view/audit/ls, pnpm/yarn outdated, git status/log/diff) and web-research advisory databases. No write — its `tools.deny` frontmatter forbids Write/Edit/MultiEdit and every install/update/audit-fix/commit per agents/hatch3r-dependency-drafter.md §Boundaries (\"Never: Edit a manifest or lockfile, run an install/update/audit fix, or commit — you are the drafter, not the applier\"). Manifest edits route to hatch3r-fixer / hatch3r-devops.",
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
 * Functionally distinct runtime tool categories — every category that maps to
 * a unique adapter-native tool set. These six are the privilege envelope a
 * policy can actually grant; the "all categories" least-privilege warning in
 * `validateToolPolicies` is computed against this set (D2-SA2.4 F5).
 */
export const FUNCTIONAL_TOOL_CATEGORIES = [
  "read",
  "search",
  "write",
  "execute",
  "web",
  "mcp",
] as const;

/**
 * Reserved tool categories. Declared for forward compatibility but unused by
 * any current `AGENT_TOOL_POLICY` and collapsed at the translator layer
 * (`adapterToolTranslator.ts`): `git` maps to the same native tools as
 * `execute` (git is driven via Bash), and `board` is MCP-driven (no distinct
 * native token). A policy that grants either gains no privilege beyond
 * `execute`/`mcp` respectively. Retained as reserved rather than removed to
 * preserve design optionality for a future git/board-specialist agent
 * (D2-SA2.4 F3).
 */
export const RESERVED_TOOL_CATEGORIES = ["git", "board"] as const;

/**
 * Canonical tool category registry — the union of functional and reserved
 * categories. Adding a new runtime tool category requires adding it here so
 * `validateToolPolicies` accepts it. `git`/`board` are reserved (see
 * {@link RESERVED_TOOL_CATEGORIES}); the least-privilege warning gate uses
 * {@link FUNCTIONAL_TOOL_CATEGORIES} so granting all six functional categories
 * trips the warning even though it omits the two reserved aliases.
 */
export const ALL_TOOL_CATEGORIES = [
  ...FUNCTIONAL_TOOL_CATEGORIES,
  ...RESERVED_TOOL_CATEGORIES,
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

    // Least-privilege warning: gate on the functionally distinct categories
    // only. The reserved `git`/`board` aliases collapse to `execute`/`mcp` at
    // the translator layer (see RESERVED_TOOL_CATEGORIES), so a policy granting
    // all six functional categories is the broadest realistic privilege
    // envelope and must trip this warning even when it omits git/board
    // (D2-SA2.4 F5).
    const hasAll = FUNCTIONAL_TOOL_CATEGORIES.every((cat) =>
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

// D2-M08 (D2 Medium, Cycle 10 Wave 3 rollover): gate ALL CLI paths against
// typo'd tool categories at module-init time.
//
// Previously, `validateToolPolicies()` was only invoked from
// `src/pipeline/complianceVerification.ts::runComplianceChecks`, which runs
// only under `hatch3r validate` (`src/cli/commands/validate.ts:2356`). Any
// CLI invocation that did NOT run `validate` (init, sync, status, update,
// add, verify, ...) would silently consume a typo'd `AGENT_TOOL_POLICIES`
// entry — `checkToolAccess` matches by exact string equality, so an entry
// like `"read-ony"` deny-all-reads at runtime with zero diagnostic surface
// until a user happened to run `validate` later.
//
// The module is imported by every CLI surface (adapters, content scanner,
// pipeline modules), so a single eager validation at module-init covers
// every entry point — a typo in the canonical registry now fails fast on
// the first import instead of slipping past until the next `validate`. The
// HatchError thrown here has `errorCode: VALIDATION_ERROR` and exits 1 via
// the CLI top-level error handler.
//
// Tests that exercise the typo path explicitly pass typo'd fixtures to
// `validateToolPolicies(typoPolicies)`, so they are unaffected by the
// module-init pass against the canonical default.
validateToolPolicies();

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
//     policy JSON and emits a `permissionDecision: "deny"` payload on
//     stdout (exit 0) to block out-of-policy invocations.
//   - `buildCursorSubagentGuardHookScript()` — Node ESM `subagentStart`
//     hook that Cursor runs at sub-agent spawn; reads the policy JSON and
//     emits `{permission: "deny"}` for any `hatch3r-*` sub-agent with no
//     policy row (the hard runtime block, parity with the Claude deny).
//   - `buildCursorAllowlistRule()` — Cursor `.mdc` rule body that
//     instructs the Cursor agent runtime to honour the registry for
//     per-CATEGORY restrictions (Cursor's `preToolUse` payload exposes no
//     agent-identity field, so category granularity stays rule-delegated;
//     pairs with the `subagentStart` guard above and the `readonly: true`
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
export function buildAgentToolPoliciesJson(
  extraPolicies: readonly AgentToolPolicy[] = [],
): string {
  // D20-1 (X5/CD5): `extraPolicies` carries runtime-derived policies for
  // user-authored agents whose emitted (re-prefixed) id has no canonical
  // AGENT_TOOL_POLICIES entry. The Claude adapter derives these from each
  // user agent's authored `tools.allowed`/`tools.denied` grant via
  // {@link deriveUserAgentPolicy} and appends them here so the emitted
  // policy document the PreToolUse hook reads contains a row for the user
  // agent — closing the NO_POLICY deny-all path. A canonical id always
  // wins: an extra policy whose agentId collides with a registered policy
  // is dropped so user content can never widen a canonical agent's grant.
  const canonicalIds = new Set(AGENT_TOOL_POLICIES.map((p) => p.agentId));
  const dedupedExtras: AgentToolPolicy[] = [];
  const seenExtra = new Set<string>();
  for (const p of extraPolicies) {
    if (canonicalIds.has(p.agentId) || seenExtra.has(p.agentId)) continue;
    seenExtra.add(p.agentId);
    dedupedExtras.push(p);
  }
  const allPolicies = [...AGENT_TOOL_POLICIES, ...dedupedExtras];
  const doc = {
    schema: "hatch3r/agent-tool-policies/v1",
    generatedBy: "src/pipeline/agentToolAllowlist.ts",
    allToolCategories: ALL_TOOL_CATEGORIES,
    policies: allPolicies.map((p) => ({
      agentId: p.agentId,
      allowedTools: p.allowedTools,
      description: p.description,
      // D15-M6: emit writeScope so downstream consumers (PreToolUse hook,
      // Cursor allowlist rule) can read the contractual boundary alongside
      // the categorical allowlist.
      ...(p.writeScope ? { writeScope: p.writeScope } : {}),
    })),
  };
  return JSON.stringify(doc, null, 2);
}

/**
 * D20-1 (X5/CD5): derive a runtime {@link AgentToolPolicy} for a user-authored
 * agent from its authored `tools.allowed` / `tools.denied` grant.
 *
 * Problem closed: a user agent slug cannot use the `hatch3r-` prefix
 * (`src/content/userContent.ts` slug gate), so the Claude adapter re-prefixes
 * it to `hatch3r-<slug>` on emission. That re-prefixed id matches no entry in
 * the canonical `AGENT_TOOL_POLICIES` registry, so the emitted
 * `agent-tool-policies.json` had no row for it and the PreToolUse hook denied
 * EVERY tool call by `NO_POLICY` deny-by-default — a bricked agent. Deriving a
 * policy from the grant the author already declared (and the gate already
 * validated against {@link ALL_TOOL_CATEGORIES}) lets the hook govern the user
 * agent with its intended privilege envelope.
 *
 * Deny-by-default floor: the resolved allowlist is the authored `allowed`
 * categories MINUS the authored `denied` categories. Unknown categories are
 * dropped (defensive — the user-content gate rejects them at author time, but
 * a hand-edited file could carry one). An agent that declared no `allowed`
 * grant resolves to an empty allowlist (every tool still denied) — the same
 * least-privilege posture as a canonical read-only agent, and the validate-time
 * coverage warning (`validateAgentToolPolicyCoverage`) nudges the author to add
 * a grant.
 *
 * @param emittedAgentId The re-prefixed id the adapter writes (e.g.
 *   `hatch3r-foo`) — the same string the PreToolUse hook matches on
 *   `agent_type`.
 * @param grant The author-declared categories from the agent's `tools`
 *   frontmatter (`toolsAllowed` / `toolsDenied` on the CanonicalFile).
 */
export function deriveUserAgentPolicy(
  emittedAgentId: string,
  grant: { allowed?: readonly string[]; denied?: readonly string[] },
): AgentToolPolicy {
  const known = new Set<string>(ALL_TOOL_CATEGORIES);
  const denied = new Set<string>(
    (grant.denied ?? []).filter((c) => known.has(c)),
  );
  const allowedTools: string[] = [];
  const seen = new Set<string>();
  for (const cat of grant.allowed ?? []) {
    if (!known.has(cat)) continue;
    if (denied.has(cat)) continue;
    if (seen.has(cat)) continue;
    seen.add(cat);
    allowedTools.push(cat);
  }
  return {
    agentId: emittedAgentId,
    allowedTools,
    description:
      `User-authored agent (.hatch3r/overrides/agents/) — policy derived from authored ` +
      `tools grant (deny-by-default: allowed minus denied). ` +
      `Allowed categories: ${allowedTools.length > 0 ? allowedTools.join(", ") : "(none — agent has no tool grant)"}.`,
  };
}

/**
 * Render the Claude Code PreToolUse hook script (Node ESM). The script
 * reads the sibling `agent-tool-policies.json`, maps the Claude Code
 * tool name to a hatch3r category via a bundled table, and emits a
 * `permissionDecision: "deny"` JSON payload on stdout to block the
 * tool call when the active hatch3r sub-agent's policy does not grant
 * the requested category.
 *
 * Contract source: https://code.claude.com/docs/en/hooks (accessed
 * 2026-05-21). PreToolUse hooks receive the payload as JSON on stdin
 * with fields `tool_name`, `tool_input`, and — when fired from a
 * sub-agent — `agent_type` (the named agent class, matched against
 * the registry's `agentId`) plus `agent_id` (per-instance id). The
 * deny decision is `exit 0` with a stdout JSON document of shape
 * `{hookSpecificOutput:{hookEventName:"PreToolUse",
 * permissionDecision:"deny",permissionDecisionReason:"…"}}`. Exit
 * code 2 is not the documented deny mechanism for PreToolUse.
 *
 * Scope: only `hatch3r-*` sub-agents are governed by
 * AGENT_TOOL_POLICIES. Main-thread calls (no `agent_type`) and Claude
 * Code's own sub-agents (e.g. `general-purpose`, `Plan`) pass
 * through. Within hatch3r scope, unknown tools and unknown agents
 * still deny-by-default.
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
// Contract (https://code.claude.com/docs/en/hooks):
//   - PreToolUse hook payload arrives as JSON on stdin. Relevant
//     fields: \`tool_name\`, \`tool_input\`, plus \`agent_type\` and
//     \`agent_id\` when the hook fires inside a sub-agent context.
//   - Allow / no-decision: exit 0 with empty stdout. Claude Code's
//     normal permission flow applies.
//   - Deny: exit 0 with stdout JSON
//     \`{hookSpecificOutput:{hookEventName:"PreToolUse",
//     permissionDecision:"deny",permissionDecisionReason:"…"}}\`.
//   - A structured deny event is also written to stderr so
//     failure-log pipelines can persist the denial.
//
// Scope: only \`hatch3r-*\` sub-agents are governed by the canonical
// AGENT_TOOL_POLICIES registry. Main-thread calls and Claude Code's
// own sub-agents (e.g. \`general-purpose\`, \`Plan\`) are passed
// through. Within hatch3r scope, unknown agents and unknown tools
// deny-by-default.

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

function readStdinSync() {
  try {
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

function emitDenyEvent(event) {
  process.stderr.write(
    JSON.stringify({
      hook: "hatch3r-pretooluse-allowlist",
      timestamp: new Date().toISOString(),
      ...event,
    }) + "\\n",
  );
}

function denyToolCall(event, reason) {
  emitDenyEvent(event);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

let payload = {};
const raw = readStdinSync();
if (raw) {
  try {
    payload = JSON.parse(raw);
  } catch {
    // Malformed payload — fall through to no-decision so a parser
    // bug here cannot brick the host session.
    process.exit(0);
  }
}

const toolName = typeof payload.tool_name === "string" ? payload.tool_name : "";
const agentType = typeof payload.agent_type === "string" ? payload.agent_type : "";
const agentInstanceId = typeof payload.agent_id === "string" ? payload.agent_id : "";

// Scope filter: only hatch3r-authored sub-agents are governed by this
// allowlist. Main-thread calls (no agent_type) and Claude Code's own
// sub-agents are out of scope — pass through.
if (!agentType.startsWith("hatch3r-")) {
  process.exit(0);
}

// MCP tools follow \`mcp__<server>__<tool>\`. Bash maps to execute;
// the registry's \`git\` category is not separable from \`execute\`
// at this layer (the translator emits Bash for both).
let category = TOOL_TO_CATEGORY[toolName];
if (!category && toolName.startsWith("mcp__")) category = "mcp";

if (!category) {
  // Unknown Claude Code tool — deny by default so a new tool added
  // upstream cannot silently widen privilege until the table is
  // updated and re-emitted.
  denyToolCall(
    {
      reasonCode: "UNKNOWN_TOOL",
      agentId: agentType,
      agentInstanceId,
      tool: toolName,
      message: \`Unknown Claude Code tool "\${toolName}"; deny-by-default per ASI02.\`,
    },
    \`hatch3r ASI02 allowlist: tool "\${toolName}" is not in the hatch3r category map; deny-by-default.\`,
  );
}

let policiesDoc;
try {
  policiesDoc = JSON.parse(readFileSync(POLICY_FILE, "utf-8"));
} catch (err) {
  denyToolCall(
    {
      reasonCode: "POLICY_FILE_MISSING",
      agentId: agentType,
      agentInstanceId,
      tool: toolName,
      message: \`Failed to read \${POLICY_FILE}: \${err.message}\`,
    },
    \`hatch3r ASI02 allowlist: policy file \${POLICY_FILE} unreadable; deny-by-default.\`,
  );
}

const policy = policiesDoc.policies.find((p) => p.agentId === agentType);
if (!policy) {
  denyToolCall(
    {
      reasonCode: "NO_POLICY",
      agentId: agentType,
      agentInstanceId,
      tool: toolName,
      message: \`No policy registered for agent "\${agentType}"; deny-by-default.\`,
    },
    \`hatch3r ASI02 allowlist: no policy registered for agent "\${agentType}"; deny-by-default.\`,
  );
}

if (!policy.allowedTools.includes(category)) {
  denyToolCall(
    {
      reasonCode: "TOOL_NOT_ALLOWED",
      agentId: agentType,
      agentInstanceId,
      tool: toolName,
      category,
      allowedTools: policy.allowedTools,
      message: \`Agent "\${agentType}" not allowed to use category "\${category}" (tool "\${toolName}"). Allowed: \${policy.allowedTools.join(", ")}.\`,
    },
    \`hatch3r ASI02 allowlist: agent "\${agentType}" not allowed to use category "\${category}" (tool "\${toolName}"). Allowed: \${policy.allowedTools.join(", ")}.\`,
  );
}

// Allowed — exit 0 with empty stdout lets Claude Code's normal
// permission flow apply.
process.exit(0);
`;
}

/**
 * Render the Cursor `subagentStart` deny hook script (Node ESM). This is
 * the hard runtime ASI02 block for Cursor, at parity with the Claude
 * PreToolUse NO_POLICY deny — it blocks an over-privileged or unknown
 * hatch3r sub-agent at spawn rather than letting it run unconstrained.
 *
 * Contract source: https://cursor.com/docs/agent/hooks (accessed
 * 2026-06-06). The `subagentStart` event fires before a sub-agent begins;
 * its stdin payload carries `subagent_type` (the named agent class, matched
 * against the registry's `agentId`) and `subagent_id` (per-instance id).
 * Hooks communicate over stdio with JSON in both directions: a deny is a
 * stdout JSON document `{permission: "deny", user_message: "…"}`; `allow`
 * (or no decision) lets the spawn proceed.
 *
 * Why `subagentStart` and not `preToolUse`: the `preToolUse` payload exposes
 * `tool_name`/`tool_input`/`cwd`/`model`/`agent_message` but NO agent-identity
 * field, so it cannot map a tool call to the active hatch3r agent's policy.
 * `subagentStart` is the only Cursor lifecycle event that exposes the active
 * sub-agent id with a blocking decision, so the per-agent gate binds here.
 * Per-tool-CATEGORY granularity remains rule-delegated (the `agents-policy.json`
 * + allowlist rule) plus the `readonly: true` write/execute frontmatter guard.
 *
 * Scope: only `hatch3r-*` sub-agents are governed by AGENT_TOOL_POLICIES.
 * Cursor's own sub-agents and any non-hatch3r `subagent_type` pass through.
 * Within hatch3r scope, an agent with no policy row denies-by-default
 * (NO_POLICY), the Cursor analog of the Claude NO_POLICY path. The hook entry
 * is emitted with `failClosed: true` so a crash/timeout also blocks the spawn.
 *
 * The script reads the sibling policy doc via a relative path
 * (`../agents-policy.json` from `.cursor/hooks/`) so it has zero runtime
 * dependencies, mirroring {@link buildClaudePreToolUseHookScript}.
 */
export function buildCursorSubagentGuardHookScript(): string {
  return `#!/usr/bin/env node
// hatch3r — Cursor subagentStart allowlist guard (D9-4, D15 P6).
//
// This script is regenerated by \`npx hatch3r sync\`. Do not edit by hand;
// edit src/pipeline/agentToolAllowlist.ts::AGENT_TOOL_POLICIES instead.
//
// Contract (https://cursor.com/docs/agent/hooks accessed 2026-06-06):
//   - subagentStart payload arrives as JSON on stdin. Relevant fields:
//     \`subagent_type\` (named agent class) and \`subagent_id\` (per-instance).
//   - Allow / no-decision: exit 0 with empty stdout. The spawn proceeds.
//   - Deny: exit 0 with stdout JSON \`{permission:"deny",user_message:"…"}\`.
//   - A structured deny event is also written to stderr so failure-log
//     pipelines can persist the denial.
//
// Scope: only \`hatch3r-*\` sub-agents are governed by the canonical
// AGENT_TOOL_POLICIES registry. Cursor's own sub-agents and any other
// \`subagent_type\` pass through. Within hatch3r scope, an agent with no
// policy row denies-by-default (NO_POLICY).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// agents-policy.json lives one level up at \`.cursor/agents-policy.json\`;
// this script lives at \`.cursor/hooks/subagent-guard.mjs\`.
const POLICY_FILE = join(__dirname, "..", "agents-policy.json");

function readStdinSync() {
  try {
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

function emitDenyEvent(event) {
  process.stderr.write(
    JSON.stringify({
      hook: "hatch3r-cursor-subagent-guard",
      timestamp: new Date().toISOString(),
      ...event,
    }) + "\\n",
  );
}

function denySubagent(event, reason) {
  emitDenyEvent(event);
  process.stdout.write(
    JSON.stringify({
      permission: "deny",
      user_message: reason,
    }),
  );
  process.exit(0);
}

let payload = {};
const raw = readStdinSync();
if (raw) {
  try {
    payload = JSON.parse(raw);
  } catch {
    // Malformed payload — fall through to no-decision so a parser bug
    // here cannot brick the host session.
    process.exit(0);
  }
}

const subagentType = typeof payload.subagent_type === "string" ? payload.subagent_type : "";
const subagentInstanceId = typeof payload.subagent_id === "string" ? payload.subagent_id : "";

// Scope filter: only hatch3r-authored sub-agents are governed by this
// allowlist. Cursor's own sub-agents and any non-hatch3r type pass through.
if (!subagentType.startsWith("hatch3r-")) {
  process.exit(0);
}

let policiesDoc;
try {
  policiesDoc = JSON.parse(readFileSync(POLICY_FILE, "utf-8"));
} catch (err) {
  denySubagent(
    {
      reasonCode: "POLICY_FILE_MISSING",
      agentId: subagentType,
      subagentInstanceId,
      message: \`Failed to read \${POLICY_FILE}: \${err.message}\`,
    },
    \`hatch3r ASI02 guard: policy file \${POLICY_FILE} unreadable; deny-by-default.\`,
  );
}

const policy = policiesDoc.policies.find((p) => p.agentId === subagentType);
if (!policy) {
  denySubagent(
    {
      reasonCode: "NO_POLICY",
      agentId: subagentType,
      subagentInstanceId,
      message: \`No policy registered for agent "\${subagentType}"; deny-by-default.\`,
    },
    \`hatch3r ASI02 guard: no policy registered for agent "\${subagentType}"; deny-by-default. Add it to src/pipeline/agentToolAllowlist.ts::AGENT_TOOL_POLICIES and re-run \\\`npx hatch3r sync\\\`.\`,
  );
}

// A registered hatch3r agent with a policy row is allowed to start; its
// per-tool-category envelope is enforced by the allowlist rule + the
// \`readonly: true\` frontmatter guard (preToolUse cannot see agent identity,
// so category granularity cannot bind at the tool-call boundary on Cursor).
process.exit(0);
`;
}

/**
 * Render the Cursor allowlist rule body. Cursor's `preToolUse` hook payload
 * exposes no agent-identity field (per cursor.com/docs/agent/hooks accessed
 * 2026-06-06), so per-tool-CATEGORY enforcement is rule-delegated: the rule
 * is `alwaysApply: true` and instructs the Cursor agent runtime to refuse
 * tool calls that exceed the allowlist in the sibling `agents-policy.json`.
 * The agent-identity gate that `preToolUse` cannot serve is bound at the
 * `subagentStart` event by {@link buildCursorSubagentGuardHookScript} (the
 * hard NO_POLICY deny). Pairs with the `readonly: true` frontmatter primitive
 * emitted by `toCursorReadonlyFrontmatter` for read-only roles.
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
    "Cursor enforces this allowlist on three surfaces. (1) The `subagentStart` hook (`.cursor/hooks/subagent-guard.mjs`) is a hard runtime block: it reads this registry from `.cursor/agents-policy.json` and denies any `hatch3r-*` sub-agent with no policy row at spawn (`{permission: \"deny\"}`), the Cursor analog of the Claude PreToolUse NO_POLICY deny. (2) The subagent frontmatter `readonly: true` (emitted automatically for agents whose policy lacks `write` and `execute`) blocks file edits and state-changing shell commands. (3) For richer per-CATEGORY restrictions (e.g., denying `web` or `mcp`), the agent must refuse the call and surface a `TOOL_NOT_ALLOWED` rejection — Cursor's `preToolUse` payload carries no agent-identity field, so category granularity cannot bind at the tool-call boundary and stays runtime-delegated.",
    "",
    "Deny-by-default: unknown agent ids and unknown categories must be refused.",
  ].join("\n");
}
