import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { resolveAgentModel } from "../models/resolve.js";
import { applyCustomization } from "./customization.js";
import { transformEnvVarSyntax } from "./mcp-utils.js";
import type { HookDefinition, HookEvent } from "../hooks/types.js";
import { HATCH3R_VERSION } from "../version.js";

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
// Mapping from hatch3r canonical hook events to Claude Code hook semantics:
//   pre-commit   -> PreToolUse  + matcher "Bash"   (intercept before shell commands)
//   post-merge   -> PostToolUse + matcher "Bash"   (react after shell commands)
//   ci-failure   -> SubagentStart + matcher "Bash" (trigger on sub-agent launch)
//   file-save    -> PostToolUse + matcher "Write"  (react after file writes)
//   session-start -> SessionStart + matcher ".*"   (fire on every session start)
//   pre-push     -> PreToolUse  + matcher "Bash"   (intercept before shell commands)
function mapToClaudeEvent(event: HookEvent): string {
  const mapping: Record<HookEvent, string> = {
    "pre-commit": "PreToolUse",
    "post-merge": "PostToolUse",
    "ci-failure": "SubagentStart",
    "file-save": "PostToolUse",
    "session-start": "SessionStart",
    "pre-push": "PreToolUse",
    "worktree-create": "PostToolUse",
    "worktree-remove": "PreToolUse",
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
    "worktree-create": "Bash",
    "worktree-remove": "Bash",
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
          "Instructions: `.agents/AGENTS.md`. Rules: `.claude/rules/`. Agents: `.claude/agents/`.",
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
          "Full canonical agent instructions are at `.agents/AGENTS.md`.",
          "Rules are managed in `.claude/rules/` and agents in `.claude/agents/`.",
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
    const innerContent = innerParts.join("\n");
    results.push(output("CLAUDE.md", wrapInManagedBlock(innerContent), innerContent));

    if (ctx.features.rules) {
      const rules = await readCanonicalFiles(ctx.agentsDir, "rules");
      for (const rule of rules) {
        const { content, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, rule);
        this.warnings.push(...warnings);
        if (skip) continue;
        const desc = overrides.description ?? rule.description;
        const body = minimal
          ? `# ${rule.id}\n\n${this.stripMinimal(content)}`
          : `# ${rule.id}\n\n${desc}\n\n${content}`;
        results.push(output(`.claude/rules/${toPrefixedId(rule.id)}.md`, wrapInManagedBlock(body), body));
      }
    }

    if (ctx.features.agents) {
      const agents = await readCanonicalFiles(ctx.agentsDir, "agents");
      for (const agent of agents) {
        const { content, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, agent);
        this.warnings.push(...warnings);
        if (skip) continue;
        const agentId = toPrefixedId(agent.id);
        const model = resolveAgentModel(agent.id, agent, ctx.manifest, overrides);
        const desc = overrides.description ?? agent.description;
        const fm = `---\ndescription: ${desc}\n---`;
        if (minimal) {
          const modelNote = model ? `\nModel: \`${model}\`` : "";
          const body = `${this.stripMinimal(content)}${modelNote}`;
          results.push(output(`.claude/agents/${agentId}.md`, `${fm}\n\n${wrapInManagedBlock(body)}`, body));
        } else {
          const modelGuidance = model
            ? `\n\n## Recommended Model\n\nPreferred: \`${model}\`. Set via \`/model ${model}\` or env \`CLAUDE_CODE_SUBAGENT_MODEL=${model}\`.`
            : "";
          const body = `${content}${modelGuidance}`;
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

    hooksConfig.TaskCompleted = [{
      matcher: ".*",
      hooks: [{ type: "command", command: "echo \"HATCH3R_QUALITY_GATE: Before marking this task complete, verify: (1) Phase 3 review loop passed with 0 Critical + 0 Warning, (2) Phase 4 specialists ran (hatch3r-test-writer + hatch3r-security-auditor at minimum), (3) all acceptance criteria met. If any check fails, do NOT mark complete — spawn the appropriate agent to address the gap.\"" }],
    }];
    hooksConfig.TeammateIdle = [{
      matcher: ".*",
      hooks: [{ type: "command", command: "echo \"HATCH3R_PIPELINE_CHECK: Idle teammate detected. Check for pending Phase 4 quality tasks: hatch3r-test-writer, hatch3r-security-auditor, hatch3r-docs-writer, hatch3r-lint-fixer, hatch3r-a11y-auditor. If any are pending and within this teammate's scope, pick up the next task.\"" }],
    }];

    // Worktree file isolation: detect `git worktree add` and sync gitignored files
    if (ctx.manifest.worktree?.enabled) {
      if (!hooksConfig.PostToolUse) hooksConfig.PostToolUse = [];
      hooksConfig.PostToolUse.push({
        matcher: "Bash",
        hooks: [{
          type: "command",
          command: 'bash -c \'CMD="${TOOL_INPUT:-}"; if echo "$CMD" | grep -q "git worktree add"; then ARGS="${CMD#*git worktree add}"; WTDIR=""; SKIP=false; for w in $ARGS; do if $SKIP; then SKIP=false; continue; fi; case "$w" in -b|-B|--reason) SKIP=true;; -*) ;; *) WTDIR="$w"; break;; esac; done; [ -n "$WTDIR" ] && npx hatch3r worktree-setup "$WTDIR" || true; fi\'',
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

    results.push(
      ...await this.processSkillsRaw(ctx, (id) => `.claude/skills/${toPrefixedId(id)}/SKILL.md`),
    );

    results.push(
      ...await this.processCommandsRaw(ctx, (id) => `.claude/commands/${toPrefixedId(id)}.md`),
    );

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp) {
      const claudeMcp: Record<string, unknown> = {};
      for (const [name, entry] of Object.entries(mcp)) {
        const type = entry.command ? "stdio" : entry.url ? "http" : undefined;
        const withType = type ? { type, ...entry } : { ...entry };
        claudeMcp[name] = transformEnvVarSyntax(withType, "claude");
      }
      results.push(output(".mcp.json", JSON.stringify({ mcpServers: claudeMcp }, null, 2)));
    }

    results.push(output(".claude/commands/hatch3r-agent-team.md", wrapInManagedBlock(AGENT_TEAM_COMMAND), AGENT_TEAM_COMMAND));

    return results;
  }
}
