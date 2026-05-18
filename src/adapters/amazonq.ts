import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
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
// Schema per AWS 2026 docs:
//   https://aws.github.io/amazon-q-developer-cli/agent-format.html (accessed 2026-04-19)
// - `useLegacyMcpJson`: when true, inherits servers from legacy
//   `~/.aws/amazonq/mcp.json` and `.amazonq/mcp.json`. Hatch3r writes the
//   project-local `.amazonq/mcp.json`, so new agent descriptors set this to
//   true to pick it up. Finding C7.5-W2B2-H33.
// - `hooks`: map of canonical event name -> array of hook entries with a
//   shell `command` (and optional `matcher` for tool-targeted events).
//   hatch3r dispatches agents via rules-file markers, so each populated
//   entry emits a shell `echo` carrying the HATCH3R_HOOK_ACTIVATED payload
//   that the agent reads from the rules bridge. Finding D9-SA9.14.1.
interface AmazonQHookEntry {
  command: string;
  matcher?: string;
}

interface AmazonQAgentDescriptor {
  name: string;
  description: string;
  instructions: string;
  useLegacyMcpJson: boolean;
  hooks?: Record<string, AmazonQHookEntry[]>;
}

export class AmazonQAdapter extends BaseAdapter {
  readonly name = "amazon-q";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    const inner = [
      ...await this.bridgeHeader(ctx),
      ...await this.inlineRules(ctx),
      ...await this.inlineAgents(ctx),
    ].join("\n").trim();
    results.push(output(".amazonq/rules/hatch3r-agents.md", wrapInManagedBlock(inner), inner));

    results.push(
      ...await this.processSkillsRawCliFiltered(ctx, (id) => `.amazonq/rules/hatch3r-skill-${id}.md`),
    );

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp && Object.keys(mcp).length > 0) {
      const entries = this.buildStdMcpEntries(mcp, "shell");
      if (Object.keys(entries).length > 0) {
        results.push(output(".amazonq/mcp.json", JSON.stringify({ mcpServers: entries }, null, 2)));
      }
    }

    // Read hooks once so both the cli-agents descriptors and the rules-bridge
    // file share a single mapping. Finding D9-SA9.14.1 requires the
    // AgentDescriptor.hooks field be populated per AWS 2026 schema.
    const hooks = await this.readHooks(ctx);
    const descriptorHooks = this.buildDescriptorHooks(hooks);

    // Generate native Amazon Q custom agent descriptors in .amazonq/cli-agents/.
    // Each canonical agent maps to a JSON descriptor that Amazon Q discovers natively.
    if (ctx.features.agents) {
      const agents = await this.readUserFacingCanonicalFiles(ctx.agentsDir, "agents");
      for (const agent of agents) {
        const { content: rawContent, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, agent);
        this.warnings.push(...warnings);
        if (skip) continue;
        // C9-H47 (D14-SA14.4-H01): substitute detected toolchain tokens.
        const content = this.substituteDetectedRepoTokens(rawContent, ctx);
        const desc = overrides.description ?? agent.description;
        const descriptor: AmazonQAgentDescriptor = {
          name: toPrefixedId(agent.id),
          description: desc,
          instructions: content,
          // C7.5-W2B2-H33: hatch3r writes .amazonq/mcp.json; setting this to
          // true makes new agent descriptors inherit it, otherwise Q CLI
          // ignores the legacy MCP file when a cli-agent is spawned.
          useLegacyMcpJson: true,
        };
        if (Object.keys(descriptorHooks).length > 0) {
          descriptor.hooks = descriptorHooks;
        }
        results.push(output(
          `.amazonq/cli-agents/${toPrefixedId(agent.id)}.json`,
          JSON.stringify(descriptor, null, 2),
        ));
      }
    }

    // Generate hooks as lifecycle event bindings.
    // Amazon Q canonical hook events: agentSpawn, userPromptSubmit,
    // preToolUse, postToolUse, stop.
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

  /**
   * Build the `hooks` map for a cli-agent descriptor from hatch3r canonical
   * hook definitions. Group multiple hatch3r hooks that map to the same AWS
   * canonical event (e.g. `file-save` + `post-merge` both map to
   * `postToolUse`) so each canonical event key holds an array of entries.
   *
   * Each entry emits an `echo` command that carries the HATCH3R_HOOK_ACTIVATED
   * directive so the surrounding agent (which reads the rules-bridge file)
   * knows which hatch3r hook fired and which agent to dispatch.
   */
  private buildDescriptorHooks(
    hooks: Awaited<ReturnType<AmazonQAdapter["readHooks"]>>,
  ): Record<string, AmazonQHookEntry[]> {
    const grouped: Record<string, AmazonQHookEntry[]> = {};
    for (const hook of hooks) {
      const amazonQEvent = mapToAmazonQEvent(hook.event);
      if (!amazonQEvent) continue;
      const marker = `HATCH3R_HOOK_ACTIVATED id=${hook.id} event=${hook.event} agent=${hook.agent}`;
      const entry: AmazonQHookEntry = {
        command: `echo ${JSON.stringify(marker)}`,
      };
      (grouped[amazonQEvent] ??= []).push(entry);
    }
    return grouped;
  }
}
