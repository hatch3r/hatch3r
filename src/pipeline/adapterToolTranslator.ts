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
 *   - Cursor: exposes only a `readonly: true` boolean (no allowlist);
 *     we emit `readonly: true` when no write/execute categories are
 *     present so the invariant collapses to its strongest Cursor-native
 *     approximation.
 *   - Codex: exposes a coarse per-subagent `sandbox_mode`; the Codex adapter
 *     emits `read-only` unless the canonical policy explicitly grants write.
 *     Source: https://developers.openai.com/codex/subagents
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
// D2-SA2.4-03 platform-tool currency: verified against
// https://code.claude.com/docs/en/tools-reference (accessed 2026-07-10). When
// the Claude Code tool set drifts, extend BOTH this map AND the emitted hook's
// TOOL_TO_CATEGORY (src/pipeline/agentToolAllowlist.ts) — they are one logical
// table split across two surfaces. The currency lock tests
// (adapterToolTranslator.test.ts + agentToolAllowlist.test.ts) fail when a
// known-current tool stops being emitted/categorized, so drift is caught at
// audit time, not user runtime.
//
// DEFERRED (D2-SA2.4-03 remainder → B1 maintainer decision, see the finding's
// results file): the task/session tools TaskCreate/TaskGet/TaskList/TaskUpdate/
// TaskOutput/TaskStop (TodoWrite is disabled since v2.1.142 in favor of these)
// and `Skill` are intentionally NOT mapped here. They require a product decision
// this implementation cannot self-authorize — whether to introduce a dedicated
// `session` category (ripples through FUNCTIONAL_TOOL_CATEGORIES + the over-grant
// gate + every policy) versus a universal base set, and whether/where to grant
// the privilege-expanding `Skill` tool. Until decided they stay deny-by-default
// (the secure posture). MultiEdit/NotebookRead retained for back-compat rather
// than dropped, to avoid a privilege reduction against older platform builds.
const CLAUDE_CATEGORY_MAP: Readonly<Record<string, readonly string[]>> = {
  read: ["Read", "NotebookRead", "LSP"],
  search: ["Grep", "Glob", "ToolSearch"],
  write: ["Edit", "MultiEdit", "Write", "NotebookEdit"],
  execute: ["Bash", "PowerShell", "EnterWorktree", "ExitWorktree"],
  web: ["WebSearch", "WebFetch"],
  // D2-SA2.4-01 (P3): `mcp` maps to no fixed tool name — the reachable MCP tools
  // are server-specific (`mcp__<server>`/`mcp__<server>__*`), so a static
  // category→name map cannot enumerate them. The per-server grant tokens are
  // appended by {@link mcpServerGrants} from the selected server set the adapter
  // threads in (`ctx.manifest.mcp.servers`). An enumerated `tools:` list
  // otherwise EXCLUDES every MCP tool platform-side
  // (https://code.claude.com/docs/en/sub-agents, accessed 2026-07-10).
  mcp: [],
  // Reserved categories (RESERVED_TOOL_CATEGORIES in agentToolAllowlist.ts):
  // no current policy grants these; they collapse onto execute/mcp here.
  git: ["Bash"], // Reserved. Git is driven via Bash; callers that grant git retain execute semantics.
  board: [], // Reserved. Project-board tooling is MCP-driven; see mcp mapping.
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
  // D2-SA2.4-01 (P3): `mcp` maps to no fixed alias — Copilot MCP tools are named
  // `<server>/<tool>` or `<server>/*`, appended by {@link mcpServerGrants} from
  // the adapter-threaded server set. The `mcp-servers` frontmatter property is
  // NOT read by VS Code/IDE custom agents, so the `tools:` list is the only MCP
  // grant mechanism there
  // (https://docs.github.com/en/copilot/reference/custom-agents-configuration,
  // accessed 2026-07-10).
  mcp: [],
  // Reserved categories (RESERVED_TOOL_CATEGORIES in agentToolAllowlist.ts):
  // no current policy grants these; they collapse onto execute/mcp here.
  // D15-22 (SA15.3-F7, Cycle 11 Wave 3, P6): `git` collapses to `execute`
  // because Copilot's `tools:` array is a tool-level allowlist only — it has no
  // `Bash:<subcommand>` deny primitive (verified 2026-06-09 @
  // https://docs.github.com/en/copilot/reference/custom-agents-configuration),
  // so a source `tools.deny: ["Bash:git commit", ...]` cannot be re-emitted into
  // a finer Copilot grant the way Claude's `Bash:git*` deny list survives. A
  // git-restricted agent therefore receives unrestricted `execute` on Copilot,
  // and the emitted surface installs no PreToolUse runtime gate (Copilot is the
  // only adapter with `hooks: false` in ADAPTER_CAPABILITIES). This gap is
  // disclosed in SECURITY.md -> Allowlist Hybrid Contract (Copilot runtime row).
  git: ["execute"], // Reserved. Collapses to execute semantics (see SECURITY.md Copilot row).
  board: [], // Reserved. Project-board tooling is MCP-driven; no distinct token.
};

