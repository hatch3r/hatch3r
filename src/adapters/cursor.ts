import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import chalk from "chalk";
import type {
  AdapterOutput,
  CanonicalFile,
  HatchManifest,
} from "../types.js";
import { toPrefixedId } from "../types.js";
import { resolveAgentModel } from "../models/resolve.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BRIDGE_ORCHESTRATION } from "../cli/shared/agentsContent.js";
import { output } from "./base.js";
import type { Adapter } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { applyCustomization, applyCustomizationRaw } from "./customization.js";

function cursorRuleFrontmatter(rule: CanonicalFile, scopeOverride?: string): string {
  const scope = scopeOverride ?? rule.scope;
  const lines: string[] = [`description: ${rule.description}`];
  if (scope === "always") {
    lines.push("alwaysApply: true");
  } else if (scope) {
    const globs = scope.includes(",")
      ? scope.split(",").map((g) => g.trim())
      : [scope];
    lines.push(`globs: [${globs.map((g) => `"${g}"`).join(", ")}]`);
  } else {
    lines.push("alwaysApply: false");
  }
  return `---\n${lines.join("\n")}\n---`;
}

function mdcOutput(path: string, frontmatter: string, body: string): AdapterOutput {
  return output(path, `${frontmatter}\n\n${wrapInManagedBlock(body)}`, body);
}

export class CursorAdapter implements Adapter {
  name = "cursor";

  async generate(
    agentsDir: string,
    manifest: HatchManifest,
  ): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];
    const { features } = manifest;
    const projectRoot = dirname(agentsDir);

    if (features.rules) {
      const rules = await readCanonicalFiles(agentsDir, "rules");
      for (const rule of rules) {
        const { content, skip, overrides } = await applyCustomization(projectRoot, rule);
        if (skip) continue;
        const desc = overrides.description ?? rule.description;
        const ruleWithDesc = { ...rule, description: desc };
        const baseName = `${toPrefixedId(rule.id)}.mdc`;
        results.push(
          mdcOutput(`.cursor/rules/${baseName}`, cursorRuleFrontmatter(ruleWithDesc, overrides.scope), content),
        );
      }
    }

    if (features.agents) {
      const agents = await readCanonicalFiles(agentsDir, "agents");
      for (const agent of agents) {
        const { content, skip, overrides } = await applyCustomization(projectRoot, agent);
        if (skip) continue;
        const model = resolveAgentModel(agent.id, agent, manifest, overrides);
        const desc = overrides.description ?? agent.description;
        const lines = [
          `name: ${agent.id}`,
          `description: ${desc}`,
        ];
        if (model) lines.push(`model: ${model}`);
        const fm = `---\n${lines.join("\n")}\n---`;
        results.push(
          mdcOutput(`.cursor/agents/${toPrefixedId(agent.id)}.md`, fm, content),
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
          mdcOutput(`.cursor/skills/${toPrefixedId(skill.id)}/SKILL.md`, fm, content),
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
            `.cursor/commands/${toPrefixedId(cmd.id)}.md`,
            wrapInManagedBlock(content),
            content,
          ),
        );
      }
    }

    if (features.mcp && manifest.mcp.servers.length > 0) {
      const mcpPath = join(agentsDir, "mcp", "mcp.json");
      try {
        const mcpContent = await readFile(mcpPath, "utf-8");
        results.push(output(".cursor/mcp.json", mcpContent));
      } catch (err) {
        console.warn(chalk.yellow(`  Warning: Could not read MCP config: ${err instanceof Error ? err.message : String(err)}`));
      }
    }

    if (features.hooks) {
      const { readHookDefinitions } = await import("../hooks/index.js");
      const hooks = await readHookDefinitions(agentsDir);

      for (const hook of hooks) {
        const globs = hook.condition?.globs || [];
        const globLine =
          globs.length > 0
            ? `globs: [${globs.map((g) => `"${g}"`).join(", ")}]`
            : "alwaysApply: false";

        const fm = `---\ndescription: "Hook: ${hook.description}"\n${globLine}\n---`;
        const body = `# Hook: ${hook.id}\n\n**Event:** ${hook.event}\n**Agent:** ${hook.agent}\n\n${hook.description}\n\nWhen this hook's event (${hook.event}) is triggered${globs.length > 0 ? ` for files matching ${globs.join(", ")}` : ""}, activate the ${hook.agent} agent.`;

        results.push(
          mdcOutput(`.cursor/rules/${toPrefixedId(`hook-${hook.id}`)}.mdc`, fm, body),
        );
      }
    }

    const bridgeFm = `---
description: Bridge to canonical agent instructions and mandatory orchestration directives
alwaysApply: true
---`;
    const bridgeBody = `# Hatch3r Bridge

This project uses hatch3r for agentic coding setup.
Canonical agent instructions live at \`/.agents/AGENTS.md\`.

${BRIDGE_ORCHESTRATION}`;
    results.push(mdcOutput(".cursor/rules/hatch3r-bridge.mdc", bridgeFm, bridgeBody));

    if (manifest.tools.includes("cursor")) {
      const envConfig = {
        instructions: ["Read /.agents/AGENTS.md for project instructions"],
        mcpServers: {},
      };
      results.push(output(".cursor/environment.json", JSON.stringify(envConfig, null, 2) + "\n"));
    }

    return results;
  }
}
