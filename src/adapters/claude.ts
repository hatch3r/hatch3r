import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BRIDGE_ORCHESTRATION } from "../cli/shared/agentsContent.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { resolveAgentModel } from "../models/resolve.js";
import { applyCustomization } from "./customization.js";
import type { HookDefinition, HookEvent } from "../hooks/types.js";
import { HATCH3R_VERSION } from "../version.js";

const AGENT_TEAMS_SECTION = [
  "## Agent Teams (Experimental)",
  "",
  "This project uses hatch3r's 4-phase sub-agent pipeline (Research → Implement → Review → Quality)",
  "which maps directly to Claude Code Agent Teams. Each phase becomes a teammate role.",
  "",
  "### Enabling Agent Teams",
  "",
  "Agent Teams is experimental. Enable by setting `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in your",
  "environment or in `.claude/settings.json` under `env`. Once enabled, request a team in the prompt:",
  "",
  "```",
  'Create an agent team for this task. Use the hatch3r 4-phase pipeline.',
  "```",
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

- Use \`--teammate-mode tmux\` or \`--teammate-mode in-process\` based on your terminal
- Each teammate reads CLAUDE.md and inherits project rules automatically
- Assign explicit file/directory boundaries to each teammate
- The lead coordinates; it should NOT implement code itself (use delegate mode)
`;

function mapToClaudeEvent(event: HookEvent): string {
  const mapping: Record<HookEvent, string> = {
    "pre-commit": "PreToolUse",
    "post-merge": "PostToolUse",
    "ci-failure": "SubagentStart",
    "file-save": "PostToolUse",
    "session-start": "SessionStart",
    "pre-push": "PreToolUse",
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
  };
  return eventToolMap[hook.event] || ".*";
}

function transformEnvVarsForClaude(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{env:([^}]+)\}/g, "${$1}");
  }
  if (Array.isArray(value)) {
    return value.map(transformEnvVarsForClaude);
  }
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = transformEnvVarsForClaude(v);
    }
    return result;
  }
  return value;
}

export class ClaudeAdapter extends BaseAdapter {
  readonly name = "claude";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    const innerContent = [
      "",
      "# Hatch3r Project Instructions",
      "",
      "Full canonical agent instructions are at `.agents/AGENTS.md`.",
      "Rules are managed in `.claude/rules/` and agents in `.claude/agents/`.",
      "",
      BRIDGE_ORCHESTRATION,
      "",
      ...AGENT_TEAMS_SECTION,
      "",
      "## Personal Settings",
      "",
      "Create `CLAUDE.local.md` for personal settings (not committed to git).",
      "Claude Code reads this file for user-specific preferences.",
      "",
    ].join("\n");
    results.push(output("CLAUDE.md", wrapInManagedBlock(innerContent), innerContent));

    if (ctx.features.rules) {
      const rules = await readCanonicalFiles(ctx.agentsDir, "rules");
      for (const rule of rules) {
        const { content, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, rule);
        this.warnings.push(...warnings);
        if (skip) continue;
        const desc = overrides.description ?? rule.description;
        const body = `# ${rule.id}\n\n${desc}\n\n${content}`;
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
        const modelGuidance = model
          ? `\n\n## Recommended Model\n\nPreferred: \`${model}\`. Set via \`/model ${model}\` or env \`CLAUDE_CODE_SUBAGENT_MODEL=${model}\`.`
          : "";
        const desc = overrides.description ?? agent.description;
        const fm = `---\ndescription: ${desc}\n---`;
        const body = `${content}${modelGuidance}`;
        results.push(output(`.claude/agents/${agentId}.md`, `${fm}\n\n${wrapInManagedBlock(body)}`, body));
      }
    }

    const defaultAllow = ["Read", "Edit", "MultiEdit", "Write", "Grep", "Glob", "LS", "TodoRead", "TodoWrite"];
    const claudeConfig = ctx.manifest.claude;
    const settingsObj: Record<string, unknown> = {
      _hatch3r: {
        version: HATCH3R_VERSION,
        managed: true,
      },
      permissions: {
        allow: claudeConfig?.permissions?.allow ?? defaultAllow,
        deny: claudeConfig?.permissions?.deny ?? [],
      },
      teammateMode: claudeConfig?.teammateMode ?? "tool-using",
    };

    const hooksConfig: Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>> = {};
    const hooks = await this.readHooks(ctx);
    for (const hook of hooks) {
      const claudeEvent = mapToClaudeEvent(hook.event);
      if (!hooksConfig[claudeEvent]) hooksConfig[claudeEvent] = [];
      hooksConfig[claudeEvent].push({
        matcher: getClaudeToolMatcher(hook),
        hooks: [{ type: "command", command: `echo "hatch3r hook: ${hook.id} — activate ${hook.agent} agent"` }],
      });
    }

    hooksConfig.TaskCompleted = [{
      matcher: ".*",
      hooks: [{ type: "command", command: "echo \"hatch3r quality gate: verify task meets review criteria before marking complete\"" }],
    }];
    hooksConfig.TeammateIdle = [{
      matcher: ".*",
      hooks: [{ type: "command", command: "echo \"hatch3r pipeline: check for pending quality-phase tasks to assign to idle teammate\"" }],
    }];
    settingsObj.hooks = hooksConfig;
    if (ctx.manifest.claude?.agentTeams !== false) {
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
        claudeMcp[name] = transformEnvVarsForClaude(withType);
      }
      results.push(output(".mcp.json", JSON.stringify({ mcpServers: claudeMcp }, null, 2)));
    }

    results.push(output(".claude/commands/hatch3r-agent-team.md", wrapInManagedBlock(AGENT_TEAM_COMMAND), AGENT_TEAM_COMMAND));

    return results;
  }
}
