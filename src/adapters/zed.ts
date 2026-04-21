import type { AdapterOutput } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";

/**
 * Zed adapter.
 *
 * Generates `.rules` with inline bridge/rules/agents and optional
 * `.zed/mcp.json` for project-level MCP configuration.
 * Zed has no skills, commands, or hooks concepts.
 *
 * Zed 2026 platform capabilities surfaced in the bridge body (C8-D9-M2, P3):
 *   - `spawn_agent` tool: Agent Control Protocol (ACP) primitive shipped in
 *     Zed 0.227.1 (2026-03). The Zed Agent spawns subagents for parallel
 *     task execution and scoped context. Source:
 *     https://zed.dev/releases/stable (accessed 2026-04-19).
 *   - OAuth MCP authentication: MCP servers requiring OAuth render an
 *     "Authenticate" button that redirects to the authorization server.
 *     Shipped in Zed 0.230.0. Source: https://zed.dev/releases/stable
 *     (accessed 2026-04-19). `.zed/mcp.json` continues to carry the
 *     static server config; OAuth is completed interactively in Zed.
 */
export class ZedAdapter extends BaseAdapter {
  readonly name = "zed";

  /**
   * Platform capability notes emitted into `.rules` between the bridge
   * header and the inline rules sections. Keeps the agent aware of the
   * Zed 2026 primitives (spawn_agent, OAuth MCP auth) when planning
   * work inside Zed's Agent Panel.
   */
  private zedPlatformCapabilities(): string[] {
    return [
      "## Zed Platform Capabilities",
      "",
      "- **`spawn_agent` (Zed 0.227.1+):** Zed's Agent Control Protocol (ACP)",
      "  exposes a `spawn_agent` tool that lets the Zed Agent delegate scoped",
      "  subtasks to subagents for parallel execution and tighter context",
      "  windows. Prefer `spawn_agent` over sequential tool calls when the",
      "  work fans out across independent files or concerns.",
      "- **OAuth MCP authentication (Zed 0.230.0+):** MCP servers configured",
      "  in `.zed/mcp.json` that require OAuth render an \"Authenticate\"",
      "  button in the Agent Panel and redirect the user to the authorization",
      "  server. Do not embed OAuth tokens in `.zed/mcp.json` — complete the",
      "  browser flow in Zed and let the editor store the credential.",
      "",
    ];
  }

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    const inner = [
      ...await this.bridgeHeader(ctx),
      ...this.zedPlatformCapabilities(),
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
