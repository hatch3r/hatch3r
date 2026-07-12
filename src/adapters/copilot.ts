// Last updated: 2026-05-28 (P3 platform-currency anchor; D9-M2 Cycle 10 Wave-3
// re-verified the `.github/agents/{name}.agent.md` repository-level custom
// agent path schema against the current GitHub Copilot how-to docs at
// https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents
// (accessed 2026-05-28) — repository-level template path is still
// `.github/agents/{name}.agent.md`; org/enterprise-level path drops the
// `.github/` prefix to root `agents/{name}.agent.md`. The reference doc at
// /reference/custom-agents-configuration enumerates the frontmatter schema
// fields cited below.
import type {
  AdapterOutput,
  CanonicalFile,
} from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapManagedFor } from "../merge/managedBlocks.js";
import {
  readMaturityTier,
  maturityDirective,
  readConfidenceFloor,
  confidenceFloorDirective,
} from "../manifest/hatchJson.js";
import { BaseAdapter, output, type AdapterContext, type CompanionSubdir } from "./base.js";
import { sortByPrecedence, precedenceRank, resolveRuleGlobs } from "./canonical.js";
import { resolveAgentModel } from "../models/resolve.js";
import { applyCustomization } from "./customization.js";
import { detectPackageManager } from "../detect/packageManager.js";
import {
  toCopilotToolsFrontmatter,
  toCopilotToolsFrontmatterFromCategories,
} from "../pipeline/adapterToolTranslator.js";

// Issue #73 — Copilot has `hooks: false` in ADAPTER_CAPABILITIES (the
// hatch3r-emitted Copilot surface installs no PreToolUse hook, no transcript
// access for external processes, no tool-refusal API). Pipeline enforcement of
// what hatch3r ships is therefore trust-based; this addendum surfaces the
// constraint to the model on every turn and names the self-detectable drift
// indicators.
//
// D9-17 (Cycle 11 Wave 3, D9, P3 currency): the prior absolute "Copilot cannot
// block server-side" claim is Preview-qualified as of 2026-06-09. The VS Code
// surface now documents an agent-customization PreToolUse hook (Preview) that
// returns `permissionDecision: "deny"` to block a single tool call, plus an
// agent-scoped `hooks:` frontmatter field. hatch3r does NOT yet emit that
// deny-gate (tracked as a CL-2 content-gap candidate), so the shipped
// enforcement remains trust-based — but the addendum no longer claims the
// platform is incapable of a block. Sources (accessed 2026-06-09):
//   https://code.visualstudio.com/docs/agent-customization/hooks
//   https://code.visualstudio.com/docs/agent-customization/custom-agents
const COPILOT_ENFORCEMENT_ADDENDUM = `## Copilot Enforcement Model (trust-based on the emitted surface)

The hatch3r-emitted Copilot surface installs no PreToolUse or pre-edit hook
(see \`src/adapters/index.ts\` — \`copilot\` is the only adapter with
\`hooks: false\` in \`ADAPTER_CAPABILITIES\`), so hatch3r does not block
code-writing tool calls server-side on what it ships today. Enforcement of
these directives is therefore trust-based — the directives in this file and in
\`.github/instructions/\` are normative, not advisory.

Platform note (Preview, accessed 2026-06-09): VS Code now exposes an
agent-customization PreToolUse hook that can return
\`permissionDecision: "deny"\` to block a single tool call, plus an agent-scoped
\`hooks:\` frontmatter field
(https://code.visualstudio.com/docs/agent-customization/hooks,
https://code.visualstudio.com/docs/agent-customization/custom-agents). hatch3r
does not emit that deny-gate yet, so the trust-based model above is what governs
the current output; treat the self-detectable indicators below as the active
control.

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

/**
 * D9-SA9.3-01 (Cycle 12, D9, P3): GitHub caps a custom-agent prompt — the
 * Markdown content below the YAML frontmatter of a `.github/agents/*.agent.md`
 * file — at 30,000 characters
 * (docs.github.com/en/copilot/reference/custom-agents-configuration, accessed
 * 2026-07-11: "The prompt can be a maximum of 30,000 characters"). The docs do
 * not specify the overflow behavior, so an over-cap prompt is truncated or
 * rejected with no signal to the user or the framework — a silent runtime loss
 * on the highest-value agents (reviewer, implementer, learnings-loader,
 * testability all exceed it as of Cycle 12). {@link CopilotAdapter.warnIfPromptOverCap}
 * converts that into an audit-visible sync warning per the Silent Failure
 * Contract (CONSTITUTION §2 P5); the canonical-body trim that brings the four
 * agents back under the cap routes through the content lifecycle.
 */
const COPILOT_AGENT_PROMPT_CAP = 30_000;

