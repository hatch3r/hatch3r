/**
 * Per-adapter trust delegation translator (D15 / Pillar P6).
 *
 * Audit context:
 *   - C7.5-W2B2-H41: per-adapter `tools:` frontmatter emission.
 *   - C7.5-W2B2-H45: translate AGENT_TOOL_POLICIES to adapter-native
 *                    allowlist primitives so the monotonic-privilege
 *                    invariant survives into the downstream tool runtime.
 *   - D15-F15.5-01: Cycle 6 Critical #3 — trust delegation chain
 *     enforcement was incomplete because the TypeScript allowlist was
 *     not rendered into any generated subagent file.
 *
 * What this module does:
 *   Maps the hatch3r canonical tool categories (read, search, write,
 *   execute, web, mcp, git, board) to the native tool allowlist format
 *   each target platform recognises in its subagent frontmatter:
 *   - Claude Code: `tools: Read, Grep, Glob, ...` (comma-separated
 *     canonical tool names). Source:
 *     https://code.claude.com/docs/en/sub-agents#available-tools
 *     (accessed 2026-04-20).
 *   - GitHub Copilot: `tools: ["read", "edit", "search", ...]`
 *     (YAML array of primary aliases). Source:
 *     https://docs.github.com/en/copilot/reference/custom-agents-configuration
 *     (accessed 2026-04-20).
 *   - Windsurf Cascade: comma-separated tool names like Claude Code.
 *   - Cursor: exposes only a `readonly: true` boolean (no allowlist);
 *     we emit `readonly: true` when no write/execute categories are
 *     present so the invariant collapses to its strongest Cursor-native
 *     approximation.
 *
 * Design constraints:
 *   1. Deny-by-default. If no policy is registered for an agent id, the
 *      helper returns `null` and the caller MUST omit the frontmatter
 *      field. That preserves the upstream Claude Code default (inherit
 *      every tool) only for agents that were not authored by hatch3r —
 *      hatch3r-authored agents always have a policy.
 *   2. No side effects. The module only reads from AGENT_TOOL_POLICIES;
 *      it does not mutate or require runtime wiring.
 *   3. Monotonically decreasing privilege. A translator must never
 *      widen an agent's category set when mapping to adapter-native
 *      tools. Mappings here are explicit enumerations; adding new
 *      categories requires a code change + test.
 */

import { getAgentToolPolicy } from "./agentToolAllowlist.js";

// ── Tool category → native tool name mappings ──────────────────────

/**
 * Map a hatch3r category to the set of Claude Code tool names that
 * implement it. Grouped per `code.claude.com/docs/en/sub-agents`
 * available tools section.
 */
const CLAUDE_CATEGORY_MAP: Readonly<Record<string, readonly string[]>> = {
  read: ["Read", "NotebookRead"],
  search: ["Grep", "Glob"],
  write: ["Edit", "MultiEdit", "Write", "NotebookEdit"],
  execute: ["Bash"],
  web: ["WebSearch", "WebFetch"],
  mcp: [], // MCP tools are scoped via the `mcpServers` frontmatter field, not `tools`.
  git: ["Bash"], // Git is driven via Bash; callers that grant git retain execute semantics.
  board: [], // Project-board tooling is MCP-driven; see mcp mapping.
};

/**
 * GitHub Copilot primary aliases per
 * https://docs.github.com/en/copilot/reference/custom-agents-configuration
 * (accessed 2026-04-20).
 */
const COPILOT_CATEGORY_MAP: Readonly<Record<string, readonly string[]>> = {
  read: ["read"],
  search: ["search"],
  write: ["edit"],
  execute: ["execute"],
  web: ["web"],
  mcp: [], // MCP exposure is controlled via `mcp-servers`, not `tools`.
  git: ["execute"],
  board: [],
};

/**
 * Windsurf Cascade subagent tool names. Windsurf uses Claude-style
 * comma-separated tool tokens; we reuse the Claude mapping.
 */
const WINDSURF_CATEGORY_MAP = CLAUDE_CATEGORY_MAP;

