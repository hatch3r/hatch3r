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
        const { content, skip } = await applyCustomizationRaw(ctx.projectRoot, skill);
        if (skip) continue;
        lines.push(`## Skill: ${toPrefixedId(skill.id)}`, "", content, "");
      }
    }

    const inner = lines.join("\n");
    return [output(".goosehints", wrapInManagedBlock(inner), inner)];
  }
}
