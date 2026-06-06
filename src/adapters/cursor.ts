// Last updated: 2026-06-06 (P3 platform-currency anchor; cursor.com/docs/agent/hooks
// + cursor.com/docs/agent/subagents access dates inside this file remain
// authoritative for individual claims. D9-M1 Cycle 10 Wave-3 re-verified the
// `readonly: true` subagent frontmatter primitive against the current
// /docs/agent/subagents URL. D9-4 Cycle 11 Wave-2 re-verified the full hook
// lifecycle against cursor.com/docs/agent/hooks accessed 2026-06-06: the
// `subagentStart` event carries `subagent_type` and returns
// `{permission: "deny"}` to block an over-privileged agent at spawn — wired
// to `.cursor/hooks/subagent-guard.mjs` as the hard runtime ASI02 block.).
import type {
  AdapterOutput,
  CanonicalFile,
} from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapManagedFor } from "../merge/managedBlocks.js";
import { readMaturityTier } from "../manifest/hatchJson.js";
import { BaseAdapter, output, type AdapterContext, type CompanionSubdir } from "./base.js";
import { sortByPrecedence, precedenceRank, resolveRuleGlobs } from "./canonical.js";
import { resolveAgentModel } from "../models/resolve.js";
import { applyCustomization } from "./customization.js";
import { transformEnvVarSyntax } from "./mcp-utils.js";
import { toCursorReadonlyFrontmatter } from "../pipeline/adapterToolTranslator.js";
import type { HookDefinition, HookEvent } from "../hooks/types.js";
import {
  buildAgentToolPoliciesJson,
  buildCursorAllowlistRule,
  buildCursorSubagentGuardHookScript,
} from "../pipeline/agentToolAllowlist.js";

/**
 * The Cursor adapter generates .mdc files from .md canonical files by adding
 * Cursor-specific frontmatter (description, globs/alwaysApply) and wrapping
 * content in managed blocks. Rules get `alwaysApply: true` or `globs: [...]`
 * based on their scope. Agents get `name`, `description`, `model`, `readonly`,
 * and `is_background` frontmatter fields.
 */

/**
 * F14.3-H2 (Cycle 10 D14, Pillar P3): per-tier output marker.
 *
 * Adapter outputs were byte-identical across maturity tiers (Decision 4 /
 * #16) — an enterprise install received the same `.cursor/rules/` content
 * as a solo install with no signal of the declared tier. Emit a one-line
 * header comment carrying `manifest.maturity` (absence collapses to
 * `"solo"` via {@link readMaturityTier}) at the top of every per-rule body
 * so the tier travels with the generated artifact. The marker is a markdown
 * comment so it renders invisibly in Cursor's rule view while remaining
 * greppable for drift checks. Paired with F14.3-C1's admission tagging so
 * the tier shown here matches the content actually selected.
 */
function cursorMaturityHeader(ctx: AdapterContext): string {
  const tier = readMaturityTier(ctx.manifest);
  return `<!-- hatch3r: right-size to maturity=${tier}. Invest only as deep as this tier needs; never default to enterprise-grade. Universal floor (security, correctness, a11y basics, baseline tests) always binds. See rules/hatch3r-right-sizing.md. -->`;
}

/**
 * D9-H-4 (Cycle 10 D9, Pillar P3): canonical hook event → Cursor 1.7+
 * `hooks.json` lifecycle event (camelCase taxonomy per
 * https://cursor.com/docs/agent/hooks accessed 2026-06-06).
 *
 * Cursor's hook surface runs a shell `command` and reads a permission
 * decision (`{permission: allow|deny|ask}`) — it does NOT spawn an agent.
 * hatch3r hooks declare an `agent:` to activate, which has no native
 * command equivalent, so the emitted `command` surfaces the activation
 * directive on stdout and the `.cursor/rules/hook-*.mdc` rule (still
 * emitted below) carries the actual agent-spawn instruction. Events with
 * no Cursor lifecycle equivalent (`post-merge`, `ci-failure`,
 * `worktree-create`, `worktree-remove`) are absent from this map and fall
 * through to the `.mdc` fallback only.
 */
