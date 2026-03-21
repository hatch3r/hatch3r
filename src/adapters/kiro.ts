import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { applyCustomization } from "./customization.js";
import type { HookEvent } from "../hooks/types.js";

function steeringFrontmatter(globs?: string): string {
  if (!globs) return "";
  return `---\ninclusion: fileMatch\nfileMatchPattern: "${globs}"\n---\n\n`;
}

export class KiroAdapter extends BaseAdapter {
  readonly name = "kiro";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];
    const lines = [...await this.bridgeHeader(ctx)];

    if (ctx.features.rules) {
      const rules = await readCanonicalFiles(ctx.agentsDir, "rules");
      for (const rule of rules) {
        const { content, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, rule);
        this.warnings.push(...warnings);
        if (skip) continue;
        const scope = overrides.scope ?? rule.scope;
        const desc = overrides.description ?? rule.description;

        if (scope && scope !== "always") {
          const globs = scope.includes("*") ? scope : `${scope}/**`;
          const fm = steeringFrontmatter(globs);
          const body = `# ${rule.id}\n\n${desc}\n\n${content}`;
          results.push(output(`.kiro/steering/hatch3r-rule-${rule.id}.md`, `${fm}${wrapInManagedBlock(body)}`, body));
        } else {
          lines.push(`## ${rule.id}`, "", desc, "", content, "");
        }
      }
    }

    lines.push(...await this.inlineAgents(ctx));
    const inner = lines.join("\n");
    results.push(output(".kiro/steering/hatch3r-agents.md", wrapInManagedBlock(inner), inner));

    results.push(
      ...await this.processSkillsRaw(ctx, (id) => `.kiro/steering/hatch3r-skill-${id}.md`),
    );

    const hooks = await this.readHooks(ctx);
    if (hooks.length > 0) {
      const hookLines: string[] = ["# Hatch3r Hooks", ""];
      for (const hook of hooks) {
        hookLines.push(`## ${hook.id}`, "");
        hookLines.push(`**Event:** ${hook.event}`);
        hookLines.push(`**Agent:** ${hook.agent}`);
        hookLines.push(`**Description:** ${hook.description}`);
        if (hook.condition?.globs) {
          hookLines.push(`**Globs:** ${hook.condition.globs.join(", ")}`);
        }
        hookLines.push("");
        hookLines.push(`HATCH3R_HOOK_ACTIVATED: When this hook's event (${hook.event}) is triggered, you MUST spawn the ${hook.agent} agent now. Read and follow the ${hook.agent} agent protocol in \`.agents/agents/${toPrefixedId(hook.agent)}.md\`.`);
        hookLines.push("");
      }
      const hookContent = hookLines.join("\n");
      results.push(output(".kiro/steering/hatch3r-hooks.md", wrapInManagedBlock(hookContent), hookContent));
    }

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp && Object.keys(mcp).length > 0) {
      const entries = this.buildStdMcpEntries(mcp);
      if (Object.keys(entries).length > 0) {
        results.push(output(".kiro/settings/mcp.json", JSON.stringify({ mcpServers: entries }, null, 2)));
      }
    }

    return results;
  }
}
