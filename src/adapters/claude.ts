// Last updated: 2026-05-19 (P3 platform-currency anchor; per-claim Anthropic
// docs access dates inside this file remain authoritative for individual
// assertions).
import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { sortByPrecedence, precedenceRank } from "./canonical.js";
import { resolveAgentModel } from "../models/resolve.js";
import { applyCustomization } from "./customization.js";
import { transformEnvVarSyntax } from "./mcp-utils.js";
import { toClaudeToolsFrontmatter } from "../pipeline/adapterToolTranslator.js";
import {
  buildAgentToolPoliciesJson,
  buildClaudePreToolUseHookScript,
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
 * The sentinel marks the deterministic, hatch3r-managed prefix that the
 * Claude Code runtime can fingerprint for prompt-cache reuse. A static
 * boundary on both sides of the managed block lets the cache layer detect
 * unchanged prefixes across syncs without scanning the entire file body.
 *
 * Format is a balanced pair (`-START`/`-END`) so consumers can split on the
 * outer markers without ambiguity when both appear in the same emitted file.
 * The base sentinel `<!-- HATCH3R-CACHE-BREAKPOINT -->` is exported for
 * tooling that wants to scan for the breakpoint family without caring which
 * end of the block it sits at.
 *
 * The sentinel is a markdown comment so it is invisible in rendered output
 * and idempotent under the existing `wrapInManagedBlock` trim pass — the
 * symmetric leading/trailing whitespace contract of the managed-block
 * helpers is preserved.
 */
export const CACHE_BREAKPOINT_SENTINEL = "<!-- HATCH3R-CACHE-BREAKPOINT -->";
export const CACHE_BREAKPOINT_SENTINEL_START = "<!-- HATCH3R-CACHE-BREAKPOINT-START -->";
export const CACHE_BREAKPOINT_SENTINEL_END = "<!-- HATCH3R-CACHE-BREAKPOINT-END -->";

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
 * passed to `wrapInManagedBlock`), wrap it with sentinels, and rebuild
 * the full file `content` via `wrapInManagedBlock`. Outputs without
 * `managedContent` (no managed block) pass through unchanged.
 */