// Wave 3 / W1-C: per-adapter category maps for the adapters removed in v1.9.0
// remain gone. Codex has since been restored, using the coarse sandbox resolver
// in `adapters/codexAgents.ts` rather than a native per-tool allowlist.

// ── Public API ─────────────────────────────────────────────────────

export type AdapterName =
  | "claude"
  | "copilot"
  | "cursor"
  | "codex";

/**
 * Translate an agent id's hatch3r policy to the Claude Code `tools:`
 * frontmatter value (comma-separated tool names).
 *
 * Returns `null` when the agent has no registered policy — caller MUST
 * omit the frontmatter field (Claude Code inherits all tools if the
 * field is absent). This is conservative: hatch3r-authored agents all
 * have policies; only user-authored "unknown" agents fall through.
 *
 * D2-SA2.4-01 (P3): when the policy grants the `mcp` category, pass the selected
 * MCP server names in {@link mcpServers} (the adapter's `ctx.manifest.mcp.servers`)
 * so the emitted list names each reachable `mcp__<server>` — without them an
 * enumerated `tools:` list excludes every MCP tool platform-side.
 *
 * @param mcpServers Selected MCP server names, or omit/empty when none are
 *   configured (the mcp-off case is unchanged from before this parameter).
 */
export function toClaudeToolsFrontmatter(
  agentId: string,
  mcpServers?: readonly string[],
): string | null {
  const policy = getAgentToolPolicy(agentId);
  if (!policy) return null;
  const tools = [
    ...resolveNativeTools(policy.allowedTools, CLAUDE_CATEGORY_MAP),
    ...mcpServerGrants(policy.allowedTools, mcpServers, "claude"),
  ];
  if (tools.length === 0) return null;
  return tools.join(", ");
}

/**
 * D20-1 (X5/CD5): translate an explicit hatch3r category list to the Claude
 * Code `tools:` frontmatter value (comma-separated tool names), bypassing the
 * canonical `AGENT_TOOL_POLICIES` registry lookup.
 *
 * Used for user-authored agents whose emitted (re-prefixed) id has no
 * registry entry: the categories come from the agent's authored
 * `tools.allowed` grant (with `tools.denied` already subtracted by the caller)
 * rather than from a registered policy. Routes through the same
 * {@link CLAUDE_CATEGORY_MAP} as {@link toClaudeToolsFrontmatter} so the
 * category→tool-name mapping stays single-source and the monotonic-privilege
 * invariant is preserved.
 *
 * Returns `null` when the resolved set is empty (no categories, or only
 * categories that map to no Claude tool — e.g. `mcp`/`board`), so the caller
 * omits the frontmatter field. NOTE: an empty/`null` Claude `tools:` field
 * means "inherit all tools" upstream; the runtime PreToolUse hook is the
 * authoritative deny gate for these agents (it reads the derived policy from
 * `agent-tool-policies.json`), so the omitted-field case does not widen the
 * effective privilege envelope.
 */
export function toClaudeToolsFrontmatterFromCategories(
  categories: readonly string[],
  mcpServers?: readonly string[],
): string | null {
  const tools = [
    ...resolveNativeTools(categories, CLAUDE_CATEGORY_MAP),
    ...mcpServerGrants(categories, mcpServers, "claude"),
  ];
  if (tools.length === 0) return null;
  return tools.join(", ");
}

/**
 * Translate an agent id's hatch3r policy to a GitHub Copilot
 * `tools: [...]` YAML array value.
 *
 * Returns `null` when the agent has no registered policy.
 */
