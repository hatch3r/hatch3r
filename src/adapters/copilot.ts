import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import chalk from "chalk";
import type {
  AdapterOutput,
  CanonicalFile,
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

function detectInstallCommand(projectRoot: string): { install: string; build: string } {
  if (existsSync(join(projectRoot, "bun.lockb"))) return { install: "bun install", build: "bun run build" };
  if (existsSync(join(projectRoot, "pnpm-lock.yaml"))) return { install: "pnpm install --frozen-lockfile", build: "pnpm run build" };
  if (existsSync(join(projectRoot, "yarn.lock"))) return { install: "yarn install --frozen-lockfile", build: "yarn build" };
  return { install: "npm ci", build: "npm run build" };
}

export class CopilotAdapter implements Adapter {
  name = "copilot";

  async generate(
    agentsDir: string,
    manifest: HatchManifest,
  ): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];
    const { features } = manifest;
    const projectRoot = dirname(agentsDir);

    const alwaysRules: { rule: CanonicalFile; content: string }[] = [];
    const scopedRules: { rule: CanonicalFile; content: string; scope: string }[] = [];

    if (features.rules) {
      const rules = await readCanonicalFiles(agentsDir, "rules");
      for (const rule of rules) {
        const { content, skip, overrides } = await applyCustomization(projectRoot, rule);
        if (skip) continue;
        const scope = overrides.scope ?? rule.scope;
        if (scope && scope !== "always") {
          scopedRules.push({ rule: { ...rule, description: overrides.description ?? rule.description }, content, scope });
        } else {
          alwaysRules.push({ rule: { ...rule, description: overrides.description ?? rule.description }, content });
        }
      }
    }

    const innerContent = [
      "",
      "# Hatch3r Project Instructions",
      "",
      "Full canonical agent instructions are at `/.agents/AGENTS.md`.",
      "",
      BRIDGE_ORCHESTRATION,
      "",
      "## Hatch3r Rules",
      "",
      ...alwaysRules.map(
        (r) => `### ${r.rule.id}\n\n${r.rule.description}\n\n${r.content}`,
      ),
      "",
    ].join("\n");

    results.push(
      output(".github/copilot-instructions.md", wrapInManagedBlock(innerContent), innerContent),
    );

    const { install, build } = detectInstallCommand(projectRoot);
    const copilotSetupSteps = `name: "Copilot Setup Steps"
on: [push]
jobs:
  setup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install dependencies
        run: ${install}
      - name: Build
        run: ${build}
`;
    results.push(output(".github/workflows/copilot-setup-steps.yml", copilotSetupSteps));

    for (const { rule, content, scope } of scopedRules) {
      const globs = scope.includes(",")
        ? scope.split(",").map((g) => g.trim())
        : [scope];
      const applyTo = globs.join(", ");
      const fm = `---\napplyTo: "${applyTo}"\n---`;
      const body = `# ${rule.id}\n\n${rule.description}\n\n${content}`;
      results.push(
        output(
          `.github/instructions/${toPrefixedId(rule.id)}.instructions.md`,
          `${fm}\n\n${wrapInManagedBlock(body)}`,
          body,
        ),
      );
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
          output(
            `.github/agents/${toPrefixedId(agent.id)}.md`,
            `${fm}\n\n${wrapInManagedBlock(content)}`,
            content,
          ),
        );
      }
    }

    if (features.prompts) {
      const prompts = await readCanonicalFiles(agentsDir, "prompts");
      for (const prompt of prompts) {
        const body = prompt.rawContent;
        results.push(
          output(
            `.github/prompts/${toPrefixedId(prompt.id)}.prompt.md`,
            wrapInManagedBlock(body),
            body,
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
            `.github/copilot/commands/${toPrefixedId(cmd.id)}.prompt.md`,
            wrapInManagedBlock(content),
            content,
          ),
        );
      }
    }

    if (features.githubAgents) {
      const ghAgents = await readCanonicalFiles(agentsDir, "github-agents");
      for (const agent of ghAgents) {
        const body = agent.rawContent;
        results.push(
          output(
            `.github/copilot/agents/${toPrefixedId(agent.id)}.md`,
            wrapInManagedBlock(body),
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
            `.github/skills/${toPrefixedId(skill.id)}/SKILL.md`,
            `${fm}\n\n${wrapInManagedBlock(content)}`,
            content,
          ),
        );
      }
    }

    if (features.mcp && manifest.mcp.servers.length > 0) {
      const mcpPath = join(agentsDir, "mcp", "mcp.json");
      try {
        const mcpRaw = await readFile(mcpPath, "utf-8");
        const mcpParsed = JSON.parse(mcpRaw) as {
          mcpServers?: Record<string, Record<string, unknown>>;
        };
        if (mcpParsed.mcpServers) {
          for (const server of Object.values(mcpParsed.mcpServers)) {
            if (server.command) {
              server.envFile = "${workspaceFolder}/.env.mcp";
            }
          }
        }
        results.push(
          output(
            ".vscode/mcp.json",
            JSON.stringify(mcpParsed, null, 2) + "\n",
          ),
        );
      } catch (err) {
        console.warn(chalk.yellow(`  Warning: Could not read MCP config: ${err instanceof Error ? err.message : String(err)}`));
      }
    }

    return results;
  }
}