/**
 * Roo Code custom-mode `groups` array values. Source:
 * https://docs.roocode.com/features/custom-modes (accessed 2026-05-18,
 * Roo Code, official-docs).
 *
 * Roo Code defines five group identifiers; each gates a category of tool
 * usage inside a custom mode. Cline reads the same `.roomodes` schema.
 *   - `read`    — file reads, grep/glob style search
 *   - `edit`    — file edits / writes / patches
 *   - `browser` — Puppeteer/Playwright browser actions (covers web fetch)
 *   - `command` — shell command execution
 *   - `mcp`    — MCP tool invocation
 *
 * Closes finding C9-H21 (D9-SA9.4.F2, P3/P6): the Cline adapter previously
 * hardcoded `["read", "edit", "browser", "command", "mcp"]` for every
 * mode, silently widening privilege for read-only hatch3r agents. This
 * map collapses each hatch3r category to the smallest Roo group set that
 * is technically required for that category — preserving the monotonic
 * privilege invariant on Cline/Roo Code that the Cursor/Claude/Copilot/
 * Windsurf adapters already enforce via their translator entry points.
 */
const CLINE_CATEGORY_MAP: Readonly<Record<string, readonly string[]>> = {
  read: ["read"],
  search: ["read"], // Roo's `read` group includes grep/glob style search.
  write: ["edit"],
  execute: ["command"],
  web: ["browser"], // Roo exposes web access via the browser group only.
  mcp: ["mcp"],
  git: ["command"], // Git is shell-driven on Cline/Roo, matching CLAUDE_CATEGORY_MAP.
  board: ["mcp"], // Project boards are MCP-driven, matching COPILOT_CATEGORY_MAP.
};

/**
 * Canonical Roo Code `groups` ordering. Used so equivalent policies emit
 * identical JSON output regardless of insertion order — keeps the
 * `.roomodes` diff stable across runs.
 */
const CLINE_GROUPS_ORDER = ["read", "edit", "browser", "command", "mcp"] as const;

/**
 * OpenCode agent `permission:` schema values per
 * https://opencode.ai/docs/agents (accessed 2026-05-18, OpenCode docs,
 * official-docs).
 *
 * OpenCode 2026 deprecated the older `tools: { write: false }` boolean
 * map in favour of a richer per-tool `permission:` map whose values are
 * `allow | ask | deny`. The schema covers `read`, `edit`, `glob`,
 * `grep`, `bash`, `task`, `webfetch`, `websearch`, `lsp`, `skill`.
 *
 * We grant `allow` only for tools explicitly authorised by the agent's
 * hatch3r category set, and emit `deny` for every other tool — keeping
 * the monotonic-privilege invariant intact for OpenCode subagents.
 * `ask` (which would prompt the user) is never emitted: hatch3r policies
 * are deterministic, so a fall-back to "ask" would silently widen
 * privilege when the user clicks through.
 *
 * Mapping rationale:
 *  - `read`     ← hatch3r `read`     (file reads)
 *  - `edit`     ← hatch3r `write`    (file edits/writes/patches)
 *  - `glob`     ← hatch3r `search`   (path globbing)
 *  - `grep`     ← hatch3r `search`   (code search)
 *  - `bash`     ← hatch3r `execute`  (shell)
 *  - `webfetch` ← hatch3r `web`      (HTTP fetch)
 *  - `websearch`← hatch3r `web`      (search engine)
 *  - `task`     ← hatch3r `execute`  (sub-agent dispatch needs shell-class trust)
 *  - `lsp`      ← hatch3r `read`     (LSP read-only diagnostics)
 *  - `skill`    ← hatch3r `read`     (skill files are documentation)
 *
 * Closes finding C9-H6 (D2-SA2.4-02, P3/P6) for `opencode`.
 */
const OPENCODE_PERMISSIONS = [
  "read",
  "edit",
  "glob",
  "grep",
  "bash",
  "task",
  "webfetch",
  "websearch",
  "lsp",
  "skill",
] as const;

type OpenCodePermissionKey = (typeof OPENCODE_PERMISSIONS)[number];

const OPENCODE_PERMISSION_MAP: Readonly<
  Record<string, readonly OpenCodePermissionKey[]>
