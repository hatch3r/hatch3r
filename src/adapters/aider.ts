import { dirname } from "node:path";
import type { AdapterOutput, HatchManifest } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BRIDGE_ORCHESTRATION } from "../cli/shared/agentsContent.js";
import { output } from "./base.js";
import type { Adapter } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { resolveAgentModel } from "../models/resolve.js";
import { applyCustomization, applyCustomizationRaw } from "./customization.js";
import { toPrefixedId } from "../types.js";

export class AiderAdapter implements Adapter {
  name = "aider";

  async generate(
    agentsDir: string,
    manifest: HatchManifest,
  ): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];
    const { features } = manifest;
    const projectRoot = dirname(agentsDir);

    const conventionLines: string[] = [
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
        conventionLines.push(`## ${rule.id}`);
        conventionLines.push("");
        conventionLines.push(desc);
        conventionLines.push("");
        conventionLines.push(content);
        conventionLines.push("");
      }
    }

    if (features.agents) {
      const agents = await readCanonicalFiles(agentsDir, "agents");
      for (const agent of agents) {
        const { content, skip, overrides } = await applyCustomization(projectRoot, agent);
        if (skip) continue;
        const model = resolveAgentModel(agent.id, agent, manifest, overrides);
        const desc = overrides.description ?? agent.description;
        conventionLines.push(`## Agent: ${agent.id}`);
        if (model) conventionLines.push(`**Recommended model:** \`${model}\``);
        conventionLines.push("");
        conventionLines.push(desc);
        conventionLines.push("");
        conventionLines.push(content);
        conventionLines.push("");
      }
    }

    const conventionInner = conventionLines.join("\n");
    results.push(output("CONVENTIONS.md", wrapInManagedBlock(conventionInner), conventionInner));

    if (features.skills) {
      const skills = await readCanonicalFiles(agentsDir, "skills");
      for (const skill of skills) {
        const { content, skip } = await applyCustomizationRaw(projectRoot, skill);
        if (skip) continue;
        results.push(
          output(
            `.aider/skills/${toPrefixedId(skill.id)}/SKILL.md`,
            wrapInManagedBlock(content),
            content,
          ),
        );
      }
    }

    const configYaml = [
      "# Managed by hatch3r — do not edit manually",
      "read:",
      "  - CONVENTIONS.md",
      "  - .agents/AGENTS.md",
      "auto-lint: true",
      "",
    ].join("\n");
    results.push(output(".aider.conf.yml", configYaml));

    return results;
  }
}
