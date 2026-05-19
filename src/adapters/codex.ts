import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { resolveAgentModel } from "../models/resolve.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { sortByPrecedence } from "./canonical.js";
import { applyCustomization } from "./customization.js";
import { escapeTomlString, escapeTomlMultilineString, tomlKey } from "./toml-utils.js";
import { transformEnvVarSyntax } from "./mcp-utils.js";

// Codex adapter — generates configuration for OpenAI Codex CLI (v0.114+).
//
// Codex reads project config from the `.codex/` directory plus project-doc
// markdown files discovered via the Codex precedence chain. Per the 2026
// OpenAI docs (https://developers.openai.com/codex/guides/agents-md):
//
//   Discovery order per scope (global ~/.codex/, then project root down to cwd):
//     1. AGENTS.override.md   (opt-in override file)
//     2. AGENTS.md            (default project doc)
//     3. Any filename listed in `project_doc_fallback_filenames`
//        (e.g. TEAM_GUIDE.md, .agents.md)
//
// hatch3r emits AGENTS.md at the project root (via the agents-md adapter) and
// registers the legacy fallback names (TEAM_GUIDE.md, .agents.md) so existing
// Codex users whose docs used those names still surface hatch3r content when
// AGENTS.md is absent. The `status` command surfaces a warning when a
// project-level AGENTS.override.md exists, since that file silently overrides
// hatch3r-managed AGENTS.md (P3, D9-SA9.5.1).
//
// C9-H22 (D9-SA9.5.F1, P3+P1): Codex CLI 0.114 has a documented regression
// (openai/codex#14579 — closed): custom agent roles defined in a project-local
// `.codex/config.toml` (and per the same loader path, files under
// `.codex/agents/*.toml`) are not resolved by the live `spawn_agent` tool.
// The same role works when injected via `-c` CLI overrides, so the failure is
// in project-config loading rather than role syntax. Until OpenAI ships a fix
// upstream, hatch3r's per-agent TOML files in `.codex/agents/` may not be
// callable from `spawn_agent` in 0.114-series CLIs even though sync produces
// them correctly. When `manifest.features.agents` is enabled, this adapter
// emits a generation-time warning naming the regression and the workaround
// (CLI `-c` overrides) so operators can audit before relying on multi-agent
// orchestration. The `status` command surfaces the same note whenever codex
// is among the configured adapters so the warning is visible outside sync.
//
// Per-agent (subagent) configurations are written as individual TOML files in
// `.codex/agents/` per the Codex subagents schema
// (https://developers.openai.com/codex/subagents). Required top-level keys:
//   name, description, developer_instructions.
// Optional: model, nickname_candidates, sandbox_mode, model_reasoning_effort,
// plus per-agent `[mcp_servers.<id>]` tables. The `[agents]` section in
// config.toml configures global orchestration (max_threads, max_depth,
// job_max_runtime_seconds), not per-agent definitions.
export class CodexAdapter extends BaseAdapter {
  readonly name = "codex";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    const configLines: string[] = [
      "# Codex project configuration (managed by hatch3r)",
      "#",
      "# Do not manually edit — run `npx hatch3r sync` to regenerate.",
      "",
      "# Project-doc discovery precedence (per OpenAI Codex CLI 2026 docs):",
      "#   AGENTS.override.md -> AGENTS.md -> project_doc_fallback_filenames",
      "# hatch3r writes AGENTS.md at the project root; legacy fallback names",
      "# are registered below so projects migrating from pre-2026 Codex still",
      "# surface hatch3r content if they renamed their project doc.",
      'project_doc_fallback_filenames = ["TEAM_GUIDE.md", ".agents.md"]',
      "",
    ];

    if (ctx.features.rules) {
      // Wave B4: sort by precedence so the `# rule: ...` comments emitted
      // into .codex/config.toml appear in critical -> high -> normal -> low
      // order (id lexicographic tie-break) — matches the ordering used by
      // the other inline adapters that concatenate rule bodies.
      // C9-H39 (D11-SA11.1-01): use the BaseAdapter-tracked read wrapper so
      // every canonical rule consumed here is recorded in
      // `this._trackedSourceFiles` and surfaces on each output's
      // `sourceFiles` field.
      const rules = sortByPrecedence(
        await this.readTrackedCanonicalFiles(ctx.agentsDir, "rules"),
      );
      const enabledRules = [];
      for (const rule of rules) {
        const { skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, rule);
        this.warnings.push(...warnings);
        if (skip) continue;
        const desc = overrides.description ?? rule.description;
        enabledRules.push({ ...rule, description: desc });
      }
      if (enabledRules.length > 0) {
        configLines.push("# Additional instruction files (rules)");
        for (const rule of enabledRules) {
          configLines.push(`# rule: ${rule.id} — ${rule.description}`);
        }
        configLines.push("");
      }
    }