/**
 * D9-16 (Cycle 11 Wave 3, D9, P3 model resolution + P5 silent-failure): the
 * GitHub Copilot `.agent.md` `model:` frontmatter field expects a model the
 * Copilot model picker resolves — a provider-dated model ID
 * (`claude-sonnet-4.5`, `gpt-5.2-codex`, `gemini-3-flash`) or a documented
 * display name carrying a `(copilot)` qualifier (`GPT-5.2 (copilot)`). Source:
 * https://docs.github.com/en/copilot/reference/custom-agents-configuration +
 * the agent-frontmatter `model:` examples on
 * https://code.visualstudio.com/docs/agent-customization/custom-agents
 * (accessed 2026-06-06).
 *
 * The hatch3r-internal capacity tiers `standard` and `fast` (authored on 29 of
 * the canonical agents' `model:` frontmatter) are NOT in `MODEL_ALIASES`, so
 * `resolveAgentModel` → `resolveModelAlias` passes them through verbatim. Copilot
 * cannot resolve either word, so it silently falls back to the picker default —
 * the per-agent cost tier becomes a no-op AND the emitted file carries an
 * unrecognized value (a silent-failure surface, CONSTITUTION §2 P5). Gate native
 * emission to a recognizable value; an unmappable tier word is omitted (Copilot
 * then uses its default, which is the same effective behaviour but without
 * shipping a dead field). This mirrors `isClaudeRecognizableModel`
 * (src/adapters/claude.ts) for the Copilot surface.
 */
function isCopilotRecognizableModel(model: string): boolean {
  return (
    /^claude-/.test(model) ||
    /^gpt-/.test(model) ||
    /^codex-/.test(model) ||
    /^gemini-/.test(model) ||
    // Documented display-name form: a `(copilot)`-qualified picker label.
    /\(copilot\)\s*$/.test(model)
  );
}

/**
 * hatch3r-internal `model:` placeholders the Copilot surface omits by design, so
 * {@link CopilotAdapter.warnIfModelDropped} stays silent on them. Two provenance
 * groups: (1) the capacity-tier words authored on canonical agents' `model:`
 * frontmatter — `standard`/`fast` — plus the other `TriageTier` members `light`/`deep`
 * (src/pipeline/costEstimator.ts) for forward-compat if an agent adopts them; (2) the
 * `inherit` sentinel, which `resolveModelAlias` passes through verbatim and whose
 * emission IS omission (src/models/resolve.ts). None is a user model choice, so a drop
 * warning on any of them would be per-sync noise on the shipped agent corpus, not the
 * signal D9-SA9.3-06 targets (an unrecognized USER-configured model).
 */
const COPILOT_INTENTIONALLY_OMITTED_MODELS: ReadonlySet<string> = new Set([
  "standard",
  "fast",
  "light",
  "deep",
  "inherit",
]);

/**
 * D5-39 (Cycle 11 Wave 3, D5, P6): default tool-category grant per github-agent
 * role, keyed by emitted (prefixed) id. github-agents (`type: github-agent`)
 * are simplified cloud-agent definitions whose ids are outside the canonical
 * `AGENT_TOOL_POLICIES` registry, so `toCopilotToolsFrontmatter` returns `null`
 * for them and — pre-fix — they shipped with NO `tools:` restriction (a
 * security/lint cloud agent inherited every tool). These grants give each role
 * a least-privilege baseline the adapter renders via
 * `toCopilotToolsFrontmatterFromCategories`:
 *   - docs  → read/search/write  (writes specs + ADRs; no shell)
 *   - test  → read/search/write/execute  (writes + runs tests)
 *   - lint  → read/search/write/execute  (applies fixes + runs linters)
 *   - security → read/search  (audits; reports findings, never mutates)
 * An unlisted github-agent falls back to {@link GITHUB_AGENT_DEFAULT_CATEGORIES}
 * (read/search) — the most restrictive functional baseline — so a future
 * github-agent is never emitted unrestricted. Categories resolve through the
 * shared `COPILOT_CATEGORY_MAP`, so the category→alias mapping stays
 * single-source with the registry path.
 */
const GITHUB_AGENT_TOOL_CATEGORIES: Readonly<Record<string, readonly string[]>> = {
  "hatch3r-docs-agent": ["read", "search", "write"],
  "hatch3r-test-agent": ["read", "search", "write", "execute"],
  "hatch3r-lint-agent": ["read", "search", "write", "execute"],
  "hatch3r-security-agent": ["read", "search"],
};

/** D5-39: read-only baseline for any github-agent without an explicit grant. */
const GITHUB_AGENT_DEFAULT_CATEGORIES: readonly string[] = ["read", "search"];

/**
 * D9-5 (Cycle 11 D9, P3) / D5-39 (Cycle 11 Wave 3, D5): strip a leading
 * `---\n...\n---` YAML frontmatter fence and return the remaining body. Used by
 * the github-agents emission path: the authored fence is discarded (the adapter
 * re-serializes a Copilot-recognized frontmatter under D5-39) and only the body
 * is wrapped in a managed block — Copilot's `.github/agents/*.agent.md` loader
 * parses frontmatter only at byte 0, so the normalized fence must sit there.
 * Mirrors the anchored shape of `FRONTMATTER_REGEX` in
 * `src/adapters/canonical.ts`.
 *
 * Returns the whole input as `body` when there is no leading fence (e.g. a
 * frontmatter-less github-agent).
 */
