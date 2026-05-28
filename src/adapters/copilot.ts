import type {
  AdapterOutput,
  CanonicalFile,
} from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { readMaturityTier } from "../manifest/hatchJson.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";
import { sortByPrecedence, precedenceRank } from "./canonical.js";
import { resolveAgentModel } from "../models/resolve.js";
import { applyCustomization } from "./customization.js";
import { detectPackageManager } from "../detect/packageManager.js";
import { toCopilotToolsFrontmatter } from "../pipeline/adapterToolTranslator.js";

// Issue #73 — Copilot has `hooks: false` in ADAPTER_CAPABILITIES (no
// PreToolUse hook, no transcript access for external processes, no
// tool-refusal API). Pipeline enforcement is therefore trust-based;
// this addendum surfaces the constraint to the model on every turn
// and names the self-detectable drift indicators.
const COPILOT_ENFORCEMENT_ADDENDUM = `## Copilot Enforcement Model (no hook surface)

GitHub Copilot Chat does not expose a PreToolUse or pre-edit hook
(see \`src/adapters/index.ts\` — \`copilot\` is the only adapter with
\`hooks: false\` in \`ADAPTER_CAPABILITIES\`). Hatch3r cannot block
code-writing tool calls server-side for Copilot. Enforcement is
therefore trust-based — the directives in this file and in
\`.github/instructions/\` are normative, not advisory.

Self-detectable drift indicators (halt the current turn if any appear):

- Missing pipeline-state header on a tracked Tier 2+ task (see
  \`hatch3r-agent-orchestration\` → Per-Turn Pipeline-State Header).
- A call to \`replace_string_in_file\`, \`multi_replace_string_in_file\`,
  \`create_file\`, or any code-writing tool before the user has
  confirmed the Pre-Implementation Summary on a Tier 3 task (see
  \`hatch3r-deep-context\` → Tier 3 — Deep).
- An \`Edit\` / \`Write\` invocation from the orchestrator turn that
  did not immediately follow a SUCCESS report from \`hatch3r-implementer\`
  via the \`Task\` tool.

On any drift, halt and re-delegate via \`hatch3r-implementer\` (Phase 2)
or \`hatch3r-fixer\` (Phase 3). The only carve-out is \`hatch3r-quick-change\`
Tier 1 trivial single-line edits per its declared scope.`;

/**
 * D9-H-7 (Cycle 10 D9, Pillar P6): orchestrator-only hatch3r sub-agents that
 * MUST NOT be model-auto-invocable on the Copilot surface.
 *
 * GitHub's custom-agent configuration documents `target`,
 * `disable-model-invocation`, and `user-invocable` as the fields that gate
 * auto-invocation (https://docs.github.com/en/copilot/reference/custom-agents-configuration
 * accessed 2026-05-27). Without them every hatch3r agent emits as
 * auto-invocable on BOTH VS Code and github.com, so Copilot could spawn an
 * implementer/fixer directly — bypassing the Orchestrator Self-Discipline
 * protocol (CLAUDE.md → Mandatory Delegation Directive; CHANGELOG #73) that
 * requires these agents to run only when an orchestrator delegates to them
 * via the Task tool.
 *
 * These agents are the Phase-2/3/4 producer + gate roles the orchestrator
 * drives; they stay user-invocable (a human can still select them
 * deliberately) but are removed from the model's automatic-selection pool.
 * F16.3-H1 (Cycle 10 Wave 1C): the legacy test-writer + security-auditor
 * always-floor roles have collapsed into hatch3r-testability (CQ5) and
 * hatch3r-security (CQ3); the orchestrator-only gate moves with them so the
 * Phase-4 always-floor specialists continue to require explicit delegation.
 *
 * A future enhancement (deferred to the frontmatter-parser work unit) will
 * let canonical agents declare an explicit `copilot_invocation_policy` to
 * override this default per-agent.
 *
 * Stored in canonical prefixed form (`hatch3r-…`) and matched against the
 * loop's `prefixedId` (always normalised via `toPrefixedId`), so the gate
 * fires identically whether the canonical agent declares `id: implementer`
 * or `id: hatch3r-implementer`.
 */
const COPILOT_ORCHESTRATOR_ONLY_AGENTS = new Set<string>([
  "hatch3r-implementer",
  "hatch3r-fixer",
  "hatch3r-reviewer",
  "hatch3r-testability",
  "hatch3r-security",
]);

export class CopilotAdapter extends BaseAdapter {
  readonly name = "copilot";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    const alwaysRules: { rule: CanonicalFile; content: string }[] = [];
    const scopedRules: { rule: CanonicalFile; content: string; scope: string }[] = [];

