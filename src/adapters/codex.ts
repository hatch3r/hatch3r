import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { resolveAgentModel } from "../models/resolve.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { applyCustomization } from "./customization.js";
import { escapeTomlString } from "./toml-utils.js";

// Codex adapter — generates configuration for OpenAI Codex CLI.
// Codex reads project config from the `.codex/` directory and uses
// `.agents/AGENTS.md` as the primary model instructions file (set via
// model_instructions_file in .codex/config.toml). Agent-specific
// instructions are referenced from `.agents/agents/<id>.md`.
export class CodexAdapter extends BaseAdapter {
  readonly name = "codex";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    const configLines: string[] = [
      "# Codex project configuration (managed by hatch3r)",
      "#",
      "# Do not manually edit — run `npx hatch3r sync` to regenerate.",
      "",
      'model_instructions_file = ".agents/AGENTS.md"',
      "",
    ];

    if (ctx.features.rules) {
      const rules = await readCanonicalFiles(ctx.agentsDir, "rules");
      const enabledRules = [];
      for (const rule of rules) {
        const { skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, rule);
        this.warnings.push(...warnings);
        if (skip) continue;
        const desc = overrides.description ?? rule.description;
        enabledRules.push({ ...rule, description: desc });
      }
      if (enabledRules.length > 0) {
        configLines.push("# Additional instruction files (rules)");
        for (const rule of enabledRules) {
          configLines.push(`# rule: ${rule.id} — ${rule.description}`);
        }
        configLines.push("");
      }
    }

    if (ctx.features.agents) {
      const agents = await readCanonicalFiles(ctx.agentsDir, "agents");
      for (const agent of agents) {
        const { skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, agent);
        this.warnings.push(...warnings);
        if (skip) continue;
        const agentId = toPrefixedId(agent.id);
        const model = resolveAgentModel(agent.id, agent, ctx.manifest, overrides);
        configLines.push(`[agents.${agentId}]`);
        configLines.push(`model_instructions_file = "${escapeTomlString(`.agents/agents/${agent.id}.md`)}"`);
        if (model) configLines.push(`model = "${escapeTomlString(model)}"`);
        configLines.push("");
      }
    }

    const mcpFiltered = await this.readFilteredMcp(ctx);
    if (mcpFiltered) {
      for (const [name, server] of Object.entries(mcpFiltered)) {
        configLines.push(`[mcp_servers.${name}]`);
        if (server.command) {
          configLines.push(`command = "${escapeTomlString(server.command)}"`);
          if (server.args && server.args.length > 0) {
            const argsStr = server.args.map((a) => `"${escapeTomlString(a)}"`).join(", ");
            configLines.push(`args = [${argsStr}]`);
          }
        } else if (server.url) {
          configLines.push(`url = "${escapeTomlString(server.url)}"`);
        }
        if (server.env) {
          for (const [k, v] of Object.entries(server.env)) {
            configLines.push(`env.${k} = "${escapeTomlString(v)}"`);
          }
        }
        configLines.push("");
      }
    }

    results.push(output(".codex/config.toml", configLines.join("\n")));

    results.push(
      ...await this.processSkillsRaw(ctx, (id) => `.codex/skills/${toPrefixedId(id)}/SKILL.md`),
    );

    return results;
  }
}
