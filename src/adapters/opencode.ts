import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { resolveAgentModel, withProviderPrefix } from "../models/resolve.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { applyCustomization } from "./customization.js";
import { transformEnvVarSyntax } from "./mcp-utils.js";
import { HATCH3R_VERSION } from "../version.js";

/**
 * OpenCode adapter — targets sst/opencode (https://github.com/sst/opencode,
 * 146k stars as of 2026-04-19), the successor to the archived opencode-ai org.
 * Adapter output paths track the per-project conventions documented at
 * https://opencode.ai/docs (accessed 2026-04-19):
 *   - Agents:   `.opencode/agents/<name>.md`   (plural, per docs)
 *   - Commands: `.opencode/commands/<name>.md` (plural, per docs)
 *   - Skills:   `.opencode/skills/<name>/SKILL.md`
 *
 * #267 (D9-9.38): OpenCode loads instructions from both `opencode.json`
 * (via the `instructions` array) and individual `.opencode/` files.
 * When both exist, content may be loaded twice in the LLM context.
 * To avoid duplication, `opencode.json` references canonical files
 * in `.agents/` while agent/skill/command files are placed in `.opencode/`.
 * OpenCode deduplicates by file path, so the same file path appearing
 * in both `instructions[]` and `.opencode/` will only be loaded once.
 */
export class OpenCodeAdapter extends BaseAdapter {
  readonly name = "opencode";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    // #267 (D9-9.38): instructions[] references canonical paths in .agents/ only.
    // Agent/skill/command files go in .opencode/ to avoid dual-loading.
    const instructions: string[] = [".agents/AGENTS.md"];
    if (ctx.features.rules) instructions.push(".agents/rules/*.md");
    if (ctx.features.agents) instructions.push(".agents/agents/*.md");
    if (ctx.features.skills) instructions.push(".agents/skills/*/SKILL.md");
    if (ctx.features.commands) instructions.push(".agents/commands/*.md");

    const opencodeConfig: Record<string, unknown> = {
      _hatch3r: {
        version: HATCH3R_VERSION,
        managed: true,
      },
      $schema: "https://opencode.ai/config.json",
      instructions,
    };

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp && Object.keys(mcp).length > 0) {
      const mcpObj: Record<string, unknown> = {};
      for (const [name, server] of Object.entries(mcp)) {
        if (server.command) {
          const cmd = [server.command, ...(server.args || [])];
          const entry: Record<string, unknown> = {
            type: "local",
            command: cmd,
            enabled: true,
            ...(server.env && Object.keys(server.env).length > 0
              ? { environment: transformEnvVarSyntax(server.env, "shell") }
              : {}),
          };
          if (server.headers && Object.keys(server.headers).length > 0) {
            entry.headers = transformEnvVarSyntax(server.headers, "shell");
          }
          mcpObj[name] = entry;
        } else if (server.url) {
          const entry: Record<string, unknown> = { type: "remote", url: server.url, enabled: true };
          if (server.headers && Object.keys(server.headers).length > 0) {
            entry.headers = transformEnvVarSyntax(server.headers, "shell");
          }
          mcpObj[name] = entry;
        }
      }
      if (Object.keys(mcpObj).length > 0) {
        opencodeConfig.mcp = mcpObj;
      }
    }

    results.push(output("opencode.json", JSON.stringify(opencodeConfig, null, 2)));

    if (ctx.features.agents) {
      const agents = await readCanonicalFiles(ctx.agentsDir, "agents", this.warnings);
      for (const agent of agents) {
        const { content, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, agent);
        this.warnings.push(...warnings);
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