export function toCopilotToolsFrontmatter(
  agentId: string,
  mcpServers?: readonly string[],
): readonly string[] | null {
  const policy = getAgentToolPolicy(agentId);
  if (!policy) return null;
  const tools = [
    ...resolveNativeTools(policy.allowedTools, COPILOT_CATEGORY_MAP),
    ...mcpServerGrants(policy.allowedTools, mcpServers, "copilot"),
  ];
  return tools.length === 0 ? null : tools;
}

/**
 * D5-39 (Cycle 11 Wave 3, D5, P6): translate an explicit hatch3r category list
 * to the GitHub Copilot `tools: [...]` YAML-array value, bypassing the
 * `AGENT_TOOL_POLICIES` registry lookup.
 *
 * The Copilot twin of {@link toClaudeToolsFrontmatterFromCategories}. Used by
 * the github-agent emission path in `src/adapters/copilot.ts`: github-agents
 * (`type: github-agent`) are simplified cloud-agent definitions with ids
 * outside the canonical `AGENT_TOOL_POLICIES` registry, so the registry-keyed
 * {@link toCopilotToolsFrontmatter} returns `null` for them and they would
 * otherwise ship with NO `tools:` restriction. This helper renders a default
 * category grant the adapter supplies per github-agent role through the same
 * {@link COPILOT_CATEGORY_MAP} so the monotonic-privilege invariant and the
 * category→alias mapping stay single-source.
 *
 * Returns `null` when the resolved set is empty (no categories, or only
 * categories that map to no Copilot alias — e.g. `mcp`/`board`), so the caller
 * omits the frontmatter field.
 */
export function toCopilotToolsFrontmatterFromCategories(
  categories: readonly string[],
  mcpServers?: readonly string[],
): readonly string[] | null {
  const tools = [
    ...resolveNativeTools(categories, COPILOT_CATEGORY_MAP),
    ...mcpServerGrants(categories, mcpServers, "copilot"),
  ];
  return tools.length === 0 ? null : tools;
}

