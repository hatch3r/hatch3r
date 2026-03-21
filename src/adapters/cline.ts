import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { generateBridgeOrchestration } from "../cli/shared/agentsContent.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { resolveAgentModel } from "../models/resolve.js";
import { applyCustomization } from "./customization.js";
import { HATCH3R_VERSION } from "../version.js";

interface ClineCustomMode {
  slug: string;
  name: string;
  roleDefinition: string;
  groups: string[];
  customInstructions?: string;
  whenToUse?: string;
}

export class ClineAdapter extends BaseAdapter {
  readonly name = "cline";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    const customModes: ClineCustomMode[] = [];
    if (ctx.features.agents) {
      const agents = await readCanonicalFiles(ctx.agentsDir, "agents");
      for (const agent of agents) {
        const { content, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, agent);
        this.warnings.push(...warnings);
        if (skip) continue;
        const slug = toPrefixedId(agent.id);
        const model = resolveAgentModel(agent.id, agent, ctx.manifest, overrides);
        const modelGuidance = model
          ? `\n\nRecommended model: ${model}. Select this model in the Roo Code model dropdown when using this mode.`
          : "";
        customModes.push({
          slug,
          name: agent.id,
          roleDefinition: content + modelGuidance,
          groups: ["read", "edit", "browser", "command", "mcp"],
          whenToUse: overrides.description ?? agent.description,
        });
      }
    }
    if (customModes.length > 0) {
      results.push(output(".roomodes", JSON.stringify({
        _hatch3r: {
          version: HATCH3R_VERSION,
          managed: true,
        },
        customModes,
      }, null, 2)));
    }

    results.push(
      ...await this.processSkillsRaw(ctx, (id) => `.cline/skills/${toPrefixedId(id)}/SKILL.md`),
    );

    if (ctx.features.rules) {
      const rules = await readCanonicalFiles(ctx.agentsDir, "rules");
      for (const rule of rules) {
        const { content, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, rule);
        this.warnings.push(...warnings);
        if (skip) continue;
        const desc = overrides.description ?? rule.description;
        const body = `# ${rule.id}\n\n${desc}\n\n${content}`;
        results.push(output(`.roo/rules/${toPrefixedId(rule.id)}.md`, wrapInManagedBlock(body), body));
      }
    }

    const hooks = await this.readHooks(ctx);
    for (const hook of hooks) {
      const globs = hook.condition?.globs || [];
      const body = [
        `# Hook: ${hook.id}`,
        "",
        `**Event:** ${hook.event}`,
        `**Agent:** ${hook.agent}`,
        "",
        hook.description,
        "",
        `HATCH3R_HOOK_ACTIVATED: When this hook's event (${hook.event}) is triggered${globs.length > 0 ? ` for files matching ${globs.join(", ")}` : ""}, you MUST spawn the ${hook.agent} agent now. Read and follow the ${hook.agent} agent protocol in \`.agents/agents/${toPrefixedId(hook.agent)}.md\`.`,
      ].join("\n");
      results.push(output(`.roo/rules/${toPrefixedId(`hook-${hook.id}`)}.md`, wrapInManagedBlock(body), body));
    }

    results.push(
      ...await this.processCommandsRaw(ctx, (id) => `.clinerules/workflows/${toPrefixedId(id)}.md`),
    );

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp && Object.keys(mcp).length > 0) {
      const rooMcp: Record<string, Record<string, unknown>> = {};
      for (const [name, server] of Object.entries(mcp)) {
        if (server.command) {
          rooMcp[name] = {
            command: server.command,
            args: server.args || [],
            ...(server.env && Object.keys(server.env).length > 0 ? { env: server.env } : {}),
          };
        } else if (server.url) {
          rooMcp[name] = { url: server.url, transport: "streamable-http" };
        }
      }
      if (Object.keys(rooMcp).length > 0) {
        results.push(output(".roo/mcp.json", JSON.stringify({ mcpServers: rooMcp }, null, 2)));
      }
    }

    const bridgeOrchestration = await generateBridgeOrchestration(ctx.agentsDir);
    const bridgeBody = [
      "# Hatch3r Bridge",
      "",
      "This project uses hatch3r for agentic coding setup.",
      "Canonical agent instructions live at `/.agents/AGENTS.md`.",
      "Rules and skills are managed in `.roo/rules/` and `.cline/skills/`.",
      "",
      bridgeOrchestration,
      "",
      "## Getting Started with Roo Code",
      "",
      "New to this project's agent setup? Progress through these stages:",
      "",
      "**Start here:** Rules in `.roo/rules/` are loaded automatically. The orchestration bridge above guides your workflow.",
      "**Next:** Use workflow commands in `.clinerules/workflows/` for guided task execution.",
      "**Then:** Switch to custom modes (defined in `.roomodes`) for specialized agent behaviors.",
      "**Later:** Customize agent behavior via `.hatch3r/{type}/{id}.customize.yaml` without editing managed files.",
    ].join("\n");
    results.push(output(".roo/rules/hatch3r-bridge.md", wrapInManagedBlock(bridgeBody), bridgeBody));

    return results;
  }
}
