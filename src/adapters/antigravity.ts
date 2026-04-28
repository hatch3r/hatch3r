import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";

/**
 * Antigravity adapter.
 *
 * Generates `.antigravity/rules.md` (bridge with inline rules/agents),
 * skills in `.agent/skills/` (canonical Antigravity workspace skills path),
 * and `.antigravity/settings.json` for MCP server configuration. No hooks
 * or commands support.
 *
 * Reference: https://antigravity.google/docs/skills (accessed 2026-04-19)
 */
export class AntigravityAdapter extends BaseAdapter {
  readonly name = "antigravity";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    const inner = [
      ...await this.bridgeHeader(ctx, ".agents/AGENTS.md"),
      ...await this.inlineRules(ctx),
      ...await this.inlineAgents(ctx),
    ].join("\n").trim();
    results.push(output(".antigravity/rules.md", wrapInManagedBlock(inner), inner));

    results.push(
      ...await this.processSkillsRaw(ctx, (id) => `.agent/skills/${toPrefixedId(id)}/SKILL.md`),
    );

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp && Object.keys(mcp).length > 0) {
      const entries = this.buildStdMcpEntries(mcp, "shell");
      if (Object.keys(entries).length > 0) {
        results.push(output(".antigravity/settings.json", JSON.stringify({ mcpServers: entries }, null, 2)));
      }
    }

    return results;
  }
}
