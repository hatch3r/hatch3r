import { dirname } from "node:path";
import type { AdapterOutput, HatchManifest } from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BRIDGE_ORCHESTRATION } from "../cli/shared/agentsContent.js";
import { output } from "./base.js";
import type { Adapter } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { resolveAgentModel } from "../models/resolve.js";
import { applyCustomization, applyCustomizationRaw } from "./customization.js";

export class GooseAdapter implements Adapter {
  name = "goose";

  async generate(
    agentsDir: string,
    manifest: HatchManifest,
  ): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];
    const { features } = manifest;
    const projectRoot = dirname(agentsDir);

    const hintLines: string[] = [
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
        hintLines.push(`## ${rule.id}`);
        hintLines.push("");
        hintLines.push(desc);
        hintLines.push("");
        hintLines.push(content);
        hintLines.push("");
      }
    }

    if (features.agents) {
      const agents = await readCanonicalFiles(agentsDir, "agents");
      for (const agent of agents) {
        const { content, skip, overrides } = await applyCustomization(projectRoot, agent);
        if (skip) continue;
        const model = resolveAgentModel(agent.id, agent, manifest, overrides);
        const desc = overrides.description ?? agent.description;
        hintLines.push(`## Agent: ${agent.id}`);
        if (model) hintLines.push(`**Recommended model:** \`${model}\``);
        hintLines.push("");
        hintLines.push(desc);
        hintLines.push("");
        hintLines.push(content);
        hintLines.push("");
      }
    }

    if (features.skills) {
      const skills = await readCanonicalFiles(agentsDir, "skills");
      for (const skill of skills) {
        const { content, skip } = await applyCustomizationRaw(projectRoot, skill);
        if (skip) continue;
        hintLines.push(`## Skill: ${toPrefixedId(skill.id)}`);
        hintLines.push("");
        hintLines.push(content);
        hintLines.push("");
      }
    }

    const hintInner = hintLines.join("\n");
    results.push(output(".goosehints", wrapInManagedBlock(hintInner), hintInner));

    return results;
  }
}