function rewrapWithCacheBreakpoints(out: AdapterOutput): AdapterOutput {
  if (!out.managedContent) return out;
  const wrappedBody = withCacheBreakpoints(out.managedContent);
  return {
    ...out,
    content: wrapInManagedBlock(wrappedBody),
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
  "Agent Teams is enabled via `.claude/settings.json`. The env var `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`",
  "is set automatically by hatch3r. Once enabled, request a team in the prompt:",
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
  "| **4 — Quality** | `quality-*` (parallel) | `hatch3r-test-writer`, `hatch3r-security-auditor`, `hatch3r-docs-writer`, `hatch3r-lint-fixer`, `hatch3r-a11y-auditor`, `hatch3r-perf-profiler`, `hatch3r-dependency-auditor` | Spawn in parallel; each owns distinct files |",
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
  "4. test-writer — write tests for the implemented changes in {test directories}.",
  "5. security-auditor — audit changes for security vulnerabilities. Read-only.",
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
  "Pipeline maps to Claude Code Agent Teams. Enable via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.",
  "",
  "| Phase | Role | Agents |",
  "|-------|------|--------|",
  "| Research | `researcher` | `hatch3r-researcher` |",
  "| Implement | `implementer` | `hatch3r-implementer` |",
  "| Review | `reviewer` | `hatch3r-reviewer`, `hatch3r-fixer` |",
  "| Quality | `quality-*` | `hatch3r-test-writer`, `hatch3r-security-auditor`, + conditional |",
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
// paired with a tool matcher regex that scopes when the hook triggers.
//
// Mapping from hatch3r canonical hook events to Claude Code hook semantics
// (Claude Code v2.1.x schema per code.claude.com/docs/en/plugins-reference#hooks,
// accessed 2026-04-19):
//   pre-commit    -> PreToolUse  + matcher "Bash"   (intercept before shell commands)
//   post-merge    -> PostToolUse + matcher "Bash"   (react after shell commands)
//   ci-failure    -> SubagentStart + matcher "Bash" (trigger on sub-agent launch)
//   file-save     -> PostToolUse + matcher "Write"  (react after file writes)
//   session-start -> SessionStart + matcher ".*"   (fire on every session start)
//   pre-push      -> PreToolUse  + matcher "Bash"   (intercept before shell commands)
//   worktree-create -> WorktreeCreate + matcher ".*"  (native v2.1.x worktree lifecycle event)
//   worktree-remove -> WorktreeRemove + matcher ".*"  (native v2.1.x worktree lifecycle event)
// The two worktree events were added in Claude Code v2.1.x alongside isolation:
// "worktree" agent frontmatter. Emitting them on the native events lets
// WorktreeCreate hooks replace default git behavior (per docs) and lets
// WorktreeRemove hooks fire on session exit or subagent finish.
function mapToClaudeEvent(event: HookEvent): string {
  const mapping: Record<HookEvent, string> = {
    "pre-commit": "PreToolUse",
    "post-merge": "PostToolUse",
    "ci-failure": "SubagentStart",
    "file-save": "PostToolUse",
    "session-start": "SessionStart",
    "pre-push": "PreToolUse",
    "worktree-create": "WorktreeCreate",
    "worktree-remove": "WorktreeRemove",
  };
  return mapping[event] || event;
}

function getClaudeToolMatcher(hook: HookDefinition): string {
  const eventToolMap: Record<HookEvent, string> = {
    "pre-commit": "Bash",
    "post-merge": "Bash",
    "file-save": "Write",
    "session-start": ".*",
    "pre-push": "Bash",
    "ci-failure": "Bash",
    // Worktree events are lifecycle-scoped, not tool-scoped; match any context.
    "worktree-create": ".*",
    "worktree-remove": ".*",
  };
  return eventToolMap[hook.event] || ".*";
}

export class ClaudeAdapter extends BaseAdapter {
  readonly name = "claude";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];
    const minimal = this.isMinimal(ctx);

    const bridgeOrchestration = await this.bridgeOrchestration(ctx);
    const teamsSection = minimal ? AGENT_TEAMS_SECTION_MINIMAL : AGENT_TEAMS_SECTION;
    const innerParts = minimal
      ? [
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
          "**Next:** Use `/hatch3r-feature` or `/hatch3r-bug-fix` commands for guided workflows.",
          "**Then:** Delegate to agents in `.claude/agents/` — use Agent Teams for parallel execution.",
          "**Later:** Customize agent behavior via `.hatch3r/{type}/{id}.customize.yaml` without editing managed files.",
          "",
        ];
    // C9-M47 (P7): wrap inner content with cache-breakpoint sentinels before
    // emission so the Claude Code prompt-cache layer sees a deterministic
    // hatch3r-managed prefix across syncs.
    const innerContent = withCacheBreakpoints(innerParts.join("\n"));
    results.push(output("CLAUDE.md", wrapInManagedBlock(innerContent), innerContent));

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
        // managed-block payload fingerprint stays stable for prompt-cache reuse.
        const body = withCacheBreakpoints(rawBody);
        const nn = precedenceRank(rule.precedence) / 10;
        results.push(output(`.claude/rules/${nn}-${toPrefixedId(rule.id)}.md`, wrapInManagedBlock(body), body));
      }
    }

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
        const toolsFm = toClaudeToolsFrontmatter(agentId);
        const fmLines = [`description: ${desc}`];
        if (toolsFm) fmLines.push(`tools: ${toolsFm}`);
        const fm = `---\n${fmLines.join("\n")}\n---`;
        // C9-M47 (P7): cache-breakpoint sentinels wrap every agent body so the
        // emitted managed block fingerprints stably across syncs.
        if (minimal) {
          const modelNote = model ? `\nModel: \`${model}\`` : "";
          const body = withCacheBreakpoints(`${this.stripMinimal(content)}${modelNote}`);
          results.push(output(`.claude/agents/${agentId}.md`, `${fm}\n\n${wrapInManagedBlock(body)}`, body));
        } else {
          const modelGuidance = model
            ? `\n\n## Recommended Model\n\nPreferred: \`${model}\`. Set via \`/model ${model}\` or env \`CLAUDE_CODE_SUBAGENT_MODEL=${model}\`.`
            : "";
          const body = withCacheBreakpoints(`${content}${modelGuidance}`);
          results.push(output(`.claude/agents/${agentId}.md`, `${fm}\n\n${wrapInManagedBlock(body)}`, body));
        }
      }
    }

    const defaultAllow = ["Read", "Edit", "MultiEdit", "Write", "Grep", "Glob", "LS", "TodoRead", "TodoWrite"];
    const claudeConfig = ctx.manifest.claude;

    // Agent Teams GA compatibility: use "auto" as default teammateMode.
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

    const hooksConfig: Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>> = {};
    const hooks = await this.readHooks(ctx);
    for (const hook of hooks) {
      const claudeEvent = mapToClaudeEvent(hook.event);
      if (!hooksConfig[claudeEvent]) hooksConfig[claudeEvent] = [];
      hooksConfig[claudeEvent].push({
        matcher: getClaudeToolMatcher(hook),
        hooks: [{ type: "command", command: `echo "HATCH3R_HOOK_ACTIVATED: Spawn the ${hook.agent} agent now. Follow the ${hook.agent} agent protocol in .claude/agents/${toPrefixedId(hook.agent)}.md. Event: ${hook.event}. Hook ID: ${hook.id}."` }],
      });
    }

    // C9-H49 (D15-SA15.2, P6): per-adapter PreToolUse allowlist hook.
    // Reclassifies the agent tool allowlist as Hybrid (canonical policy
    // registry + runtime PreToolUse gate). The hook is emitted as a
    // sibling of agent-tool-policies.json so the script reads the
    // policy file via relative path. Registered as a PreToolUse entry
    // with matcher ".*" so the hook fires on every tool call; the
    // script handles category-specific deny decisions internally.
    // Source: https://code.claude.com/docs/en/plugins-reference#hooks
    // (PreToolUse exit 2 denies the call; accessed 2026-04-19).
    //
    // Launcher hardening: because the matcher is ".*", any failure in
    // resolving or running the script becomes a per-tool-call error
    // storm. Wrap the invocation in a Node-inline guard that (a) exits
    // 0 silently if the .mjs is missing (fail-open + quiet — same
    // security posture as the broken-install case today, minus the
    // noise), (b) propagates the child's stdout (deny JSON) through
    // stdio:'inherit', (c) keeps the child's stderr audit log only on
    // a clean exit so script crashes don't leak stack traces on every
    // tool call. Detection of a missing script remains the job of
    // `hatch3r status` / `hatch3r verify`.
    if (!hooksConfig.PreToolUse) hooksConfig.PreToolUse = [];
    hooksConfig.PreToolUse.push({
      matcher: ".*",
      hooks: [{
        type: "command",
        command:
          "node -e \"const fs=require('fs'),cp=require('child_process'),p='.claude/hooks/pretooluse-allowlist.mjs';try{fs.statSync(p)}catch{process.exit(0)}const r=cp.spawnSync(process.execPath,[p],{stdio:['inherit','inherit','pipe']});if(r.status===0&&r.stderr)process.stderr.write(r.stderr);process.exit(0)\"",
      }],
    });

    hooksConfig.TaskCompleted = [{
      matcher: ".*",
      hooks: [{ type: "command", command: "echo \"HATCH3R_QUALITY_GATE: Before marking this task complete, verify: (1) Phase 3 review loop passed with 0 Critical + 0 Warning, (2) Phase 4 specialists ran (hatch3r-test-writer + hatch3r-security-auditor at minimum), (3) all acceptance criteria met. If any check fails, do NOT mark complete — spawn the appropriate agent to address the gap.\"" }],
    }];
    hooksConfig.TeammateIdle = [{
      matcher: ".*",
      hooks: [{ type: "command", command: "echo \"HATCH3R_PIPELINE_CHECK: Idle teammate detected. Check for pending Phase 4 quality tasks: hatch3r-test-writer, hatch3r-security-auditor, hatch3r-docs-writer, hatch3r-lint-fixer, hatch3r-a11y-auditor. If any are pending and within this teammate's scope, pick up the next task.\"" }],
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

    // Agent Teams: when agentTeams is "ga", omit the experimental env var
    // (the feature is natively available). Otherwise, set the experimental flag
    // to enable Agent Teams unless explicitly disabled (agentTeams === false).
    const agentTeamsSetting = ctx.manifest.claude?.agentTeams;
    if (agentTeamsSetting === "ga") {
      // GA mode: no experimental flag needed, Agent Teams is natively available.
      // Only set env if there are other env vars to include.
    } else if (agentTeamsSetting !== false) {
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
    results.push(output(
      ".claude/hooks/agent-tool-policies.json",
      buildAgentToolPoliciesJson(),
    ));
    results.push(output(
      ".claude/hooks/pretooluse-allowlist.mjs",
      buildClaudePreToolUseHookScript(),
    ));

    // C9-M47 (P7): re-wrap skill/command outputs with cache-breakpoint
    // sentinels. The base helpers emit `wrapInManagedBlock(content)` directly
    // (shared across all 15 adapters); we post-process the Claude-specific
    // results so the sentinels appear in this adapter's managed blocks only,
    // without touching the cross-adapter helpers.
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
    const companionMappings: Array<[string, boolean, (f: string) => string]> = [
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
        // Other private-prefixed fields preserved by `readFilteredMcp`
        // (`_pinned_sha256`, `_trust_bypass`) are framework-internal
        // policy markers consumed by `validateMcpHttpEndpoint` at
        // generation time; they have no Claude Code runtime meaning
        // and are stripped here so they do not surface in the emitted
        // `.mcp.json`. `_description` and `_disabled` are already
        // stripped upstream by `readFilteredMcp` (see
        // `BaseAdapter.readFilteredMcp` in `base.ts`).
        const { _timeout, _pinned_sha256, _trust_bypass, ...publicEntry } = entry;
        const type = entry.command ? "stdio" : entry.url ? "http" : undefined;
        const timeout =
          typeof _timeout === "number" && _timeout > 0 ? _timeout : undefined;
        // Suppress unused-binding lint for the stripped policy markers
        // — referencing them here documents that the destructure is
        // intentional rather than dead code.
        void _pinned_sha256;
        void _trust_bypass;
        const withType: Record<string, unknown> = {
          ...(type !== undefined ? { type } : {}),
          ...(timeout !== undefined ? { timeout } : {}),
          ...publicEntry,
        };
        claudeMcp[name] = transformEnvVarSyntax(withType, "claude");
      }
      results.push(output(".mcp.json", JSON.stringify({ mcpServers: claudeMcp }, null, 2)));
    }

    // C9-M47 (P7): agent-team command body gets cache-breakpoint sentinels too.
    const agentTeamBody = withCacheBreakpoints(AGENT_TEAM_COMMAND);
    results.push(output(".claude/commands/hatch3r-agent-team.md", wrapInManagedBlock(agentTeamBody), agentTeamBody));

    return results;
  }
}