> = {
  read: ["read", "lsp", "skill"],
  search: ["glob", "grep"],
  write: ["edit"],
  execute: ["bash", "task"],
  web: ["webfetch", "websearch"],
  mcp: [], // OpenCode controls MCP via the `mcp:` config block, not `permission:`.
  git: ["bash"], // Git is shell-driven on OpenCode.
  board: [], // Boards are MCP-driven.
};

/**
 * Amazon Q Developer CLI custom-agent `allowedTools` schema per
 * https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line-custom-agents-configuration.html
 * (accessed 2026-05-18, Amazon Q Developer User Guide, official-docs).
 *
 * Built-in tool names (per
 * https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line-built-in-tools.html):
 *   - `fs_read`      — file/dir reads
 *   - `fs_write`     — file writes
 *   - `execute_bash` — shell
 *   - `use_aws`      — AWS API surface (not currently in hatch3r categories)
 *   - `knowledge`    — knowledge base reads
 *   - `report_issues`— issue reporting
 *
 * Amazon Q has no first-class `search` primitive — grep/glob is layered
 * on top of `fs_read` (the model uses fs_read to walk the tree). We
 * therefore grant `fs_read` for both hatch3r `read` and `search` rather
 * than synthesising a search token that does not exist on the platform.
 *
 * Closes finding C9-H6 for `amazonq`.
 */
const AMAZONQ_CATEGORY_MAP: Readonly<Record<string, readonly string[]>> = {
  read: ["fs_read"],
  search: ["fs_read"], // Amazon Q uses fs_read for both filesystem reads and code search.
  write: ["fs_write"],
  execute: ["execute_bash"],
  web: [], // No documented built-in web tool in @builtin namespace; MCP-delegated.
  mcp: [], // MCP exposure is controlled via `mcpServers`, not `allowedTools` built-ins.
  git: ["execute_bash"], // Git is shell-driven.
  board: [], // Boards are MCP-driven.
};

/**
 * Canonical Amazon Q tool ordering. Used so equivalent policies emit
 * identical JSON output regardless of insertion order.
 */
const AMAZONQ_TOOLS_ORDER = [
  "fs_read",
  "fs_write",
  "execute_bash",
] as const;

/**
 * Kiro CLI custom-agent `tools` / `allowedTools` schema per
 * https://kiro.dev/docs/cli/custom-agents/configuration-reference/
 * (accessed 2026-05-18, Kiro docs, official-docs).
 *
 * Built-in tool names exposed in the `tools` array:
 *   - `read`   — file/dir reads
 *   - `write`  — file writes
 *   - `shell`  — bash execution
 *
 * Kiro's `allowedTools` accepts the same names (plus glob patterns and
 * `@<mcp-server>` references). hatch3r emits the explicit names so the
 * generated agent does not depend on Kiro's pattern-matching semantics.
 *
 * Closes finding C9-H6 for `kiro`.
 */
const KIRO_CATEGORY_MAP: Readonly<Record<string, readonly string[]>> = {
  read: ["read"],
  search: ["read"], // Kiro has no separate search primitive; file reads cover grep/glob.
  write: ["write"],
  execute: ["shell"],
  web: [], // No built-in web tool; MCP-delegated.
  mcp: [],
  git: ["shell"], // Git is shell-driven.
  board: [],
};

const KIRO_TOOLS_ORDER = ["read", "write", "shell"] as const;

/**
 * Gemini CLI `coreTools` schema per
 * https://geminicli.com/docs/reference/configuration/ (accessed
 * 2026-05-18, Gemini CLI docs, official-docs). Tool names follow
 * the Gemini CLI built-in tool naming convention:
 *   - `ReadFileTool`        — file read
 *   - `ReadFolderTool`      — directory listing
 *   - `WriteFileTool`       — file write
 *   - `EditTool`            — file edit
 *   - `ShellTool`           — shell execution
 *   - `WebFetchTool`        — HTTP fetch
 *   - `GoogleWebSearchTool` — search engine
 *   - `GrepTool`            — code search
 *   - `GlobTool`            — path globbing
 *
 * `coreTools` is an allowlist (deny everything not listed). hatch3r
 * emits the explicit allowlist so a Gemini operator who copies the
 * generated settings.json gets deny-by-default behaviour for tools
 * outside the agent's policy.
 *
 * Closes finding C9-H6 for `gemini`.
 */
