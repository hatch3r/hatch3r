import type { AdapterOutput } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";

/**
 * Zed adapter.
 *
 * Generates `.rules` with inline bridge/rules/agents and optional
 * `.zed/mcp.json` for project-level MCP configuration.
 * Zed has no skills, commands, or hooks concepts.
 */
export class ZedAdapter extends BaseAdapter {
  readonly name = "zed";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    const inner = [
      ...await this.bridgeHeader(ctx),
      ...await this.inlineRules(ctx),
      ...await this.inlineAgents(ctx),
    ].join("\n");
    results.push(output(".rules", wrapInManagedBlock(inner), inner));

    // Zed supports project-level MCP configuration via .zed/mcp.json
    const mcp = await this.readFilteredMcp(ctx);
    if (mcp && Object.keys(mcp).length > 0) {
      const entries = this.buildStdMcpEntries(mcp, "shell");
      if (Object.keys(entries).length > 0) {
        results.push(output(".zed/mcp.json", JSON.stringify({ mcpServers: entries }, null, 2) + "\n"));
      }
    }

    return results;
  }
}