function splitFrontmatter(raw: string): { body: string } {
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n([\s\S]*))?$/);
  if (!match) return { body: raw };
  return { body: match[1] ?? "" };
}

/**
 * D12-1 (Cycle 11 Wave 2, D12, P2): single-canonical-source attribution for a
 * per-file Copilot output (one scoped-rule `.instructions.md`, one
 * `.agent.md`, one github-agent `.agent.md`). Returns `[file.sourcePath]` so
 * the output self-attributes to its one canonical input instead of inheriting
 * the adapter-wide read set; `undefined` for a synthesised fixture whose
 * `sourcePath` is empty. The inlined always-rules in
 * copilot-instructions.md are NOT per-file — that artifact aggregates many
 * rules and correctly keeps the adapter-wide set.
 */
function copilotSingleSource(file: CanonicalFile): string[] | undefined {
  return file.sourcePath ? [file.sourcePath] : undefined;
}

/**
 * A VS Code `.vscode/mcp.json` top-level input-variable entry. VS Code prompts
 * the user for the value and substitutes it wherever `${input:<id>}` appears.
 * Schema verified against
 * https://code.visualstudio.com/docs/agents/reference/mcp-configuration
 * (input-variables-for-sensitive-data, accessed 2026-06-05): `id`, `type`,
 * `description` are required; `password: true` masks the entry.
 */
interface VsCodeMcpInput {
  id: string;
  type: "promptString";
  description: string;
  password: true;
}

/** Matches a `${env:NAME}` reference and captures the POSIX env-var `NAME`. */
const ENV_REF_REGEX = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * D11-7 (Cycle 11 D11, P6/CQ4): rewrite every `${env:NAME}` reference inside
 * the `headers` object of each VS Code MCP server entry to the VS Code
 * `${input:NAME}` form, and return a deduped `inputs[]` array carrying one
 * `{id,type:"promptString",password:true}` entry per distinct `NAME`.
 *
 * Rationale: VS Code does NOT shell-expand `$VAR` in MCP header values; the
 * only header-secret mechanism it substitutes is a top-level `inputs[]`
 * variable referenced as `${input:NAME}`. The adapter therefore emits header
 * `${env:NAME}` (preserved via the `"passthrough"` transform) as `${input:NAME}`
 * and declares the matching input. Non-secret static headers (no `${env:...}`)
 * pass through unchanged and produce no input.
 *
 * Mutates each entry's `headers` in place. Input ids are emitted in
 * first-seen order across the server map so the generated file is stable
 * across runs (deterministic aggregation).
 */
function collectMcpHeaderInputs(
  servers: Record<string, Record<string, unknown>>,
): VsCodeMcpInput[] {
  const seen = new Set<string>();
  const inputs: VsCodeMcpInput[] = [];
  for (const entry of Object.values(servers)) {
    const headers = entry.headers;
    if (!headers || typeof headers !== "object") continue;
    const headerObj = headers as Record<string, unknown>;
    for (const [key, value] of Object.entries(headerObj)) {
      if (typeof value !== "string") continue;
      headerObj[key] = value.replace(ENV_REF_REGEX, (_full, name: string) => {
        if (!seen.has(name)) {
          seen.add(name);
          inputs.push({
            id: name,
            type: "promptString",
            description: `Secret for MCP header \${input:${name}}`,
            password: true,
          });
        }
        return `\${input:${name}}`;
      });
    }
  }
  return inputs;
}

export class CopilotAdapter extends BaseAdapter {
  readonly name = "copilot";

  /**
   * D9-SA9.3-01 (Cycle 12, D9, P3): push an audit-visible warning when an
   * emitted `.github/agents/*.agent.md` prompt exceeds GitHub's documented
   * 30,000-character cap ({@link COPILOT_AGENT_PROMPT_CAP}). `prompt` is the
   * Markdown below the YAML frontmatter — the managed-block-wrapped body, which
   * is exactly what Copilot ingests and counts. Over the cap, Copilot truncates
   * or rejects the prompt with no signal; naming the agent, its measured size,
   * and the cap satisfies the Silent Failure Contract (CONSTITUTION §2 P5) so
   * the operator sees which agent will be truncated before shipping it.
   */
  private warnIfPromptOverCap(agentPath: string, prompt: string): void {
    if (prompt.length <= COPILOT_AGENT_PROMPT_CAP) return;
    this.warnings.push(
      `${agentPath}: emitted Copilot agent prompt is ${prompt.length} characters, ` +
        `over GitHub's ${COPILOT_AGENT_PROMPT_CAP}-character custom-agent limit — Copilot ` +
        `truncates or rejects the prompt, silently dropping instruction. Reduce the ` +
        `agent's canonical body below ${COPILOT_AGENT_PROMPT_CAP} characters.`,
    );
  }