/**
 * Cursor subagent frontmatter does not expose an explicit tool
 * allowlist — the closest analogue is `readonly: true`, which blocks
 * file edits and state-changing shell commands (per Cursor subagents
 * docs at https://cursor.com/docs/agent/subagents, re-verified
 * 2026-05-28 — the documented frontmatter set still lists
 * `name | description | model | readonly | is_background` with
 * `readonly: boolean (default false)` carrying the restricted-write
 * semantics).
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

// Wave 3 / W1-C: per-adapter translator helpers for the 12 removed
// adapters (windsurf, cline, opencode, amazonq, kiro, gemini, plus the
// 6 already coverage="none" platforms) are gone. Only claude/copilot/
// cursor translators remain above. Codex uses the coarse sandbox resolver in
// `adapters/codexAgents.ts` rather than a native per-tool allowlist.

// ── Coverage-limit explainer (C9-H6 / D2-SA2.4-02) ─────────────────
//
// Three adapters have `coverage: "full"`; Codex has `coverage: "partial"`
// because its documented subagent schema exposes a coarse sandbox rather than
// a fine-grained tool list. The matrix below is
// kept as an explicit per-adapter coverage statement so that if a
// future adapter exposes no per-agent allowlist primitive (`coverage:
// "none"`), the translator declines to emit a token rather than guess
// one — guessed names silently widen privilege when the downstream
// runtime rejects them. Each entry records WHY its translator exists
// (or would not) so audit reviewers can validate any future gap is
// platform-imposed, not hatch3r-imposed. P3 freshness: re-verify each
// link per cycle.

/**
 * Per-adapter tool-allowlist coverage matrix surfaced to the operator
 * via the {@link ADAPTER_ALLOWLIST_COVERAGE} table and audit reports.
 *
 * `coverage: "full"`   ⇒ A translator function exists and emits a
 *                         policy-derived allowlist into the adapter's
 *                         generated artifact.
 * `coverage: "partial"`⇒ A conservative coarse permission mapping exists,
 *                         but the platform cannot express every canonical
 *                         tool category independently.
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
  readonly coverage: "full" | "partial" | "none";
  /** Translator export name when coverage is implemented. `null` for `"none"`. */
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
    // D9-M1 (Cycle 10 D9 Wave-3, P3): re-verified 2026-05-28 — subagents
    // docs moved from /docs/agents to /docs/agent/subagents; `readonly`
    // boolean remains the documented restricted-write primitive.
    sourceUrl: "https://cursor.com/docs/agent/subagents",
  },
  {
    adapter: "codex",
    coverage: "partial",
    translator: "resolveCodexAgentSandboxMode",
    rationale: "Codex subagents expose coarse sandbox_mode; hatch3r defaults to read-only unless write is explicitly granted.",
    sourceUrl: "https://developers.openai.com/codex/subagents",
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

// D9-M5 (Cycle 10 D9 Wave-3, P3): per-entry access-date stamps so the
// per-cycle currency mechanism can be audited without grepping the wider
// codebase. Each entry MUST carry a `// verified YYYY-MM-DD @ <docs URL>`
// comment that is refreshed during the D9 per-cycle web-research pass
// (governance/audit/domains/D09-platform-adapters.md SA9.1-9.3 checklist
// item "User-question tool"). Bumping a tool name without updating the
// date stamp is a Medium finding.
const ASK_USER_TOOLS: Readonly<Record<string, AskUserToolEntry | null>> = {
  // verified 2026-06-06 @ https://code.claude.com/docs/en/sub-agents (AskUserQuestion native tool documented).
  // Sub-agent exclusion: AskUserQuestion is the orchestrator/main-conversation question
  // tool; Claude Code filters it out of every Task-tool sub-agent context (foreground and
  // background) regardless of the agent's `tools` declaration, so a spawned hatch3r-* agent
  // cannot call it. Sub-agents instead RETURN Status BLOCKED_AMBIGUITY with the rendered
  // question and the orchestrator owns the live ASK (agents/shared/clarification-default-block.md
  // -> Protocol; agents/shared/quality-charter.md §17). Upstream-confirmed: anthropics/claude-code
  // issues #18721 (docs limitation), #12890, #34592 (verified 2026-06-06).
  claude: { name: "AskUserQuestion" },
  // verified 2026-05-28 @ https://cursor.com/docs/agent/subagents (no native question tool documented; plain-text fallback applies).
  cursor: null,
  // verified 2026-05-28 @ https://docs.github.com/en/copilot/reference/custom-agents-configuration (no native question tool documented; plain-text fallback applies).
  copilot: null,
  // verified 2026-08-09 @ https://learn.chatgpt.com/docs/build-skills (skills are portable instructions; no always-available skill-level question tool is documented).
  codex: null,
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

/**
 * D2-SA2.4-01 (P3): render the platform-native per-server MCP grant tokens for a
 * policy/category set that grants the `mcp` category.
 *
 * An enumerated `tools:` allowlist EXCLUDES every MCP tool it does not name. On
 * Claude Code a sub-agent that declares a `tools:` list "can't use any MCP tools"
 * unless `mcp__<server>` / `mcp__<server>__*` patterns are listed
 * (https://code.claude.com/docs/en/sub-agents, accessed 2026-07-10); on GitHub
 * Copilot MCP tools are named `<server>/<tool>` or `<server>/*`
 * (https://docs.github.com/en/copilot/reference/custom-agents-configuration,
 * accessed 2026-07-10). {@link CLAUDE_CATEGORY_MAP}.mcp / {@link COPILOT_CATEGORY_MAP}.mcp
 * are `[]` because a static category→fixed-name map cannot know which servers an
 * operator selected — so the adapter threads the selected set
 * (`ctx.manifest.mcp.servers`) in here, and this helper emits one whole-server
 * grant per selection (`mcp__<server>` on Claude, `<server>/*` on Copilot).
 *
 * Returns `[]` when the `mcp` category is not granted OR no servers are selected,
 * so a non-mcp agent and an mcp-off project emit exactly what they did before
 * this parameter existed. Duplicate server names are collapsed, selection order
 * is preserved for deterministic output.
 */
function mcpServerGrants(
  categories: readonly string[],
  mcpServers: readonly string[] | undefined,
  style: "claude" | "copilot",
): string[] {
  if (!categories.includes("mcp")) return [];
  if (!mcpServers || mcpServers.length === 0) return [];
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const server of mcpServers) {
    if (!server || seen.has(server)) continue;
    seen.add(server);
    tokens.push(style === "claude" ? `mcp__${server}` : `${server}/*`);
  }
  return tokens;
}