const GEMINI_CATEGORY_MAP: Readonly<Record<string, readonly string[]>> = {
  read: ["ReadFileTool", "ReadFolderTool"],
  search: ["GrepTool", "GlobTool"],
  write: ["WriteFileTool", "EditTool"],
  execute: ["ShellTool"],
  web: ["WebFetchTool", "GoogleWebSearchTool"],
  mcp: [], // MCP tools are scoped via Gemini's `mcpServers` config, not `coreTools`.
  git: ["ShellTool"], // Git is shell-driven.
  board: [], // Boards are MCP-driven.
};

const GEMINI_TOOLS_ORDER = [
  "ReadFileTool",
  "ReadFolderTool",
  "GrepTool",
  "GlobTool",
  "WriteFileTool",
  "EditTool",
  "ShellTool",
  "WebFetchTool",
  "GoogleWebSearchTool",
] as const;

// ── Public API ─────────────────────────────────────────────────────

export type AdapterName =
  | "claude"
  | "copilot"
  | "cursor"
  | "windsurf"
  | "cline"
  | "opencode"
  | "amazon-q"
  | "kiro"
  | "gemini";

/**
 * Translate an agent id's hatch3r policy to the Claude Code `tools:`
 * frontmatter value (comma-separated tool names).
 *
 * Returns `null` when the agent has no registered policy — caller MUST
 * omit the frontmatter field (Claude Code inherits all tools if the
 * field is absent). This is conservative: hatch3r-authored agents all
 * have policies; only user-authored "unknown" agents fall through.
 */
export function toClaudeToolsFrontmatter(agentId: string): string | null {
  const policy = getAgentToolPolicy(agentId);
  if (!policy) return null;
  const tools = resolveNativeTools(policy.allowedTools, CLAUDE_CATEGORY_MAP);
  if (tools.length === 0) return null;
  return tools.join(", ");
}

/**
 * Translate an agent id's hatch3r policy to a GitHub Copilot
 * `tools: [...]` YAML array value.
 *
 * Returns `null` when the agent has no registered policy.
 */
export function toCopilotToolsFrontmatter(agentId: string): readonly string[] | null {
  const policy = getAgentToolPolicy(agentId);
  if (!policy) return null;
  const tools = resolveNativeTools(policy.allowedTools, COPILOT_CATEGORY_MAP);
  return tools.length === 0 ? null : tools;
}

/**
 * Translate an agent id's hatch3r policy to the Windsurf Cascade
 * `tools:` frontmatter value (comma-separated).
 *
 * Returns `null` when the agent has no registered policy.
 */
export function toWindsurfToolsFrontmatter(agentId: string): string | null {
  const policy = getAgentToolPolicy(agentId);
  if (!policy) return null;
  const tools = resolveNativeTools(policy.allowedTools, WINDSURF_CATEGORY_MAP);
  if (tools.length === 0) return null;
  return tools.join(", ");
}

/**
 * Translate an agent id's hatch3r policy to the Cline/Roo Code custom-mode
 * `groups` array.
 *
 * Returns `null` when the agent has no registered policy — caller MUST
 * fall back to a conservative default (empty array would disable every
 * tool group in Roo Code, which is the deny-by-default outcome for an
 * unknown agent). Returns an empty array only when the policy resolves
 * to zero groups; the caller decides how to represent that.
 *
 * The returned array is sorted by {@link CLINE_GROUPS_ORDER} so the
 * generated `.roomodes` JSON diff stays stable run-to-run regardless of
 * the order in which categories appear in `policy.allowedTools`.
 *
 * Closes finding C9-H21 (D9-SA9.4.F2): per-mode groups translation that
 * preserves the monotonic-privilege invariant for Cline/Roo Code instead
 * of hardcoding the full group set.
 */
export function toClineGroupsFrontmatter(agentId: string): string[] | null {
  const policy = getAgentToolPolicy(agentId);
  if (!policy) return null;
  const resolved = new Set(resolveNativeTools(policy.allowedTools, CLINE_CATEGORY_MAP));
  return CLINE_GROUPS_ORDER.filter((g) => resolved.has(g));
}

