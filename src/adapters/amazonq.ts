import type { AdapterOutput } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";

export class AmazonQAdapter extends BaseAdapter {
  readonly name = "amazon-q";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    const inner = [
      ...await this.bridgeHeader(ctx.agentsDir),
      ...await this.inlineRules(ctx),
      ...await this.inlineAgents(ctx),
    ].join("\n");
    results.push(output(".amazonq/rules/hatch3r-agents.md", wrapInManagedBlock(inner), inner));

    results.push(
      ...await this.processSkillsRaw(ctx, (id) => `.amazonq/rules/hatch3r-skill-${id}.md`),
    );

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp && Object.keys(mcp).length > 0) {
      const entries = this.buildStdMcpEntries(mcp);
      if (Object.keys(entries).length > 0) {
        results.push(output(".amazonq/settings.json", JSON.stringify({ mcpServers: entries }, null, 2)));
      }
    }

    return results;
  }
}
