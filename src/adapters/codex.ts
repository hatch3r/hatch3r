import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import chalk from "chalk";
import type {
  AdapterOutput,
  HatchManifest,
} from "../types.js";
import { resolveAgentModel } from "../models/resolve.js";
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
  _description?: string;
  _disabled?: boolean;
}

export class CodexAdapter implements Adapter {
  name = "codex";

  async generate(
    agentsDir: string,
    manifest: HatchManifest,
  ): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];
    const projectRoot = dirname(agentsDir);

    const configLines: string[] = [
      "# Codex project configuration (managed by hatch3r)",
      "#",
      "# Do not manually edit — run `npx hatch3r sync` to regenerate.",
      "",
      'model_instructions_file = ".agents/AGENTS.md"',
      "",
    ];

    if (manifest.features.rules) {
      const rules = await readCanonicalFiles(agentsDir, "rules");
      const enabledRules = [];
      for (const rule of rules) {
        const { skip, overrides } = await applyCustomization(projectRoot, rule);
        if (skip) continue;
        const desc = overrides.description ?? rule.description;
        enabledRules.push({ ...rule, description: desc });
      }
      if (enabledRules.length > 0) {
        configLines.push("# Additional instruction files (rules)");
        for (const rule of enabledRules) {
          configLines.push(`# rule: ${rule.id} — ${rule.description}`);
        }
        configLines.push("");
      }
    }

    if (manifest.features.agents) {
      const agents = await readCanonicalFiles(agentsDir, "agents");
      for (const agent of agents) {
        const { skip, overrides } = await applyCustomization(projectRoot, agent);
        if (skip) continue;
        const agentId = toPrefixedId(agent.id);
        const model = resolveAgentModel(agent.id, agent, manifest, overrides);
        configLines.push(`[agents.${agentId}]`);
        configLines.push(`model_instructions_file = ".agents/agents/${agent.id}.md"`);
        if (model) configLines.push(`model = "${model}"`);
        configLines.push("");
      }
    }

    if (manifest.features.mcp && manifest.mcp.servers.length > 0) {
      const mcpPath = join(agentsDir, "mcp", "mcp.json");
      try {
        const mcpRaw = await readFile(mcpPath, "utf-8");
        const mcpParsed = JSON.parse(mcpRaw) as { mcpServers?: Record<string, McpServerEntry> };
        if (mcpParsed.mcpServers) {
          for (const [name, server] of Object.entries(mcpParsed.mcpServers)) {
            if (server._disabled) continue;
            configLines.push(`[mcp_servers.${name}]`);
            if (server.command) {
              configLines.push(`command = "${server.command}"`);
              if (server.args && server.args.length > 0) {
                const argsStr = server.args.map((a) => `"${a}"`).join(", ");
                configLines.push(`args = [${argsStr}]`);
              }
            } else if (server.url) {
              configLines.push(`url = "${server.url}"`);
            }
            if (server.env) {
              for (const [k, v] of Object.entries(server.env)) {
                configLines.push(`env.${k} = "${v}"`);
              }
            }
            configLines.push("");
          }
        }
      } catch (err) {
        console.warn(chalk.yellow(`  Warning: Could not read MCP config: ${err instanceof Error ? err.message : String(err)}`));
      }
    }

    results.push(output(".codex/config.toml", configLines.join("\n")));

    if (manifest.features.skills) {
      const skills = await readCanonicalFiles(agentsDir, "skills");
      for (const skill of skills) {
        const { content, skip } = await applyCustomizationRaw(projectRoot, skill);
        if (skip) continue;
        results.push(
          output(
            `.codex/skills/${toPrefixedId(skill.id)}/SKILL.md`,
            wrapInManagedBlock(content),
            content,
          ),
        );
      }
    }

    return results;
  }
}
