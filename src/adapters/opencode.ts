import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { resolveAgentModel, withProviderPrefix } from "../models/resolve.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { applyCustomization } from "./customization.js";

export class OpenCodeAdapter extends BaseAdapter {
  readonly name = "opencode";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    const instructions: string[] = [".agents/AGENTS.md"];
    if (ctx.features.rules) instructions.push(".agents/rules/*.md");
    if (ctx.features.agents) instructions.push(".agents/agents/*.md");
    if (ctx.features.skills) instructions.push(".agents/skills/*/SKILL.md");
    if (ctx.features.commands) instructions.push(".agents/commands/*.md");

    const opencodeConfig: Record<string, unknown> = {
      $schema: "https://opencode.ai/config-schema.json",
      instructions,
    };

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp && Object.keys(mcp).length > 0) {
      const mcpObj: Record<string, unknown> = {};
      for (const [name, server] of Object.entries(mcp)) {
        if (server.command) {
          const cmd = [server.command, ...(server.args || [])];
          mcpObj[name] = {
            type: "local",
            command: cmd,
            enabled: true,
            ...(server.env && Object.keys(server.env).length > 0 ? { environment: server.env } : {}),
          };
        } else if (server.url) {
          mcpObj[name] = { type: "remote", url: server.url, enabled: true };
        }
      }
      if (Object.keys(mcpObj).length > 0) {
        opencodeConfig.mcp = mcpObj;
      }
    }

    results.push(output("opencode.json", JSON.stringify(opencodeConfig, null, 2)));

    if (ctx.features.agents) {
      const agents = await readCanonicalFiles(ctx.agentsDir, "agents");
      for (const agent of agents) {
        const { content, skip, overrides } = await applyCustomization(ctx.projectRoot, agent);
        if (skip) continue;
        const agentId = toPrefixedId(agent.id);
        const model = resolveAgentModel(agent.id, agent, ctx.manifest, overrides);
        const desc = overrides.description ?? agent.description;
        const lines = [`description: ${desc}`];
        if (model) lines.push(`model: ${withProviderPrefix(model)}`);
        const fm = `---\n${lines.join("\n")}\n---`;
        results.push(output(`.opencode/agents/${agentId}.md`, `${fm}\n\n${wrapInManagedBlock(content)}`, content));
      }
    }

    results.push(
      ...await this.processSkillsRaw(ctx, (id) => `.opencode/skills/${toPrefixedId(id)}/SKILL.md`),
    );

    results.push(
      ...await this.processCommandsRaw(ctx, (id) => `.opencode/commands/${toPrefixedId(id)}.md`),
    );

    return results;
  }
}