    if (ctx.features.rules) {
      // C9-H39 (D11-SA11.1-01): use the BaseAdapter-tracked read wrapper so
      // every canonical rule consumed here is recorded in
      // `this._trackedSourceFiles` and surfaces on each output's
      // `sourceFiles` field.
      const rules = await this.readTrackedCanonicalFiles(ctx.canonicalRoot, "rules", ctx.userRepoRoot);
      // Wave B3: sort by precedence so both the inlined always-rules (in
      // copilot-instructions.md) and the per-file scoped-rules are emitted
      // in priority order. Always-rules are concatenated into a single file,
      // so no NN- prefix applies to them -- the sort alone establishes load
      // order. Scoped-rules get a NN- filename prefix on their per-file path.
      const sortedRules = sortByPrecedence(rules);
      for (const rule of sortedRules) {
        // C9-H20 (D8-H8.3.1): cooperative abort between rule files.
        this.throwIfAborted(ctx);
        const { content: rawContent, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, rule);
        this.warnings.push(...warnings);
        if (skip) continue;
        // Parity with BaseAdapter.inlineRules: substitute the platform-tool
        // marker so copilot's custom rule loop stays consistent with the
        // 14 other adapters that go through the base class.
        const content = this.substituteCanonicalContent(rawContent, ctx);
        const scope = overrides.scope ?? rule.scope;
        if (scope && scope !== "always") {
          scopedRules.push({ rule: { ...rule, description: overrides.description ?? rule.description }, content, scope });
        } else {
          alwaysRules.push({ rule: { ...rule, description: overrides.description ?? rule.description }, content });
        }
      }
    }

