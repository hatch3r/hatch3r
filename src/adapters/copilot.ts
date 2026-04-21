import type {
  AdapterOutput,
  CanonicalFile,
} from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { readCanonicalFiles, sortByPrecedence, precedenceRank } from "./canonical.js";
import { resolveAgentModel } from "../models/resolve.js";
import { applyCustomization } from "./customization.js";
import { detectPackageManager } from "../detect/packageManager.js";
import { toCopilotToolsFrontmatter } from "../pipeline/adapterToolTranslator.js";

export class CopilotAdapter extends BaseAdapter {
  readonly name = "copilot";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    const alwaysRules: { rule: CanonicalFile; content: string }[] = [];
    const scopedRules: { rule: CanonicalFile; content: string; scope: string }[] = [];

    if (ctx.features.rules) {
      const rules = await readCanonicalFiles(ctx.agentsDir, "rules", this.warnings);
      // Wave B3: sort by precedence so both the inlined always-rules (in
      // copilot-instructions.md) and the per-file scoped-rules are emitted
      // in priority order. Always-rules are concatenated into a single file,
      // so no NN- prefix applies to them -- the sort alone establishes load
      // order. Scoped-rules get a NN- filename prefix on their per-file path.
      const sortedRules = sortByPrecedence(rules);
      for (const rule of sortedRules) {
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
      "**Next:** Use prompts and commands in `.github/prompts/` for guided workflows.",
      "**Then:** Delegate to agents in `.github/agents/` for specialized tasks.",
      "**Later:** Customize agent behavior via `.hatch3r/{type}/{id}.customize.yaml` without editing managed files.",
      "",
    ].join("\n");
    results.push(output(".github/copilot-instructions.md", wrapInManagedBlock(innerContent), innerContent));

    const pm = await detectPackageManager(ctx.projectRoot);
    const install = [pm.installCmd, ...pm.installArgs].join(" ");
    const build = `${pm.installCmd} run build`;
    const copilotSetupStepsInner = `name: "Copilot Setup Steps"
on: push
jobs:
  copilot-setup-steps:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install dependencies
        run: ${install}
      - name: Build
        run: ${build}`;
    results.push(output(
      ".github/workflows/copilot-setup-steps.yml",
      wrapInManagedBlock(copilotSetupStepsInner) + "\n",
      copilotSetupStepsInner,
    ));

    for (const { rule, content, scope } of scopedRules) {
      const globs = scope.includes(",")
        ? scope.split(",").map((g) => g.trim())
        : [scope];
      const applyTo = globs.join(", ");
      const fm = `---\napplyTo: "${applyTo}"\n---`;
      const body = `# ${rule.id}\n\n${rule.description}\n\n${content}`;
      // Wave B3: NN- filename prefix on scoped per-file rule outputs.
      const nn = precedenceRank(rule.precedence) / 10;
      results.push(
        output(
          `.github/instructions/${nn}-${toPrefixedId(rule.id)}.instructions.md`,
          `${fm}\n\n${wrapInManagedBlock(body)}`,
          body,
        ),
      );
    }

    if (ctx.features.agents) {
      const agents = await readCanonicalFiles(ctx.agentsDir, "agents", this.warnings);
      for (const agent of agents) {
        const { content, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, agent);
        this.warnings.push(...warnings);
        if (skip) continue;
        const model = resolveAgentModel(agent.id, agent, ctx.manifest, overrides);
        const desc = overrides.description ?? agent.description;
        const prefixedId = toPrefixedId(agent.id);
        const lines = [`name: ${agent.id}`, `description: ${desc}`];
        if (model) lines.push(`model: ${model}`);
        // C7.5-W2B2-H41/H45 (D15, P6): emit Copilot `tools:` allowlist
        // translated from AGENT_TOOL_POLICIES so the downstream Copilot
        // agent runtime enforces the hatch3r monotonic-privilege
        // invariant. Copilot frontmatter format:
        // https://docs.github.com/en/copilot/reference/custom-agents-configuration
        // (accessed 2026-04-20).
        const copilotTools = toCopilotToolsFrontmatter(prefixedId);
        if (copilotTools) {
          lines.push(`tools: [${copilotTools.map((t) => `"${t}"`).join(", ")}]`);
        }
        const fm = `---\n${lines.join("\n")}\n---`;
        results.push(output(`.github/agents/${prefixedId}.agent.md`, `${fm}\n\n${wrapInManagedBlock(content)}`, content));
      }
    }

    if (ctx.features.prompts) {
      const prompts = await readCanonicalFiles(ctx.agentsDir, "prompts", this.warnings);
      for (const prompt of prompts) {
        const body = prompt.rawContent;
        results.push(output(`.github/prompts/${toPrefixedId(prompt.id)}.prompt.md`, wrapInManagedBlock(body), body));
      }
    }

    results.push(
      ...await this.processCommandsRaw(ctx, (id) => `.github/prompts/${toPrefixedId(id)}.prompt.md`),
    );

    if (ctx.features.githubAgents) {
      const ghAgents = await readCanonicalFiles(ctx.agentsDir, "github-agents", this.warnings);
      for (const agent of ghAgents) {
        const body = agent.rawContent;
        results.push(output(`.github/agents/${toPrefixedId(agent.id)}.agent.md`, wrapInManagedBlock(body), body));
      }
    }

    results.push(
      ...await this.processSkillsWithFm(ctx, (id) => `.github/skills/${toPrefixedId(id)}/SKILL.md`),
    );

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp && Object.keys(mcp).length > 0) {
      // Use shared buildStdMcpEntries to avoid redundant env construction (#2.19)
      const vscodeServers = this.buildStdMcpEntries(mcp, "shell");
      results.push(output(".vscode/mcp.json", JSON.stringify({ servers: vscodeServers }, null, 2) + "\n"));
    }

    return results;
  }
}
