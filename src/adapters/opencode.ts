import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import chalk from "chalk";
import type {
  AdapterOutput,
  HatchManifest,
} from "../types.js";
import { resolveAgentModel, withProviderPrefix } from "../models/resolve.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { output } from "./base.js";
import type { Adapter } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { applyCustomization, applyCustomizationRaw } from "./customization.js";

interface McpServerEntry {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  _disabled?: boolean;
}

export class OpenCodeAdapter implements Adapter {
  name = "opencode";

  async generate(
    agentsDir: string,
    manifest: HatchManifest,
  ): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];
    const { features } = manifest;
    const projectRoot = dirname(agentsDir);

    const instructions: string[] = [".agents/AGENTS.md"];
    if (features.rules) instructions.push(".agents/rules/*.md");
    if (features.agents) instructions.push(".agents/agents/*.md");
    if (features.skills) instructions.push(".agents/skills/*/SKILL.md");
    if (features.commands) instructions.push(".agents/commands/*.md");

    const opencodeConfig: Record<string, unknown> = {
      $schema: "https://opencode.ai/config-schema.json",
      instructions,
    };

    if (features.mcp && manifest.mcp.servers.length > 0) {
      const mcpPath = join(agentsDir, "mcp", "mcp.json");
      try {
        const mcpRaw = await readFile(mcpPath, "utf-8");
        const mcpParsed = JSON.parse(mcpRaw) as { mcpServers?: Record<string, McpServerEntry> };
        if (mcpParsed.mcpServers) {
          const mcp: Record<string, unknown> = {};
          for (const [name, server] of Object.entries(mcpParsed.mcpServers)) {
            if (server._disabled) continue;
            if (server.command) {
              const cmd = [server.command, ...(server.args || [])];
              mcp[name] = {
                type: "local",
                command: cmd,
                enabled: true,
                ...(server.env && Object.keys(server.env).length > 0 ? { environment: server.env } : {}),
              };
            } else if (server.url) {
              mcp[name] = {
                type: "remote",
                url: server.url,
                enabled: true,
              };
            }
          }
          if (Object.keys(mcp).length > 0) {
            opencodeConfig.mcp = mcp;
          }
        }
      } catch (err) {
        console.warn(chalk.yellow(`  Warning: Could not read MCP config: ${err instanceof Error ? err.message : String(err)}`));
      }
    }

    results.push(output("opencode.json", JSON.stringify(opencodeConfig, null, 2)));

    if (features.agents) {
      const agents = await readCanonicalFiles(agentsDir, "agents");
      for (const agent of agents) {
        const { content, skip, overrides } = await applyCustomization(projectRoot, agent);
        if (skip) continue;
        const agentId = toPrefixedId(agent.id);
        const model = resolveAgentModel(agent.id, agent, manifest, overrides);
        const desc = overrides.description ?? agent.description;
        const lines = [`description: ${desc}`];
        if (model) lines.push(`model: ${withProviderPrefix(model)}`);
        const fm = `---\n${lines.join("\n")}\n---`;
        results.push(
          output(
            `.opencode/agents/${agentId}.md`,
            `${fm}\n\n${wrapInManagedBlock(content)}`,
            content,
          ),
        );
      }
    }

    if (features.skills) {
      const skills = await readCanonicalFiles(agentsDir, "skills");
      for (const skill of skills) {
        const { content, skip } = await applyCustomizationRaw(projectRoot, skill);
        if (skip) continue;
        results.push(
          output(
            `.opencode/skills/${toPrefixedId(skill.id)}/SKILL.md`,
            wrapInManagedBlock(content),
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
            `.opencode/commands/${toPrefixedId(cmd.id)}.md`,
            wrapInManagedBlock(content),
            content,
          ),
        );
      }
    }

    return results;
  }
}
