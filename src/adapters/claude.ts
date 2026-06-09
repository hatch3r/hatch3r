// Last updated: 2026-05-19 (P3 platform-currency anchor; per-claim Anthropic
// docs access dates inside this file remain authoritative for individual
// assertions).
import type { AdapterOutput, CanonicalFile } from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapManagedFor } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext, type CompanionSubdir } from "./base.js";
import { sortByPrecedence, precedenceRank, resolveRuleGlobs } from "./canonical.js";
import { resolveAgentModel } from "../models/resolve.js";
import {
  readMaturityTier,
  maturityDirective,
  readConfidenceFloor,
  confidenceFloorDirective,
} from "../manifest/hatchJson.js";
import { applyCustomization } from "./customization.js";
import { transformEnvVarSyntax, stripPrivateMcpFields, MCP_DEFAULT_PROTOCOL_VERSION } from "./mcp-utils.js";
import {
  toClaudeToolsFrontmatter,
  toClaudeToolsFrontmatterFromCategories,
  toCursorReadonlyFrontmatter,
} from "../pipeline/adapterToolTranslator.js";
import {
  buildAgentToolPoliciesJson,
  buildClaudePreToolUseHookScript,
  deriveUserAgentPolicy,
  type AgentToolPolicy,
} from "../pipeline/agentToolAllowlist.js";
import type { HookDefinition, HookEvent } from "../hooks/types.js";
import { HATCH3R_VERSION } from "../version.js";

/**
 * C9-M47 (D6-SA6.4, P7 Speed & Token Efficiency): cache-breakpoint sentinel.
 *
 * Emitted as a paired HTML comment at the start and end of every Claude
 * adapter managed-block payload (CLAUDE.md, .claude/rules/*.md,
 * .claude/agents/*.md, .claude/skills/*\/SKILL.md, .claude/commands/*.md,
 * .claude/commands/hatch3r-agent-team.md).
 *
 * The sentinel marks the deterministic, hatch3r-managed prefix as a stable
 * diff boundary: a static marker on both sides of the managed block lets
 * operators (and sync tooling) detect whether the hatch3r-managed region
 * changed across syncs without scanning the entire file body.
 *
 * D6-SA6.6-F3 (Cycle 10, P5): these markers have NO runtime effect on prompt
 * caching. Anthropic prompt caching is an API-level feature applied via the
 * `cache_control` field on system/tools/messages content blocks
 * (platform.claude.com/docs/en/build-with-claude/prompt-caching, accessed
 * 2026-05-28); an HTML comment inside rendered CLAUDE.md / rules content
 * cannot reach that request layer, and Claude Code memory docs
 * (code.claude.com/docs/en/memory, accessed 2026-05-28) document no scanner
 * that translates these markers into `cache_control`. The defensible value
 * is the diff-boundary use above.
 *
 * Format is a balanced pair (`-START`/`-END`) so consumers can split on the
 * outer markers without ambiguity when both appear in the same emitted file.
 * The base sentinel `<!-- HATCH3R-CACHE-BREAKPOINT -->` is exported for
 * tooling that wants to scan for the breakpoint family without caring which
 * end of the block it sits at.
 *
 * The sentinel is a markdown comment so it is invisible in rendered output
 * and idempotent under the managed-block trim pass — the symmetric
 * leading/trailing whitespace contract of the managed-block helpers is
 * preserved.
 */
export const CACHE_BREAKPOINT_SENTINEL = "<!-- HATCH3R-CACHE-BREAKPOINT -->";
export const CACHE_BREAKPOINT_SENTINEL_START = "<!-- HATCH3R-CACHE-BREAKPOINT-START -->";
export const CACHE_BREAKPOINT_SENTINEL_END = "<!-- HATCH3R-CACHE-BREAKPOINT-END -->";

/**
 * F6.6-H1 (Cycle 10, D6, P7): map a canonical rule `scope` to Claude Code's
 * `.claude/rules/` `paths:` frontmatter so glob-scoped rules lazy-load only
 * when Claude reads a matching file, instead of loading every scoped rule
 * body unconditionally at session start.
 *
 * Claude Code primitive (code.claude.com/docs/en/memory#path-specific-rules,
 * accessed 2026-05-27): "Rules can be scoped to specific files using YAML
 * frontmatter with the `paths` field. These conditional rules only apply
 * when Claude is working with files matching the specified patterns. Rules
 * without a `paths` field are loaded unconditionally."
 *
 * Mapping mirrors the cursor `globs:` / copilot `applyTo:` scope transform
 * already in `cursor.ts::cursorRuleFrontmatter` and `copilot.ts`, resolved
 * through the shared `resolveRuleGlobs` helper:
 *   - `scope: always`                          -> "" (omit `paths:`; load unconditionally)
 *   - `scope: conditional` + `globs: "<csv>"`  -> `paths: ["g1", "g2", ...]` (flow array)
 *   - `scope: "<csv>"` (legacy inline CSV)     -> `paths: ["g1", "g2", ...]`
 *   - `scope: conditional` with no `globs:`    -> "" (no patterns; load unconditionally)
 *   - absent / empty                           -> "" (no glob shape; load unconditionally)
 *
 * X4/CD4 (D6-1/D9-1/D11-1 — GLOBS DROP): the previous implementation returned
 * "" for `scope === "conditional"` outright, so every canonical
 * `scope: conditional` rule (52/65 of them, incl. `floor:security` /
 * `precedence: critical` `hatch3r-security-patterns`) emitted NO `paths:`
 * frontmatter and loaded unconditionally at session start — the real patterns
 * in the `globs:` field were never read. Routing through `resolveRuleGlobs`
 * pulls those patterns so the rule lazy-loads only on matching file reads, per
 * Claude Code's documented `paths` primitive.
 *
 * Returns the frontmatter block (including the `---` fences and a trailing
 * newline) ready to prepend to the rule body, or "" when no `paths:` applies.
 * The flow-sequence form (`["a", "b"]`) is valid YAML and matches the
 * single-line frontmatter rendering the cursor/copilot adapters already use.
 */
function claudeRulePathsFrontmatter(
  rule: Pick<CanonicalFile, "scope" | "globs">,
  scopeOverride?: string,
): string {
  const globs = resolveRuleGlobs(rule, { scope: scopeOverride });
  if (globs.length === 0) return "";
  const arr = globs.map((g) => `"${g}"`).join(", ");
  return `---\npaths: [${arr}]\n---\n`;
}

/**
 * Wrap a body string with the cache-breakpoint sentinel pair so the entire
 * payload sits inside a deterministic, fingerprintable region. Idempotent:
 * a body that already contains both sentinels is returned unchanged so
 * nested calls (e.g. post-processing helpers already wrapped upstream)
 * do not produce duplicated markers.
 */
function withCacheBreakpoints(body: string): string {
  if (
    body.includes(CACHE_BREAKPOINT_SENTINEL_START) &&
    body.includes(CACHE_BREAKPOINT_SENTINEL_END)
  ) {
    return body;
  }
  return `${CACHE_BREAKPOINT_SENTINEL_START}\n${body}\n${CACHE_BREAKPOINT_SENTINEL_END}`;
}

/**
 * C9-M47 (P7): re-wrap an `AdapterOutput` produced by the cross-adapter
 * helpers (`processSkillsRawCliFiltered`, `processCommandsRaw`) so the
 * Claude adapter's managed-block payload carries the cache-breakpoint
 * sentinels without disturbing the shared base helpers.
 *
 * Strategy: take the existing `managedContent` (the raw body the helper
 * passed to the managed-block wrapper), wrap it with sentinels, and rebuild
 * the full file `content` via `wrapManagedFor(out.path, …)`. Routing through
 * the path-mandatory helper (D11-SA11.2-F8) keeps the marker variant correct
 * for the output's extension even though every `.claude/` output is markdown
 * today. Outputs without `managedContent` (no managed block) pass through
 * unchanged.
 */
function rewrapWithCacheBreakpoints(out: AdapterOutput): AdapterOutput {
  if (!out.managedContent) return out;
  const wrappedBody = withCacheBreakpoints(out.managedContent);
  return {
    ...out,
    content: wrapManagedFor(out.path, wrappedBody),
    managedContent: wrappedBody,
  };
}

