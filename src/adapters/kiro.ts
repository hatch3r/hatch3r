import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import chalk from "chalk";
import type { AdapterOutput, HatchManifest } from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BRIDGE_ORCHESTRATION } from "../cli/shared/agentsContent.js";
import { output } from "./base.js";
import type { Adapter } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { resolveAgentModel } from "../models/resolve.js";
import { applyCustomization, applyCustomizationRaw } from "./customization.js";

interface McpServerEntry {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  _disabled?: boolean;
}

function steeringFrontmatter(globs?: string): string {
  if (!globs) return "";
  return `---\ninclusion: conditional\nglobs: "${globs}"\n---\n\n`;
}

export class KiroAdapter implements Adapter {
  name = "kiro";

  async generate(
    agentsDir: string,
    manifest: HatchManifest,
  ): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];
    const { features } = manifest;
    const projectRoot = dirname(agentsDir);

    const steeringLines: string[] = [
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
        const scope = overrides.scope ?? rule.scope;
        const desc = overrides.description ?? rule.description;

        if (scope && scope !== "always") {
          const globs = scope.includes("*") ? scope : `${scope}/**`;
          const fm = steeringFrontmatter(globs);
          const body = `# ${rule.id}\n\n${desc}\n\n${content}`;
          results.push(
            output(
              `.kiro/steering/${toPrefixedId(rule.id)}.md`,
              `${fm}${wrapInManagedBlock(body)}`,
              body,
            ),
          );
        } else {
          steeringLines.push(`## ${rule.id}`);
          steeringLines.push("");
          steeringLines.push(desc);
          steeringLines.push("");
          steeringLines.push(content);
          steeringLines.push("");
        }
      }
    }

    if (features.agents) {
      const agents = await readCanonicalFiles(agentsDir, "agents");
      for (const agent of agents) {
        const { content, skip, overrides } = await applyCustomization(projectRoot, agent);
        if (skip) continue;
        const model = resolveAgentModel(agent.id, agent, manifest, overrides);
        const desc = overrides.description ?? agent.description;
        steeringLines.push(`## Agent: ${agent.id}`);
        if (model) steeringLines.push(`**Recommended model:** \`${model}\``);
        steeringLines.push("");
        steeringLines.push(desc);
        steeringLines.push("");
        steeringLines.push(content);
        steeringLines.push("");
      }
    }

    const steeringInner = steeringLines.join("\n");
    results.push(
      output(
        ".kiro/steering/hatch3r-agents.md",
        wrapInManagedBlock(steeringInner),
        steeringInner,
      ),
    );

    if (features.skills) {
      const skills = await readCanonicalFiles(agentsDir, "skills");
      for (const skill of skills) {
        const { content, skip } = await applyCustomizationRaw(projectRoot, skill);
        if (skip) continue;
        results.push(
          output(
            `.kiro/steering/${toPrefixedId(skill.id)}.md`,
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
        const mcpParsed = JSON.parse(mcpRaw) as { mcpServers?: Record<string, McpServerEntry> };
        if (mcpParsed.mcpServers) {
          const kiroMcp: Record<string, unknown> = {};
          for (const [name, server] of Object.entries(mcpParsed.mcpServers)) {
            if (server._disabled) continue;
            if (server.command) {
              kiroMcp[name] = {
                command: server.command,
                args: server.args || [],
                ...(server.env && Object.keys(server.env).length > 0 ? { env: server.env } : {}),
              };
            } else if (server.url) {
              kiroMcp[name] = { url: server.url };
            }
          }
          if (Object.keys(kiroMcp).length > 0) {
            results.push(
              output(
                ".kiro/settings/mcp.json",
                JSON.stringify({ mcpServers: kiroMcp }, null, 2),
              ),
            );
          }
        }
      } catch (err) {
        console.warn(chalk.yellow(`  Warning: Could not read MCP config: ${err instanceof Error ? err.message : String(err)}`));
      }
    }

    return results;
  }
}
