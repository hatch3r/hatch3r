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

export class AmpAdapter implements Adapter {
  name = "amp";

  async generate(
    agentsDir: string,
    manifest: HatchManifest,
  ): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];
    const { features } = manifest;
    const projectRoot = dirname(agentsDir);

    const bridgeLines: string[] = [];

    if (features.rules) {
      const rules = await readCanonicalFiles(agentsDir, "rules");
      for (const rule of rules) {
        const { content, skip, overrides } = await applyCustomization(projectRoot, rule);
        if (skip) continue;
        const desc = overrides.description ?? rule.description;
        bridgeLines.push(`## ${rule.id}`);
        bridgeLines.push("");
        bridgeLines.push(desc);
        bridgeLines.push("");
        bridgeLines.push(content);
        bridgeLines.push("");
      }
    }

    if (features.agents) {
      const agents = await readCanonicalFiles(agentsDir, "agents");
      for (const agent of agents) {
        const { content, skip, overrides } = await applyCustomization(projectRoot, agent);
        if (skip) continue;
        const model = resolveAgentModel(agent.id, agent, manifest, overrides);
        const desc = overrides.description ?? agent.description;
        bridgeLines.push(`## Agent: ${agent.id}`);
        if (model) bridgeLines.push(`**Recommended model:** \`${model}\`. Use Smart mode for Opus, Rush for Haiku, Deep for Codex.`);
        bridgeLines.push("");
        bridgeLines.push(desc);
        bridgeLines.push("");
        bridgeLines.push(content);
        bridgeLines.push("");
      }
    }

    const innerContent = [
      "",
      "# Hatch3r Agent Instructions",
      "",
      "Full canonical agent instructions are at `/.agents/AGENTS.md`.",
      "",
      BRIDGE_ORCHESTRATION,
      "",
      ...bridgeLines,
    ].join("\n");
    results.push(output(".amp/AGENTS.md", wrapInManagedBlock(innerContent), innerContent));

    if (features.skills) {
      const skills = await readCanonicalFiles(agentsDir, "skills");
      for (const skill of skills) {
        const { content, skip } = await applyCustomizationRaw(projectRoot, skill);
        if (skip) continue;
        results.push(
          output(
            `.amp/skills/${toPrefixedId(skill.id)}/SKILL.md`,
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
          const ampMcp: Record<string, unknown> = {};
          for (const [name, server] of Object.entries(mcpParsed.mcpServers)) {
            if (server._disabled) continue;
            if (server.command) {
              ampMcp[name] = {
                command: server.command,
                args: server.args || [],
                ...(server.env && Object.keys(server.env).length > 0 ? { env: server.env } : {}),
              };
            } else if (server.url) {
              ampMcp[name] = { url: server.url };
            }
          }
          if (Object.keys(ampMcp).length > 0) {
            const ampSettings = {
              "amp.mcpServers": ampMcp,
            };
            results.push(
              output(".amp/settings.json", JSON.stringify(ampSettings, null, 2)),
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