const AGENT_TEAMS_SECTION = [
  "## Agent Teams",
  "",
  "This project uses hatch3r's 4-phase sub-agent pipeline (Research -> Implement -> Review -> Quality)",
  "which maps directly to Claude Code Agent Teams. Each phase becomes a teammate role.",
  "",
  "### Enabling Agent Teams",
  "",
  "Agent Teams is experimental in Claude Code v2.1.32+ (re-verified 2026-05-28 against",
  "https://code.claude.com/docs/en/agent-teams — \"Agent teams are experimental and disabled by default. Enable",
  "them by adding CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS to your settings.json or environment.\"). Hatch3r emits",
  "the env var into `.claude/settings.json` so the feature is available; set `claude.agentTeams: false` in",
  "`.hatch3r/hatch.json` to suppress the flag if you do not want Agent Teams enabled. Request a team in the",
  "prompt:",
  "",
  "```",
  'Create an agent team for this task. Use the hatch3r 4-phase pipeline.',
  "```",
  "",
  "### Teammate Display Modes",
  "",
  "Agent Teams supports two display modes configured via `teammateMode` in `.claude/settings.json`:",
  "",
  '- `"auto"` (default): uses split panes if inside tmux, in-process otherwise.',
  '- `"in-process"`: all teammates run inside your main terminal. Use Shift+Down to cycle.',
  '- `"tmux"`: each teammate gets its own pane. Requires tmux or iTerm2.',
  "",
  "### Pipeline-to-Team Mapping",
  "",
  "| Phase | Teammate Role | hatch3r Agents | Delegation Notes |",
  "|-------|--------------|----------------|------------------|",
  "| **1 — Research** | `researcher` | `hatch3r-researcher`, `hatch3r-learnings-loader` | Read-only; shares findings via task list |",
  "| **2 — Implement** | `implementer` | `hatch3r-implementer` | Require plan approval for complex tasks |",
  "| **3 — Review** | `reviewer` | `hatch3r-reviewer`, `hatch3r-fixer` | Review loop: reviewer finds issues, fixer resolves them |",
  "| **4 — Quality** | `quality-*` (parallel) | `hatch3r-testability`, `hatch3r-security`, `hatch3r-docs-writer`, `hatch3r-lint-fixer`, `hatch3r-ui`, `hatch3r-ux`, `hatch3r-reliability`, `hatch3r-scalability`, `hatch3r-performance`, `hatch3r-maintainability`, `hatch3r-enhancability` | Spawn in parallel; each owns distinct files |",
  "",
  "### Spawn Prompt Template",
  "",
  "When creating a team, use explicit file boundaries and role assignments:",
  "",
  "```",
  "Create an agent team with these roles:",
  "1. researcher — gather context from src/ and docs/. Read-only, no code changes.",
  "   Share findings via the task list.",
  "2. implementer — implement changes in {target directories}.",
  "   Require plan approval before making changes.",
  "3. reviewer — review the implementer's changes for correctness, style, and security.",
  "   Post findings to the task list.",
  "4. testability — write tests for the implemented changes in {test directories}.",
  "5. security — audit changes for security vulnerabilities. Read-only.",
  "```",
  "",
  "### Delegation Rules",
  "",
  "- **Researcher before implementer**: Block implementer tasks on researcher completion.",
  "  The lead should not approve the implementer's plan until researcher findings are posted.",
  "- **Reviewer in loop**: After implementation, the reviewer teammate inspects changes.",
  "  If critical issues are found, message the implementer directly to fix them.",
  "- **Quality in parallel**: Once review is clean, spawn quality teammates simultaneously.",
  "  Each quality teammate owns a distinct concern (tests, security, docs) to avoid conflicts.",
  "- **Plan approval**: Require plan approval for the implementer teammate to ensure",
  "  the implementation approach aligns with researcher findings before any code is written.",
  "",
  "### Quality Gate Hooks",
  "",
  "The `TaskCompleted` and `TeammateIdle` hooks in `.claude/settings.json` enforce the pipeline:",
  "",
  "- `TaskCompleted` validates that completed tasks meet review criteria before marking done.",
  "- `TeammateIdle` checks whether idle teammates can pick up pending quality-phase tasks.",
  "",
  "### Important Notes",
  "",
  "- Teammates read this `CLAUDE.md` automatically — all hatch3r instructions apply to every teammate.",
  "- Teammates do **not** inherit conversation history; include full task context in spawn prompts.",
  "- Assign explicit file boundaries to avoid edit conflicts between teammates.",
  "- Use the `hatch3r-agent-team` command (`/hatch3r-agent-team`) for guided team creation.",
];

/** Minimal version of Agent Teams section -- essential mapping only, no prose. */
const AGENT_TEAMS_SECTION_MINIMAL = [
  "## Agent Teams",
  "",
  "Pipeline maps to Claude Code Agent Teams (experimental in v2.1.32+; requires CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1, emitted by hatch3r unless disabled via claude.agentTeams: false).",
  "",
  "| Phase | Role | Agents |",
  "|-------|------|--------|",
  "| Research | `researcher` | `hatch3r-researcher` |",
  "| Implement | `implementer` | `hatch3r-implementer` |",
  "| Review | `reviewer` | `hatch3r-reviewer`, `hatch3r-fixer` |",
  "| Quality | `quality-*` | `hatch3r-testability`, `hatch3r-security`, + conditional CQ specialists |",
  "",
  "Use `/hatch3r-agent-team` for guided team creation.",
];

const AGENT_TEAM_COMMAND = `# hatch3r Agent Team

Create a Claude Code Agent Team that follows the hatch3r 4-phase pipeline.

## Usage

Describe the task when invoking this command. The team will be structured according
to the hatch3r pipeline: Research → Implement → Review → Quality.

## Team Structure

Set up an Agent Team with these roles based on the task described above:

### Phase 1 — Research (read-only)

Spawn a \`researcher\` teammate:
- Read the codebase to understand context, patterns, and conventions
- Identify affected files and blast radius
- Share findings via the shared task list
- Do NOT modify any files

### Phase 2 — Implement (requires plan approval)

Spawn an \`implementer\` teammate after the researcher completes:
- Review the researcher's findings from the task list before planning
- Create a plan and submit for approval before writing code
- Implement changes within the assigned file boundaries
- Mark implementation tasks complete when done

### Phase 3 — Review

Spawn a \`reviewer\` teammate after implementation:
- Review all changes made by the implementer
- Post findings (Critical/Warning/Info) to the task list
- If Critical or Warning findings exist, message the implementer to fix
- Re-review after fixes; repeat up to 3 iterations

### Phase 4 — Quality (parallel)

After review is clean, spawn quality teammates in parallel:
- \`test-writer\` — write/update tests for the changes
- \`security-auditor\` — audit for security vulnerabilities (read-only)
- \`docs-writer\` — update documentation if APIs or behavior changed

Each quality teammate owns distinct files to avoid conflicts.

## Task Dependencies

- implementer depends on researcher
- reviewer depends on implementer
- quality teammates depend on reviewer (clean review)

## Important

- Teammate display mode is configured in \`.claude/settings.json\` via \`teammateMode\` (\`auto\`, \`in-process\`, or \`tmux\`)
- Override for a single session: \`claude --teammate-mode in-process\`
- Each teammate reads CLAUDE.md and inherits project rules automatically
- Assign explicit file/directory boundaries to each teammate
- The lead coordinates; it should NOT implement code itself (use delegate mode)
`;

// Claude Code hooks use an event+matcher pattern, not direct git hook names.
// Each hook fires on a Claude event (e.g. PreToolUse, PostToolUse, SessionStart)
// paired with a matcher whose meaning is EVENT-SPECIFIC: PreToolUse/PostToolUse
// match tool names; SessionStart matches the session source; SubagentStart
// matches the agent type; Stop ignores its matcher entirely
// (code.claude.com/docs/en/hooks → "What the matcher filters", accessed
// 2026-06-05).
//
// D9-10 (Cycle 11 Wave 3, D9, P3): every entry in the two maps below
// (mapToClaudeEvent, getClaudeToolMatcher) was re-verified 2026-06-09 against
// code.claude.com/docs/en/hooks. The live ~30-event catalogue
// (PreToolUse/PostToolUse/PostToolUseFailure/SessionStart/SubagentStart/
// SubagentStop/Stop/StopFailure/TaskCreated/InstructionsLoaded/WorktreeCreate/
// WorktreeRemove/…) confirms each mapped target still exists with the same
// trigger semantics; the Stop-vs-StopFailure choice for review-loop-cap is
// recorded inline at its mapping line. The capability-seed detail string in
// capabilityMatrix.ts (PLATFORM_CAPABILITY_SEED.claude hooks row) mirrors the
// same re-verification date.
//
// Events with no native Claude hook surface (ADVISORY_ONLY_EVENTS below) are
// NOT emitted into settings.json — they would either never fire or fire on
// every occurrence of an unrelated trigger. They are surfaced as advisory
// CLAUDE.md notes instead (parity with Cursor's .mdc-only and Copilot's
// no-hook-surface paths for the same events).
//
// Mapping from hatch3r canonical hook events to Claude Code hook semantics:
//   pre-commit    -> PreToolUse  + matcher "Bash"    (intercept before shell commands)
//   post-merge    -> PostToolUse + matcher "Bash"    (the activation command gates on a
//                                                      `git merge` substring in the tool
//                                                      input, so it fires only on a real
//                                                      merge — not on every Bash call;
//                                                      D5-14)
//   file-save     -> PostToolUse + matcher "Write"   (react after file writes)
//   session-start -> SessionStart + matcher "startup" (session-SOURCE matcher per the
//                                                      SessionStart table; "startup" =
//                                                      new session. A tool matcher like
//                                                      ".*" was a no-op here; D5-13)
//   pre-push      -> PreToolUse  + matcher "Bash"    (intercept before shell commands)
//   worktree-create -> WorktreeCreate (no matcher support — always fires)
//   worktree-remove -> WorktreeRemove (no matcher support — always fires)
//   review-loop-cap -> Stop          (Stop ignores its matcher; the scope lives in the
//                                      hook command, which reads the `.review-loop.json`
//                                      counter — D5-13)
// ci-failure is advisory-only: Claude Code has NO native event for an external
// CI pipeline failure (code.claude.com/docs/en/hooks, accessed 2026-06-05 —
// "No native events exist for external CI pipeline failures"). The prior
// SubagentStart+"Bash" mapping was DEAD: SubagentStart matches AGENT TYPES, not
// tool names, so "Bash" matched nothing and the ci-watcher never activated
// (D5-14, D9-2, D11-10). The closest native event, StopFailure, fires on a
// Claude API error — not external CI — so re-mapping there would mislead;
// ci-failure is emitted as guidance instead.

