import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { applyCustomization } from "./customization.js";
import type { HookEvent } from "../hooks/types.js";

function steeringFrontmatter(globs?: string): string {
  if (!globs) return "";
  return `---\ninclusion: fileMatch\nfileMatchPattern: "${globs}"\n---\n\n`;
}

// Map hatch3r hook events to Kiro 2026 native hook trigger identifiers.
// Kiro supports 10 trigger types documented at https://kiro.dev/docs/hooks/types/
// (accessed 2026-04-20): prompt-submit, agent-stop, pre-tool-use, post-tool-use,
// file-create, file-save, file-delete, pre-task-execution, post-task-execution,
// manual-trigger. Hatch3r events that lack a direct Kiro equivalent fall back
// to manual-trigger so users can wire them up themselves.
function mapToKiroTrigger(event: HookEvent): string {
  const mapping: Record<HookEvent, string> = {
    "pre-commit": "pre-tool-use",
    "post-merge": "post-tool-use",
    "ci-failure": "manual-trigger",
    "file-save": "file-save",
    "session-start": "prompt-submit",
    "pre-push": "pre-tool-use",
    "worktree-create": "manual-trigger",
    "worktree-remove": "manual-trigger",
  };
  return mapping[event] || "manual-trigger";
}

export class KiroAdapter extends BaseAdapter {
  readonly name = "kiro";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];
    const lines = [...await this.bridgeHeader(ctx)];

    // Kiro Powers (2026): users can package hatch3r-generated steering + hooks + MCP
    // as a reusable Power bundle. See https://kiro.dev/blog/introducing-powers/
    if (!this.isMinimal(ctx)) {
      lines.push(
        "> Kiro Powers: the steering, hooks, and MCP files emitted here can be bundled as a Kiro Power for cross-project reuse.",
        "",
      );
    }

    if (ctx.features.rules) {
      const rules = await readCanonicalFiles(ctx.agentsDir, "rules", this.warnings);
      for (const rule of rules) {
        const { content, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, rule);
        this.warnings.push(...warnings);
        if (skip) continue;
        const scope = overrides.scope ?? rule.scope;
        const desc = overrides.description ?? rule.description;

        if (scope && scope !== "always") {
          const globs = scope.includes("*") ? scope : `${scope}/**`;
          const fm = steeringFrontmatter(globs);
          const body = `# ${rule.id}\n\n${desc}\n\n${content}`;
          results.push(output(`.kiro/steering/hatch3r-rule-${rule.id}.md`, `${fm}${wrapInManagedBlock(body)}`, body));
        } else {
          lines.push(`## ${rule.id}`, "", desc, "", content, "");
        }
      }
    }

    lines.push(...await this.inlineAgents(ctx));
    const inner = lines.join("\n");
    results.push(output(".kiro/steering/hatch3r-agents.md", wrapInManagedBlock(inner), inner));

    results.push(
      ...await this.processSkillsRaw(ctx, (id) => `.kiro/steering/hatch3r-skill-${id}.md`),
    );

    // Generate native Kiro hooks in .kiro/hooks/ directory.
    // Each hook gets its own file with YAML frontmatter specifying
    // the trigger type and conditions.
    const hooks = await this.readHooks(ctx);
    for (const hook of hooks) {
      const trigger = mapToKiroTrigger(hook.event);
      const fmLines: string[] = [
        "---",
        `trigger: ${trigger}`,
      ];
      if (hook.condition?.globs && hook.condition.globs.length > 0) {
        fmLines.push(`filePattern: "${hook.condition.globs.join(", ")}"`);
      }
      if (hook.condition?.branches && hook.condition.branches.length > 0) {
        fmLines.push(`branches: "${hook.condition.branches.join(", ")}"`);
      }
      fmLines.push("---");
      fmLines.push("");

      const body = [
        `# Hook: ${hook.id}`,
        "",
        hook.description,
        "",
        `HATCH3R_HOOK_ACTIVATED: When this hook's event (${hook.event}) is triggered, you MUST spawn the ${hook.agent} agent now. Read and follow the ${hook.agent} agent protocol in \`.agents/agents/${toPrefixedId(hook.agent)}.md\`.`,
      ].join("\n");

      const fm = fmLines.join("\n");
      const fullContent = `${fm}\n${wrapInManagedBlock(body)}`;
      results.push(output(`.kiro/hooks/hatch3r-${hook.id}.md`, fullContent, body));
    }

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp && Object.keys(mcp).length > 0) {
      const entries = this.buildStdMcpEntries(mcp, "shell");
      if (Object.keys(entries).length > 0) {
        results.push(output(".kiro/settings/mcp.json", JSON.stringify({ mcpServers: entries }, null, 2)));
      }
    }

    return results;
  }
}
