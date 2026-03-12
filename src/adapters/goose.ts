import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { applyCustomizationRaw } from "./customization.js";

export class GooseAdapter extends BaseAdapter {
  readonly name = "goose";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const lines = [
      ...this.bridgeHeader(),
      ...await this.inlineRules(ctx),
      ...await this.inlineAgents(ctx),
    ];

    if (ctx.features.skills) {
      const skills = await readCanonicalFiles(ctx.agentsDir, "skills");
      for (const skill of skills) {
        const { content, skip, warnings } = await applyCustomizationRaw(ctx.projectRoot, skill);
        this.warnings.push(...warnings);
        if (skip) continue;
        lines.push(`## Skill: ${toPrefixedId(skill.id)}`, "", content, "");
      }
    }

    const inner = lines.join("\n");
    const results: AdapterOutput[] = [output(".goosehints", wrapInManagedBlock(inner), inner)];

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp && Object.keys(mcp).length > 0) {
      const entries = this.buildStdMcpEntries(mcp);
      if (Object.keys(entries).length > 0) {
        const gooseMcp: Record<string, unknown> = {};
        for (const [name, entry] of Object.entries(entries)) {
          gooseMcp[name] = entry;
        }
        results.push(output(".goose/mcp.json", JSON.stringify(gooseMcp, null, 2)));
      }
    }

    return results;
  }
}