/**
 * Cursor subagent frontmatter does not expose an explicit tool
 * allowlist — the closest analogue is `readonly: true`, which blocks
 * file edits and state-changing shell commands (per Cursor subagents
 * docs, accessed 2026-04-20).
 *
 * Returns `true` when the agent's policy lacks both `write` and
 * `execute` categories (i.e., the strongest restriction Cursor can
 * enforce applies). Returns `false` otherwise. Returns `null` for
 * unknown agents so the caller preserves its existing behaviour.
 */
export function toCursorReadonlyFrontmatter(agentId: string): boolean | null {
  const policy = getAgentToolPolicy(agentId);
  if (!policy) return null;
  const hasWrite = policy.allowedTools.includes("write");
  const hasExecute = policy.allowedTools.includes("execute");
  return !hasWrite && !hasExecute;
}

/**
 * Translate an agent id's hatch3r policy to OpenCode's
 * `permission:` frontmatter map.
 *
 * Returns `null` when the agent has no registered policy — caller MUST
 * omit the field (OpenCode applies its workspace-wide defaults).
 *
 * The returned object covers every OpenCode permission key with one of
 * `"allow"` or `"deny"`. `"ask"` is never emitted: hatch3r policies are
 * deterministic and a user-prompted "ask" would silently widen privilege
 * when the user clicks through. Closes finding C9-H6 for `opencode`.
 */
export function toOpenCodePermissionFrontmatter(
  agentId: string,
): Record<OpenCodePermissionKey, "allow" | "deny"> | null {
  const policy = getAgentToolPolicy(agentId);
  if (!policy) return null;
  const allowed = new Set(
    resolveNativeTools(policy.allowedTools, OPENCODE_PERMISSION_MAP),
  );
  const out: Record<string, "allow" | "deny"> = {};
  for (const key of OPENCODE_PERMISSIONS) {
    out[key] = allowed.has(key) ? "allow" : "deny";
  }
  return out as Record<OpenCodePermissionKey, "allow" | "deny">;
}

/**
 * Translate an agent id's hatch3r policy to Amazon Q Developer CLI's
 * `allowedTools` array.
 *
 * Returns `null` when the agent has no registered policy — caller MUST
 * omit the field (Amazon Q will prompt for every tool call, the
 * deny-by-default outcome for unknown agents).
 *
 * Returned tools are sorted by {@link AMAZONQ_TOOLS_ORDER} so equivalent
 * policies emit identical JSON regardless of insertion order. Closes
 * finding C9-H6 for `amazonq`.
 */
export function toAmazonQAllowedTools(agentId: string): string[] | null {
  const policy = getAgentToolPolicy(agentId);
  if (!policy) return null;
  const resolved = new Set(
    resolveNativeTools(policy.allowedTools, AMAZONQ_CATEGORY_MAP),
  );
  return AMAZONQ_TOOLS_ORDER.filter((t) => resolved.has(t));
}

/**
 * Translate an agent id's hatch3r policy to Kiro CLI's custom-agent
 * `tools` array (and the matching `allowedTools` array — they share
 * the same value space).
 *
 * Returns `null` when the agent has no registered policy.
 *
 * Returned tools are sorted by {@link KIRO_TOOLS_ORDER}. Closes finding
 * C9-H6 for `kiro`.
 */
export function toKiroTools(agentId: string): string[] | null {
  const policy = getAgentToolPolicy(agentId);
  if (!policy) return null;
  const resolved = new Set(
    resolveNativeTools(policy.allowedTools, KIRO_CATEGORY_MAP),
  );
  return KIRO_TOOLS_ORDER.filter((t) => resolved.has(t));
}

/**
 * Translate an agent id's hatch3r policy to Gemini CLI's `coreTools`
 * array (settings.json `tools.core`).
 *
 * Returns `null` when the agent has no registered policy. Caller MUST
 * omit the field; Gemini CLI then defaults to its full built-in tool
 * set (NOT deny-by-default — see Gemini docs).
 *
 * Returned tools are sorted by {@link GEMINI_TOOLS_ORDER}. Closes
 * finding C9-H6 for `gemini`.
 */