  /**
   * D9-SA9.3-06 (Cycle 12, D9, P1 + P5 silent-failure): {@link isCopilotRecognizableModel}
   * admits only the four provider-prefix families (`claude-`/`gpt-`/`codex-`/`gemini-`)
   * plus a `(copilot)`-qualified display name. GitHub's supported-models reference
   * (docs.github.com/en/copilot/reference/ai-models/supported-models, accessed
   * 2026-07-12) also lists picker models OUTSIDE those prefixes — `MAI-Code-1-Flash`
   * (Microsoft), `Raptor mini` (fine-tuned GPT-5 mini), `Kimi-K2.7-Code` (Moonshot AI).
   * A user who sets `models.agents.<id>` to such a valid Copilot model has the `model:`
   * field OMITTED by the recognizable-value gate at the emission sites, and Copilot falls
   * back to the picker default — the explicit per-agent choice becomes a silent no-op. The
   * non-prefix vendors are unpredictable (three already), so widening the regex cannot
   * generalize; this converts the drop into an audit-visible sync warning per the Silent
   * Failure Contract (CONSTITUTION §2 P5). The field stays omitted — D9-16's safe fallback
   * is preserved, no dead field is shipped — only the operator-facing signal is added. The
   * hatch3r-internal placeholders in {@link COPILOT_INTENTIONALLY_OMITTED_MODELS} are not
   * user model choices and never warn.
   */
  private warnIfModelDropped(artifactPath: string, model: string | undefined): void {
    if (!model || isCopilotRecognizableModel(model)) return;
    if (COPILOT_INTENTIONALLY_OMITTED_MODELS.has(model)) return;
    this.warnings.push(
      `${artifactPath}: configured model "${model}" is not a Copilot-recognizable ` +
        `value (expected a claude-/gpt-/codex-/gemini- id or a "(copilot)" display name), ` +
        `so the model: field was omitted and Copilot falls back to the picker default — the ` +
        `per-agent model choice is a no-op. Use a supported id from ` +
        `docs.github.com/en/copilot/reference/ai-models/supported-models.`,
    );
  }

  /**
   * D9-SA9.3-08 / CL-2 U11 (Cycle 12, D9, P6): opt-in VS Code MCP sandbox
   * hardening. Applies `sandboxEnabled: true` to the emitted stdio server
   * entries selected by `copilot.mcpSandbox.servers` (`"all"` = every stdio
   * entry) and returns the configured top-level `sandbox` rules object when at
   * least one server was actually sandboxed. VS Code schema (accessed
   * 2026-07-12, code.visualstudio.com/docs/agents/reference/mcp-configuration):
   * per-server `sandboxEnabled` is stdio-only and macOS/Linux-only; the
   * top-level `sandbox` object (sibling of `servers`/`inputs`) carries
   * `filesystem.{allowWrite,denyRead,denyWrite}` +
   * `network.{allowedDomains,deniedDomains}` and applies to all sandboxed
   * servers, which "can only access the file system paths and network domains
   * that you explicitly permit" (default-deny — the reason this emission is
   * OPT-IN: blanket enablement would break every network-reaching stdio MCP
   * server in the canonical set). Warnings per the Silent Failure Contract:
   * a named-but-absent server, a named HTTP server (skipped — stdio-only), and
   * rules configured with zero sandboxed servers (rules omitted, never inert).
   */
  private applyMcpSandbox(
    ctx: AdapterContext,
    servers: Record<string, Record<string, unknown>>,
  ): Record<string, unknown> | undefined {
    const cfg = ctx.manifest.copilot?.mcpSandbox;
    if (!cfg) return undefined;
    const requested =
      cfg.servers === "all"
        ? Object.keys(servers).filter((name) => servers[name].type === "stdio")
        : cfg.servers;
    let sandboxedCount = 0;
    for (const name of requested) {
      const entry = servers[name];
      if (!entry) {
        this.warnings.push(
          `copilot: mcpSandbox names server "${name}" but no such server is emitted to ` +
            `.vscode/mcp.json — no sandboxEnabled applied for it. Check manifest mcp.servers ` +
            `and the copilot.mcpSandbox.servers list.`,
        );
        continue;
      }
      if (entry.type !== "stdio") {
        this.warnings.push(
          `copilot: mcpSandbox names server "${name}", but VS Code's sandboxEnabled field ` +
            `applies to stdio servers only — "${name}" is ${String(entry.type)}-transport, ` +
            `so it was skipped (code.visualstudio.com/docs/agents/reference/mcp-configuration).`,
        );
        continue;
      }
      entry.sandboxEnabled = true;
      sandboxedCount++;
    }
    if (!cfg.rules) return undefined;
    if (sandboxedCount === 0) {
      this.warnings.push(
        "copilot: mcpSandbox.rules is configured but no emitted server was sandboxed — " +
          "omitting the top-level sandbox object (its rules apply only to sandboxed servers, " +
          "so emitting it would ship dead config).",
      );
      return undefined;
    }
    return cfg.rules as Record<string, unknown>;
  }

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const results: AdapterOutput[] = [];

    // D2-SA2.4-01 (D9/D15, P3): the selected MCP server set, threaded into the
    // emitted Copilot `tools:` allowlist so an mcp-granted agent names each
    // reachable `<server>/*`. Copilot has no `mcp-servers` frontmatter primitive
    // in VS Code/IDE custom agents, so the `tools:` list is the only MCP grant
    // mechanism there — an enumerated list without `<server>/*` tokens excludes
    // every MCP tool. Gated on `ctx.features.mcp` to match the MCP-emission gate.
    const mcpServers = ctx.features.mcp ? ctx.manifest.mcp.servers : [];

