import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { resolveAgentModel } from "../models/resolve.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { applyCustomization } from "./customization.js";
import { escapeTomlString } from "./toml-utils.js";
import { transformEnvVarSyntax } from "./mcp-utils.js";

// Codex adapter — generates configuration for OpenAI Codex CLI.
// Codex reads project config from the `.codex/` directory. Agent-specific
// configurations are written as individual TOML files in `.codex/agents/`.
export class CodexAdapter extends BaseAdapter {
  readonly name = "codex";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    const configLines: string[] = [
      "# Codex project configuration (managed by hatch3r)",
      "#",
      "# Do not manually edit — run `npx hatch3r sync` to regenerate.",
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
        const desc = overrides.description ?? agent.description;

        // Codex expects individual TOML files per agent, not sections in config.toml
        const agentLines: string[] = [
          "# Codex agent configuration (managed by hatch3r)",
          "#",
          "# Do not manually edit — run `npx hatch3r sync` to regenerate.",
          "",
          `description = "${escapeTomlString(desc)}"`,
          `model_instructions_file = "${escapeTomlString(`.agents/agents/${agent.id}.md`)}"`,
        ];
        if (model) agentLines.push(`model = "${escapeTomlString(model)}"`);
        agentLines.push("");
        results.push(output(`.codex/agents/${agentId}.toml`, agentLines.join("\n")));
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
            const transformed = transformEnvVarSyntax(v, "shell") as string;
            configLines.push(`env.${k} = "${escapeTomlString(transformed)}"`);
          }
        }
        if (server.headers) {
          for (const [k, v] of Object.entries(server.headers)) {
            const transformed = transformEnvVarSyntax(v, "shell") as string;
            configLines.push(`headers.${k} = "${escapeTomlString(transformed)}"`);
          }
        }
        configLines.push("");
      }
    }

    // Codex v0.114+ supports hooks
    const hooks = await this.readHooks(ctx);
    if (hooks.length > 0) {
      configLines.push("# Hooks (v0.114+)");
      for (const hook of hooks) {
        configLines.push(`[hooks."${escapeTomlString(hook.event)}"]`);
        configLines.push(`command = "echo \\"HATCH3R_HOOK_ACTIVATED: Spawn the ${escapeTomlString(hook.agent)} agent now. Event: ${escapeTomlString(hook.event)}. Hook ID: ${escapeTomlString(hook.id)}.\\""`)
        if (hook.condition?.globs && hook.condition.globs.length > 0) {
          const globsStr = hook.condition.globs.map((g) => `"${escapeTomlString(g)}"`).join(", ");
          configLines.push(`globs = [${globsStr}]`);
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