interface CursorHookMapping {
  /** Cursor lifecycle event name. */
  event: string;
  /** Optional shell-command matcher (Cursor narrows `beforeShellExecution` by command text). */
  matcher?: string;
}
const CURSOR_HOOK_EVENT_MAP: Partial<Record<HookEvent, CursorHookMapping>> = {
  "pre-commit": { event: "beforeShellExecution", matcher: "git commit" },
  "pre-push": { event: "beforeShellExecution", matcher: "git push" },
  "file-save": { event: "afterFileEdit" },
  "session-start": { event: "sessionStart" },
};

/**
 * Build a single `.cursor/hooks.json` entry for a canonical hook.
 *
 * Cursor hook entries are `{type: "command", command, matcher?}`. Because
 * Cursor runs the command rather than spawning an agent, the command is a
 * `printf` that surfaces the hatch3r activation directive to the agent
 * transcript (the paired `.mdc` rule carries the binding spawn protocol).
 * Exit 0 with no JSON keeps Cursor's default permission flow (`allow`),
 * so the notification never blocks the user's action. The directive text
 * is single-quoted and the agent id interpolated through `toPrefixedId`,
 * which restricts output to the `hatch3r-[a-z0-9-]` namespace, so no shell
 * metacharacters can reach the command string.
 */
function buildCursorHookEntry(
  hook: HookDefinition,
  mapping: CursorHookMapping,
): Record<string, unknown> {
  const directive = `hatch3r hook ${hook.id}: spawn the ${hook.agent} agent (see .cursor/rules/${toPrefixedId(`hook-${hook.id}`)}.mdc)`;
  const entry: Record<string, unknown> = {
    type: "command",
    command: `printf '%s\\n' '${directive}'`,
  };
  if (mapping.matcher) entry.matcher = mapping.matcher;
  return entry;
}

function cursorRuleFrontmatter(rule: CanonicalFile, scopeOverride?: string): string {
  const scope = scopeOverride ?? rule.scope;
  const lines: string[] = [`description: ${rule.description}`];
  if (scope === "always") {
    lines.push("alwaysApply: true");
  } else {
    // X4/CD4 (D6-1/D9-1/D11-1 — GLOBS DROP): resolve the real glob set via
    // the shared helper. For `scope: conditional` rules the patterns live in
    // the canonical `globs:` field; the previous `scope.split(",")` derived
    // globs from `scope` alone and emitted `globs: ["conditional"]`, which
    // never matched any file so the rule never auto-attached. An empty set
    // (unconditional rule, or `scope` absent) falls back to `alwaysApply:
    // false` exactly as before.
    const globs = resolveRuleGlobs(rule, { scope: scopeOverride });
    if (globs.length > 0) {
      lines.push(`globs: [${globs.map((g) => `"${g}"`).join(", ")}]`);
    } else {
      lines.push("alwaysApply: false");
    }
  }
  return `---\n${lines.join("\n")}\n---`;
}

function mdcOutput(path: string, frontmatter: string, body: string, sourceFiles?: string[]): AdapterOutput {
  return output(path, `${frontmatter}\n\n${wrapManagedFor(path, body)}`, body, sourceFiles);
}

/**
 * D12-1 (Cycle 11 Wave 2, D12, P2): single-canonical-source attribution for a
 * per-file Cursor output (one rule `.mdc`, one agent `.md`). Returns
 * `[file.sourcePath]` so the output self-attributes to its one canonical input
 * instead of inheriting the adapter-wide read set in `BaseAdapter.generate`;
 * `undefined` for a synthesised fixture whose `sourcePath` is empty (falls back
 * to the broad set rather than a `[""]` row).
 */
function cursorSingleSource(file: CanonicalFile): string[] | undefined {
  return file.sourcePath ? [file.sourcePath] : undefined;
}

