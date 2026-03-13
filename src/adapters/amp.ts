import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";

export class AmpAdapter extends BaseAdapter {
  readonly name = "amp";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    const inner = [
      ...await this.bridgeHeader(ctx.agentsDir),
      ...await this.inlineRules(ctx),
      ...await this.inlineAgents(ctx, (m) => ({
        text: `**Recommended model:** \`${m}\`. Use Smart mode for Opus, Rush for Haiku, Deep for Codex.`,
      })),
    ].join("\n");
    results.push(output(".amp/AGENTS.md", wrapInManagedBlock(inner), inner));

    results.push(
      ...await this.processSkillsRaw(ctx, (id) => `.amp/skills/${toPrefixedId(id)}/SKILL.md`),
    );

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp && Object.keys(mcp).length > 0) {
      const entries = this.buildStdMcpEntries(mcp);
      if (Object.keys(entries).length > 0) {
        results.push(output(".amp/settings.json", JSON.stringify({ "amp.mcpServers": entries }, null, 2)));
      }
    }

    return results;
  }
}