    if (ctx.features.agents) {
      // C9-H22 (D9-SA9.5.F1): Warn that per-agent TOML files in `.codex/agents/`
      // may not be loaded by Codex 0.114's `spawn_agent` tool due to
      // openai/codex#14579. Emitted on every sync when agents are enabled so
      // operators see the regression note alongside the generated files.
      this.warnings.push(
        "[codex] Codex CLI 0.114 has a spawn_agent regression (openai/codex#14579): " +
          "custom agent roles defined in project-local .codex/ files are not loaded " +
          "by spawn_agent. hatch3r generates per-agent TOML files in .codex/agents/ " +
          "but they may not be callable from spawn_agent on Codex 0.114. Workaround: " +
          "inject the same role via CLI overrides (codex exec -c 'agents.<id>.config_file=…'). " +
          "Upgrade Codex when a fixed version ships, or use the `codex` adapter only for " +
          "single-agent flows in the interim.",
      );
      const agents = await this.readUserFacingCanonicalFiles(ctx.agentsDir, "agents");
      for (const agent of agents) {
        const { content: rawContent, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, agent);
        this.warnings.push(...warnings);
        if (skip) continue;
        // C9-H47 (D14-SA14.4-H01): substitute detected toolchain tokens.
        const content = this.substituteDetectedRepoTokens(rawContent, ctx);
        const agentId = toPrefixedId(agent.id);
        const model = resolveAgentModel(agent.id, agent, ctx.manifest, overrides);
        const desc = overrides.description ?? agent.description;

        // Per Codex subagents schema (2026), each standalone agent file uses
        // top-level keys: `name`, `description`, `developer_instructions`
        // (required), with optional `model`, `nickname_candidates`,
        // `sandbox_mode`, etc. There is no `[agent]` wrapper section.
        const agentLines: string[] = [
          "# Codex agent configuration (managed by hatch3r)",
          "#",
          "# Do not manually edit — run `npx hatch3r sync` to regenerate.",
          "",
          `name = "${escapeTomlString(agentId)}"`,
          `description = "${escapeTomlString(desc)}"`,
        ];
        if (model) agentLines.push(`model = "${escapeTomlString(model)}"`);
        agentLines.push(
          `developer_instructions = """`,
          escapeTomlMultilineString(content),
          `"""`,
          "",
        );
        results.push(output(`.codex/agents/${agentId}.toml`, agentLines.join("\n")));
      }
    }

    const mcpFiltered = await this.readFilteredMcp(ctx);
    if (mcpFiltered) {
      for (const [name, server] of Object.entries(mcpFiltered)) {
        configLines.push(`[mcp_servers.${name}]`);
        if (server.command) {
          configLines.push(`command = "${escapeTomlString(server.command)}"`);
          if (server.args && server.args.length > 0) {
            const argsStr = server.args.map((a) => `"${escapeTomlString(a)}"`).join(", ");
            configLines.push(`args = [${argsStr}]`);
          }
        } else if (server.url) {
          configLines.push(`url = "${escapeTomlString(server.url)}"`);
        }
        // Codex v0.114+: use TOML table sections for env and headers.
        // Keys are validated against TOML bare-key rules via tomlKey().
        if (server.env && Object.keys(server.env).length > 0) {
          configLines.push(`[mcp_servers.${name}.env]`);
          for (const [k, v] of Object.entries(server.env)) {
            const transformed = transformEnvVarSyntax(v, "shell") as string;
            configLines.push(`${tomlKey(k)} = "${escapeTomlString(transformed)}"`);
          }
        }
        if (server.headers && Object.keys(server.headers).length > 0) {
          configLines.push(`[mcp_servers.${name}.headers]`);
          for (const [k, v] of Object.entries(server.headers)) {
            const transformed = transformEnvVarSyntax(v, "shell") as string;
            configLines.push(`${tomlKey(k)} = "${escapeTomlString(transformed)}"`);
          }
        }
        configLines.push("");
      }
    }

    // Codex v0.114+ supports hooks
    const hooks = await this.readHooks(ctx);
    if (hooks.length > 0) {
      configLines.push("# Hooks (v0.114+)");
      for (const hook of hooks) {
        configLines.push(`[hooks."${escapeTomlString(hook.event)}"]`);
        configLines.push(`command = "echo \\"HATCH3R_HOOK_ACTIVATED: Spawn the ${escapeTomlString(hook.agent)} agent now. Event: ${escapeTomlString(hook.event)}. Hook ID: ${escapeTomlString(hook.id)}.\\""`)
        if (hook.condition?.globs && hook.condition.globs.length > 0) {
          const globsStr = hook.condition.globs.map((g) => `"${escapeTomlString(g)}"`).join(", ");
          configLines.push(`globs = [${globsStr}]`);
        }
        configLines.push("");
      }
    }

    results.push(output(".codex/config.toml", configLines.join("\n")));

    results.push(
      ...await this.processSkillsRawCliFiltered(ctx, (id) => `.codex/skills/${toPrefixedId(id)}/SKILL.md`),
    );

    return results;
  }
}
