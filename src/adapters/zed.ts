import { dirname } from "node:path";
import type { AdapterOutput, HatchManifest } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BRIDGE_ORCHESTRATION } from "../cli/shared/agentsContent.js";
import { output } from "./base.js";
import type { Adapter } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { resolveAgentModel } from "../models/resolve.js";
import { applyCustomization } from "./customization.js";

export class ZedAdapter implements Adapter {
  name = "zed";

  async generate(
    agentsDir: string,
    manifest: HatchManifest,
  ): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];
    const { features } = manifest;
    const projectRoot = dirname(agentsDir);

    const rulesLines: string[] = [
      "",
      "# Hatch3r Agent Instructions",
      "",
      "Full canonical agent instructions are at `/.agents/AGENTS.md`.",
      "",
      BRIDGE_ORCHESTRATION,
      "",
    ];

    if (features.rules) {
      const rules = await readCanonicalFiles(agentsDir, "rules");
      for (const rule of rules) {
        const { content, skip, overrides } = await applyCustomization(projectRoot, rule);
        if (skip) continue;
        const desc = overrides.description ?? rule.description;
        rulesLines.push(`## ${rule.id}`);
        rulesLines.push("");
        rulesLines.push(desc);
        rulesLines.push("");
        rulesLines.push(content);
        rulesLines.push("");
      }
    }

    if (features.agents) {
      const agents = await readCanonicalFiles(agentsDir, "agents");
      for (const agent of agents) {
        const { content, skip, overrides } = await applyCustomization(projectRoot, agent);
        if (skip) continue;
        const model = resolveAgentModel(agent.id, agent, manifest, overrides);
        const desc = overrides.description ?? agent.description;
        rulesLines.push(`## Agent: ${agent.id}`);
        if (model) rulesLines.push(`**Recommended model:** \`${model}\``);
        rulesLines.push("");
        rulesLines.push(desc);
        rulesLines.push("");
        rulesLines.push(content);
        rulesLines.push("");
      }
    }

    const rulesInner = rulesLines.join("\n");
    results.push(output(".rules", wrapInManagedBlock(rulesInner), rulesInner));

    return results;
  }
}