export function toGeminiCoreTools(agentId: string): string[] | null {
  const policy = getAgentToolPolicy(agentId);
  if (!policy) return null;
  const resolved = new Set(
    resolveNativeTools(policy.allowedTools, GEMINI_CATEGORY_MAP),
  );
  return GEMINI_TOOLS_ORDER.filter((t) => resolved.has(t));
}

// ── Coverage-limit explainer (C9-H6 / D2-SA2.4-02) ─────────────────
//
// 6 of 15 adapters lack a per-agent tool-allowlist primitive. The
// translator declines to emit a token rather than guess one, because
// guessed names silently widen privilege when the downstream runtime
// rejects them. Each entry below records WHY no translator exists so
// audit reviewers can validate the gap is platform-imposed, not
// hatch3r-imposed. P3 freshness: re-verify each link per cycle.

/**
 * Per-adapter tool-allowlist coverage matrix surfaced to the operator
 * via the {@link ADAPTER_ALLOWLIST_COVERAGE} table and audit reports.
 *
 * `coverage: "full"`   ⇒ A translator function exists and emits a
 *                         policy-derived allowlist into the adapter's
 *                         generated artifact.
 * `coverage: "none"`   ⇒ The platform does not expose a per-agent
 *                         allowlist primitive in a form the adapter
 *                         can carry forward. The `rationale` field
 *                         documents the platform-imposed gap.
 *
 * Closes finding C9-H6 (D2-SA2.4-02) — explicit coverage statement
 * for every adapter, no silent gaps.
 */
export interface AdapterAllowlistCoverage {
  readonly adapter: string;
  readonly coverage: "full" | "none";
  /** Translator export name when coverage === "full". `null` for `"none"`. */
  readonly translator: string | null;
  /** Free-form rationale (≤200 chars). */
  readonly rationale: string;
  /** Authoritative platform docs URL (re-verified each audit cycle). */
  readonly sourceUrl: string;
}

export const ADAPTER_ALLOWLIST_COVERAGE: readonly AdapterAllowlistCoverage[] = [
  {
    adapter: "claude",
    coverage: "full",
    translator: "toClaudeToolsFrontmatter",
    rationale: "Claude Code subagent frontmatter accepts `tools:` (comma-separated tool names).",
    sourceUrl: "https://code.claude.com/docs/en/sub-agents",
  },
  {
    adapter: "copilot",
    coverage: "full",
    translator: "toCopilotToolsFrontmatter",
    rationale: "GitHub Copilot custom-agent frontmatter accepts `tools:` (YAML array of primary aliases).",
    sourceUrl: "https://docs.github.com/en/copilot/reference/custom-agents-configuration",
  },
  {
    adapter: "cursor",
    coverage: "full",
    translator: "toCursorReadonlyFrontmatter",
    rationale: "Cursor exposes only a `readonly: true` boolean — emitted when policy lacks write+execute.",
    sourceUrl: "https://cursor.com/docs/agents",
  },
  {
    adapter: "windsurf",
    coverage: "full",
    translator: "toWindsurfToolsFrontmatter",
    rationale: "Windsurf Cascade reuses Claude-style comma-separated tool tokens.",
    sourceUrl: "https://docs.windsurf.com/windsurf/cascade",
  },
  {
    adapter: "cline",
    coverage: "full",
    translator: "toClineGroupsFrontmatter",
    rationale: "Cline reads Roo Code `.roomodes` schema with `groups: [read,edit,browser,command,mcp]`.",
    sourceUrl: "https://docs.roocode.com/features/custom-modes",
  },
  {
    adapter: "opencode",
    coverage: "full",
    translator: "toOpenCodePermissionFrontmatter",
    rationale: "OpenCode 2026 `permission:` map (allow|ask|deny) over read/edit/glob/grep/bash/web/etc.",
    sourceUrl: "https://opencode.ai/docs/agents",
  },
  {
    adapter: "amazon-q",
    coverage: "full",
    translator: "toAmazonQAllowedTools",
    rationale: "Amazon Q Developer CLI custom-agent JSON `allowedTools: [fs_read, fs_write, execute_bash, ...]`.",
    sourceUrl: "https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line-custom-agents-configuration.html",
  },
  {
    adapter: "kiro",
    coverage: "full",
    translator: "toKiroTools",
    rationale: "Kiro CLI custom-agent JSON `tools: [read, write, shell]` plus identical `allowedTools` array.",
    sourceUrl: "https://kiro.dev/docs/cli/custom-agents/configuration-reference/",
  },
  {
    adapter: "gemini",
    coverage: "full",
    translator: "toGeminiCoreTools",
    rationale: "Gemini CLI settings.json `coreTools: [ReadFileTool, WriteFileTool, ShellTool, ...]` allowlist.",
    sourceUrl: "https://geminicli.com/docs/reference/configuration/",
  },
  {
    adapter: "aider",
    coverage: "none",
    translator: null,
    rationale: "Aider has no per-agent allowlist; `/read` marks files read-only but does not restrict tools.",
    sourceUrl: "https://aider.chat/docs/usage/conventions.html",
  },
  {
    adapter: "amp",
    coverage: "none",
    translator: null,
    rationale: "Amp `commands.allowlist` restricts bash commands, not per-agent tool categories (workspace-wide).",
    sourceUrl: "https://ampcode.com/manual",
  },
  {
    adapter: "antigravity",
    coverage: "none",
    translator: null,
    rationale: "Google Antigravity uses IDE-wide Allow/Deny/Ask lists + autonomy levels, not per-agent frontmatter.",
    sourceUrl: "https://antigravity.google/docs",
  },
  {
    adapter: "codex",
    coverage: "none",
    translator: null,
    rationale: "OpenAI Codex CLI uses process-level sandbox_mode + approval_policy, not per-agent allowlists.",
    sourceUrl: "https://developers.openai.com/codex/config-reference",
  },
  {
    adapter: "goose",
    coverage: "none",
    translator: null,
    rationale: "Goose uses env-var GOOSE_ALLOWLIST URL for MCP extension installs, not per-agent tool restriction.",
    sourceUrl: "https://block.github.io/goose/docs/guides/allowlist/",
  },
  {
    adapter: "zed",
    coverage: "none",
    translator: null,
    rationale: "Zed `agent.tool_permissions` is editor-wide; per-agent profiles are UI-driven without canonical schema.",
    sourceUrl: "https://zed.dev/docs/ai/tool-permissions",
  },
];

