import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { applyCustomization } from "./customization.js";

function isGlobPattern(scope: string): boolean {
  return scope.includes("*") || scope.includes("?") || scope.includes("[");
}

function ruleTrigger(scope: string | undefined): "always_on" | "glob" | "model_decision" {
  if (!scope) return "model_decision";
  if (scope === "always") return "always_on";
  return "glob";
}

export class WindsurfAdapter extends BaseAdapter {
  readonly name = "windsurf";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    const bridgeOrchestration = await this.bridgeOrchestration(ctx);
    const windsurfInner = [
      "",
      "# Hatch3r Agent Instructions",
      "",
      "Full canonical agent instructions are at `/.agents/AGENTS.md`.",
      "Rules and skills are managed in `.windsurf/rules/` and `.windsurf/skills/`.",
      "",
      bridgeOrchestration,
      "",
      ...await this.inlineAgents(ctx),
      "",
      "## Getting Started with Windsurf",
      "",
      "New to this project's agent setup? Progress through these stages:",
      "",
      "**Start here:** Rules in `.windsurf/rules/` are loaded automatically. The orchestration bridge above guides your workflow.",
      "**Next:** Use commands in `.windsurf/workflows/` for guided workflows (e.g., feature development, bug fixes).",
      "**Then:** Use parallel Cascade sessions for independent tasks to maximize throughput.",
      "**Later:** Customize agent behavior via `.hatch3r/{type}/{id}.customize.yaml` without editing managed files.",
      "",
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
        const globScope = (trigger === "glob" && scope)
          ? (isGlobPattern(scope) ? scope : `${scope}/**`)
          : undefined;
        const desc = overrides.description ?? rule.description;
        // Windsurf requires a description field for model_decision triggers
        // so the AI model knows when to activate the rule.
        const descField = trigger === "model_decision" ? `\ndescription: "${desc.replace(/"/g, '\\"')}"` : "";
        const fm = `---\ntrigger: ${trigger}${descField}${globScope ? `\nglobs: "${globScope}"` : ""}\n---`;
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
      const entries = this.buildStdMcpEntries(mcp, "shell");
      if (Object.keys(entries).length > 0) {
        results.push(output(".windsurf/mcp.json", JSON.stringify({ mcpServers: entries }, null, 2) + "\n"));
      }
    }

    return results;
  }
}
