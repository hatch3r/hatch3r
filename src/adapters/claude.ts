import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import chalk from "chalk";
import type {
  AdapterOutput,
  HatchManifest,
} from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BRIDGE_ORCHESTRATION } from "../cli/shared/agentsContent.js";
import { output } from "./base.js";
import type { Adapter } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { resolveAgentModel } from "../models/resolve.js";
import { applyCustomization, applyCustomizationRaw } from "./customization.js";
import type { HookDefinition } from "../hooks/types.js";

function mapToClaudeEvent(event: string): string {
  const mapping: Record<string, string> = {
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
  const eventToolMap: Record<string, string> = {
    "pre-commit": "Bash",
    "post-merge": "Bash",
    "file-save": "Write",
    "session-start": ".*",
    "pre-push": "Bash",
    "ci-failure": "Bash",
  };
  return eventToolMap[hook.event] || ".*";
}

export class ClaudeAdapter implements Adapter {
  name = "claude";

  async generate(
    agentsDir: string,
    manifest: HatchManifest,
  ): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];
    const { features } = manifest;
    const projectRoot = dirname(agentsDir);

    const innerContent = [
      "",
      "# Hatch3r Project Instructions",
      "",
      "Full canonical agent instructions are at `.agents/AGENTS.md`.",
      "Rules are managed in `.claude/rules/` and agents in `.claude/agents/`.",
      "",
      BRIDGE_ORCHESTRATION,
      "",
      "## Agent Teams (Experimental)",
      "",
      "This project's sub-agentic architecture (implementer agent + issue workflow skill) is",
      "compatible with Claude Code Agent Teams. When using Agent Teams:",
      "",
      "- Give each teammate explicit file boundaries in spawn prompts",
      "- The hatch3r-implementer agent pattern maps to teammate spawn prompts",
      "- Use `/.agents/skills/hatch3r-issue-workflow/SKILL.md` for orchestration",
      "- Teammates do not inherit conversation history; include task-specific context",
      "",
      "## Personal Settings",
      "",
      "Create `CLAUDE.local.md` for personal settings (not committed to git).",
      "Claude Code reads this file for user-specific preferences.",
      "",
    ].join("\n");

    results.push(output("CLAUDE.md", wrapInManagedBlock(innerContent), innerContent));

    if (features.rules) {
      const rules = await readCanonicalFiles(agentsDir, "rules");
      for (const rule of rules) {
        const { content, skip, overrides } = await applyCustomization(projectRoot, rule);
        if (skip) continue;
        const desc = overrides.description ?? rule.description;
        const body = `# ${rule.id}\n\n${desc}\n\n${content}`;
        results.push(output(`.claude/rules/${toPrefixedId(rule.id)}.md`, wrapInManagedBlock(body), body));
      }
    }

    if (features.agents) {
      const agents = await readCanonicalFiles(agentsDir, "agents");
      for (const agent of agents) {
        const { content, skip, overrides } = await applyCustomization(projectRoot, agent);
        if (skip) continue;
        const agentId = toPrefixedId(agent.id);
        const model = resolveAgentModel(agent.id, agent, manifest, overrides);
        const modelGuidance = model
          ? `\n\n## Recommended Model\n\nPreferred: \`${model}\`. Set via \`/model ${model}\` or env \`CLAUDE_CODE_SUBAGENT_MODEL=${model}\`.`
          : "";
        const desc = overrides.description ?? agent.description;
        const fm = `---\ndescription: ${desc}\n---`;
        const body = `${content}${modelGuidance}`;
        results.push(output(`.claude/agents/${agentId}.md`, `${fm}\n\n${wrapInManagedBlock(body)}`, body));
      }
    }

    const settingsObj: Record<string, unknown> = {
      permissions: {
        allow: [
          "Read",
          "Edit",
          "MultiEdit",
          "Write",
          "Grep",
          "Glob",
          "LS",
          "TodoRead",
          "TodoWrite",
        ],
        deny: [],
      },
      teammateMode: "tool-using",
    };

    if (features.hooks) {
      const { readHookDefinitions } = await import("../hooks/index.js");
      const hooks = await readHookDefinitions(agentsDir);

      if (hooks.length > 0) {
        const hooksConfig: Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>> = {};

        for (const hook of hooks) {
          const claudeEvent = mapToClaudeEvent(hook.event);
          if (!hooksConfig[claudeEvent]) {
            hooksConfig[claudeEvent] = [];
          }
          const matcher = getClaudeToolMatcher(hook);
          hooksConfig[claudeEvent].push({
            matcher,
            hooks: [
              {
                type: "command",
                command: `echo "hatch3r hook: ${hook.id} — activate ${hook.agent} agent"`,
              },
            ],
          });
        }

        settingsObj.hooks = hooksConfig;
      }
    }

    results.push(
      output(".claude/settings.json", JSON.stringify(settingsObj, null, 2)),
    );

    if (features.skills) {
      const skills = await readCanonicalFiles(agentsDir, "skills");
      for (const skill of skills) {
        const { content, skip } = await applyCustomizationRaw(projectRoot, skill);
        if (skip) continue;
        results.push(
          output(
            `.claude/skills/${toPrefixedId(skill.id)}/SKILL.md`,
            wrapInManagedBlock(content),
            content,
          ),
        );
      }
    }

    if (features.commands) {
      const commands = await readCanonicalFiles(agentsDir, "commands");
      for (const cmd of commands) {
        const { content, skip } = await applyCustomizationRaw(projectRoot, cmd);
        if (skip) continue;
        results.push(
          output(
            `.claude/commands/${toPrefixedId(cmd.id)}.md`,
            wrapInManagedBlock(content),
            content,
          ),
        );
      }
    }

    if (features.mcp && manifest.mcp.servers.length > 0) {
      const mcpPath = join(agentsDir, "mcp", "mcp.json");
      try {
        const mcpContent = await readFile(mcpPath, "utf-8");
        results.push(output(".mcp.json", mcpContent));
      } catch (err) {
        console.warn(chalk.yellow(`  Warning: Could not read MCP config: ${err instanceof Error ? err.message : String(err)}`));
      }
    }

    return results;
  }
}
