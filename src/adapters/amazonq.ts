import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { applyCustomization } from "./customization.js";
import type { HookEvent } from "../hooks/types.js";

// Amazon Q lifecycle hook events.
// Amazon Q CLI custom agents support 5 canonical hook events:
// agentSpawn, userPromptSubmit, preToolUse, postToolUse, stop.
// Reference: https://aws.github.io/amazon-q-developer-cli/agent-format.html (accessed 2026-04-19)
function mapToAmazonQEvent(event: HookEvent): string | null {
  const mapping: Partial<Record<HookEvent, string>> = {
    "session-start": "agentSpawn",
    "pre-commit": "preToolUse",
    "file-save": "postToolUse",
    "post-merge": "postToolUse",
    "ci-failure": "stop",
  };
  return mapping[event] ?? null;
}

// Amazon Q custom agent descriptor — written to .amazonq/cli-agents/{name}.json.
// Reference: https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/q-cli-agents.html
interface AmazonQAgentDescriptor {
  name: string;
  description: string;
  instructions: string;
  hooks?: Record<string, { agent: string; description: string }>;
}

export class AmazonQAdapter extends BaseAdapter {
  readonly name = "amazon-q";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    const inner = [
      ...await this.bridgeHeader(ctx),
      ...await this.inlineRules(ctx),
      ...await this.inlineAgents(ctx),
    ].join("\n");
    results.push(output(".amazonq/rules/hatch3r-agents.md", wrapInManagedBlock(inner), inner));

    results.push(
      ...await this.processSkillsRaw(ctx, (id) => `.amazonq/rules/hatch3r-skill-${id}.md`),
    );

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp && Object.keys(mcp).length > 0) {
      const entries = this.buildStdMcpEntries(mcp, "shell");
      if (Object.keys(entries).length > 0) {
        results.push(output(".amazonq/mcp.json", JSON.stringify({ mcpServers: entries }, null, 2)));
      }
    }

    // Generate native Amazon Q custom agent descriptors in .amazonq/cli-agents/.
    // Each canonical agent maps to a JSON descriptor that Amazon Q discovers natively.
    if (ctx.features.agents) {
      const agents = await readCanonicalFiles(ctx.agentsDir, "agents");
      for (const agent of agents) {
        const { content, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, agent);
        this.warnings.push(...warnings);
        if (skip) continue;
        const desc = overrides.description ?? agent.description;
        const descriptor: AmazonQAgentDescriptor = {
          name: toPrefixedId(agent.id),
          description: desc,
          instructions: content,
        };
        results.push(output(
          `.amazonq/cli-agents/${toPrefixedId(agent.id)}.json`,
          JSON.stringify(descriptor, null, 2),
        ));
      }
    }

    // Generate hooks as lifecycle event bindings.
    // Amazon Q canonical hook events: agentSpawn, userPromptSubmit,
    // preToolUse, postToolUse, stop.
    const hooks = await this.readHooks(ctx);
    if (hooks.length > 0) {
      const hookLines: string[] = ["# Hatch3r Hooks", ""];
      for (const hook of hooks) {
        const amazonQEvent = mapToAmazonQEvent(hook.event);
        if (!amazonQEvent) continue;
        hookLines.push(`## ${hook.id}`, "");
        hookLines.push(`**Event:** ${amazonQEvent} (${hook.event})`);
        hookLines.push(`**Agent:** ${hook.agent}`);
        hookLines.push(`**Description:** ${hook.description}`);
        if (hook.condition?.globs) {
          hookLines.push(`**Globs:** ${hook.condition.globs.join(", ")}`);
        }
        hookLines.push("");
        hookLines.push(`HATCH3R_HOOK_ACTIVATED: When this hook's event (${hook.event}) is triggered, you MUST spawn the ${hook.agent} agent now. Read and follow the ${hook.agent} agent protocol in \`.agents/agents/${toPrefixedId(hook.agent)}.md\`.`);
        hookLines.push("");
      }
      if (hookLines.length > 2) {
        const hookContent = hookLines.join("\n");
        results.push(output(".amazonq/rules/hatch3r-hooks.md", wrapInManagedBlock(hookContent), hookContent));
      }
    }

    return results;
  }
}
