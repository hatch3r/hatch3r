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

function escapeTomlString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\t/g, "\\t")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

function mapToGeminiEvent(event: string): string {
  const mapping: Record<string, string> = {
    "pre-commit": "BeforeTool",
    "post-merge": "AfterTool",
    "ci-failure": "AfterAgent",
    "file-save": "AfterTool",
    "session-start": "SessionStart",
    "pre-push": "BeforeTool",
  };
  return mapping[event] || event;
}

interface McpServerEntry {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  _disabled?: boolean;
}

export class GeminiAdapter implements Adapter {
  name = "gemini";

  async generate(
    agentsDir: string,
    manifest: HatchManifest,
  ): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];
    const { features } = manifest;
    const projectRoot = dirname(agentsDir);

    const geminiMdLines: string[] = [
      "",
      "# Hatch3r Agent Instructions",
      "",
      "Full canonical agent instructions are at `.agents/AGENTS.md`.",
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
        geminiMdLines.push(`## ${rule.id}`);
        geminiMdLines.push("");
        geminiMdLines.push(desc);
        geminiMdLines.push("");
        geminiMdLines.push(content);
        geminiMdLines.push("");
      }
    }

    if (features.agents) {
      const agents = await readCanonicalFiles(agentsDir, "agents");
      for (const agent of agents) {
        const { content, skip, overrides } = await applyCustomization(projectRoot, agent);
        if (skip) continue;
        const model = resolveAgentModel(agent.id, agent, manifest, overrides);
        const desc = overrides.description ?? agent.description;
        geminiMdLines.push(`## Agent: ${agent.id}`);
        geminiMdLines.push("");
        geminiMdLines.push(desc);
        geminiMdLines.push("");
        geminiMdLines.push(content);
        if (model) {
          geminiMdLines.push("");
          geminiMdLines.push(`**Recommended model:** \`${model}\`. Set via \`gemini --model ${model}\` or select in Google AI Studio.`);
        }
        geminiMdLines.push("");
      }
    }

    const geminiInner = geminiMdLines.join("\n");
    results.push(output("GEMINI.md", wrapInManagedBlock(geminiInner), geminiInner));

    const settings: Record<string, unknown> = {
      context: {
        fileName: ["GEMINI.md", "AGENTS.md"],
      },
    };

    if (features.mcp && manifest.mcp.servers.length > 0) {
      const mcpPath = join(agentsDir, "mcp", "mcp.json");
      try {
        const mcpRaw = await readFile(mcpPath, "utf-8");
        const mcpParsed = JSON.parse(mcpRaw) as { mcpServers?: Record<string, McpServerEntry> };
        if (mcpParsed.mcpServers) {
          const geminiMcp: Record<string, unknown> = {};
          for (const [name, server] of Object.entries(mcpParsed.mcpServers)) {
            if (server._disabled) continue;
            if (server.command) {
              geminiMcp[name] = {
                command: server.command,
                args: server.args || [],
                ...(server.env && Object.keys(server.env).length > 0 ? { env: server.env } : {}),
              };
            } else if (server.url) {
              geminiMcp[name] = { url: server.url };
            }
          }
          if (Object.keys(geminiMcp).length > 0) {
            settings.mcpServers = geminiMcp;
          }
        }
      } catch (err) {
        console.warn(chalk.yellow(`  Warning: Could not read MCP config: ${err instanceof Error ? err.message : String(err)}`));
      }
    }

    if (features.hooks) {
      const { readHookDefinitions } = await import("../hooks/index.js");
      const hooks = await readHookDefinitions(agentsDir);

      if (hooks.length > 0) {
        const hooksObj: Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>> = {};

        for (const hook of hooks) {
          const geminiEvent = mapToGeminiEvent(hook.event);
          if (!hooksObj[geminiEvent]) {
            hooksObj[geminiEvent] = [];
          }
          const matcher = hook.condition?.globs?.join("|") || ".*";
          hooksObj[geminiEvent].push({
            matcher,
            hooks: [
              {
                type: "command",
                command: `echo "hatch3r hook: ${hook.id} — activate ${hook.agent} agent"`,
              },
            ],
          });
        }

        settings.hooks = hooksObj;
      }
    }

    results.push(output(".gemini/settings.json", JSON.stringify(settings, null, 2)));

    if (features.skills) {
      const skills = await readCanonicalFiles(agentsDir, "skills");
      for (const skill of skills) {
        const { content, skip } = await applyCustomizationRaw(projectRoot, skill);
        if (skip) continue;
        results.push(
          output(
            `.gemini/skills/${toPrefixedId(skill.id)}/SKILL.md`,
            wrapInManagedBlock(content),
            content,
          ),
        );
      }
    }

    if (features.commands) {
      const commands = await readCanonicalFiles(agentsDir, "commands");
      for (const cmd of commands) {
        const { content, skip, overrides } = await applyCustomization(projectRoot, cmd);
        if (skip) continue;
        const desc = overrides.description ?? cmd.description;
        const toml = [
          `description = "${escapeTomlString(desc)}"`,
          `prompt = "${escapeTomlString(content)}"`,
        ].join("\n");
        results.push(
          output(`.gemini/commands/${toPrefixedId(cmd.id)}.toml`, toml),
        );
      }
    }

    return results;
  }
}
