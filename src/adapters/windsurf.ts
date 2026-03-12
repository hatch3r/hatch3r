import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BRIDGE_ORCHESTRATION } from "../cli/shared/agentsContent.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { applyCustomization } from "./customization.js";

function isGlobPattern(scope: string): boolean {
  return scope.includes("*") || scope.includes("?") || scope.includes("[");
}

function ruleTrigger(scope: string | undefined): "always_on" | "glob_pattern" | "model_decision" {
  if (!scope) return "model_decision";
  if (scope === "always") return "always_on";
  return "glob_pattern";
}

export class WindsurfAdapter extends BaseAdapter {
  readonly name = "windsurf";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    const windsurfInner = [
      "",
      "# Hatch3r Agent Instructions",
      "",
      "Full canonical agent instructions are at `/.agents/AGENTS.md`.",
      "Rules and skills are managed in `.windsurf/rules/` and `.windsurf/skills/`.",
      "",
      BRIDGE_ORCHESTRATION,
      "",
      ...await this.inlineAgents(ctx),
    ].join("\n");
    results.push(output(".windsurfrules", wrapInManagedBlock(windsurfInner), windsurfInner));

    if (ctx.features.rules) {
      const rules = await readCanonicalFiles(ctx.agentsDir, "rules");
      for (const rule of rules) {
        const { content, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, rule);
        this.warnings.push(...warnings);
        if (skip) continue;
        const scope = overrides.scope ?? rule.scope;
        const trigger = ruleTrigger(scope);
        const globScope = (trigger === "glob_pattern" && scope)
          ? (isGlobPattern(scope) ? scope : `${scope}/**`)
          : undefined;
        const fm = `---\ntrigger: ${trigger}${globScope ? `\nglobs: "${globScope}"` : ""}\n---`;
        const desc = overrides.description ?? rule.description;
        const body = `# ${rule.id}\n\n${desc}\n\n${content}`;
        results.push(output(`.windsurf/rules/${toPrefixedId(rule.id)}.md`, `${fm}\n\n${wrapInManagedBlock(body)}`, body));
      }
    }

    results.push(
      ...await this.processSkillsWithFm(ctx, (id) => `.windsurf/skills/${toPrefixedId(id)}/SKILL.md`),
    );

    results.push(
      ...await this.processCommandsRaw(ctx, (id) => `.windsurf/workflows/${toPrefixedId(id)}.md`),
    );

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp && Object.keys(mcp).length > 0) {
      const entries = this.buildStdMcpEntries(mcp);
      if (Object.keys(entries).length > 0) {
        results.push(output(".windsurf/mcp.json", JSON.stringify({ mcpServers: entries }, null, 2) + "\n"));
      }
    }

    return results;
  }
}
