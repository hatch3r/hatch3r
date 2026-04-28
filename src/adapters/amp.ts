import type { AdapterOutput } from "../types.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";

/**
 * Amp adapter.
 *
 * Emits only `.amp/settings.json` (when MCP servers are configured).
 *
 * Skills are NOT re-emitted by amp. Amp reads `.agents/skills/` natively
 * from the canonical mirror — that directory is populated once by
 * `copyHatch3rFiles()` during init/update with raw, unwrapped SKILL.md
 * content. Re-emitting through `processSkillsRaw()` would target the same
 * paths and cause `safeWriteFile`'s `appendIfNoBlock` branch to corrupt
 * each file by prepending a HATCH3R managed block before the YAML
 * frontmatter, which then fails to parse.
 *
 * Amp reads `AGENTS.md` natively at the project root — that file is
 * written once by `generateRootAgentsMd()` in init/update; the adapter
 * does not emit it. Amp also reads commands natively from
 * `.agents/commands/`.
 */
export class AmpAdapter extends BaseAdapter {
  readonly name = "amp";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

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
