import type {
  AdapterOutput,
  CanonicalFile,
} from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { resolveAgentModel } from "../models/resolve.js";
import { applyCustomization } from "./customization.js";
import { transformEnvVarSyntax } from "./mcp-utils.js";
import { toCursorReadonlyFrontmatter } from "../pipeline/adapterToolTranslator.js";

/**
 * The Cursor adapter generates .mdc files from .md canonical files by adding
 * Cursor-specific frontmatter (description, globs/alwaysApply) and wrapping
 * content in managed blocks. Rules get `alwaysApply: true` or `globs: [...]`
 * based on their scope. Agents get `name`, `description`, `model`, `readonly`,
 * and `is_background` frontmatter fields.
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
      const rules = await readCanonicalFiles(ctx.agentsDir, "rules", this.warnings);
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
      const agents = await readCanonicalFiles(ctx.agentsDir, "agents", this.warnings);
      for (const agent of agents) {
        const { content, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, agent);
        this.warnings.push(...warnings);
        if (skip) continue;
        const prefixedId = toPrefixedId(agent.id);
        const model = resolveAgentModel(agent.id, agent, ctx.manifest, overrides);
        const desc = overrides.description ?? agent.description;
        const lines = [`name: ${agent.id}`, `description: ${desc}`];
        if (model) lines.push(`model: ${model}`);
        // C7.5-W2B2-H41/H45 (D15, P6): Cursor subagent frontmatter has
        // no tool allowlist — the closest native primitive is
        // `readonly: true`, which blocks file edits and state-changing
        // shell commands. Emit readonly whenever the AGENT_TOOL_POLICIES
        // entry lacks both `write` and `execute`, or whenever the
        // canonical agent already declared itself readonly. Policy
        // takes precedence: once a policy forbids write+execute,
        // readonly is emitted regardless of the canonical flag so the
        // monotonic-privilege invariant cannot be widened by omission.
        const policyReadonly = toCursorReadonlyFrontmatter(prefixedId);
        const effectiveReadonly = policyReadonly ?? agent.readonly ?? false;
        if (effectiveReadonly) lines.push("readonly: true");
        if (agent.background) lines.push("is_background: true");
        const fm = `---\n${lines.join("\n")}\n---`;
        results.push(mdcOutput(`.cursor/agents/${prefixedId}.md`, fm, content));
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
      const transformed = transformEnvVarSyntax(mcp, "shell") as Record<string, Record<string, unknown>>;
      results.push(output(".cursor/mcp.json", JSON.stringify({ mcpServers: transformed }, null, 2)));
    }

    const hookResults = await this.readHooks(ctx);
    for (const hook of hookResults) {
      const globs = hook.condition?.globs || [];
      const globLine =
        globs.length > 0
          ? `globs: [${globs.map((g: string) => `"${g}"`).join(", ")}]`
          : "alwaysApply: false";
      const fm = `---\ndescription: "Hook: ${hook.description}"\n${globLine}\n---`;
      const body = `# Hook: ${hook.id}\n\n**Event:** ${hook.event}\n**Agent:** ${hook.agent}\n\n${hook.description}\n\nHATCH3R_HOOK_ACTIVATED: When this hook's event (${hook.event}) is triggered${globs.length > 0 ? ` for files matching ${globs.join(", ")}` : ""}, you MUST spawn the ${hook.agent} agent now. Read and follow the ${hook.agent} agent protocol in \`.agents/agents/${toPrefixedId(hook.agent)}.md\`.`;
      results.push(mdcOutput(`.cursor/rules/${toPrefixedId(`hook-${hook.id}`)}.mdc`, fm, body));
    }

    const bridgeFm = `---
description: Bridge to canonical agent instructions and mandatory orchestration directives
alwaysApply: true
---`;
    const bridgeOrchestration = await this.bridgeOrchestration(ctx);
    const bridgeBody = `# Hatch3r Bridge

This project uses hatch3r for agentic coding setup.
Canonical agent instructions live at \`/.agents/AGENTS.md\`.

${bridgeOrchestration}

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
Plugin configurations in \`.cursor/mcp.json\` are compatible with Team Marketplace distribution.

## Cursor 3.0 Workflows

Cursor 3.0 (April 2, 2026) added two slash commands that pair with hatch3r's parallel-agent pipeline:
- \`/worktree\` — runs the current task in an isolated git worktree so agent edits cannot collide with your working tree. Use it when delegating to the implementer, fixer, or lint-fixer agents.
- \`/best-of-n\` — runs the same task across multiple models in parallel worktrees and compares outcomes. Pair with the reviewer agent to pick the winner.

## Getting Started with Cursor

New to this project's agent setup? Progress through these stages:

**Start here:** Rules in \`.cursor/rules/\` are loaded automatically. The orchestration bridge above guides your workflow.
**Next:** Use \`/hatch3r-feature\` or \`/hatch3r-bug-fix\` commands in Cursor chat for guided workflows.
**Then:** Delegate to agents in \`.cursor/agents/\` — Cursor supports up to 4 subagents in parallel.
**Later:** Customize agent behavior via \`.hatch3r/{type}/{id}.customize.yaml\` without editing managed files.`;
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
