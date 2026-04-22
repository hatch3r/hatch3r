import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { readCanonicalFiles, sortByPrecedence, precedenceRank } from "./canonical.js";
import { applyCustomization } from "./customization.js";
import { toWindsurfToolsFrontmatter } from "../pipeline/adapterToolTranslator.js";
import type { HookEvent } from "../hooks/types.js";
import { HATCH3R_VERSION } from "../version.js";

function isGlobPattern(scope: string): boolean {
  return scope.includes("*") || scope.includes("?") || scope.includes("[");
}

function ruleTrigger(scope: string | undefined): "always_on" | "glob" | "model_decision" {
  if (!scope) return "model_decision";
  if (scope === "always") return "always_on";
  return "glob";
}

// Windsurf Cascade Hooks (`.windsurf/hooks.json`) — shipped in Windsurf 1.13.12
// (2026-01-25). Schema per https://docs.windsurf.com/windsurf/cascade/hooks.md
// (accessed 2026-04-19). Twelve Cascade events; hatch3r maps canonical events:
//   pre-commit, pre-push → pre_run_command (before shell commands)
//   post-merge           → post_run_command
//   ci-failure           → post_cascade_response (no native trigger; fires after model response)
//   file-save            → post_write_code
//   session-start        → pre_user_prompt (Cascade fires on each prompt submit)
//   worktree-create      → post_setup_worktree (native Cascade event)
//   worktree-remove      → post_run_command (no native remove hook)
function mapToWindsurfEvent(event: HookEvent): string {
  const mapping: Record<HookEvent, string> = {
    "pre-commit": "pre_run_command",
    "post-merge": "post_run_command",
    "ci-failure": "post_cascade_response",
    "file-save": "post_write_code",
    "session-start": "pre_user_prompt",
    "pre-push": "pre_run_command",
    "worktree-create": "post_setup_worktree",
    "worktree-remove": "post_run_command",
  };
  return mapping[event];
}

export class WindsurfAdapter extends BaseAdapter {
  readonly name = "windsurf";

  /**
   * Emit a policy-derived tool allowlist section that Cascade renders
   * at the top of `.windsurfrules`. This is the Windsurf-native
   * equivalent of Claude Code's per-subagent `tools:` frontmatter and
   * implements the H45 translator in the monotonic-privilege chain.
   *
   * Windsurf's Cascade treats the rules file as preamble for every
   * session; embedding the allowlist here means the agent-specific
   * tool boundaries survive even when no per-subagent file exists.
   *
   * Audit context: C7.5-W2B2-H41 / C7.5-W2B2-H45 (D15, P6).
   */
  private async windsurfAgentToolPolicies(ctx: AdapterContext): Promise<string[]> {
    if (!ctx.features.agents) return [];
    const agents = await this.readUserFacingCanonicalFiles(ctx.agentsDir, "agents");
    const rows: string[] = [];
    for (const agent of agents) {
      const { skip } = await applyCustomization(ctx.projectRoot, agent);
      if (skip) continue;
      const prefixedId = toPrefixedId(agent.id);
      const tools = toWindsurfToolsFrontmatter(prefixedId);
      if (tools) {
        rows.push(`| \`${prefixedId}\` | ${tools} |`);
      }
    }
    if (rows.length === 0) return [];
    return [
      "## Agent Tool Policies",
      "",
      "Per-agent tool allowlists enforce the hatch3r monotonic-privilege invariant",
      "(D15 / P6). When Cascade spawns one of the agents below, constrain its",
      "tool access to the listed set.",
      "",
      "| Agent | Allowed Tools |",
      "|-------|---------------|",
      ...rows,
    ];
  }

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    const bridgeOrchestration = await this.bridgeOrchestration(ctx);
    const windsurfInner = [
      "",
      "# Hatch3r Agent Instructions",
      "",
      "Full canonical agent instructions are at `/.agents/AGENTS.md`.",
      "Rules and skills are managed in `.windsurf/rules/` and `.windsurf/skills/`.",
      "",
      bridgeOrchestration,
      "",
      ...await this.inlineAgents(ctx),
      "",
      ...await this.windsurfAgentToolPolicies(ctx),
      "",
      "## Getting Started with Windsurf",
      "",
      "New to this project's agent setup? Progress through these stages:",
      "",
      "**Start here:** Rules in `.windsurf/rules/` are loaded automatically. The orchestration bridge above guides your workflow.",
      "**Next:** Use commands in `.windsurf/workflows/` for guided workflows (e.g., feature development, bug fixes).",
      "**Then:** Use parallel Cascade sessions for independent tasks to maximize throughput.",
      "**Multi-branch review:** Windsurf supports git worktrees (v1.13.3+); spawn a Cascade session per branch without conflicts.",
      "**Later:** Customize agent behavior via `.hatch3r/{type}/{id}.customize.yaml` without editing managed files.",
      "",
    ].join("\n");
    results.push(output(".windsurfrules", wrapInManagedBlock(windsurfInner), windsurfInner));

