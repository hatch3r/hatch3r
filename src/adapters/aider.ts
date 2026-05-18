import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";

/**
 * Aider adapter.
 *
 * Generates `CONVENTIONS.md` (bridge with inline rules/agents),
 * skills in `.aider/skills/`, and `.aider.conf.yml` pointing to
 * CONVENTIONS.md and AGENTS.md. Aider has no MCP or hooks support.
 */
export class AiderAdapter extends BaseAdapter {
  readonly name = "aider";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const inner = [
      ...await this.bridgeHeader(ctx),
      ...await this.inlineRules(ctx),
      ...await this.inlineAgents(ctx),
    ].join("\n").trim();

    const results: AdapterOutput[] = [
      output("CONVENTIONS.md", wrapInManagedBlock(inner), inner),
    ];

    results.push(
      ...await this.processSkillsRawCliFiltered(ctx, (id) => `.aider/skills/${toPrefixedId(id)}/SKILL.md`),
    );

    // Note: Aider config is output as YAML (.aider.conf.yml). If TOML output is
    // ever added for Aider, all string values must be properly escaped using
    // escapeTomlString() from toml-utils.ts to handle backslashes, quotes, and
    // control characters correctly.
    results.push(output(".aider.conf.yml", [
      "# Managed by hatch3r — do not edit manually",
      "read:",
      "  - CONVENTIONS.md",
      "  - .agents/AGENTS.md",
      "auto-lint: true",
      "",
    ].join("\n")));

    return results;
  }
}