/** Canonical hook events with no native Claude Code hook surface (D9-2). */
const ADVISORY_ONLY_EVENTS: ReadonlySet<HookEvent> = new Set<HookEvent>(["ci-failure"]);

/** Events that DO map to a native Claude Code hook (the complement of {@link ADVISORY_ONLY_EVENTS}). */
type NativeHookEvent = Exclude<HookEvent, "ci-failure">;

function mapToClaudeEvent(event: NativeHookEvent): string {
  const mapping: Record<NativeHookEvent, string> = {
    "pre-commit": "PreToolUse",
    "post-merge": "PostToolUse",
    "file-save": "PostToolUse",
    "session-start": "SessionStart",
    "pre-push": "PreToolUse",
    "worktree-create": "WorktreeCreate",
    "worktree-remove": "WorktreeRemove",
    // D9-10 (Cycle 11 Wave 3, D9, P3): Stop-vs-StopFailure re-evaluation.
    // `Stop` = "When Claude finishes responding"; `StopFailure` = "When the
    // turn ends due to an API error" (code.claude.com/docs/en/hooks, re-verified
    // 2026-06-09). The review-loop cap must fire when a normal turn completes so
    // the `.review-loop.json` counter advances on every reviewer/fixer round —
    // NOT on a transport-layer API error. `Stop` is therefore correct;
    // re-mapping to `StopFailure` would only fire the cap on API failures and
    // never on a clean review round. `Stop` ignores its matcher (same source),
    // so the loop scope stays in the hook command, not the matcher.
    "review-loop-cap": "Stop",
  };
  // D9-L-3 (Cycle 10, P5): no `|| event` fallback. `mapping` is typed
  // Record<NativeHookEvent, string>, so a future native HookEvent added to the
  // closed union (src/hooks/types.ts) without a branch here fails the
  // Record-literal completeness check at compile time — fail-loud rather than
  // silently emitting an unmapped canonical event name Claude Code would not
  // recognise. Advisory-only events (ci-failure) are filtered out before this
  // function is reached, so the narrowed key set is exhaustive.
  return mapping[event];
}

function getClaudeToolMatcher(hook: HookDefinition & { event: NativeHookEvent }): string {
  const eventToolMap: Record<NativeHookEvent, string> = {
    "pre-commit": "Bash",
    "post-merge": "Bash",
    "file-save": "Write",
    // SessionStart honors a session-SOURCE matcher, not a tool matcher
    // (code.claude.com/docs/en/hooks: startup | resume | clear | compact).
    // "startup" fires the learnings-loader on a new session; the prior ".*"
    // tool matcher was meaningless for this event (D5-13).
    "session-start": "startup",
    "pre-push": "Bash",
    // Worktree events have no matcher support (always fire); ".*" is a
    // harmless placeholder the runtime ignores.
    "worktree-create": ".*",
    "worktree-remove": ".*",
    // Stop ignores its matcher entirely (code.claude.com/docs/en/hooks:
    // "no matcher support — always fires"). The fixer-spawn scope lives in the
    // review-loop-cap hook command (reads `.review-loop.json`), not here.
    "review-loop-cap": ".*",
  };
  // D9-L-3 (Cycle 10, P5): no `|| ".*"` fallback — Record<NativeHookEvent,
  // string> completeness is the fail-loud gate (see mapToClaudeEvent above).
  return eventToolMap[hook.event];
}

/**
 * D15-3 (Cycle 11, P6 / ASI02-03): re-emit a canonical agent's literal
 * short-form `tools.deny` envelope into the generated Claude subagent file.
 *
 * The canonical agents `hatch3r-devops`, `hatch3r-dependency-drafter`, and
 * `hatch3r-pack-installer` author a fine-grained `tools: { allow, deny }`
 * grant whose deny list mixes two shapes:
 *   - Top-level Claude tool names (`Write`, `Edit`, `MultiEdit`, `Bash`).
 *   - Granular `Bash:<subcommand>` strings (`"Bash:git commit"`,
 *     `"Bash:git push"`, `"Bash:terraform apply"`).
 *
 * Pre-fix this list was parsed and then dropped — the Claude agent file
 * rebuilt its frontmatter from the coarse policy-derived `tools:` allowlist
 * only, so the per-agent deny was never honored (SA15.3-F1). Claude Code's
 * subagent frontmatter exposes two enforcement surfaces
 * (code.claude.com/docs/en/sub-agents, accessed 2026-06-05):
 *   - `disallowedTools:` — a denylist of TOP-LEVEL tool names removed from the
 *     inherited/allowed set. This is the native, enforced home for the bare
 *     `Write`/`Edit`/`MultiEdit` denies.
 *   - The subagent `tools:`/`disallowedTools:` fields take top-level tool
 *     names ONLY; granular `Bash(<subcommand>:*)` rules are a settings.json
 *     `permissions` primitive (code.claude.com/docs/en/settings, accessed
 *     2026-06-05), which is session-global, not per-subagent. To scope the
 *     deny to THIS agent only (not every session) and avoid a global blast
 *     radius, the granular `Bash:<subcommand>` denies are surfaced as a `## Tool
 *     Restrictions` constraint block in the agent body (the subagent reads
 *     its own definition; the model honors the documented boundary — parity
 *     with how Cursor carries the same restriction as `readonly` + prose).
 *
 * Returns the top-level `disallowedTools` list and the rendered constraint
 * block. Either may be empty: an agent with only granular denies yields no
 * `disallowedTools`; an agent with only top-level denies yields no block.
 */
function deriveAgentDenyEmission(
  agent: Pick<CanonicalFile, "toolsAllowRaw" | "toolsDenyRaw">,
): { disallowedTools: string[]; restrictionsBlock: string } {
  const deny = agent.toolsDenyRaw ?? [];
  const allow = agent.toolsAllowRaw ?? [];
  // Top-level tokens carry no `:` scope; granular tokens are `Bash:<sub>`.
  const topLevelDeny = deny.filter((t) => !t.includes(":"));
  const granularDeny = deny.filter((t) => t.includes(":"));
  const granularAllow = allow.filter((t) => t.includes(":"));

  let restrictionsBlock = "";
  if (granularDeny.length > 0 || granularAllow.length > 0) {
    const lines = [
      "## Tool Restrictions",
      "",
      "This agent's `tools.allow`/`tools.deny` grant scopes shell access to specific",
      "subcommands. Claude Code subagent frontmatter `tools:`/`disallowedTools:` accept",
      "top-level tool names only, so the per-subcommand boundary below is honored at the",
      "model layer — do not run a denied command even when `Bash` is otherwise available.",
      "",
    ];
    if (granularAllow.length > 0) {
      lines.push("**Allowed shell subcommands:**", "");
      for (const t of granularAllow) lines.push(`- \`${t}\``);
      lines.push("");
    }
    if (granularDeny.length > 0) {
      lines.push("**Denied shell subcommands (never run):**", "");
      for (const t of granularDeny) lines.push(`- \`${t}\``);
      lines.push("");
    }
    restrictionsBlock = lines.join("\n").trimEnd();
  }

  return { disallowedTools: topLevelDeny, restrictionsBlock };
}