    if (ctx.features.rules) {
      const rules = await readCanonicalFiles(ctx.agentsDir, "rules", this.warnings);
      // Wave B3: precedence-ordered emission + NN- numeric filename prefix.
      // NN derives from precedenceRank(rule.precedence): critical=10, high=30,
      // normal=50, low=70. Windsurf lists rule files alphabetically in the
      // Cascade preamble, so the prefix surfaces load order at the filesystem
      // level.
      const sortedRules = sortByPrecedence(rules);
      for (const rule of sortedRules) {
        const { content, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, rule);
        this.warnings.push(...warnings);
        if (skip) continue;
        const scope = overrides.scope ?? rule.scope;
        const trigger = ruleTrigger(scope);
        const globScope = (trigger === "glob" && scope)
          ? (isGlobPattern(scope) ? scope : `${scope}/**`)
          : undefined;
        const desc = overrides.description ?? rule.description;
        // Windsurf requires a description field for model_decision triggers
        // so the AI model knows when to activate the rule.
        const descField = trigger === "model_decision" ? `\ndescription: "${desc.replace(/"/g, '\\"')}"` : "";
        const fm = `---\ntrigger: ${trigger}${descField}${globScope ? `\nglobs: "${globScope}"` : ""}\n---`;
        const body = `# ${rule.id}\n\n${desc}\n\n${content}`;
        const nn = precedenceRank(rule.precedence) / 10;
        results.push(output(`.windsurf/rules/${nn}-${toPrefixedId(rule.id)}.md`, `${fm}\n\n${wrapInManagedBlock(body)}`, body));
      }
    }

    results.push(
      ...await this.processSkillsWithFm(ctx, (id) => `.windsurf/skills/${toPrefixedId(id)}/SKILL.md`),
    );

    results.push(
      ...await this.processCommandsRaw(ctx, (id) => `.windsurf/workflows/${toPrefixedId(id)}.md`),
    );

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp && Object.keys(mcp).length > 0) {
      const entries = this.buildStdMcpEntries(mcp, "shell");
      if (Object.keys(entries).length > 0) {
        results.push(output(".windsurf/mcp.json", JSON.stringify({ mcpServers: entries }, null, 2) + "\n"));
      }
    }

    // C7.5-W2B2-H31 (D9-SA9.7.1, P3): Windsurf Cascade Hooks emission.
    // Docs: https://docs.windsurf.com/windsurf/cascade/hooks.md (accessed 2026-04-19).
    // File: `.windsurf/hooks.json`. Schema: { hooks: { <event>: [{ command, show_output? }] } }.
    const hooks = await this.readHooks(ctx);
    if (hooks.length > 0) {
      const hooksByEvent: Record<string, Array<{ command: string; show_output: boolean }>> = {};
      for (const hook of hooks) {
        const wsEvent = mapToWindsurfEvent(hook.event);
        if (!hooksByEvent[wsEvent]) hooksByEvent[wsEvent] = [];
        const globSuffix = hook.condition?.globs && hook.condition.globs.length > 0
          ? ` for files matching ${hook.condition.globs.join(", ")}`
          : "";
        hooksByEvent[wsEvent].push({
          command: `echo "HATCH3R_HOOK_ACTIVATED: Spawn the ${hook.agent} agent now. Follow the ${hook.agent} agent protocol in .windsurf/agents/${toPrefixedId(hook.agent)}.md. Event: ${hook.event}. Hook ID: ${hook.id}.${globSuffix}"`,
          show_output: true,
        });
      }
      const hooksPayload = {
        _hatch3r: {
          version: HATCH3R_VERSION,
          managed: true,
          schema: "windsurf/cascade-hooks/v1",
        },
        hooks: hooksByEvent,
      };
      results.push(output(".windsurf/hooks.json", JSON.stringify(hooksPayload, null, 2) + "\n"));
    }

    return results;
  }
}
