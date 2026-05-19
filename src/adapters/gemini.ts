import { join } from "node:path";
import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { filterUserFacing } from "./canonical.js";
import { applyCustomization } from "./customization.js";
import type { HookEvent } from "../hooks/types.js";
import { escapeTomlString } from "./toml-utils.js";
import { HATCH3R_VERSION } from "../version.js";

function mapToGeminiEvent(event: HookEvent): string {
  const mapping: Record<HookEvent, string> = {
    "pre-commit": "BeforeTool",
    "post-merge": "AfterTool",
    "ci-failure": "AfterAgent",
    "file-save": "AfterTool",
    "session-start": "SessionStart",
    "pre-push": "BeforeTool",
    "worktree-create": "AfterTool",
    "worktree-remove": "BeforeTool",
  };
  return mapping[event] || event;
}

export class GeminiAdapter extends BaseAdapter {
  readonly name = "gemini";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    const inner = [
      ...await this.bridgeHeader(ctx, ".agents/AGENTS.md"),
      ...await this.inlineRules(ctx),
      ...await this.inlineAgents(ctx, (m) => ({
        text: `**Recommended model:** \`${m}\`. Set via \`gemini --model ${m}\` or select in Google AI Studio.`,
        after: true,
      })),
    ].join("\n");
    results.push(output("GEMINI.md", wrapInManagedBlock(inner), inner));

    const settings: Record<string, unknown> = {
      _hatch3r: {
        version: HATCH3R_VERSION,
        managed: true,
      },
      context: { fileName: ["GEMINI.md", "AGENTS.md"] },
    };

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp && Object.keys(mcp).length > 0) {
      const entries = this.buildStdMcpEntries(mcp, "shell");
      if (Object.keys(entries).length > 0) {
        settings.mcpServers = entries;
      }
    }

    const hooks = await this.readHooks(ctx);
    if (hooks.length > 0) {
      const hooksObj: Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>> = {};
      for (const hook of hooks) {
        const geminiEvent = mapToGeminiEvent(hook.event);
        if (!hooksObj[geminiEvent]) hooksObj[geminiEvent] = [];
        const matcher = hook.condition?.globs?.join("|") || ".*";
        hooksObj[geminiEvent].push({
          matcher,
          hooks: [{ type: "command", command: `echo "HATCH3R_HOOK_ACTIVATED: Spawn the ${hook.agent} agent now. Follow the ${hook.agent} agent protocol in .gemini/agents/${toPrefixedId(hook.agent)}.md. Event: ${hook.event}. Hook ID: ${hook.id}."` }],
        });
      }
      settings.hooks = hooksObj;
    }

    results.push(output(".gemini/settings.json", JSON.stringify(settings, null, 2)));

    results.push(
      ...await this.processSkillsRawCliFiltered(ctx, (id) => `.gemini/skills/${toPrefixedId(id)}/SKILL.md`),
    );

    if (ctx.features.commands) {
      // C9-H39 (D11-SA11.1-01): use the BaseAdapter-tracked read wrapper so
      // every canonical command consumed here is recorded in
      // `this._trackedSourceFiles` and surfaces on each output's
      // `sourceFiles` field. We retain the inline `filterUserFacing` call
      // (instead of switching to `readUserFacingCanonicalFiles`) because
      // the latter joins the path differently — keeping the literal join
      // preserves prior behavior in this adapter's snapshot.
      const commandsRaw = await this.readTrackedCanonicalFiles(ctx.agentsDir, "commands");
      const commands = filterUserFacing(commandsRaw, "command", join(ctx.agentsDir, "commands"));
      for (const cmd of commands) {
        const { content: rawContent, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, cmd);
        this.warnings.push(...warnings);
        if (skip) continue;
        // C9-H47 (D14-SA14.4-H01): substitute detected toolchain tokens.
        const content = this.substituteDetectedRepoTokens(rawContent, ctx);
        const desc = overrides.description ?? cmd.description;
        const toml = [
          `description = "${escapeTomlString(desc)}"`,
          `prompt = "${escapeTomlString(content)}"`,
        ].join("\n");
        results.push(output(`.gemini/commands/${toPrefixedId(cmd.id)}.toml`, toml));
      }
    }

    return results;
  }
}
