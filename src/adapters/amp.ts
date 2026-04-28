import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";

/**
 * Amp adapter.
 *
 * Generates skills in `.agents/skills/` and `.amp/settings.json` for MCP.
 * Amp reads `AGENTS.md` natively at the project root — that file is written
 * once by `generateRootAgentsMd()` in init/update; the adapter no longer
 * emits it (multi-adapter installs were producing duplicate writes).
 * Amp reads commands natively from `.agents/commands/`.
 */
export class AmpAdapter extends BaseAdapter {
  readonly name = "amp";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    results.push(
      ...await this.processSkillsRaw(ctx, (id) => `.agents/skills/${toPrefixedId(id)}/SKILL.md`),
    );

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp && Object.keys(mcp).length > 0) {
      const entries = this.buildStdMcpEntries(mcp, "shell");
      if (Object.keys(entries).length > 0) {
        results.push(output(".amp/settings.json", JSON.stringify({ "amp.mcpServers": entries }, null, 2)));
      }
    }

    return results;
  }
}
