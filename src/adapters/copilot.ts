import type {
  AdapterOutput,
  CanonicalFile,
} from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { resolveAgentModel } from "../models/resolve.js";
import { applyCustomization } from "./customization.js";
import { transformEnvVarSyntax } from "./mcp-utils.js";
import { detectPackageManager } from "../detect/packageManager.js";

export class CopilotAdapter extends BaseAdapter {
  readonly name = "copilot";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    const alwaysRules: { rule: CanonicalFile; content: string }[] = [];
    const scopedRules: { rule: CanonicalFile; content: string; scope: string }[] = [];

    if (ctx.features.rules) {
      const rules = await readCanonicalFiles(ctx.agentsDir, "rules");
      for (const rule of rules) {
        const { content, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, rule);
        this.warnings.push(...warnings);
        if (skip) continue;
        const scope = overrides.scope ?? rule.scope;
        if (scope && scope !== "always") {
          scopedRules.push({ rule: { ...rule, description: overrides.description ?? rule.description }, content, scope });
        } else {
          alwaysRules.push({ rule: { ...rule, description: overrides.description ?? rule.description }, content });
        }
      }
    }

    const bridgeOrchestration = await this.bridgeOrchestration(ctx);
    const innerContent = [
      "",
      "# Hatch3r Project Instructions",
      "",
      "Full canonical agent instructions are at `/.agents/AGENTS.md`.",
      "",
      bridgeOrchestration,
      "",
      "## Hatch3r Rules",
      "",
      ...alwaysRules.map(
        (r) => `### ${r.rule.id}\n\n${r.rule.description}\n\n${r.content}`,
      ),
      "",
      "## Getting Started with Copilot",
      "",
      "New to this project's agent setup? Progress through these stages:",
      "",
      "**Start here:** Instructions in `.github/instructions/` scope rules to specific file patterns. The orchestration bridge above guides your workflow.",
      "**Next:** Use prompts in `.github/prompts/` and commands in `.github/copilot/commands/` for guided workflows.",
      "**Then:** Delegate to agents in `.github/agents/` for specialized tasks.",
      "**Later:** Customize agent behavior via `.hatch3r/{type}/{id}.customize.yaml` without editing managed files.",
      "",
    ].join("\n");
    results.push(output(".github/copilot-instructions.md", wrapInManagedBlock(innerContent), innerContent));

    const pm = await detectPackageManager(ctx.projectRoot);
    const install = [pm.installCmd, ...pm.installArgs].join(" ");
    const build = `${pm.installCmd} run build`;
    const copilotSetupSteps = `name: "Copilot Setup Steps"
on: push
jobs:
  copilot-setup-steps:
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

    if (ctx.features.agents) {
      const agents = await readCanonicalFiles(ctx.agentsDir, "agents");
      for (const agent of agents) {
        const { content, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, agent);
        this.warnings.push(...warnings);
        if (skip) continue;
        const model = resolveAgentModel(agent.id, agent, ctx.manifest, overrides);
        const desc = overrides.description ?? agent.description;
        const lines = [`name: ${agent.id}`, `description: ${desc}`];
        if (model) lines.push(`model: ${model}`);
        const fm = `---\n${lines.join("\n")}\n---`;
        results.push(output(`.github/agents/${toPrefixedId(agent.id)}.agent.md`, `${fm}\n\n${wrapInManagedBlock(content)}`, content));
      }
    }

    if (ctx.features.prompts) {
      const prompts = await readCanonicalFiles(ctx.agentsDir, "prompts");
      for (const prompt of prompts) {
        const body = prompt.rawContent;
        results.push(output(`.github/prompts/${toPrefixedId(prompt.id)}.prompt.md`, wrapInManagedBlock(body), body));
      }
    }

    results.push(
      ...await this.processCommandsRaw(ctx, (id) => `.github/copilot/commands/${toPrefixedId(id)}.prompt.md`),
    );

    if (ctx.features.githubAgents) {
      const ghAgents = await readCanonicalFiles(ctx.agentsDir, "github-agents");
      for (const agent of ghAgents) {
        const body = agent.rawContent;
        results.push(output(`.github/copilot/agents/${toPrefixedId(agent.id)}.md`, wrapInManagedBlock(body), body));
      }
    }

    results.push(
      ...await this.processSkillsWithFm(ctx, (id) => `.github/skills/${toPrefixedId(id)}/SKILL.md`),
    );

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp && Object.keys(mcp).length > 0) {
      const vscodeServers: Record<string, Record<string, unknown>> = {};
      for (const [name, server] of Object.entries(mcp)) {
        const entry: Record<string, unknown> = {};
        if (server.command) entry.command = server.command;
        if (server.args) entry.args = server.args;
        if (server.url) entry.url = server.url;
        if (server.env && Object.keys(server.env).length > 0) {
          entry.env = transformEnvVarSyntax(server.env, "shell");
        }
        if (server.headers && Object.keys(server.headers).length > 0) {
          entry.headers = transformEnvVarSyntax(server.headers, "shell");
        }
        vscodeServers[name] = entry;
      }
      results.push(output(".vscode/mcp.json", JSON.stringify({ servers: vscodeServers }, null, 2) + "\n"));
    }

    return results;
  }
}
