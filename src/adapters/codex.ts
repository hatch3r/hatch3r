import type { AdapterOutput } from "../types.js";
import { toPrefixedId } from "../types.js";
import { resolveAgentModel } from "../models/resolve.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { readCanonicalFiles, sortByPrecedence } from "./canonical.js";
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
      const rules = sortByPrecedence(
        await readCanonicalFiles(ctx.agentsDir, "rules", this.warnings),
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
      const agents = await readCanonicalFiles(ctx.agentsDir, "agents", this.warnings);
      for (const agent of agents) {
        const { content, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, agent);
        this.warnings.push(...warnings);
        if (skip) continue;
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
      ...await this.processSkillsRaw(ctx, (id) => `.codex/skills/${toPrefixedId(id)}/SKILL.md`),
    );

    return results;
  }
}