    const alwaysRules: { rule: CanonicalFile; content: string }[] = [];
    // X4/CD4 (D6-1/D9-1/D11-1 — GLOBS DROP): carry the RESOLVED glob list
    // (from resolveRuleGlobs) instead of the raw `scope` string. The previous
    // shape stored `scope` and the emission loop derived `applyTo` from it via
    // `scope.split(",")`, which emitted `applyTo: "conditional"` for every
    // `scope: conditional` rule (real patterns live in the `globs:` field, not
    // `scope`). VS Code never matched that literal, so the instruction file
    // never scoped to any file.
    const scopedRules: { rule: CanonicalFile; content: string; globs: string[] }[] = [];

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
        const ruleWithDesc = { ...rule, description: overrides.description ?? rule.description };
        // X4/CD4: resolve the real glob set up front. A `scope: conditional`
        // rule whose `globs:` field is absent/empty resolves to [] and is
        // (correctly) treated as unconditional → inlined into the always-rules
        // block rather than emitted as a scoped instruction file with an empty
        // `applyTo`. D5-28: a `scope: agent-requested` rule also resolves to []
        // here — Copilot has no agent-requested primitive, so it loads
        // unconditionally (the honest fallback; the lazy-pull win is Cursor-only).
        const globs = resolveRuleGlobs(rule, { scope: overrides.scope });
        if (globs.length > 0) {
          scopedRules.push({ rule: ruleWithDesc, content, globs });
        } else {
          alwaysRules.push({ rule: ruleWithDesc, content });
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
    // D1-17 (Cycle 11 Wave 3, D1, P1): resolved confidence floor (explicit
    // `confidenceFloor` else the maturity-aware default) so the configured
    // agent-assertiveness floor reaches copilot-instructions.md — pre-fix the
    // persisted floor reached no adapter output.
    const confidenceFloor = readConfidenceFloor(ctx.manifest);
    // D6-29 (Cycle 11 Wave 3): emit the shared directive payload (single source
    // in hatchJson.ts::maturityDirective) as a blockquote line — copilot's
    // native marker form, in contrast to the claude/cursor HTML-comment wrapper.
    // D1-17: the confidence-floor marker rides the same blockquote surface.
    const innerContent = [
      "",
      `> ${maturityDirective(maturityTier)}`,
      `> ${confidenceFloorDirective(confidenceFloor)}`,
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
    results.push(output(
      ".github/copilot-instructions.md",
      wrapManagedFor(".github/copilot-instructions.md", innerContent),
      innerContent,
    ));

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
    // Issue #76: wrapManagedFor derives the marker variant from the path, so
    // this `.yml` output gets YAML `#`-prefixed markers instead of HTML
    // `<!-- -->` markers, which GitHub Actions rejects as a YAML syntax error
    // on line 2. The path-mandatory helper makes this correct-by-construction
    // (D11-SA11.2-F8): an author cannot omit the path and fall back to the
    // markdown default here.
    const copilotSetupStepsPath = ".github/workflows/copilot-setup-steps.yml";
    results.push(output(
      copilotSetupStepsPath,
      wrapManagedFor(copilotSetupStepsPath, copilotSetupStepsInner),
      copilotSetupStepsInner,
    ));

    for (const { rule, content, globs } of scopedRules) {
      // X4/CD4: `globs` is the resolved pattern list from resolveRuleGlobs
      // (never the literal "conditional"). VS Code's `applyTo` is a single
      // comma-separated glob string per
      // https://code.visualstudio.com/docs/agent-customization/custom-instructions
      // (custom instructions `applyTo` frontmatter).
      const applyTo = globs.join(", ");
      const fmLines = [`applyTo: "${applyTo}"`];
      // D5-29 (Cycle 11 Wave 3, P6): render the optional Copilot agent-scope
      // opt-out. A rule that declares `copilot_exclude_agent: "code-review"`
      // (or `"coding-agent"` / `"cloud-agent"`) emits an `excludeAgent:` line
      // so the named agent skips this path-scoped instruction file — the only
      // Copilot-native opt-out for a path-specific instructions file
      // (https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot,
      // accessed 2026-06-06: works alongside `applyTo`; omission = every agent
      // uses the file). Absent on every canonical rule today, so no line is
      // emitted by default and current output is byte-identical.
      if (rule.copilotExcludeAgent) {
        fmLines.push(`excludeAgent: "${rule.copilotExcludeAgent}"`);
      }
      const fm = `---\n${fmLines.join("\n")}\n---`;
      const body = `# ${rule.id}\n\n${rule.description}\n\n${content}`;
      // Wave B3: NN- filename prefix on scoped per-file rule outputs.
      const nn = precedenceRank(rule.precedence) / 10;
      const instrPath = `.github/instructions/${nn}-${toPrefixedId(rule.id)}.instructions.md`;
      results.push(
        output(
          instrPath,
          `${fm}\n\n${wrapManagedFor(instrPath, body)}`,
          body,
          copilotSingleSource(rule),
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
        // D9-16 (Cycle 11 Wave 3, P3 + P5): emit `model:` only when it resolves
        // to a Copilot-recognizable value. The hatch3r-internal tier words
        // `standard`/`fast` (on 29 canonical agents) are not Copilot picker
        // names; emitting them ships a dead field Copilot silently ignores
        // while falling back to its default. Omitting them yields the same
        // effective model with no silent-failure surface.
        if (model && isCopilotRecognizableModel(model)) lines.push(`model: ${model}`);
        // C7.5-W2B2-H41/H45 (D15, P6): emit Copilot `tools:` allowlist
        // translated from AGENT_TOOL_POLICIES so the downstream Copilot
        // agent runtime enforces the hatch3r monotonic-privilege
        // invariant. Copilot frontmatter format:
        // https://docs.github.com/en/copilot/reference/custom-agents-configuration
        // (accessed 2026-04-20).
        const copilotTools = toCopilotToolsFrontmatter(prefixedId, mcpServers);
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
        const agentPath = `.github/agents/${prefixedId}.agent.md`;
        // D9-SA9.3-06 (Cycle 12): if `model` resolved to a value the D9-16 gate
        // above dropped (a user-configured non-prefix Copilot model), surface the
        // omission — it is otherwise a silent per-agent no-op.
        this.warnIfModelDropped(agentPath, model);
        // D9-SA9.3-01 (Cycle 12): warn if the below-frontmatter prompt exceeds
        // GitHub's 30,000-char custom-agent cap (the wrapped body is exactly what
        // Copilot ingests and counts).
        const wrappedAgent = wrapManagedFor(agentPath, content);
        this.warnIfPromptOverCap(agentPath, wrappedAgent);
        results.push(output(agentPath, `${fm}\n\n${wrappedAgent}`, content, copilotSingleSource(agent)));
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
    //
    // release/2.2.0 — `emitModel`: Copilot documents a `model:` frontmatter
    // field on `.github/prompts/*.prompt.md` in STRING form only (the Copilot
    // CLI rejects the array form — github/copilot-cli#2133; omitted = the
    // user's picker model, and there is no `inherit` keyword, so unset is
    // expressed by omitting the field; docs.github.com prompt-files reference,
    // accessed 2026-07-08). The base helper emits the single unquoted-scalar
    // string shape and never emits `inherit`, matching both constraints; the
    // D9-16 recognizable-value gate keeps tier words / unknown IDs out.
    results.push(
      ...await this.processCommandsWithFm(
        ctx,
        (id) => `.github/prompts/${toPrefixedId(id)}.prompt.md`,
        { emitModel: isCopilotRecognizableModel },
      ),
    );

    // D5-41 (Cycle 11 Wave 3, D5, P4 / D16.3 add-vs-remove bias): suppress the
    // github-agent picker entries when the full regular-agent path is active.
    // github-agents (`type: github-agent`, e.g. `hatch3r-security-agent`) are
    // simplified cloud-agent twins of regular agents (`hatch3r-security`) and
    // emit to the SAME `.github/agents/{prefixedId}.agent.md` picker the
    // regular-agent loop above populates. With the default
    // `features.agents = true` AND `features.githubAgents = true`, a real init
    // shipped BOTH `hatch3r-security.agent.md` (regular: protected, an
    // `AGENT_TOOL_POLICIES`-backed `tools:` allowlist, orchestrator-only
    // invocation gating) AND the weaker `hatch3r-security-agent.agent.md`
    // (github-agent: read-only baseline `tools:`, no protection, no gating) into
    // one picker — ×4 such pairs (docs/lint/security/test). The duplicate
    // weaker twin is a selection hazard and content bloat.
    //
    // D16.3 bias is consolidation/gate over removal: the github-agents content
    // is NOT deleted — it is the SOLE agent surface when the regular-agent path
    // is off (`features.agents === false`, the Copilot-cloud-only / pack
    // configuration where only the simplified twins should ship). Gate emission
    // OFF only when the regular path supersedes it; this keeps the picker free
    // of weaker duplicates in the common case and preserves the twins for the
    // narrow case that needs them.
    if (ctx.features.githubAgents && !ctx.features.agents) {
      // C9-H39 (D11-SA11.1-01): tracked read wrapper for github-agents provenance.
      const ghAgents = await this.readTrackedCanonicalFiles(ctx.canonicalRoot, "github-agents", ctx.userRepoRoot);
      for (const agent of ghAgents) {
        // D5-39 (Cycle 11 Wave 3, D5, P6): NORMALIZE the github-agent
        // frontmatter instead of shipping the authored fence verbatim. The
        // authored frontmatter carries fields Copilot's `.github/agents/*.agent.md`
        // loader does not recognize (`type`, `tags`, `quality_charter`,
        // `efficiency_patterns`, `cache_friendly`) and — critically — NO
        // `tools:` line, so every github-agent (including the security and lint
        // cloud agents) shipped with no tool restriction. Re-serialize a
        // Copilot-recognized frontmatter (`name` + `description` + a `tools:`
        // allowlist + an optional gated `model:`) from the parsed metadata.
        //
        // D9-5 layout is preserved: the frontmatter still opens at byte 0 and
        // only the body is wrapped in the managed block (Copilot parses
        // frontmatter only at byte 0). `splitFrontmatter` is retained solely to
        // recover the prose body; the authored fence is discarded in favour of
        // the normalized one.
        const { body } = splitFrontmatter(agent.rawContent);
        const prefixedId = toPrefixedId(agent.id);
        const ghAgentPath = `.github/agents/${prefixedId}.agent.md`;
        const lines = [`name: ${agent.id}`, `description: ${agent.description}`];
        // D9-16 (Cycle 11 Wave 3, P3 + P5): same model gate as the regular-agent
        // path — emit `model:` only for a Copilot-recognizable value, never the
        // hatch3r tier words `standard`/`fast`.
        const model = agent.model ? resolveAgentModel(agent.id, agent, ctx.manifest, {}) : undefined;
        if (model && isCopilotRecognizableModel(model)) lines.push(`model: ${model}`);
        // D9-SA9.3-06 (Cycle 12): same drop-visibility guard on the github-agent surface.
        this.warnIfModelDropped(ghAgentPath, model);
        // D5-39: per-role least-privilege `tools:` allowlist (read-only baseline
        // for an unlisted github-agent), rendered through the shared category map.
        const categories = GITHUB_AGENT_TOOL_CATEGORIES[prefixedId] ?? GITHUB_AGENT_DEFAULT_CATEGORIES;
        const tools = toCopilotToolsFrontmatterFromCategories(categories, mcpServers);
        if (tools) {
          lines.push(`tools: [${tools.map((t) => `"${t}"`).join(", ")}]`);
        }
        const fm = `---\n${lines.join("\n")}\n---`;
        const wrappedBody = wrapManagedFor(ghAgentPath, body);
        // D9-SA9.3-01 (Cycle 12): same cap guard on the github-agent surface.
        this.warnIfPromptOverCap(ghAgentPath, wrappedBody);
        const content = `${fm}\n\n${wrappedBody}`;
        results.push(output(ghAgentPath, content, body, copilotSingleSource(agent)));
      }
    }

    // D9-H-6 (D9, P1): emit the Copilot `allowed-tools` pre-approval array on
    // each skill that declares `allowed_tools` in its canonical frontmatter,
    // so the GitHub Copilot Skills runtime skips per-invocation tool
    // confirmation for the shell binaries the skill wraps (e.g. `rg`, `jq`).
    // Verified field name per
    // https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-skills
    // (accessed 2026-05-26).
    //
    // D9-M3 (Cycle 10 D9 Wave-3, P3): the `.github/skills/{name}/SKILL.md`
    // emission path matches the Agent Skills standard discovery contract
    // re-verified 2026-05-28 against the same docs page — project skills
    // live under `.github/skills/`, `.claude/skills/`, or `.agents/skills/`;
    // each skill is its own subdirectory; the entry file MUST be literally
    // `SKILL.md` (case-sensitive). This adapter targets the `.github/skills/`
    // root because Copilot's primary discovery loader scans that path in
    // .github-hosted repositories; the dual `.agents/skills/` discovery is
    // out-of-scope for the copilot adapter (canonical content ships only
    // bundled via npm in 1.9.0+; see resolveBundledContentRoot).
    //
    // release/2.2.0 — NO `emitModel` here, deliberately: Copilot's create-skills
    // docs enumerate `name`/`description`/`allowed-tools` frontmatter but
    // document no `model` field on SKILL.md, and no release note confirms one
    // (re-checked 2026-07-08 against the same docs page as D9-M3). Emitting an
    // undocumented field would ship dead frontmatter (CONSTITUTION §2 P5
    // silent-failure surface) — the exact failure D9-16 removed from the agent
    // path. Revisit when Copilot documents SKILL.md model support; the
    // `models.skills` map then only needs this opts entry, no new plumbing.
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
    const companionMappings: Array<[CompanionSubdir, boolean, (f: string) => string]> = [
      ["agents/modes", ctx.features.agents, (f) => `.github/agents/modes/${f}`],
      ["agents/shared", ctx.features.agents, (f) => `.github/agents/shared/${f}`],
      ["commands/board", ctx.features.commands, (f) => `.github/prompts/board/${f}`],
      ["commands/revision", ctx.features.commands, (f) => `.github/prompts/revision/${f}`],
      // D2-SA2.1-01 (Cycle 12): the orchestration-frame companion referenced by
      // every emitted orchestrator command. Copilot routes command companions
      // under `.github/prompts/` (matching the board/revision rows above), so the
      // shared frame ships to `.github/prompts/shared/` and its references resolve.
      ["commands/shared", ctx.features.commands, (f) => `.github/prompts/shared/${f}`],
      ["checks", ctx.features.agents || ctx.features.commands, (f) => `.github/checks/${f}`],
    ];
    for (const [subdir, enabled, pathFn] of companionMappings) {
      if (!enabled) continue;
      results.push(...await this.processCompanionSubdir(ctx, subdir, pathFn));
    }

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp && Object.keys(mcp).length > 0) {
      // D9-C-2 + D11-C-2 + D11-7 (Cycle 10–11, Pillars P3 + P6 + CQ4):
      //   - D9-C-2: VS Code's MCP schema requires per-server `type`
      //     (`stdio` | `http` | `sse`) — verified against
      //     https://code.visualstudio.com/docs/agents/reference/mcp-configuration
      //     (accessed 2026-05-27). Without it, schema-aware tooling
      //     (mcp-inspector, VS Code 2026.05+ strict mode, awesome-copilot
      //     lint) rejects the server entries. `buildStdMcpEntries` now
      //     emits the discriminator on every entry.
      //   - D11-C-2: VS Code's MCP loader does NOT perform shell
      //     expansion on the STDIO `env` object — every secret-bearing
      //     STDIO MCP server (github, brave-search, sentry, postgres,
      //     linear, azure-devops, gitlab) routes its secrets through VS
      //     Code's native `envFile` loader pointing at the hatch3r-managed
      //     `.env.mcp` file (matches `TOOL_SECRET_NOTES.copilot`).
      //   - D11-7: VS Code also does NOT shell-expand `$VAR` inside header
      //     values, so the prior `transformEnvVarSyntax(headers, "shell")`
      //     shipped a literal `Bearer $GITHUB_PAT` that authenticated
      //     nothing. Pass `"passthrough"` so header `${env:NAME}` survives
      //     `buildStdMcpEntries`, then rewrite each `${env:NAME}` to a VS
      //     Code `${input:NAME}` reference and emit a matching top-level
      //     `inputs[]` entry ({id,type:"promptString",password:true}) — the
      //     only header-secret mechanism VS Code substitutes at prompt
      //     time. Schema verified against
      //     https://code.visualstudio.com/docs/agents/reference/mcp-configuration
      //     (input-variables-for-sensitive-data, accessed 2026-06-05).
      const vscodeServers = this.buildStdMcpEntries(
        mcp,
        "passthrough",
        "${workspaceFolder}/.env.mcp",
      );
      const inputs = collectMcpHeaderInputs(vscodeServers);
      // D15-27 (Cycle 11 Wave 3, D15, P3/P6, SA15.5-F6): no top-level
      // `protocolVersion` here. The MCP forward-pin is Claude-only by SCHEMA
      // CONSTRAINT, not omission — VS Code's `.vscode/mcp.json` top level is
      // exactly `servers`, `inputs`, `sandbox`
      // (code.visualstudio.com/docs/agents/reference/mcp-configuration, accessed
      // 2026-06-09), and an unknown top-level key trips the same schema-aware
      // tooling D9-C-2 targets (mcp-inspector / VS Code strict mode /
      // awesome-copilot lint). The shared rationale and the Claude-side emission
      // contrast live at `MCP_DEFAULT_PROTOCOL_VERSION` in mcp-utils.ts.
      // D9-SA9.3-08 / CL-2 U11 (Cycle 12, D9, P6): opt-in MCP sandbox — flags
      // selected stdio entries `sandboxEnabled: true` in place and returns the
      // top-level `sandbox` rules object (or undefined). Default OFF; see
      // applyMcpSandbox for the schema citation + default-deny rationale.
      const sandboxRules = this.applyMcpSandbox(ctx, vscodeServers);
      const doc: Record<string, unknown> = {};
      if (inputs.length > 0) doc.inputs = inputs;
      doc.servers = vscodeServers;
      if (sandboxRules) doc.sandbox = sandboxRules;
      results.push(output(".vscode/mcp.json", JSON.stringify(doc, null, 2) + "\n"));
      // D15-28 (Cycle 11 Wave 3, D15, P6, SA15.5-F7): Silent Failure Contract.
      // A non-empty `inputs[]` means at least one HTTP MCP server carried a
      // secret-bearing header (`${env:NAME}`) that was rewritten to the VS Code
      // `${input:NAME}` prompt form — the ONLY header-secret mechanism VS Code
      // substitutes. Unlike STDIO `envFile` secrets (loaded transparently from
      // `.env.mcp`), an `${input:NAME}` header is resolved by an interactive VS
      // Code prompt at first server use, NOT from `.env.mcp`. Surface this so an
      // operator who set the secret in `.env.mcp` understands why VS Code still
      // prompts and does not assume the header authenticates silently.
      if (inputs.length > 0) {
        const ids = inputs.map((i) => i.id).join(", ");
        this.warnings.push(
          `Copilot MCP: HTTP header secret(s) ${ids} emitted to .vscode/mcp.json ` +
            `as \`\${input:...}\` prompt variable(s) — VS Code does NOT expand ` +
            `\`.env.mcp\` in header values, so VS Code will prompt for these at ` +
            `first MCP use (the value is not read from .env.mcp). Enter the secret ` +
            `when prompted; it is stored in VS Code's secret storage thereafter.`,
        );
      }
    }

    return results;
  }
}
