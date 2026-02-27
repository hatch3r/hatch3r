import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import chalk from "chalk";
import type {
  AdapterOutput,
  HatchManifest,
} from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { output } from "./base.js";
import type { Adapter } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { resolveAgentModel } from "../models/resolve.js";
import { applyCustomization, applyCustomizationRaw } from "./customization.js";

interface ClineCustomMode {
  slug: string;
  name: string;
  roleDefinition: string;
  groups: string[];
  customInstructions?: string;
  whenToUse?: string;
}

interface McpServerEntry {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  _disabled?: boolean;
}

export class ClineAdapter implements Adapter {
  name = "cline";

  async generate(
    agentsDir: string,
    manifest: HatchManifest,
  ): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];
    const { features } = manifest;
    const projectRoot = dirname(agentsDir);

    const customModes: ClineCustomMode[] = [];

    if (features.agents) {
      const agents = await readCanonicalFiles(agentsDir, "agents");
      for (const agent of agents) {
        const { content, skip, overrides } = await applyCustomization(projectRoot, agent);
        if (skip) continue;
        const slug = toPrefixedId(agent.id);
        const model = resolveAgentModel(agent.id, agent, manifest, overrides);
        const modelGuidance = model
          ? `\n\nRecommended model: ${model}. Select this model in the Roo Code model dropdown when using this mode.`
          : "";
        customModes.push({
          slug,
          name: agent.id,
          roleDefinition: content + modelGuidance,
          groups: ["read", "edit", "browser", "command", "mcp"],
          whenToUse: overrides.description ?? agent.description,
        });
      }
    }

    if (customModes.length > 0) {
      results.push(
        output(".roomodes", JSON.stringify({ customModes }, null, 2)),
      );
    }

    if (features.skills) {
      const skills = await readCanonicalFiles(agentsDir, "skills");
      for (const skill of skills) {
        const { content, skip } = await applyCustomizationRaw(projectRoot, skill);
        if (skip) continue;
        results.push(
          output(
            `.cline/skills/${toPrefixedId(skill.id)}/SKILL.md`,
            wrapInManagedBlock(content),
            content,
          ),
        );
      }
    }

    if (features.rules) {
      const rules = await readCanonicalFiles(agentsDir, "rules");
      for (const rule of rules) {
        const { content, skip, overrides } = await applyCustomization(projectRoot, rule);
        if (skip) continue;
        const ruleId = toPrefixedId(rule.id);
        const desc = overrides.description ?? rule.description;
        const body = `# ${rule.id}\n\n${desc}\n\n${content}`;
        results.push(output(`.roo/rules/${ruleId}.md`, wrapInManagedBlock(body), body));
      }
    }

    if (features.hooks) {
      const { readHookDefinitions } = await import("../hooks/index.js");
      const hooks = await readHookDefinitions(agentsDir);

      for (const hook of hooks) {
        const globs = hook.condition?.globs || [];
        const body = [
          `# Hook: ${hook.id}`,
          "",
          `**Event:** ${hook.event}`,
          `**Agent:** ${hook.agent}`,
          "",
          hook.description,
          "",
          `When this hook's event (${hook.event}) is triggered${globs.length > 0 ? ` for files matching ${globs.join(", ")}` : ""}, activate the ${hook.agent} agent.`,
        ].join("\n");

        const hookId = toPrefixedId(`hook-${hook.id}`);
        results.push(output(`.roo/rules/${hookId}.md`, wrapInManagedBlock(body), body));
      }
    }

    if (features.commands) {
      const commands = await readCanonicalFiles(agentsDir, "commands");
      for (const cmd of commands) {
        const { content, skip } = await applyCustomizationRaw(projectRoot, cmd);
        if (skip) continue;
        results.push(
          output(
            `.clinerules/workflows/${toPrefixedId(cmd.id)}.md`,
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
          const rooMcp: Record<string, unknown> = {};
          for (const [name, server] of Object.entries(mcpParsed.mcpServers)) {
            if (server._disabled) continue;
            if (server.command) {
              rooMcp[name] = {
                command: server.command,
                args: server.args || [],
                ...(server.env && Object.keys(server.env).length > 0 ? { env: server.env } : {}),
              };
            } else if (server.url) {
              rooMcp[name] = {
                url: server.url,
                transport: "streamable-http",
              };
            }
          }
          if (Object.keys(rooMcp).length > 0) {
            results.push(
              output(".roo/mcp.json", JSON.stringify({ mcpServers: rooMcp }, null, 2)),
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
