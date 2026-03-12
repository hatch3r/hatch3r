import type {
  AdapterOutput,
  CanonicalFile,
} from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BRIDGE_ORCHESTRATION } from "../cli/shared/agentsContent.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { resolveAgentModel } from "../models/resolve.js";
import { applyCustomization } from "./customization.js";

/**
 * The Cursor adapter generates .mdc files from .md canonical files by adding
 * Cursor-specific frontmatter (description, globs/alwaysApply) and wrapping
 * content in managed blocks. Rules get `alwaysApply: true` or `globs: [...]`
 * based on their scope. Agents get `name`, `description`, `model`, `readonly`,
 * and `background` frontmatter fields.
 */
function cursorRuleFrontmatter(rule: CanonicalFile, scopeOverride?: string): string {
  const scope = scopeOverride ?? rule.scope;
  const lines: string[] = [`description: ${rule.description}`];
  if (scope === "always") {
    lines.push("alwaysApply: true");
  } else if (scope) {
    const globs = scope.includes(",")
      ? scope.split(",").map((g) => g.trim())
      : [scope];
    lines.push(`globs: [${globs.map((g) => `"${g}"`).join(", ")}]`);
  } else {
    lines.push("alwaysApply: false");
  }
  return `---\n${lines.join("\n")}\n---`;
}

function mdcOutput(path: string, frontmatter: string, body: string): AdapterOutput {
  return output(path, `${frontmatter}\n\n${wrapInManagedBlock(body)}`, body);
}

export class CursorAdapter extends BaseAdapter {
  readonly name = "cursor";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    if (ctx.features.rules) {
      const rules = await readCanonicalFiles(ctx.agentsDir, "rules");
      for (const rule of rules) {
        const { content, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, rule);
        this.warnings.push(...warnings);
        if (skip) continue;
        const desc = overrides.description ?? rule.description;
        const ruleWithDesc = { ...rule, description: desc };
        const baseName = `${toPrefixedId(rule.id)}.mdc`;
        results.push(mdcOutput(`.cursor/rules/${baseName}`, cursorRuleFrontmatter(ruleWithDesc, overrides.scope), content));
      }
    }

    if (ctx.features.agents) {
      const agents = await readCanonicalFiles(ctx.agentsDir, "agents");
      for (const agent of agents) {
        const { content, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, agent);
        this.warnings.push(...warnings);
        if (skip) continue;
        const model = resolveAgentModel(agent.id, agent, ctx.manifest, overrides);
        const desc = overrides.description ?? agent.description;
        const lines = [`name: ${agent.id}`, `description: ${desc}`];
        if (model) lines.push(`model: ${model}`);
        if (agent.readonly) lines.push("readonly: true");
        if (agent.background) lines.push("background: true");
        const fm = `---\n${lines.join("\n")}\n---`;
        results.push(mdcOutput(`.cursor/agents/${toPrefixedId(agent.id)}.md`, fm, content));
      }
    }

    results.push(
      ...await this.processSkillsWithFm(ctx, (id) => `.cursor/skills/${toPrefixedId(id)}/SKILL.md`),
    );

    results.push(
      ...await this.processCommandsRaw(ctx, (id) => `.cursor/commands/${toPrefixedId(id)}.md`),
    );

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp) {
      results.push(output(".cursor/mcp.json", JSON.stringify({ mcpServers: mcp }, null, 2)));
    }

    const hookResults = await this.readHooks(ctx);
    for (const hook of hookResults) {
      const globs = hook.condition?.globs || [];
      const globLine =
        globs.length > 0
          ? `globs: [${globs.map((g: string) => `"${g}"`).join(", ")}]`
          : "alwaysApply: false";
      const fm = `---\ndescription: "Hook: ${hook.description}"\n${globLine}\n---`;
      const body = `# Hook: ${hook.id}\n\n**Event:** ${hook.event}\n**Agent:** ${hook.agent}\n\n${hook.description}\n\nWhen this hook's event (${hook.event}) is triggered${globs.length > 0 ? ` for files matching ${globs.join(", ")}` : ""}, activate the ${hook.agent} agent.`;
      results.push(mdcOutput(`.cursor/rules/${toPrefixedId(`hook-${hook.id}`)}.mdc`, fm, body));
    }

    const bridgeFm = `---
description: Bridge to canonical agent instructions and mandatory orchestration directives
alwaysApply: true
---`;
    const bridgeBody = `# Hatch3r Bridge

This project uses hatch3r for agentic coding setup.
Canonical agent instructions live at \`/.agents/AGENTS.md\`.

${BRIDGE_ORCHESTRATION}

## Cursor Subagent Configuration (v2.5+)

Cursor supports up to 4 subagents running in parallel. Custom subagents in \`.cursor/agents/\` support these frontmatter fields:
- \`model\`: \`fast\`, \`inherit\`, or a specific model ID
- \`readonly\`: \`true\` to restrict write permissions (verification/audit agents)
- \`background\`: \`true\` to run without blocking the parent agent

When delegating to hatch3r agents, explicitly request "up to 4 in parallel" for maximum throughput.
Background subagents write output to \`~/.cursor/subagents/\` for later inspection.

## Cursor v2.6 Capabilities

Cursor v2.6 added MCP Apps (interactive UIs in agent chats) and Team Marketplaces for plugins.
If this project includes MCP servers that expose UI components, they will render inline as MCP Apps.
Plugin configurations in \`.cursor/mcp.json\` are compatible with Team Marketplace distribution.`;
    results.push(mdcOutput(".cursor/rules/hatch3r-bridge.mdc", bridgeFm, bridgeBody));

    if (ctx.manifest.tools.includes("cursor")) {
      const envConfig = {
        instructions: ["Read /.agents/AGENTS.md for project instructions"],
        mcpServers: {},
      };
      results.push(output(".cursor/environment.json", JSON.stringify(envConfig, null, 2) + "\n"));
    }

    return results;
  }
}
