import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { sortByPrecedence, precedenceRank } from "./canonical.js";
import { resolveAgentModel } from "../models/resolve.js";
import { applyCustomization } from "./customization.js";
import { transformEnvVarSyntax } from "./mcp-utils.js";
import { toClineGroupsFrontmatter } from "../pipeline/adapterToolTranslator.js";
import { HATCH3R_VERSION } from "../version.js";

/**
 * Roo Code default fallback groups for agents that have no registered
 * AGENT_TOOL_POLICIES entry (i.e. user-authored agents). Mirrors the
 * permissive set Cline/Roo Code ships by default; only hatch3r-authored
 * agents are subject to the per-policy translation below.
 *
 * Source: https://docs.roocode.com/features/custom-modes (accessed
 * 2026-05-18, Roo Code, official-docs).
 */
const CLINE_DEFAULT_GROUPS: readonly string[] = ["read", "edit", "browser", "command", "mcp"];

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
      const agents = await this.readUserFacingCanonicalFiles(ctx.agentsDir, "agents");
      for (const agent of agents) {
        const { content: rawContent, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, agent);
        this.warnings.push(...warnings);
        if (skip) continue;
        // C9-H47 (D14-SA14.4-H01): substitute detected toolchain tokens.
        const content = this.substituteDetectedRepoTokens(rawContent, ctx);
        const slug = toPrefixedId(agent.id);
        const model = resolveAgentModel(agent.id, agent, ctx.manifest, overrides);
        const modelGuidance = model
          ? `\n\nRecommended model: ${model}. Select this model in the Roo Code model dropdown when using this mode.`
          : "";
        // C9-H21 (D9-SA9.4.F2, P3/P6): translate the agent's hatch3r tool
        // policy to per-mode Roo Code groups instead of hardcoding the
        // full permissive set. Read-only agents (e.g. hatch3r-researcher,
        // hatch3r-reviewer) drop the `edit` and `command` groups so the
        // monotonic-privilege invariant survives on Cline/Roo Code.
        //
        // Fallback path: agents without a registered policy (user-authored
        // agents under .agents/user/agents/) retain the permissive default
        // — hatch3r does not own their tool-allowlist contract.
        const policyGroups = toClineGroupsFrontmatter(slug);
        const groups = policyGroups ?? [...CLINE_DEFAULT_GROUPS];
        customModes.push({
          slug,
          name: agent.id,
          roleDefinition: content + modelGuidance,
          groups,
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
      ...await this.processSkillsRawCliFiltered(ctx, (id) => `.cline/skills/${toPrefixedId(id)}/SKILL.md`),
    );

    if (ctx.features.rules) {
      // C9-H39 (D11-SA11.1-01): use the BaseAdapter-tracked read wrapper so
      // every canonical rule consumed here is recorded in
      // `this._trackedSourceFiles` and surfaces on each output's
      // `sourceFiles` field.
      const rules = await this.readTrackedCanonicalFiles(ctx.agentsDir, "rules");
      // Wave B3: precedence-ordered emission + NN- numeric filename prefix on
      // .roo/rules/. critical=10, high=30, normal=50, low=70. Roo Code loads
      // rule files alphabetically; the prefix establishes deterministic load
      // order at the filesystem level.
      const sortedRules = sortByPrecedence(rules);
      for (const rule of sortedRules) {
        const { content: rawContent, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, rule);
        this.warnings.push(...warnings);
        if (skip) continue;
        // C9-H47 (D14-SA14.4-H01): substitute detected toolchain tokens.
        const content = this.substituteDetectedRepoTokens(rawContent, ctx);
        const desc = overrides.description ?? rule.description;
        const body = `# ${rule.id}\n\n${desc}\n\n${content}`;
        const nn = precedenceRank(rule.precedence) / 10;
        results.push(output(`.roo/rules/${nn}-${toPrefixedId(rule.id)}.md`, wrapInManagedBlock(body), body));
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
          const entry: Record<string, unknown> = {
            command: server.command,
            args: server.args || [],
            ...(server.env && Object.keys(server.env).length > 0
              ? { env: transformEnvVarSyntax(server.env, "shell") }
              : {}),
          };
          if (server.headers && Object.keys(server.headers).length > 0) {
            entry.headers = transformEnvVarSyntax(server.headers, "shell");
          }
          rooMcp[name] = entry;
        } else if (server.url) {
          const entry: Record<string, unknown> = { url: server.url, transport: "streamable-http" };
          if (server.headers && Object.keys(server.headers).length > 0) {
            entry.headers = transformEnvVarSyntax(server.headers, "shell");
          }
          rooMcp[name] = entry;
        }
      }
      if (Object.keys(rooMcp).length > 0) {
        results.push(output(".roo/mcp.json", JSON.stringify({ mcpServers: rooMcp }, null, 2)));
      }
    }

    const bridgeOrchestration = await this.bridgeOrchestration(ctx);
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