    const bridgeOrchestration = await this.bridgeOrchestration(ctx);
    // F14.3-H2 (Cycle 10 D14, Pillar P3): per-tier output marker. Copilot
    // output was byte-identical across maturity tiers (Decision 4 / #16);
    // emit the declared tier (absence → "solo" via readMaturityTier) as the
    // first managed-block line so the tier travels with the artifact. Paired
    // with F14.3-C1's admission tagging so the marker is meaningful.
    const maturityTier = readMaturityTier(ctx.manifest);
    const innerContent = [
      "",
      `> Maturity tier: ${maturityTier}. See governance/CONSTITUTION.md Decision 16 for tier semantics.`,
      "",
      "# Hatch3r Project Instructions",
      "",
      "Canonical agent orchestration is inlined in this file; per-artifact content lives in `.github/instructions/`, `.github/agents/`, `.github/skills/`, and `.github/prompts/`.",
      "",
      bridgeOrchestration,
      "",
      COPILOT_ENFORCEMENT_ADDENDUM,
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
    // Issue #76: pass the workflow path so wrapInManagedBlock emits
    // YAML `#`-prefixed markers instead of HTML `<!-- -->` markers,
    // which GitHub Actions rejects as a YAML syntax error on line 2.
    const copilotSetupStepsPath = ".github/workflows/copilot-setup-steps.yml";
    results.push(output(
      copilotSetupStepsPath,
      wrapInManagedBlock(copilotSetupStepsInner, copilotSetupStepsPath),
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
      const agents = await this.readUserFacingCanonicalFiles(ctx.canonicalRoot, "agents", ctx.userRepoRoot);
      for (const agent of agents) {
        // C9-H20 (D8-H8.3.1): cooperative abort between agent files.
        this.throwIfAborted(ctx);
        const { content: rawContent, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, agent);
        this.warnings.push(...warnings);
        if (skip) continue;
        // Parity with BaseAdapter.inlineAgents: substitute the platform-tool
        // marker so copilot's custom agent loop stays consistent with the
        // 14 other adapters that go through the base class.
        const content = this.substituteCanonicalContent(rawContent, ctx);
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
        // D9-H-7 (D9, P6): gate auto-invocation for orchestrator-only
        // sub-agents. `disable-model-invocation: true` removes the agent
        // from Copilot's automatic-selection pool on both VS Code and
        // github.com; `user-invocable: true` keeps it selectable by a human
        // (verified field names per
        // https://docs.github.com/en/copilot/reference/custom-agents-configuration
        // accessed 2026-05-27). Without this, Copilot could auto-spawn the
        // implementer/fixer/reviewer/test-writer/security-auditor directly,
        // bypassing the Orchestrator Self-Discipline delegation protocol.
        if (COPILOT_ORCHESTRATOR_ONLY_AGENTS.has(prefixedId)) {
          lines.push("disable-model-invocation: true");
          lines.push("user-invocable: true");
        }
        const fm = `---\n${lines.join("\n")}\n---`;
        results.push(output(`.github/agents/${prefixedId}.agent.md`, `${fm}\n\n${wrapInManagedBlock(content)}`, content));
      }
    }

    // D9-H-5 (D9, P4): no canonical `prompts/` read branch. hatch3r ships no
    // `prompts/hatch3r-*.prompt.md` content, so the former
    // `if (ctx.features.prompts) { readTrackedCanonicalFiles(..., "prompts") }`
    // block read a directory that does not exist at the canonical root (ENOENT
    // → empty) and emitted nothing in production — dead code that also made
    // `ADAPTER_CAPABILITIES.copilot.prompts` mis-advertise the capability.
    // Commands still surface in Copilot's native prompts-file picker via the
    // `.github/prompts/` path below, gated on `features.commands`.
    results.push(
      ...await this.processCommandsRaw(ctx, (id) => `.github/prompts/${toPrefixedId(id)}.prompt.md`),
    );

    if (ctx.features.githubAgents) {
      // C9-H39 (D11-SA11.1-01): tracked read wrapper for github-agents provenance.
      const ghAgents = await this.readTrackedCanonicalFiles(ctx.canonicalRoot, "github-agents", ctx.userRepoRoot);
      for (const agent of ghAgents) {
        const body = agent.rawContent;
        results.push(output(`.github/agents/${toPrefixedId(agent.id)}.agent.md`, wrapInManagedBlock(body), body));
      }
    }

    // D9-H-6 (D9, P1): emit the Copilot `allowed-tools` pre-approval array on
    // each skill that declares `allowed_tools` in its canonical frontmatter,
    // so the GitHub Copilot Skills runtime skips per-invocation tool
    // confirmation for the shell binaries the skill wraps (e.g. `rg`, `jq`).
    // Verified field name per
    // https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-skills
    // (accessed 2026-05-26).
    results.push(
      ...await this.processSkillsWithFmCliFiltered(
        ctx,
        (id) => `.github/skills/${toPrefixedId(id)}/SKILL.md`,
        { emitAllowedTools: true },
      ),
    );

    // Companion/reference content (see `BaseAdapter.processCompanionSubdir`
    // for the rationale). Copilot routes commands to `.github/prompts/`,
    // so command companions land beside the per-command prompt files;
    // agents and checks follow the per-adapter agent/check directories.
    // Gating mirrors the primary feature; `checks/` rides either agents
    // or commands. Command emission to `.github/prompts/` is gated on
    // `features.commands` (D9-H-5 removed the dead canonical `prompts/`
    // read branch), so command companions follow `features.commands`.
    const companionMappings: Array<[string, boolean, (f: string) => string]> = [
      ["agents/modes", ctx.features.agents, (f) => `.github/agents/modes/${f}`],
      ["agents/shared", ctx.features.agents, (f) => `.github/agents/shared/${f}`],
      ["commands/board", ctx.features.commands, (f) => `.github/prompts/board/${f}`],
      ["commands/revision", ctx.features.commands, (f) => `.github/prompts/revision/${f}`],
      ["checks", ctx.features.agents || ctx.features.commands, (f) => `.github/checks/${f}`],
    ];
    for (const [subdir, enabled, pathFn] of companionMappings) {
      if (!enabled) continue;
      results.push(...await this.processCompanionSubdir(ctx, subdir, pathFn));
    }

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp && Object.keys(mcp).length > 0) {
      // D9-C-2 + D11-C-2 (Cycle 10, Pillars P3 + P6):
      //   - D9-C-2: VS Code's MCP schema requires per-server `type`
      //     (`stdio` | `http` | `sse`) — verified against
      //     https://code.visualstudio.com/docs/copilot/reference/mcp-configuration
      //     (accessed 2026-05-27). Without it, schema-aware tooling
      //     (mcp-inspector, VS Code 2026.05+ strict mode, awesome-copilot
      //     lint) rejects the server entries. `buildStdMcpEntries` now
      //     emits the discriminator on every entry.
      //   - D11-C-2: VS Code's MCP loader does NOT perform shell
      //     expansion — passing `envVarFormat: "shell"` silently shipped
      //     each `${env:TOKEN}` as a literal `$TOKEN` that VS Code
      //     treated as a string, so every secret-bearing STDIO MCP
      //     server (github, brave-search, sentry, postgres, linear,
      //     azure-devops, gitlab) was broken at runtime. Route STDIO
      //     secrets through VS Code's native `envFile` loader pointing
      //     at the hatch3r-managed `.env.mcp` file (matches the existing
      //     `TOOL_SECRET_NOTES.copilot` UX claim that `.env.mcp` is
      //     auto-loaded). HTTP-transport entries continue to ship their
      //     secrets via `headers` with `${env:VAR}` rewritten to `$VAR`
      //     — VS Code substitutes header `${input:NAME}` references at
      //     prompt time; the shell form is preserved on the HTTP path
      //     pending a follow-up that wires `${input:NAME}` + `inputs[]`
      //     (out-of-scope for D11-C-2's STDIO-focused fix).
      const vscodeServers = this.buildStdMcpEntries(
        mcp,
        "shell",
        "${workspaceFolder}/.env.mcp",
      );
      results.push(output(".vscode/mcp.json", JSON.stringify({ servers: vscodeServers }, null, 2) + "\n"));
    }

    return results;
  }
}
