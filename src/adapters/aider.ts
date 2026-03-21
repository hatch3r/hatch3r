import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";

export class AiderAdapter extends BaseAdapter {
  readonly name = "aider";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const inner = [
      ...await this.bridgeHeader(ctx),
      ...await this.inlineRules(ctx),
      ...await this.inlineAgents(ctx),
    ].join("\n");

    const results: AdapterOutput[] = [
      output("CONVENTIONS.md", wrapInManagedBlock(inner), inner),
    ];

    results.push(
      ...await this.processSkillsRaw(ctx, (id) => `.aider/skills/${toPrefixedId(id)}/SKILL.md`),
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