export class CursorAdapter extends BaseAdapter {
  readonly name = "cursor";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    if (ctx.features.rules) {
      // C9-H39 (D11-SA11.1-01): use the BaseAdapter-tracked read wrapper so
      // every canonical rule consumed here is recorded in
      // `this._trackedSourceFiles` and surfaces on each output's
      // `sourceFiles` field. Direct `readCanonicalFiles` calls bypass the
      // provenance tracker introduced by C8-D12-M3.
      const rules = await this.readTrackedCanonicalFiles(ctx.canonicalRoot, "rules", ctx.userRepoRoot);
      // Wave B3: precedence-ordered emission + NN- numeric filename prefix.
      // NN derives from precedenceRank(rule.precedence): critical=10, high=30,
      // normal=50, low=70. The prefix makes load order visible in the filesystem
      // so tools that enumerate .cursor/rules/ alphabetically apply higher-
      // precedence rules first.
      const sortedRules = sortByPrecedence(rules);
      for (const rule of sortedRules) {
        // C9-H20 (D8-H8.3.1): cooperative abort between per-rule .mdc
        // emissions so pipeline timeouts cancel without waiting for the
        // remaining rules' customisation step to finish.
        this.throwIfAborted(ctx);
        const { content: rawContent, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, rule);
        this.warnings.push(...warnings);
        if (skip) continue;
        // C9-H47 (D14-SA14.4-H01): substitute detected toolchain tokens so
        // canonical content carries `${HATCH3R:LINTER}` etc. and adapter
        // output carries the resolved value.
        const substituted = this.substituteDetectedRepoTokens(rawContent, ctx);
        // F14.3-H2 (D14, P3): prepend the per-tier maturity header so the
        // declared tier travels with each rule body (was byte-identical
        // across tiers before).
        const content = `${cursorMaturityHeader(ctx)}\n\n${substituted}`;
        const desc = overrides.description ?? rule.description;
        const ruleWithDesc = { ...rule, description: desc };
        const nn = precedenceRank(rule.precedence) / 10;
        const baseName = `${nn}-${toPrefixedId(rule.id)}.mdc`;
        results.push(mdcOutput(`.cursor/rules/${baseName}`, cursorRuleFrontmatter(ruleWithDesc, overrides.scope), content, cursorSingleSource(rule)));
      }
    }

    if (ctx.features.agents) {
      const agents = await this.readUserFacingCanonicalFiles(ctx.canonicalRoot, "agents", ctx.userRepoRoot);
      for (const agent of agents) {
        // C9-H20 (D8-H8.3.1): cooperative abort between agent files.
        this.throwIfAborted(ctx);
        const { content: rawContent, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, agent);
        this.warnings.push(...warnings);
        if (skip) continue;
        // C9-H47: substitute detected toolchain tokens in agent body.
        const content = this.substituteDetectedRepoTokens(rawContent, ctx);
        const prefixedId = toPrefixedId(agent.id);
        const model = resolveAgentModel(agent.id, agent, ctx.manifest, overrides);
        const desc = overrides.description ?? agent.description;
        const lines = [`name: ${agent.id}`, `description: ${desc}`];
        if (model) lines.push(`model: ${model}`);
        // C7.5-W2B2-H41/H45 (D15, P6): Cursor subagent frontmatter has
        // no tool allowlist — the closest native primitive is
        // `readonly: true`, which blocks file edits and state-changing
        // shell commands. Emit readonly whenever the AGENT_TOOL_POLICIES
        // entry lacks both `write` and `execute`, or whenever the
        // canonical agent already declared itself readonly. Policy
        // takes precedence: once a policy forbids write+execute,
        // readonly is emitted regardless of the canonical flag so the
        // monotonic-privilege invariant cannot be widened by omission.
        const policyReadonly = toCursorReadonlyFrontmatter(prefixedId);
        const effectiveReadonly = policyReadonly ?? agent.readonly ?? false;
        if (effectiveReadonly) lines.push("readonly: true");
        if (agent.background) lines.push("is_background: true");
        const fm = `---\n${lines.join("\n")}\n---`;
        results.push(mdcOutput(`.cursor/agents/${prefixedId}.md`, fm, content, cursorSingleSource(agent)));
      }
    }

