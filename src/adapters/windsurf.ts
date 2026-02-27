import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import chalk from "chalk";
import type {
  AdapterOutput,
  HatchManifest,
} from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BRIDGE_ORCHESTRATION } from "../cli/shared/agentsContent.js";
import { output } from "./base.js";
import type { Adapter } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { resolveAgentModel } from "../models/resolve.js";
import { applyCustomization, applyCustomizationRaw } from "./customization.js";

function isGlobPattern(scope: string): boolean {
  return scope.includes("*") || scope.includes("?") || scope.includes("[");
}

function ruleTrigger(scope: string | undefined): "always_on" | "glob_pattern" | "model_decision" {
  if (!scope) return "model_decision";
  if (scope === "always") return "always_on";
  return "glob_pattern";
}

export class WindsurfAdapter implements Adapter {
  name = "windsurf";

  async generate(
    agentsDir: string,
    manifest: HatchManifest,
  ): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];
    const { features } = manifest;
    const projectRoot = dirname(agentsDir);

    const windsurfrulesLines = [
      "",
      "# Hatch3r Agent Instructions",
      "",
      "Full canonical agent instructions are at `/.agents/AGENTS.md`.",
      "Rules and skills are managed in `.windsurf/rules/` and `.windsurf/skills/`.",
      "",
      BRIDGE_ORCHESTRATION,
      "",
    ];

    if (features.agents) {
      const agents = await readCanonicalFiles(agentsDir, "agents");
      for (const agent of agents) {
        const { content, skip, overrides } = await applyCustomization(projectRoot, agent);
        if (skip) continue;
        const model = resolveAgentModel(agent.id, agent, manifest, overrides);
        windsurfrulesLines.push(`## Agent: ${agent.id}`);
        if (model) windsurfrulesLines.push(`**Recommended model:** \`${model}\``);
        windsurfrulesLines.push("");
        windsurfrulesLines.push(overrides.description ?? agent.description);
        windsurfrulesLines.push("");
        windsurfrulesLines.push(content);
        windsurfrulesLines.push("");
      }
    }

    const windsurfInner = windsurfrulesLines.join("\n");
    results.push(output(".windsurfrules", wrapInManagedBlock(windsurfInner), windsurfInner));

    if (features.rules) {
      const rules = await readCanonicalFiles(agentsDir, "rules");
      for (const rule of rules) {
        const { content, skip, overrides } = await applyCustomization(projectRoot, rule);
        if (skip) continue;
        const scope = overrides.scope ?? rule.scope;
        const trigger = ruleTrigger(scope);
        const globScope = (trigger === "glob_pattern" && scope)
          ? (isGlobPattern(scope) ? scope : `${scope}/**`)
          : undefined;
        const fm = `<!-- trigger: ${trigger}${globScope ? `, globs: ${globScope}` : ""} -->`;
        const desc = overrides.description ?? rule.description;
        const body = `# ${rule.id}\n\n${desc}\n\n${content}`;
        results.push(
          output(
            `.windsurf/rules/${toPrefixedId(rule.id)}.md`,
            `${fm}\n\n${wrapInManagedBlock(body)}`,
            body,
          ),
        );
      }
    }

    if (features.skills) {
      const skills = await readCanonicalFiles(agentsDir, "skills");
      for (const skill of skills) {
        const { content, skip, overrides } = await applyCustomization(projectRoot, skill);
        if (skip) continue;
        const desc = overrides.description ?? skill.description;
        const fm = `---\nname: ${skill.id}\ndescription: ${desc}\n---`;
        results.push(
          output(
            `.windsurf/skills/${toPrefixedId(skill.id)}/SKILL.md`,
            `${fm}\n\n${wrapInManagedBlock(content)}`,
            content,
          ),
        );
      }
    }

    if (features.commands) {
      const commands = await readCanonicalFiles(agentsDir, "commands");
      for (const cmd of commands) {
        const { content, skip } = await applyCustomizationRaw(projectRoot, cmd);
        if (skip) continue;
        results.push(
          output(
            `.windsurf/workflows/${toPrefixedId(cmd.id)}.md`,
            wrapInManagedBlock(content),
            content,
          ),
        );
      }
    }

    if (features.mcp && manifest.mcp.servers.length > 0) {
      const mcpPath = join(agentsDir, "mcp", "mcp.json");
      try {
        const mcpRaw = await readFile(mcpPath, "utf-8");
        const mcpParsed = JSON.parse(mcpRaw) as { mcpServers?: Record<string, Record<string, unknown>> };
        if (mcpParsed.mcpServers) {
          results.push(
            output(".windsurf/mcp.json", JSON.stringify(mcpParsed, null, 2) + "\n"),
          );
        }
      } catch (err) {
        console.warn(chalk.yellow(`  Warning: Could not read MCP config: ${err instanceof Error ? err.message : String(err)}`));
      }
    }

    return results;
  }
}