/**
 * D9-3 (Cycle 11, P3 model resolution + P5 silent-failure): the Claude Code
 * subagent `model:` frontmatter field accepts ONLY a Claude-recognizable
 * value — one of the aliases `sonnet | opus | haiku`, a full `claude-` model
 * ID, or `inherit` (code.claude.com/docs/en/sub-agents#choose-a-model,
 * accessed 2026-06-05: "Model to use: `sonnet`, `opus`, `haiku`, a full model
 * ID (for example, `claude-opus-4-8`), or `inherit`. Defaults to `inherit`").
 *
 * Pre-fix the adapter wrote ANY resolved model string into the native field,
 * including cross-provider IDs (`gpt-4`, `gemini-3-flash`, or an alias-expanded
 * `gpt-5.3-codex` from `models.default: codex`). Claude Code rejects an
 * unknown model ID — it either hard-errors on subagent spawn or silently falls
 * back to the default (real issues anthropics/claude-code#31069 / #1434 /
 * #5108) — so the field was a silent-failure surface, not an authoritative
 * preference. Gate native emission to recognizable values; a non-Claude model
 * is surfaced only as advisory `## Recommended Model` prose (the operator can
 * still wire it via env/`/model` if their session targets a non-Anthropic
 * gateway), never as the native field Claude would reject.
 */
function isClaudeRecognizableModel(model: string): boolean {
  return (
    model === "sonnet" ||
    model === "opus" ||
    model === "haiku" ||
    model === "inherit" ||
    /^claude-/.test(model)
  );
}

/**
 * D9-11 (Cycle 11 Wave 3, D9, P3): map the existing read-only-role policy
 * semantic to Claude Code's native subagent `permissionMode:` frontmatter,
 * closing one leg of the Decision-21 native-field gap (the Claude subagent
 * frontmatter previously emitted only `description`/`tools`/`disallowedTools`/
 * `model`, leaving `permissionMode`/`mcpServers`/`maxTurns`/`skills`/`memory`
 * documented-but-unused).
 *
 * Source semantic (NOT a new judgment call): an agent whose AGENT_TOOL_POLICIES
 * grant lacks both `write` and `execute` is already a read-only role — the same
 * condition the Cursor adapter uses to emit `readonly: true`
 * (`adapterToolTranslator.ts::toCursorReadonlyFrontmatter`, consumed at
 * cursor.ts). Claude Code's analog is `permissionMode: plan` — "Plan mode
 * (read-only exploration)" (code.claude.com/docs/en/sub-agents#permission-modes,
 * accessed 2026-06-09) — so a readonly policy on Cursor and a plan-mode subagent
 * on Claude express the same restriction. This covers `hatch3r-researcher`,
 * `hatch3r-reviewer`, the 9 CQ specialists + `hatch3r-edge-case-analyst`,
 * `hatch3r-context-rules`, `hatch3r-learnings-loader`, and `hatch3r-handoff-loader`
 * (all `read`+`search` only).
 *
 * Returns `"plan"` for a readonly canonical policy, else `undefined` (field
 * omitted → the subagent inherits the parent permission mode). `undefined` is
 * also returned for a user agent (no canonical policy row) and for any agent the
 * policy grants `write` or `execute` (`hatch3r-implementer`, `hatch3r-fixer`,
 * `hatch3r-architect`, the spec/devops/pack/incident/dependency agents): forcing
 * `plan` on a writer would block the file edits its policy authorizes, a
 * regression — so this stays gated on the readonly signal only.
 *
 * The field is honored because hatch3r ships subagents into the project
 * `.claude/agents/` directory; `permissionMode` is ignored ONLY for plugin
 * subagents (same source), which is not the emission path here.
 *
 * Deferred to a CL-2 content-gap candidate (per the D9-11 fix's "spawn as a
 * CL-2 candidate" directive): the remaining native fields need per-agent design
 * rather than a one-line policy derivation — `mcpServers:` scoping for
 * `hatch3r-researcher` (which servers, and whether to inline vs reference),
 * `memory: project` for `hatch3r-learnings-loader` (which also auto-enables
 * Write/Edit, in tension with that agent's readonly policy + the plan mode set
 * here — the conflict is the design question), `maxTurns` ceilings, and `skills:`
 * preload lists. Those are intentionally NOT emitted in this wave.
 */
function claudePermissionMode(agentId: string): "plan" | undefined {
  return toCursorReadonlyFrontmatter(agentId) === true ? "plan" : undefined;
}

/**
 * D12-1 (Cycle 11 Wave 2, D12, P2): single-canonical-source attribution for a
 * per-file Claude output (one rule `.md`, one agent `.md`). Returns
 * `[file.sourcePath]` so the output self-attributes to its one canonical input
 * instead of inheriting the adapter-wide read set; `undefined` for a
 * synthesised fixture whose `sourcePath` is empty.
 */
function claudeSingleSource(file: CanonicalFile): string[] | undefined {
  return file.sourcePath ? [file.sourcePath] : undefined;
}

/**
 * D14-9 (D14, P3 / Decision 16): per-tier maturity header for the Claude
 * adapter, closing the parity gap with `cursor.ts::cursorMaturityHeader` and
 * `copilot.ts`'s `> hatch3r: right-size to maturity=<tier>` blockquote.
 *
 * Pre-fix the Claude adapter emitted no maturity signal: a CLAUDE.md generated
 * at `enterprise` was byte-identical to one generated at `solo`, so the
 * declared tier never reached the agent that reads CLAUDE.md as memory. The
 * tier resolves through {@link readMaturityTier} (absence collapses to
 * `"solo"`) and is stamped once at the top of the CLAUDE.md managed-block
 * payload — the most authoritative runtime surface, mirroring the Copilot
 * instructions-file placement rather than Cursor's per-rule-body placement.
 *
 * The marker is a markdown HTML comment (like the cache-breakpoint sentinels
 * in this same file) so it renders invisibly in Claude Code's memory view
 * while remaining greppable for drift checks. The directive text matches the
 * Cursor/Copilot wording (right-sizing instruction + universal-floor caveat +
 * `rules/hatch3r-right-sizing.md` pointer) so the calibration signal is
 * identical across all three adapters.
 */
function claudeMaturityHeader(ctx: AdapterContext): string {
  // D6-29 (Cycle 11 Wave 3): wrap the shared directive payload (single source in
  // hatchJson.ts::maturityDirective) in an HTML comment so it renders invisibly
  // in Claude Code's memory view while staying greppable for drift checks.
  return `<!-- ${maturityDirective(readMaturityTier(ctx.manifest))} -->`;
}

/**
 * D1-17 (Cycle 11 Wave 3, D1, P1): confidence-floor marker for CLAUDE.md, the
 * agent-assertiveness analog of {@link claudeMaturityHeader}. Wraps the shared
 * `confidenceFloorDirective` payload (single source in hatchJson.ts) in an HTML
 * comment so the resolved floor ({@link readConfidenceFloor}) renders invisibly
 * in Claude Code's memory view while staying greppable. Pre-fix the persisted
 * `confidenceFloor` config key reached no adapter output.
 */
function claudeConfidenceFloorHeader(ctx: AdapterContext): string {
  return `<!-- ${confidenceFloorDirective(readConfidenceFloor(ctx.manifest))} -->`;
}