    results.push(
      ...await this.processSkillsWithFmCliFiltered(ctx, (id) => `.cursor/skills/${toPrefixedId(id)}/SKILL.md`),
    );

    results.push(
      ...await this.processCommandsRaw(ctx, (id) => `.cursor/commands/${toPrefixedId(id)}.md`),
    );

    // Companion/reference content (see `BaseAdapter.processCompanionSubdir`
    // for the rationale). Mirror the canonical subtree under per-adapter
    // native paths so canonical references like `agents/shared/quality-charter.md`
    // resolve in the user repo after the 1.9.0 bundled-content migration.
    // Gating mirrors the primary feature; `checks/` is referenced by both
    // agents (reviewer) and commands (benchmark).
    const companionMappings: Array<[CompanionSubdir, boolean, (f: string) => string]> = [
      ["agents/modes", ctx.features.agents, (f) => `.cursor/agents/modes/${f}`],
      ["agents/shared", ctx.features.agents, (f) => `.cursor/agents/shared/${f}`],
      ["commands/board", ctx.features.commands, (f) => `.cursor/commands/board/${f}`],
      ["commands/revision", ctx.features.commands, (f) => `.cursor/commands/revision/${f}`],
      ["checks", ctx.features.agents || ctx.features.commands, (f) => `.cursor/checks/${f}`],
    ];
    for (const [subdir, enabled, pathFn] of companionMappings) {
      if (!enabled) continue;
      results.push(...await this.processCompanionSubdir(ctx, subdir, pathFn));
    }

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp) {
      // D11-C-1 (Cycle 10, Pillar P6): Cursor's MCP runtime supports only
      // `${env:NAME}`, `${userHome}`, `${workspaceFolder}` interpolation
      // (cursor.com/docs/context/mcp accessed 2026-05-27). Shell-style
      // `$VAR` is treated as a literal string by Cursor, so emitting it
      // breaks every secret-bearing MCP server (github, brave-search,
      // sentry, postgres, linear, azure-devops, gitlab). The canonical
      // MCP fixture already uses `${env:VAR}` form, so "passthrough"
      // keeps it byte-identical to Cursor's required syntax.
      const transformed = transformEnvVarSyntax(mcp, "passthrough") as Record<string, Record<string, unknown>>;
      results.push(output(".cursor/mcp.json", JSON.stringify({ mcpServers: transformed }, null, 2)));
    }

    // D9-H-4 (D9, P3): Cursor 1.7+ exposes a native hook surface at
    // `.cursor/hooks.json` (version 1, camelCase lifecycle events,
    // `{permission: allow|deny|ask}` outputs — cursor.com/docs/agent/hooks
    // accessed 2026-06-06). Cursor hooks run a shell `command` and read a
    // permission decision; they do NOT spawn agents, and hatch3r hooks
    // carry an `agent:` to activate rather than a script. So we emit BOTH:
    //   1. `.cursor/hooks.json` — wires each mappable canonical event
    //      (pre-commit/pre-push/file-save/session-start) into Cursor's
    //      lifecycle via a `command` that prints the activation directive.
    //   2. `.cursor/rules/hook-*.mdc` — the instructional rule that carries
    //      the actual agent-spawn protocol (also the only surface for
    //      events with no Cursor equivalent: post-merge, ci-failure,
    //      worktree-create, worktree-remove).
    const hookResults = await this.readHooks(ctx);
    const hooksJsonEvents: Record<string, Array<Record<string, unknown>>> = {};
    for (const hook of hookResults) {
      const globs = hook.condition?.globs || [];
      const globLine =
        globs.length > 0
          ? `globs: [${globs.map((g: string) => `"${g}"`).join(", ")}]`
          : "alwaysApply: false";
      const fm = `---\ndescription: "Hook: ${hook.description}"\n${globLine}\n---`;
      const body = `# Hook: ${hook.id}\n\n**Event:** ${hook.event}\n**Agent:** ${hook.agent}\n\n${hook.description}\n\nHATCH3R_HOOK_ACTIVATED: When this hook's event (${hook.event}) is triggered${globs.length > 0 ? ` for files matching ${globs.join(", ")}` : ""}, you MUST spawn the ${hook.agent} agent now. Read and follow the ${hook.agent} agent protocol in \`.cursor/agents/${toPrefixedId(hook.agent)}.md\`.`;
      results.push(mdcOutput(`.cursor/rules/${toPrefixedId(`hook-${hook.id}`)}.mdc`, fm, body));

      const mapping = CURSOR_HOOK_EVENT_MAP[hook.event as HookEvent];
      if (mapping) {
        const entry = buildCursorHookEntry(hook, mapping);
        (hooksJsonEvents[mapping.event] ??= []).push(entry);
      }
    }
    // D9-4 (Cycle 11 D9, P6): the `.cursor/hooks.json` write is deferred to
    // after the ASI02 `subagentStart` guard entry is injected below, so the
    // hard runtime block always ships alongside any lifecycle-event wiring.

    // D9-4 (Cycle 11 D9, P6/P3): emit the per-adapter MCP / tool gating
    // artifacts. Cursor's `preToolUse` hook payload (cursor.com/docs/agent/hooks
    // accessed 2026-06-06) carries `tool_name`/`tool_input`/`tool_use_id`/
    // `cwd`/`model`/`agent_message` but NO agent-identity field, so a
    // per-tool-CATEGORY deny cannot bind to the active hatch3r agent there —
    // category granularity stays rule-delegated (alwaysApply rule +
    // machine-readable `agents-policy.json`) and the `readonly: true`
    // frontmatter primitive (emitted by `toCursorReadonlyFrontmatter` for
    // agents whose policy lacks both `write` and `execute`) is the hard
    // write/execute guard.
    //
    // The agent-IDENTITY gate that `preToolUse` cannot serve is bound at the
    // `subagentStart` event, which DOES expose `subagent_type` + `subagent_id`
    // and returns `{permission: "deny"}` to block a subagent at spawn. That
    // closes the prior gap (a Cursor over-privileged agent had no hard runtime
    // block at parity with the Claude PreToolUse deny gate): the
    // `.cursor/hooks/subagent-guard.mjs` script (built below, mirrors
    // `buildClaudePreToolUseHookScript`) reads `agents-policy.json` and denies
    // any `hatch3r-*` subagent with no policy row (NO_POLICY), the Cursor
    // analog of the Claude NO_POLICY deny. It is wired into the `subagentStart`
    // event of `.cursor/hooks.json` below.
    const allowlistFm = `---\ndescription: Per-agent tool allowlist (ASI02). Enforced by the Cursor agent runtime — out-of-policy tool calls must be refused.\nalwaysApply: true\n---`;
    results.push(mdcOutput(
      ".cursor/rules/hatch3r-tool-allowlist.mdc",
      allowlistFm,
      buildCursorAllowlistRule(),
    ));
    results.push(output(
      ".cursor/agents-policy.json",
      buildAgentToolPoliciesJson(),
    ));

    // D9-4 (Cycle 11 D9, P6): emit the `subagentStart` deny hook — the hard
    // runtime ASI02 block for Cursor, at parity with the Claude PreToolUse
    // NO_POLICY deny. The script lives under `.cursor/hooks/` and resolves the
    // sibling policy doc at `../agents-policy.json`; it is wired into the
    // `subagentStart` event with `failClosed: true` so a crash/timeout blocks
    // the spawn rather than failing open (cursor.com/docs/agent/hooks accessed
    // 2026-06-06). Emitted regardless of `features.rules` — the guard is a
    // trust artifact, identical posture to the allowlist rule above.
    results.push(output(
      ".cursor/hooks/subagent-guard.mjs",
      buildCursorSubagentGuardHookScript(),
    ));
    (hooksJsonEvents.subagentStart ??= []).push({
      type: "command",
      command: "node ./.cursor/hooks/subagent-guard.mjs",
      failClosed: true,
    });
    const hooksJson = { version: 1, hooks: hooksJsonEvents };
    results.push(output(".cursor/hooks.json", JSON.stringify(hooksJson, null, 2) + "\n"));

    const bridgeFm = `---
description: Bridge to canonical agent instructions and mandatory orchestration directives
alwaysApply: true
---`;
    const bridgeOrchestration = await this.bridgeOrchestration(ctx);
    const bridgeBody = `# Hatch3r Bridge

This project uses hatch3r for agentic coding setup.
Canonical agent orchestration is inlined in this rule (\`.cursor/rules/hatch3r-bridge.mdc\`); per-artifact content lives in \`.cursor/rules/\`, \`.cursor/agents/\`, \`.cursor/skills/\`, and \`.cursor/commands/\`.

${bridgeOrchestration}

## Cursor Subagent Configuration (v2.5+)

Cursor supports up to 4 subagents running in parallel. Custom subagents in \`.cursor/agents/\` support these frontmatter fields:
- \`model\`: \`fast\`, \`inherit\`, or a specific model ID
- \`readonly\`: \`true\` to restrict write permissions (verification/audit agents)
- \`background\`: \`true\` to run without blocking the parent agent

When delegating to hatch3r agents, explicitly request "up to 4 in parallel" for maximum throughput.
Background subagents write output to \`~/.cursor/subagents/\` for later inspection.

## Cursor v2.6 Capabilities

Cursor v2.6 added MCP Apps (interactive UIs in agent chats) and Team Marketplaces for plugins.
If this project includes MCP servers that expose UI components, they will render inline as MCP Apps.
Plugin configurations in \`.cursor/mcp.json\` are compatible with Team Marketplace distribution.

## Cursor 3.0 Workflows

Cursor 3.0 (April 2, 2026) added two slash commands that pair with hatch3r's parallel-agent pipeline:
- \`/worktree\` — runs the current task in an isolated git worktree so agent edits cannot collide with your working tree. Use it when delegating to the implementer, fixer, or lint-fixer agents.
- \`/best-of-n\` — runs the same task across multiple models in parallel worktrees and compares outcomes. Pair with the reviewer agent to pick the winner.

## Getting Started with Cursor

New to this project's agent setup? Progress through these stages:

**Start here:** Rules in \`.cursor/rules/\` are loaded automatically. The orchestration bridge above guides your workflow.
**Next:** Use \`/hatch3r-feature\` or \`/hatch3r-bug-fix\` commands in Cursor chat for guided workflows.
**Then:** Delegate to agents in \`.cursor/agents/\` — Cursor supports up to 4 subagents in parallel.
**Later:** Customize agent behavior via \`.hatch3r/{type}/{id}.customize.yaml\` without editing managed files.`;
    results.push(mdcOutput(".cursor/rules/hatch3r-bridge.mdc", bridgeFm, bridgeBody));

    if (ctx.manifest.tools.includes("cursor")) {
      // F9.2.8 (Cycle 10 D9, P3): no `mcpServers` key here. MCP server config
      // is emitted to `.cursor/mcp.json` (above); a redundant empty
      // `mcpServers: {}` in environment.json declared the same surface twice
      // and risked drift between the two files.
      const envConfig = {
        instructions: [
          "Read .cursor/rules/hatch3r-bridge.mdc for project agent orchestration; per-artifact rules, agents, skills, and commands live under .cursor/.",
        ],
      };
      results.push(output(".cursor/environment.json", JSON.stringify(envConfig, null, 2) + "\n"));
    }

    return results;
  }
}