/**
 * Render the per-adapter coverage matrix as a markdown table.
 * Used by audit reports + governance docs so the platform-imposed
 * gaps are visible to the operator without grepping the codebase.
 */
export function buildAllowlistCoverageTable(): string {
  const rows = ADAPTER_ALLOWLIST_COVERAGE.map(
    (r) =>
      `| \`${r.adapter}\` | ${r.coverage} | ${r.translator ? `\`${r.translator}\`` : "—"} | ${r.rationale} |`,
  );
  return [
    "| Adapter | Coverage | Translator | Rationale |",
    "|---------|----------|------------|-----------|",
    ...rows,
  ].join("\n");
}

// ── User-question (triage) tool per adapter ────────────────────────

/**
 * Per-adapter native user-question / triage tool used during ASK
 * checkpoints (see agents/shared/user-question-protocol.md).
 *
 * Audit context:
 *   - Pillars served: P1 (CLI UX), P3 (adapter currency), P4 (lean coverage).
 *   - D9 per-cycle web-research mandate: each adapter author MUST verify
 *     the platform's current native question tool name via official docs
 *     before flipping an entry from `null` to a populated object.
 *     See governance/audit/domains/D09-platform-adapters.md per-adapter
 *     checklist item "User-question tool".
 *
 * Convention:
 *   - `null` ⇒ adapter has no documented native question tool. Generated
 *     content falls back to the Plain-Text Fallback Template defined in
 *     agents/shared/user-question-protocol.md.
 *   - `{ name, invocationHint? }` ⇒ adapter exposes a callable native
 *     question primitive; `name` is the literal token rendered into the
 *     generated user-question-protocol.md output for that platform.
 *
 * Bias: when in doubt, default to `null` rather than guessing a name.
 * Wrong tool names produce silent failures at user-prompt time.
 */
export interface AskUserToolEntry {
  readonly name: string;
  readonly invocationHint?: string;
}

const ASK_USER_TOOLS: Readonly<Record<string, AskUserToolEntry | null>> = {
  claude: { name: "AskUserQuestion" },
  cursor: null,
  copilot: null,
  windsurf: null,
  codex: null,
  cline: null,
  opencode: null,
  amp: null,
  aider: null,
  kiro: null,
  goose: null,
  zed: null,
  "amazon-q": null,
  gemini: null,
  antigravity: null,
};

/**
 * Return the native question tool entry for an adapter, or null if the
 * adapter has no documented native tool. Unknown adapter names also
 * return null (deny-by-default).
 */
export function getAskUserToolEntry(adapter: string): AskUserToolEntry | null {
  return ASK_USER_TOOLS[adapter] ?? null;
}

/**
 * Render the platform-note paragraph that the adapter pipeline substitutes
 * for the `<!-- HATCH3R:PLATFORM-TOOL -->` marker in canonical content.
 *
 * Native case: ≤2 sentences naming the tool and pointing the reader at
 * its invocation. Fallback case: ≤2 sentences directing the reader to
 * the Plain-Text Fallback Template.
 */
export function toAskUserPlatformNote(adapter: string): string {
  const entry = getAskUserToolEntry(adapter);
  if (entry === null) {
    return [
      `**Platform:** No documented native question tool for \`${adapter}\`.`,
      "Use the Plain-Text Fallback Template below for every ASK checkpoint.",
    ].join(" ");
  }
  const hint = entry.invocationHint ? ` ${entry.invocationHint}` : "";
  return [
    `**Platform:** Invoke the \`${entry.name}\` tool for every ASK checkpoint on \`${adapter}\`.${hint}`,
    "Use the Plain-Text Fallback Template only when the tool cannot represent the question (e.g., long free-text answers).",
  ].join(" ");
}