export class ClaudeAdapter extends BaseAdapter {
  readonly name = "claude";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];
    const minimal = this.isMinimal(ctx);

    const bridgeOrchestration = await this.bridgeOrchestration(ctx);
    const teamsSection = minimal ? AGENT_TEAMS_SECTION_MINIMAL : AGENT_TEAMS_SECTION;
    // D14-9 (D14, P3 / Decision 16): stamp the resolved maturity tier at the
    // top of the CLAUDE.md payload (both minimal and standard) so the declared
    // tier travels with the artifact — pre-fix CLAUDE.md was byte-identical
    // across tiers. Parity with cursor.ts/copilot.ts maturity headers.
    const maturityHeader = claudeMaturityHeader(ctx);
    // D1-17 (D1, P1): stamp the resolved confidence floor next to the maturity
    // marker so the configured agent-assertiveness floor travels with CLAUDE.md
    // (was a write-only config key that reached no adapter output).
    const confidenceFloorHeader = claudeConfidenceFloorHeader(ctx);
    const innerParts = minimal
      ? [
          "",
          maturityHeader,
          confidenceFloorHeader,
          "",
          "# Hatch3r Project Instructions",
          "",
          "Instructions inlined below. Rules: `.claude/rules/`. Agents: `.claude/agents/`. Skills: `.claude/skills/`. Commands: `.claude/commands/`.",
          "",
          bridgeOrchestration,
          "",
          ...teamsSection,
          "",
        ]
      : [
          "",
          maturityHeader,
          confidenceFloorHeader,
          "",
          "# Hatch3r Project Instructions",
          "",
          "Canonical agent orchestration is inlined in this file.",
          "Rules are managed in `.claude/rules/`, agents in `.claude/agents/`, skills in `.claude/skills/`, commands in `.claude/commands/`.",
          "",
          bridgeOrchestration,
          "",
          ...teamsSection,
          "",
          "## Personal Settings",
          "",
          "Create `CLAUDE.local.md` for personal settings (not committed to git).",
          "Claude Code reads this file for user-specific preferences.",
          "",
          "## Getting Started with Claude Code",
          "",
          "New to this project's agent setup? Progress through these stages:",
          "",
          "**Start here:** Rules in `.claude/rules/` are loaded automatically. The orchestration bridge above guides your workflow.",
          "**Next:** Use `/hatch3r-feature-plan` or `/hatch3r-bug-plan` commands for guided workflows.",
          "**Then:** Delegate to agents in `.claude/agents/` — use Agent Teams for parallel execution.",
          "**Later:** Customize agent behavior via `.hatch3r/{type}/{id}.customize.yaml` without editing managed files.",
          "",
        ];
    // C9-M47 (P7): wrap inner content with cache-breakpoint sentinels before
    // emission so the hatch3r-managed prefix has a deterministic diff boundary
    // across syncs (diff-boundary purpose only — see the sentinel definition
    // comment re: caching being API-only).
    const innerContent = withCacheBreakpoints(innerParts.join("\n"));
    results.push(output("CLAUDE.md", wrapManagedFor("CLAUDE.md", innerContent), innerContent));

    if (ctx.features.rules) {
      // C9-H39 (D11-SA11.1-01): use the BaseAdapter-tracked read wrapper so
      // every canonical rule consumed here is recorded in
      // `this._trackedSourceFiles` and surfaces on each output's
      // `sourceFiles` field. Direct `readCanonicalFiles` calls bypass the
      // provenance tracker introduced by C8-D12-M3.
      const rules = await this.readTrackedCanonicalFiles(ctx.canonicalRoot, "rules", ctx.userRepoRoot);
      // Wave B3: precedence-ordered emission + NN- numeric filename prefix on
      // .claude/rules/. critical=10, high=30, normal=50, low=70. Claude Code
      // loads rule files alphabetically; the prefix makes load order explicit.
      const sortedRules = sortByPrecedence(rules);
      for (const rule of sortedRules) {
        // C9-H20 (D8-H8.3.1): cooperative abort check between rule files
        // so a phase/adapter timeout cancels the per-rule loop without
        // waiting for the remaining files to finish customisation.
        this.throwIfAborted(ctx);
        const { content: rawContent, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, rule);
        this.warnings.push(...warnings);
        if (skip) continue;
        // C9-H47 (D14-SA14.4-H01): substitute detected toolchain tokens.
        const content = this.substituteDetectedRepoTokens(rawContent, ctx);
        const desc = overrides.description ?? rule.description;
        const rawBody = minimal
          ? `# ${rule.id}\n\n${this.stripMinimal(content)}`
          : `# ${rule.id}\n\n${desc}\n\n${content}`;
        // C9-M47 (P7): cache-breakpoint sentinels wrap every rule body so the
        // managed-block payload has a stable diff boundary across syncs.
        const body = withCacheBreakpoints(rawBody);
        const nn = precedenceRank(rule.precedence) / 10;
        // F6.6-H1 (D6, P7): prepend Claude Code `paths:` frontmatter for
        // glob-scoped rules so they lazy-load on matching file reads instead
        // of loading every scoped body at session start. `scope: always` and
        // unscoped rules emit no frontmatter (load unconditionally), matching
        // Claude Code's documented default. Customization-layer scope override
        // takes precedence over canonical scope (parity with cursor.ts).
        const pathsFm = claudeRulePathsFrontmatter(rule, overrides.scope);
        const rulePath = `.claude/rules/${nn}-${toPrefixedId(rule.id)}.md`;
        results.push(
          output(
            rulePath,
            `${pathsFm}${wrapManagedFor(rulePath, body)}`,
            body,
            claudeSingleSource(rule),
          ),
        );
      }
    }

    // D20-1 (X5/CD5): runtime AGENT_TOOL_POLICIES rows for user-authored
    // agents. A user agent slug cannot use the `hatch3r-` prefix, so it is
    // re-prefixed to `hatch3r-<slug>` on emission (toPrefixedId below) and
    // matches no canonical policy — without a derived row the PreToolUse hook
    // NO_POLICY-denies its every tool call. We collect a derived policy per
    // user agent (keyed by the emitted id, grant = authored tools.allowed minus
    // tools.denied) and append them to the emitted agent-tool-policies.json so
    // the hook governs each user agent with its authored grant.
    const userAgentPolicies: AgentToolPolicy[] = [];

    if (ctx.features.agents) {
      const agents = await this.readUserFacingCanonicalFiles(ctx.canonicalRoot, "agents", ctx.userRepoRoot);
      for (const agent of agents) {
        // C9-H20: cooperative abort between agent files.
        this.throwIfAborted(ctx);
        const { content: rawContent, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, agent);
        this.warnings.push(...warnings);
        if (skip) continue;
        // C9-H47: substitute detected toolchain tokens in agent body.
        const content = this.substituteDetectedRepoTokens(rawContent, ctx);
        const agentId = toPrefixedId(agent.id);
        const model = resolveAgentModel(agent.id, agent, ctx.manifest, overrides);
        const desc = overrides.description ?? agent.description;
        // C7.5-W2B2-H41/H45 (D15, P6): translate AGENT_TOOL_POLICIES to
        // Claude Code `tools:` frontmatter so the monotonic-privilege
        // trust invariant survives into the Claude Code runtime. When
        // the policy is absent (non-canonical agent), we omit the
        // field so Claude Code inherits from the parent — matching the
        // upstream default documented at code.claude.com/docs/en/sub-agents.
        //
        // D20-1 (X5/CD5): for user-authored agents the canonical registry has
        // no policy under the re-prefixed id, so the registry lookup returns
        // null and (pre-fix) BOTH the `tools:` frontmatter AND the
        // agent-tool-policies.json row were absent — the PreToolUse hook then
        // NO_POLICY-denied every call. We derive a policy from the agent's
        // authored `tools.allowed`/`tools.denied` grant: register it for the
        // emitted policy doc (so the hook governs the agent) and render the
        // `tools:` frontmatter from the same grant (so Claude's per-agent
        // tool field reflects the authored envelope). An empty grant yields a
        // null frontmatter (field omitted → Claude inherits all tools) while
        // the derived policy still denies at the hook layer.
        let toolsFm: string | null;
        if (agent.source === "user") {
          const grant = {
            allowed: agent.toolsAllowed ?? [],
            denied: agent.toolsDenied ?? [],
          };
          const derived = deriveUserAgentPolicy(agentId, grant);
          userAgentPolicies.push(derived);
          toolsFm = toClaudeToolsFrontmatterFromCategories(derived.allowedTools);
        } else {
          toolsFm = toClaudeToolsFrontmatter(agentId);
        }
        const fmLines = [`description: ${desc}`];
        if (toolsFm) fmLines.push(`tools: ${toolsFm}`);
        // D15-3 (Cycle 11, P6 / ASI02-03): re-emit the canonical agent's
        // short-form `tools.deny` envelope. Top-level denies (`Write`, `Edit`,
        // `MultiEdit`, `Bash`) become a native `disallowedTools:` frontmatter
        // field (Claude removes them from the inherited/allowed set); granular
        // `Bash:<subcommand>` denies become a `## Tool Restrictions` body
        // block (subagent frontmatter cannot express per-subcommand Bash
        // scope). Without this the per-agent deny was silently dropped — the
        // file rebuilt frontmatter from the coarse `tools:` allowlist only
        // (SA15.3-F1). The runtime PreToolUse allowlist hook still gates at the
        // category layer; this restores the subcommand-level boundary the hook
        // cannot enforce.
        const { disallowedTools, restrictionsBlock } = deriveAgentDenyEmission(agent);
        if (disallowedTools.length > 0) {
          fmLines.push(`disallowedTools: ${disallowedTools.join(", ")}`);
        }
        // D9-11 (Cycle 11 Wave 3, D9, P3): emit `permissionMode: plan` for a
        // read-only-role agent (policy lacks write+execute) — the Claude analog
        // of the Cursor `readonly: true` primitive. Producer agents (write/
        // execute grant) and user agents (no canonical policy) get no field and
        // inherit the parent mode. See {@link claudePermissionMode} for the
        // CL-2-deferred remaining native fields (mcpServers/memory/maxTurns/skills).
        const permissionMode = claudePermissionMode(agentId);
        if (permissionMode) fmLines.push(`permissionMode: ${permissionMode}`);
        // D9-H-1 (D9, P3): emit Claude Code's native `model:` subagent
        // frontmatter when a model resolves, so per-agent model preferences
        // are authoritative rather than advisory prose. Claude Code resolves
        // the subagent model as CLAUDE_CODE_SUBAGENT_MODEL > per-invocation
        // param > definition frontmatter `model:` > main conversation
        // (code.claude.com/docs/en/sub-agents#choose-a-model, accessed
        // 2026-05-27).
        //
        // D9-3 (Cycle 11, P3 + P5): gate the native field to a
        // Claude-recognizable value (alias / `claude-*` ID / `inherit`).
        // A non-Claude resolved model (e.g. `gpt-4`, `gemini-3-flash`) is
        // surfaced only as `## Recommended Model` prose below — Claude Code
        // rejects an unknown `model:` ID (hard error or silent default
        // fallback), so writing it into the native field is a silent-failure
        // surface, not an authoritative preference.
        const nativeModel = model && isClaudeRecognizableModel(model) ? model : undefined;
        if (nativeModel) fmLines.push(`model: ${nativeModel}`);
        const fm = `---\n${fmLines.join("\n")}\n---`;
        // C9-M47 (P7): cache-breakpoint sentinels wrap every agent body so the
        // emitted managed block fingerprints stably across syncs.
        const restrictionsSuffix = restrictionsBlock ? `\n\n${restrictionsBlock}` : "";
        if (minimal) {
          // Minimal mode keeps body lean: the model note and tool-restriction
          // block ride along so the deny envelope is not lost at low verbosity.
          const modelNote = model ? `\nModel: \`${model}\`` : "";
          const body = withCacheBreakpoints(`${this.stripMinimal(content)}${modelNote}${restrictionsSuffix}`);
          const agentPath = `.claude/agents/${agentId}.md`;
          results.push(output(agentPath, `${fm}\n\n${wrapManagedFor(agentPath, body)}`, body, claudeSingleSource(agent)));
        } else {
          // The `## Recommended Model` prose is retained for EVERY resolved
          // model (Claude or not) so the env-var/`/model` override path stays
          // documented — for a non-Claude model it is the ONLY surface, since
          // the native `model:` field above is gated to Claude values.
          const modelGuidance = model
            ? `\n\n## Recommended Model\n\nPreferred: \`${model}\`. Set via \`/model ${model}\` or env \`CLAUDE_CODE_SUBAGENT_MODEL=${model}\`.`
            : "";
          const body = withCacheBreakpoints(`${content}${modelGuidance}${restrictionsSuffix}`);
          const agentPath = `.claude/agents/${agentId}.md`;
          results.push(output(agentPath, `${fm}\n\n${wrapManagedFor(agentPath, body)}`, body, claudeSingleSource(agent)));
        }
      }
    }

    const defaultAllow = ["Read", "Edit", "MultiEdit", "Write", "Grep", "Glob", "LS", "TodoRead", "TodoWrite"];
    const claudeConfig = ctx.manifest.claude;

    // Agent Teams: use "auto" as default teammateMode (per current docs at
    // https://code.claude.com/docs/en/agent-teams accessed 2026-05-28 — "auto"
    // uses split panes if inside tmux, in-process otherwise).
    // #264 (D9-9.35): Legacy values are deprecated; warn and map to "auto".
    const DEPRECATED_TEAMMATE_MODES = new Set(["tool-using", "full-trust", "manual-approval"]);
    const rawTeammateMode = claudeConfig?.teammateMode ?? "auto";
    if (DEPRECATED_TEAMMATE_MODES.has(rawTeammateMode)) {
      this.warnings.push(
        `claude: teammateMode "${rawTeammateMode}" is deprecated. ` +
        `Use "auto", "in-process", or "tmux" instead. Defaulting to "auto".`,
      );
    }
    const teammateMode = DEPRECATED_TEAMMATE_MODES.has(rawTeammateMode) ? "auto" : rawTeammateMode;

    const settingsObj: Record<string, unknown> = {
      _hatch3r: {
        version: HATCH3R_VERSION,
        managed: true,
      },
      permissions: {
        allow: claudeConfig?.permissions?.allow ?? defaultAllow,
        deny: claudeConfig?.permissions?.deny ?? [],
      },
      teammateMode,
    };

    // D9-H-3 (D9, P7): hook entries may carry an `args` vector (exec form,
    // Claude Code v2.1.139+). When `args` is present, `command` is the
    // executable spawned directly with no shell
    // (code.claude.com/docs/en/hooks, accessed 2026-05-26).
    const hooksConfig: Record<
      string,
      Array<{ matcher: string; hooks: Array<{ type: string; command: string; args?: string[]; if?: string }> }>
    > = {};
    const hooks = await this.readHooks(ctx);
    // D9-2 (Cycle 11, P3 + P5): advisory-only hooks (events with no native
    // Claude hook surface, e.g. ci-failure) are collected here and rendered as
    // CLAUDE.md guidance below instead of being emitted into settings.json —
    // the prior native emission was dead (fired on the wrong trigger or never).
    const advisoryHooks: HookDefinition[] = [];
    for (const hook of hooks) {
      if (ADVISORY_ONLY_EVENTS.has(hook.event)) {
        advisoryHooks.push(hook);
        continue;
      }
      // Narrowed: not an advisory-only event, so the event is a NativeHookEvent.
      const nativeHook = hook as HookDefinition & { event: NativeHookEvent };
      const claudeEvent = mapToClaudeEvent(nativeHook.event);
      if (!hooksConfig[claudeEvent]) hooksConfig[claudeEvent] = [];
      // The activation echo tells the agent which sub-agent to spawn. Every
      // event prints it unconditionally EXCEPT post-merge, which gates on a
      // `git merge` substring in $TOOL_INPUT so the ci-watcher activates only
      // when a merge actually ran — PostToolUse+"Bash" otherwise fires on
      // every shell command (D5-14). This mirrors the worktree PostToolUse+Bash
      // git-detection hook below; the matcher is tool-name-only, so the
      // subcommand gate must live in the command.
      const activation = `HATCH3R_HOOK_ACTIVATED: Spawn the ${hook.agent} agent now. Follow the ${hook.agent} agent protocol in .claude/agents/${toPrefixedId(hook.agent)}.md. Event: ${hook.event}. Hook ID: ${hook.id}.`;
      const command =
        nativeHook.event === "post-merge"
          ? `bash -c 'CMD="\${TOOL_INPUT:-}"; if echo "$CMD" | grep -q "git merge"; then echo "${activation}"; fi'`
          : `echo "${activation}"`;

      // D5-40 (Cycle 11 Wave 3, D5, P3): honor the `file-save` hook's
      // `condition.globs` scope on Claude Code. The matcher field is tool-name-
      // only (code.claude.com/docs/en/hooks → "What the matcher filters",
      // accessed 2026-06-06), so the prior PostToolUse+"Write" entry fired the
      // context-rules activation on EVERY file write — the canonical hook's
      // `**/*.ts,**/*.tsx,...` glob scope (parity with Cursor's `afterFileEdit`
      // glob narrowing) was dropped. Claude Code v2.1.85+ adds an `if` field on
      // individual hook handlers that uses permission-rule syntax to match the
      // tool name AND its arguments together, e.g. `Edit(*.ts)` /
      // `Write(*.ts)` (code.claude.com/docs/en/hooks → common fields). Translate
      // each glob into one `if`-scoped handler per write tool so the activation
      // fires only when the saved file matches the scope. `file-save` is the only
      // path-scoped native event (pre-commit/pre-push/post-merge gate on a Bash
      // subcommand, not a file path); other events keep the single unscoped
      // handler. Empty/absent globs fall through to the unscoped handler too.
      const fileSaveGlobs =
        nativeHook.event === "file-save" ? nativeHook.condition?.globs ?? [] : [];
      if (fileSaveGlobs.length > 0) {
        // Widen the matcher to both file-modifying tools (the doc example pairs
        // `Edit|Write`); the per-handler `if` then restricts to the tool+path.
        const ifHandlers = fileSaveGlobs.flatMap((glob) =>
          (["Write", "Edit"] as const).map((tool) => ({
            type: "command",
            command,
            if: `${tool}(${glob})`,
          })),
        );
        hooksConfig[claudeEvent].push({ matcher: "Write|Edit", hooks: ifHandlers });
      } else {
        hooksConfig[claudeEvent].push({
          matcher: getClaudeToolMatcher(nativeHook),
          hooks: [{ type: "command", command }],
        });
      }
    }

    // D9-2 (Cycle 11, P3 + P5): render advisory-only hooks (no native Claude
    // hook surface) as a managed `.claude/rules/` note so the operator still
    // learns the intended trigger + agent, rather than the hook silently
    // vanishing. Parity with Cursor's `.mdc`-only path and Copilot's
    // no-hook-surface path for the same events. Emitted only when BOTH the
    // hooks and rules features are on AND at least one advisory hook exists —
    // the note is a `.claude/rules/` artifact, so it rides the rules channel
    // gate (a project that suppressed rules gets no rules-surface output).
    if (ctx.features.hooks && ctx.features.rules && advisoryHooks.length > 0) {
      const noteLines = [
        "# hatch3r Advisory Hooks (no native Claude Code event)",
        "",
        "These hatch3r hook events have no native Claude Code hook surface, so they are",
        "documented here instead of wired into `.claude/settings.json`. Claude Code has no",
        "event that fires on an external CI pipeline failure",
        "(code.claude.com/docs/en/hooks, accessed 2026-06-05). Activate the agent manually,",
        "or run the matching `/hatch3r-*` command, when the described trigger occurs.",
        "",
      ];
      for (const hook of advisoryHooks) {
        noteLines.push(
          `## ${hook.event} -> ${hook.agent}`,
          "",
          `- Trigger: ${hook.description}`,
          `- Agent protocol: \`.claude/agents/${toPrefixedId(hook.agent)}.md\``,
          `- Hook ID: \`${hook.id}\``,
          "",
        );
      }
      const noteBody = withCacheBreakpoints(noteLines.join("\n").trimEnd());
      const notePath = ".claude/rules/50-hatch3r-advisory-hooks.md";
      results.push(output(notePath, wrapManagedFor(notePath, noteBody), noteBody));
    }

    // C9-H49 (D15-SA15.2, P6): per-adapter PreToolUse allowlist hook.
    // Reclassifies the agent tool allowlist as Hybrid (canonical policy
    // registry + runtime PreToolUse gate). The hook is emitted as a
    // sibling of agent-tool-policies.json so the script reads the
    // policy file via relative path. Registered as a PreToolUse entry
    // with matcher ".*" so the hook fires on every tool call; the
    // script handles category-specific deny decisions internally.
    // Source: https://code.claude.com/docs/en/plugins-reference#hooks
    // (PreToolUse exit 2 denies the call; accessed 2026-04-19) and
    // https://code.claude.com/docs/en/hooks ($CLAUDE_PROJECT_DIR is set
    // to the project root for hook commands; accessed 2026-06-03).
    //
    // cwd-robustness fix (supersedes the prior D9-H-3 exec form): register
    // the launcher in shell form, anchored to $CLAUDE_PROJECT_DIR. Claude
    // Code sets CLAUDE_PROJECT_DIR to the absolute project root for every
    // hook invocation (https://code.claude.com/docs/en/hooks, accessed
    // 2026-06-03), so the script resolves regardless of the hook's working
    // directory. The previous exec form passed a *relative* script path
    // (".claude/hooks/pretooluse-allowlist.mjs") in `args`; when the
    // PreToolUse hook fired from a context whose cwd was not the project
    // root — e.g. when the Agent tool spawns a sub-agent — Node could not
    // resolve the entry point and threw
    // `node:internal/modules/cjs/loader:1386` (Cannot find module),
    // surfaced by Claude Code as a non-blocking "PreToolUse:Agent hook
    // error" on every Agent invocation. `node` is taken from PATH rather
    // than the generation-time `process.execPath`, so the emitted
    // settings.json stays portable across Node upgrades and machines. The
    // shell form costs one `sh -c` fork (~1 ms) but still a single Node
    // cold-start — it does not reintroduce the double cold-start of the
    // pre-D9-H-3 inline `node -e` wrapper.
    //
    // Fail-open posture: the hook script is self-fail-safe (malformed
    // stdin -> exit 0; out-of-scope agent -> exit 0). A missing script
    // makes Node exit with code 1, which is a non-blocking hook error
    // (only exit 2 blocks the tool call per the hooks contract above),
    // so the call still proceeds. Detection of a missing script remains
    // the job of `hatch3r status` / `hatch3r verify`.
    if (!hooksConfig.PreToolUse) hooksConfig.PreToolUse = [];
    hooksConfig.PreToolUse.push({
      matcher: ".*",
      hooks: [{
        type: "command",
        command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/pretooluse-allowlist.mjs"',
      }],
    });

    hooksConfig.TaskCompleted = [{
      matcher: ".*",
      hooks: [{ type: "command", command: "echo \"HATCH3R_QUALITY_GATE: Before marking this task complete, verify: (1) Phase 3 review loop passed with 0 Critical + 0 Warning, (2) Phase 4 specialists ran (hatch3r-testability + hatch3r-security at minimum), (3) all acceptance criteria met. If any check fails, do NOT mark complete — spawn the appropriate agent to address the gap.\"" }],
    }];
    hooksConfig.TeammateIdle = [{
      matcher: ".*",
      hooks: [{ type: "command", command: "echo \"HATCH3R_PIPELINE_CHECK: Idle teammate detected. Check for pending Phase 4 quality tasks: hatch3r-testability, hatch3r-security, hatch3r-docs-writer, hatch3r-lint-fixer, hatch3r-ui. If any are pending and within this teammate's scope, pick up the next task.\"" }],
    }];

    // C7.5-W2B2-H50 (D17-SA17.2-B, P3): Worktree file isolation uses Claude Code
    // v2.1.x native WorktreeCreate event (per code.claude.com/docs/en/plugins-reference,
    // accessed 2026-04-19). The event fires when a worktree is being created via
    // `--worktree` or agent isolation: "worktree" and replaces default git behavior.
    // Fallback: also emit a PostToolUse+Bash hook that detects `git worktree add`
    // commands executed by the agent, so users on older Claude Code versions
    // (pre-v2.1.x) still get worktree setup triggered.
    if (ctx.manifest.worktree?.enabled) {
      if (!hooksConfig.WorktreeCreate) hooksConfig.WorktreeCreate = [];
      hooksConfig.WorktreeCreate.push({
        matcher: ".*",
        hooks: [{
          type: "command",
          command: 'bash -c \'WTDIR="${CLAUDE_WORKTREE_PATH:-${WORKTREE_PATH:-}}"; [ -n "$WTDIR" ] && npx hatch3r worktree-setup --from-path "$WTDIR" || true\'',
        }],
      });
      if (!hooksConfig.PostToolUse) hooksConfig.PostToolUse = [];
      hooksConfig.PostToolUse.push({
        matcher: "Bash",
        hooks: [{
          type: "command",
          command: 'bash -c \'CMD="${TOOL_INPUT:-}"; if echo "$CMD" | grep -q "git worktree add"; then ARGS="${CMD#*git worktree add}"; WTDIR=""; SKIP=false; for w in $ARGS; do if $SKIP; then SKIP=false; continue; fi; case "$w" in -b|-B|--reason) SKIP=true;; -*) ;; *) WTDIR="$w"; break;; esac; done; [ -n "$WTDIR" ] && npx hatch3r worktree-setup --from-path "$WTDIR" || true; fi\'',
        }],
      });
    }

    settingsObj.hooks = hooksConfig;

    // D9-M4 (Cycle 10 D9 Wave-3, P3): Agent Teams remains EXPERIMENTAL in
    // Claude Code per https://code.claude.com/docs/en/agent-teams accessed
    // 2026-05-28 — "Agent teams are experimental and disabled by default.
    // Enable them by adding CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS to your
    // settings.json or environment." The earlier D9-H-2 reading that
    // assumed v2.1.120+ GA was contradicted by the live docs page on
    // re-verification; reverse to the docs-correct default of emitting the
    // env var so Agent Teams actually functions when CLAUDE.md tells the
    // operator to spawn a team. Explicit opt-out: `claude.agentTeams: false`
    // in `.hatch3r/hatch.json` suppresses the env var for users who do not
    // want the experimental gate flipped on. `agentTeams: true` or unset
    // both emit the env var; `agentTeams: "ga"` is preserved as an alias
    // for true so callers that switched to it during the prior cycle keep
    // working but receive a one-time warning that the GA-anchor reading
    // is no longer accurate.
    const agentTeamsSetting = ctx.manifest.claude?.agentTeams;
    const emitAgentTeamsEnv = agentTeamsSetting !== false;
    if (agentTeamsSetting === "ga") {
      this.warnings.push(
        "claude: agentTeams=\"ga\" is preserved as an alias for true, but Agent Teams remains experimental " +
        "(https://code.claude.com/docs/en/agent-teams accessed 2026-05-28). " +
        "Switch to agentTeams: true (or omit) to drop the alias.",
      );
    }
    if (emitAgentTeamsEnv) {
      settingsObj.env = { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" };
    }
    results.push(output(".claude/settings.json", JSON.stringify(settingsObj, null, 2)));

    // C7-H17 + C7.5-W2B2-H50 (D9, D17, P3): Emit Claude Code plugin-style hooks
    // file alongside settings.json. Per code.claude.com/docs/en/plugins-reference
    // (accessed 2026-04-19), plugins distribute hooks via `hooks/hooks.json` at
    // the plugin root using the same {hooks: {EVENT: [{matcher, hooks: [...]}]}}
    // schema as settings.json. This makes hatch3r's hook set portable as a
    // plugin component and consumable by Claude Code's `/plugin install` flow
    // without reading settings.json. The settings.json emission above is
    // preserved (additive); plugin consumers prefer the standalone file.
    // Schema tag `claude-code/plugin-hooks/v2.2` tracks Claude Code v2.1.x's
    // WorktreeCreate/WorktreeRemove lifecycle events plus the `--from-path`
    // contract for `hatch3r worktree-setup` (hatch3r >=1.7.0). v2.1 consumers
    // calling `worktree-setup <path>` will fail name-validation; v2.2 emits the
    // explicit `--from-path` flag for legacy populate.
    if (ctx.features.hooks) {
      const pluginHooksObj = {
        _hatch3r: {
          version: HATCH3R_VERSION,
          managed: true,
          schema: "claude-code/plugin-hooks/v2.2",
        },
        hooks: hooksConfig,
      };
      results.push(output(".claude/hooks/hatch3r-hooks.json", JSON.stringify(pluginHooksObj, null, 2)));
    }

    // C9-H49 (D15-SA15.2, P6): emit the PreToolUse allowlist hook script
    // + the machine-readable agent-tool-policies.json document. Both
    // ride alongside settings.json regardless of `ctx.features.hooks`
    // because the PreToolUse gate is the runtime tail of the canonical
    // ASI02 enforcement — disabling it would break the trust chain.
    // The hook script is plain Node ESM with zero runtime dependencies;
    // the JSON document is the SECURITY.md Allowlist Hybrid Contract
    // source-of-truth payload.
    // D20-1 (X5/CD5): append the derived user-agent policies so the emitted
    // policy doc the PreToolUse hook reads carries a row for every emitted
    // user agent — closing the NO_POLICY deny-all path for re-prefixed user
    // agents. Canonical ids always win inside buildAgentToolPoliciesJson, so a
    // user agent can never widen a canonical agent's grant.
    results.push(output(
      ".claude/hooks/agent-tool-policies.json",
      buildAgentToolPoliciesJson(userAgentPolicies),
    ));
    results.push(output(
      ".claude/hooks/pretooluse-allowlist.mjs",
      buildClaudePreToolUseHookScript(),
    ));

    // C9-M47 (P7): re-wrap skill/command outputs with cache-breakpoint
    // sentinels. The base helpers emit `wrapManagedFor(path, content)` directly
    // (shared across all 3 supported adapters); we post-process the
    // Claude-specific results so the sentinels appear in this adapter's
    // managed blocks only, without touching the cross-adapter helpers.
    const skillOutputs = await this.processSkillsRawCliFiltered(
      ctx,
      (id) => `.claude/skills/${toPrefixedId(id)}/SKILL.md`,
    );
    results.push(...skillOutputs.map(rewrapWithCacheBreakpoints));

    const commandOutputs = await this.processCommandsRaw(
      ctx,
      (id) => `.claude/commands/${toPrefixedId(id)}.md`,
    );
    results.push(...commandOutputs.map(rewrapWithCacheBreakpoints));

    // Companion/reference content (`agents/modes/`, `agents/shared/`,
    // `commands/board/`, `commands/revision/`, `checks/`) is referenced by
    // primary artifacts via plain `agents/shared/quality-charter.md`-style
    // path strings. Without these subtrees on disk the runtime agent's
    // Read/Grep cannot resolve those references — the bundled-content
    // migration in 1.9.0 removed the `.agents/` mirror that previously
    // materialised them. We re-emit each subtree under the per-adapter
    // native path so references resolve and orphan cleanup tracks them.
    //
    // Gating: each subtree rides the same feature flag as the primary
    // artifact it supports — disabling a feature also disables its
    // companion subtree. `checks/` is referenced from both agents
    // (reviewer) and commands (benchmark), so either gate keeps it.
    const companionMappings: Array<[CompanionSubdir, boolean, (f: string) => string]> = [
      ["agents/modes", ctx.features.agents, (f) => `.claude/agents/modes/${f}`],
      ["agents/shared", ctx.features.agents, (f) => `.claude/agents/shared/${f}`],
      ["commands/board", ctx.features.commands, (f) => `.claude/commands/board/${f}`],
      ["commands/revision", ctx.features.commands, (f) => `.claude/commands/revision/${f}`],
      ["checks", ctx.features.agents || ctx.features.commands, (f) => `.claude/checks/${f}`],
    ];
    for (const [subdir, enabled, pathFn] of companionMappings) {
      if (!enabled) continue;
      const companionOutputs = await this.processCompanionSubdir(ctx, subdir, pathFn);
      results.push(...companionOutputs.map(rewrapWithCacheBreakpoints));
    }

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp) {
      const claudeMcp: Record<string, unknown> = {};
      for (const [name, entry] of Object.entries(mcp)) {
        // D9-C-1 (Pillar P6): Claude Code's MCP loader reads the
        // tool-execution timeout from the public `timeout` field in
        // milliseconds — per https://code.claude.com/docs/en/mcp
        // (accessed 2026-05-27): "Set a per-server tool execution
        // timeout by adding a `timeout` field in milliseconds to that
        // server's `.mcp.json` entry". Our canonical schema stores the
        // operator-supplied value as the private-prefixed `_timeout`
        // (validated by `mcp-utils.ts::validateMcpEntry`) so that the
        // underscore-prefixed `_` namespace remains the contract for
        // hatch3r-internal fields. The Claude adapter is therefore the
        // last hop where the private name must be translated to the
        // public one before emission. Without this translation the
        // operator-configured timeout was silently dropped (Claude
        // Code ignores unknown underscore-prefixed keys), with the
        // server falling back to the runtime default.
        //
        // D2-13 (Cycle 11 Wave 3, D2, P6): strip every `_`-prefixed framework
        // marker via the shared {@link stripPrivateMcpFields} helper rather
        // than a hand-maintained destructure list. `_pinned_sha256` and
        // `_trust_bypass` are policy markers consumed by
        // `validateMcpHttpEndpoint` at generation time; they have no Claude
        // Code runtime meaning and must not surface in the emitted `.mcp.json`.
        // `_timeout` is read first below for the public `timeout` translation,
        // then dropped by the strip. `_description`/`_disabled` are already
        // removed upstream by `readFilteredMcp`. A future `_`-field is stripped
        // automatically, so this path can never re-leak a private marker.
        const publicEntry = stripPrivateMcpFields(entry);
        const type = entry.command ? "stdio" : entry.url ? "http" : undefined;
        const timeout =
          typeof entry._timeout === "number" && entry._timeout > 0
            ? entry._timeout
            : undefined;
        const withType: Record<string, unknown> = {
          ...(type !== undefined ? { type } : {}),
          ...(timeout !== undefined ? { timeout } : {}),
          ...publicEntry,
        };
        claudeMcp[name] = transformEnvVarSyntax(withType, "claude");
      }
      // F17.2.3 (D17, P3): declare an explicit MCP protocol version so
      // hatch3r-generated `.mcp.json` pins to a known revision rather than
      // inheriting whatever the client/server negotiate by default. Defaults
      // to the most-recent stable spec revision; operators override via
      // `.hatch3r/hatch.json::mcp.protocolVersion` to track the 2026-07-28 RC
      // ahead of its Q3 2026 GA (see MCP_DEFAULT_PROTOCOL_VERSION and
      // docs/MIGRATION-mcp-2026-07-28.md).
      const protocolVersion =
        ctx.manifest.mcp.protocolVersion ?? MCP_DEFAULT_PROTOCOL_VERSION;
      results.push(
        output(
          ".mcp.json",
          JSON.stringify({ protocolVersion, mcpServers: claudeMcp }, null, 2),
        ),
      );
    }

    // C9-M47 (P7): agent-team command body gets cache-breakpoint sentinels too.
    const agentTeamBody = withCacheBreakpoints(AGENT_TEAM_COMMAND);
    results.push(output(".claude/commands/hatch3r-agent-team.md", wrapManagedFor(".claude/commands/hatch3r-agent-team.md", agentTeamBody), agentTeamBody));

    return results;
  }
}
