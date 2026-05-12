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

// ── Public API ─────────────────────────────────────────────────────

export type AdapterName = "claude" | "copilot" | "cursor" | "windsurf";

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