/**
 * Marker token written into the canonical user-question protocol file
 * (`agents/shared/user-question-protocol.md`). At canonical-write time
 * the marker is replaced by the enumeration table returned from
 * {@link buildAskUserPlatformTable} so every platform's runtime agent
 * can look up its own row regardless of which adapter(s) the project
 * targets.
 */
export const PLATFORM_TOOL_MARKER = "<!-- HATCH3R:PLATFORM-TOOL -->";

/**
 * Render the platform-tool enumeration table as a markdown block.
 * One row per known adapter; populated entries cite the native tool
 * name, null entries direct the reader to the Plain-Text Fallback
 * Template defined in the same protocol file.
 *
 * The table is adapter-agnostic — it is written once into the canonical
 * layer and every platform's agent reads the same source. This avoids
 * threading an adapter-target argument through the canonical-content
 * pipeline (which is shared across multi-adapter projects).
 */
export function buildAskUserPlatformTable(): string {
  const rows = Object.entries(ASK_USER_TOOLS).map(([adapter, entry]) => {
    if (entry === null) {
      return `| \`${adapter}\` | _No documented native tool — use the Plain-Text Fallback Template below._ |`;
    }
    return `| \`${adapter}\` | Invoke the \`${entry.name}\` tool for every ASK checkpoint. |`;
  });
  return [
    "| Adapter | Platform-Native Question Tool |",
    "|---------|-------------------------------|",
    ...rows,
  ].join("\n");
}

/**
 * Apply the canonical-write marker substitution to a markdown string.
 * If the marker is absent, returns the input unchanged (idempotent).
 *
 * Called by `src/content/index.ts::copySelectedContent` after the
 * shared support directories (`agents/shared/`, etc.) are copied to
 * `.agents/`.
 */
export function substituteCanonicalPlatformMarker(content: string): string {
  if (!content.includes(PLATFORM_TOOL_MARKER)) return content;
  return content.split(PLATFORM_TOOL_MARKER).join(buildAskUserPlatformTable());
}

// ── Internals ──────────────────────────────────────────────────────

function resolveNativeTools(
  categories: readonly string[],
  map: Readonly<Record<string, readonly string[]>>,
): string[] {
  const out = new Set<string>();
  for (const cat of categories) {
    const native = map[cat];
    if (!native) continue;
    for (const t of native) out.add(t);
  }
  return [...out];
}
