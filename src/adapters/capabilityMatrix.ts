// Bucket 2.5 / Decision 21 — D09 capability-utilization audit logic.
//
// Implements the per-adapter twin metric (currency + utilization) called for
// by `governance/audit/domains/D09-platform-adapters.md` Sub-Agent 9.1–9.3
// checklist "Capability utilization scan" and §9.4 "Utilization-gap aggregation".
//
// Three responsibilities:
//   1. Enumerate the capabilities the hatch3r adapter declares it supports
//      (the `ADAPTER_CAPABILITIES` matrix in `src/adapters/index.ts`).
//   2. Enumerate the capabilities the upstream platform exposes natively,
//      sourced from `docs/adapter-capability-matrix.md` (the human-maintained
//      reference matrix; falls back to a per-adapter default seed when the
//      doc is missing — silent-failure contract surfaces warnings rather than
//      swallowing the read error).
//   3. Diff the two sets and produce a `UtilizationReport` + Finding[] block
//      conforming to `agents/shared/rigor-contract.md` Required
//      Finding Output Schema (impact_horizon, progress_toward_pillar,
//      confidence + basis, sources, causal chain).
//
// Pillars served:
//   - P3 Adapter Currency — utilization gap is the per-cycle metric that
//     pairs with platform-doc currency.
//   - CQ9 Enhancability — every unutilized native capability becomes a
//     potential enhancement surface for next-cycle CL-2 candidates.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ADAPTER_CAPABILITIES } from "./index.js";
import { HatchError, type Tool } from "../types.js";

/**
 * The set of audited adapters. Aligned with `Tool` in `src/types.ts` and
 * with the 3-adapter cut (1.9.0).
 */
export type AuditedAdapter = "claude" | "cursor" | "copilot";

/**
 * Native platform capability granularity. Per-capability status:
 *   - `supported`: platform exposes this primitive natively (vendor docs cite).
 *   - `partial`:    platform exposes a related-but-incomplete primitive (e.g.
 *                   Cursor's `readonly` is a coarser allowlist than Claude's
 *                   `tools:` field).
 *   - `unsupported`: platform does not expose this primitive at all.
 */
export type PlatformCapabilityStatus = "supported" | "partial" | "unsupported";

/**
 * A native platform capability — name + status + freeform per-platform
 * detail used by the rigor-contract source line.
 */
export interface PlatformCapability {
  /** Capability identifier (stable, kebab-case). */
  id: string;
  /** Short human-readable name for finding bodies + report rows. */
  name: string;
  /** Native support status on this platform. */
  status: PlatformCapabilityStatus;
  /** One-line per-platform detail / clarification. Optional. */
  detail?: string;
}

/**
 * Adapter-declared capability set — the projection of `ADAPTER_CAPABILITIES`
 * (in `src/adapters/index.ts`) for a single adapter. Keys mirror the boolean
 * matrix columns and are the source of truth for "what hatch3r claims it
 * emits". `enumerateAdapterCapabilities` reads from the live matrix; it
 * never mutates.
 */
export interface AdapterCapabilities {
  /** Adapter id (`claude` | `cursor` | `copilot`). */
  adapter: AuditedAdapter;
  /**
   * Flag-keyed capability map. `true` = adapter declares this capability
   * exercised in its `doGenerate()` output. Names mirror the
   * `ADAPTER_CAPABILITIES` row layout 1:1 — no remapping — so drift between
   * this module and the live matrix surfaces in the existing
   * `capability-matrix.test.ts` invariant test.
   */
  declared: Record<string, boolean>;
}

/**
 * Platform native capabilities — the per-adapter list of primitives the
 * upstream platform exposes, sourced from `docs/adapter-capability-matrix.md`.
 * The doc may extend over time; this module reads the table opportunistically
 * and falls back to a built-in seed when the file is missing or unparseable.
 */
export interface PlatformCapabilities {
  /** Adapter id this capability set describes. */
  adapter: AuditedAdapter;
  /** Ordered list of native capabilities — order tracks the doc row order. */
  capabilities: PlatformCapability[];
  /**
   * Source provenance flag for downstream diagnostics:
   *   - `"doc"`     — read from `docs/adapter-capability-matrix.md`.
   *   - `"default"` — fell back to the built-in seed (doc missing/unparseable).
   */
  source: "doc" | "default";
  /** Warnings emitted during the read attempt (silent-failure contract). */
  warnings: string[];
}

/**
 * Utilization classification for one (platform-capability, adapter) pair.
 *   - `utilized`           — adapter has a matching `declared: true` flag AND
 *                            the platform marks it `supported`.
 *   - `partially-utilized` — platform marks `partial` while adapter claims
 *                            support, OR platform `supported` while adapter
 *                            declares an adjacent partial cover.
 *   - `unutilized`         — platform `supported`/`partial` but adapter
 *                            declares no coverage. THIS is the audit signal —
 *                            an enhancement-surface candidate.
 *   - `n/a`                — platform `unsupported`; the capability is
 *                            unavailable for this adapter at all.
 */
export type UtilizationStatus =
  | "utilized"
  | "partially-utilized"
  | "unutilized"
  | "n/a";

/** Per-capability utilization row inside a UtilizationReport. */
export interface UtilizationRow {
  /** Platform capability id (stable kebab-case). */
  capabilityId: string;
  /** Short name (mirrors PlatformCapability.name). */
  capabilityName: string;
  /** Platform native status (from PlatformCapability.status). */
  platformStatus: PlatformCapabilityStatus;
  /**
   * Adapter declared-support hint: name of the `AdapterCapabilities.declared`
   * key the diff used to compute this row's `utilization`, or `null` if no
   * declared flag corresponds (capability tracked only on the platform side).
   */
  declaredKey: string | null;
  /** True iff the corresponding declared flag is true. */
  declaredSupport: boolean;
  /** Computed utilization classification. */
  utilization: UtilizationStatus;
}

/**
 * Report from `computeUtilization` — per-capability classification plus a
 * scalar ratio for at-a-glance progress tracking. Stable shape; downstream
 * consumers (audit synthesis, governance health probes) can rely on the
 * field set across cycles.
 */
export interface UtilizationReport {
  adapter: AuditedAdapter;
  /** One row per platform capability (preserves PlatformCapabilities order). */
  rows: UtilizationRow[];
  /**
   * Scalar 0–1: covered ÷ total where:
   *   covered = count(utilization == "utilized")
   *           + 0.5 * count(utilization == "partially-utilized")
   *   total   = count(rows where platformStatus != "unsupported")
   * `total == 0` yields ratio `1` (vacuously fully utilized, no platform
   * surface to cover).
   */
  utilization_ratio: number;
}

/**
 * Audit finding shape, conformant to the Required Finding Output Schema
 * declared in `agents/shared/rigor-contract.md`. Severity scales
 * with the platform capability's value: high-leverage primitives (hooks,
 * tool allowlists) surface at Medium when unutilized; lower-leverage ones
 * surface at Info.
 */
export type FindingSeverity = "Info" | "Medium";

export interface FindingSource {
  url: string;
  /** ISO YYYY-MM-DD access date. */
  accessed: string;
  /** Author / organisation. */
  author: string;
  trust_tier:
    | "official-docs"
    | "peer-reviewed"
    | "vendor-note"
    | "independent-analysis"
    | "blog-post";
}

export interface Finding {
  /** Stable finding id, e.g. `D9-CAPUTIL-claude-hooks-pretooluse`. */
  id: string;
  /** `Info` | `Medium`. */
  severity: FindingSeverity;
  /** Audited adapter. */
  adapter: AuditedAdapter;
  /** Platform capability id this finding is about. */
  capabilityId: string;
  /** Required-schema fields. */
  confidence: "high" | "medium" | "low";
  confidence_basis: string;
  falsifiability: string;
  causal_chain: string;
  bias_check: string;
  counter_argument: string;
  sources: FindingSource[];
  impact_horizon: "short" | "medium" | "long";
  progress_toward_pillar: string;
  /** Finding body — recommendation + file reference. */
  body: string;
}

// ─── Adapter declared-capability extraction ────────────────────────────────

/**
 * Read the declared capability row for an audited adapter directly from
 * the live `ADAPTER_CAPABILITIES` matrix. Pure projection — no mutation,
 * no platform-doc I/O.
 *
 * @param adapter The audited adapter id.
 * @returns Frozen-style AdapterCapabilities row (caller may not mutate the
 *   returned object's `declared` map without copying — it shares structure
 *   with the matrix to keep the source-of-truth promise auditable).
 * @throws Error if `adapter` is not in `ADAPTER_CAPABILITIES`.
 */
export function enumerateAdapterCapabilities(
  adapter: AuditedAdapter,
): AdapterCapabilities {
  const row = ADAPTER_CAPABILITIES[adapter as Tool];
  if (!row) {
    throw new HatchError(
      `enumerateAdapterCapabilities: unknown adapter "${adapter}". ` +
        `Expected one of: claude, cursor, copilot.`,
      undefined,
      "VALIDATION_ERROR",
    );
  }
  // Convert the typed matrix row to a flag-keyed record so the diff
  // routine can iterate generically without type-narrowing each field.
  const declared: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(row)) {
    declared[key] = Boolean(value);
  }
  return { adapter, declared };
}

// ─── Platform-doc read + default seed ──────────────────────────────────────

/**
 * Built-in seed: per-adapter native capability list rendered when the
 * reference doc is missing or unparseable.
 *
 * Source notes (web-research, access/re-verify date 2026-06-06 per
 * `docs/adapter-capability-matrix.md` header):
 *   - Claude Code: hooks (~30-event catalogue: PreToolUse/PostToolUse/
 *     PostToolUseFailure/SessionStart/SubagentStart/SubagentStop/Stop/
 *     StopFailure/TaskCreated/InstructionsLoaded/…; see mapToClaudeEvent in
 *     claude.ts), settings.json (permissions, teammateMode, env, hooks), MCP
 *     servers (.mcp.json), slash commands (.claude/commands/), sub-agents
 *     (.claude/agents/), skills (.claude/skills/), CLAUDE.md project
 *     instructions, AskUserQuestion native question tool.
 *   - Cursor: rules (.cursor/rules/*.mdc), MCP (.cursor/mcp.json), commands
 *     (.cursor/commands/), modes / subagents (.cursor/agents/*.md with
 *     readonly + background + model), plugin system (Team Marketplaces v2.6),
 *     indexing (codebase-aware, not adapter-emitted), environment.json,
 *     Cursor 3.0 /worktree and /best-of-n workflows, .cursor/hooks.json
 *     (preToolUse + subagentStart — both adapter-emitted, see cursor.ts).
 *   - Copilot: instructions (.github/copilot-instructions.md), prompts
 *     (.github/prompts/), agent definitions (.github/agents/*.agent.md),
 *     chat participants (community-extensible), MCP via .vscode/mcp.json,
 *     VS Code Preview PreToolUse hook + agent handoffs (GA) — neither
 *     adapter-emitted yet (CL-2 candidates per D9-17/D9-18).
 */
const PLATFORM_CAPABILITY_SEED: Record<AuditedAdapter, PlatformCapability[]> = {
  claude: [
    { id: "hooks", name: "Hooks (PreToolUse/PostToolUse/Session/Worktree)", status: "supported", detail: "~30-event catalogue incl. PreToolUse/PostToolUse/PostToolUseFailure/SessionStart/SubagentStart/SubagentStop/Stop/StopFailure/TaskCreated/InstructionsLoaded (re-verified 2026-06-06; see mapToClaudeEvent in claude.ts)" },
    { id: "settings-json", name: "settings.json (permissions, teammateMode, env)", status: "supported" },
    { id: "mcp-servers", name: "MCP servers (.mcp.json)", status: "supported", detail: "stdio + http transports" },
    { id: "slash-commands", name: "Slash commands (.claude/commands/)", status: "supported" },
    { id: "sub-agents", name: "Sub-agents (.claude/agents/)", status: "supported", detail: "tools: allowlist supported" },
    { id: "skills", name: "Skills (.claude/skills/)", status: "supported", detail: "SKILL.md format" },
    { id: "claude-md", name: "CLAUDE.md project instructions", status: "supported" },
    { id: "native-question-tool", name: "AskUserQuestion native tool", status: "supported" },
    { id: "agent-teams", name: "Agent Teams (parallel teammates)", status: "supported", detail: "v2.1.32+ experimental; CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 required (verified 2026-05-28)" },
    { id: "worktree-isolation", name: "Worktree isolation (--worktree)", status: "supported" },
  ],
  cursor: [
    { id: "rules", name: "Rules (.cursor/rules/*.mdc)", status: "supported", detail: "alwaysApply + globs frontmatter" },
    { id: "mcp-json", name: "MCP (.cursor/mcp.json)", status: "supported" },
    { id: "slash-commands", name: "Slash commands (.cursor/commands/)", status: "supported" },
    { id: "sub-agents", name: "Sub-agents (.cursor/agents/)", status: "supported", detail: "readonly + background + model" },
    { id: "skills", name: "Skills (.cursor/skills/)", status: "supported", detail: "SKILL.md format" },
    { id: "plugin-system", name: "Plugins / Team Marketplaces (v2.6)", status: "partial", detail: "no per-repo manifest emitted" },
    { id: "indexing", name: "Codebase indexing", status: "unsupported", detail: "platform-managed, no adapter surface" },
    { id: "environment-json", name: "environment.json (run context)", status: "supported" },
    { id: "pre-tool-use", name: "preToolUse hook (.cursor/hooks.json)", status: "supported", detail: "tool_name/tool_input payload, no agent-identity field (cursor.com/docs/agent/hooks, verified 2026-06-06)" },
    { id: "subagent-start", name: "subagentStart hook (.cursor/hooks.json)", status: "supported", detail: "subagent_type/subagent_id payload; returns {permission:'deny'} — hatch3r emits subagent-guard.mjs (verified 2026-06-06)" },
    { id: "native-question-tool", name: "Native AskUserQuestion equivalent", status: "unsupported", detail: "pending official tool" },
    { id: "worktree-workflows", name: "/worktree + /best-of-n (v3.0)", status: "partial", detail: "documented in bridge body, not native config" },
  ],
  copilot: [
    { id: "copilot-instructions", name: ".github/copilot-instructions.md", status: "supported" },
    // D9-H-5 (D9, P4): the platform natively supports a `.github/prompts/`
    // file picker, so the seed status stays `supported`. hatch3r retracted the
    // *adapter* claim (`ADAPTER_CAPABILITIES.copilot.prompts = false`) because
    // it ships no canonical `prompts/` content — `computeUtilization` therefore
    // classifies this row `unutilized`, surfacing it as the correct
    // enhancement-surface finding (author canonical prompts to utilize it)
    // rather than the prior dead-code branch.
    { id: "prompts", name: "Prompts (.github/prompts/)", status: "supported" },
    { id: "agent-definitions", name: "Agent definitions (.github/agents/)", status: "supported", detail: "tools: allowlist via Copilot frontmatter" },
    { id: "instructions-scoped", name: "Scoped instructions (.github/instructions/)", status: "supported", detail: "applyTo glob frontmatter" },
    { id: "mcp-vscode", name: "MCP (.vscode/mcp.json)", status: "supported" },
    { id: "chat-participants", name: "Chat participants (community extensions)", status: "unsupported", detail: "VS Code extension surface; no adapter file" },
    { id: "skills", name: "Skills (.github/skills/)", status: "supported", detail: "SKILL.md format" },
    // D9-17 / D9-20 (Cycle 11 D9, P3): VS Code documents a Preview PreToolUse
    // hook with permissionDecision:"deny" + an agent-scoped `hooks:` field, so
    // the prior absolute "no hook surface" is now false on VS Code. Status is
    // `partial` (Preview, VS-Code-only — not GA, not on github.com) and
    // hatch3r emits no copilot PreToolUse hook yet (ADAPTER_CAPABILITIES
    // copilot.hooks = false), so computeUtilization classifies this row
    // `unutilized` — the enhancement-surface signal CL-2 should action.
    { id: "hooks", name: "PreToolUse hook (VS Code, Preview)", status: "partial", detail: "permissionDecision:'deny' + agent-scoped hooks: field; VS Code Preview only, not github.com (verified 2026-06-06, #73)" },
    { id: "native-question-tool", name: "Native AskUserQuestion equivalent", status: "unsupported" },
    { id: "github-agents", name: "GitHub-side agents (.github/agents/*.agent.md)", status: "supported" },
    // D9-18 (Cycle 11 D9, P3/CQ9): VS Code documents agent handoffs (GA) —
    // declarative routing between agents. hatch3r emits no native handoffs:
    // block yet, so this row classifies `unutilized`; CL-2 candidate to link
    // the Phase 1→2→3 pipeline via native handoffs.
    { id: "handoffs", name: "Agent handoffs (VS Code)", status: "supported", detail: "declarative agent-to-agent routing, GA; no adapter emission yet (verified 2026-06-06)" },
    { id: "workflow-setup-steps", name: "copilot-setup-steps workflow", status: "supported", detail: "build/install steps for hosted agents" },
  ],
};

/**
 * Mapping from `PlatformCapability.id` to the `AdapterCapabilities.declared`
 * key that should track its coverage. `null` means the platform-side
 * capability has no corresponding declared flag in the matrix — the row will
 * surface as "unutilized" but the audit treats it as an Info-level
 * enhancement candidate, not a Medium drift.
 */
const PLATFORM_TO_DECLARED_KEY: Record<AuditedAdapter, Record<string, string | null>> = {
  claude: {
    hooks: "hooks",
    "settings-json": "hooks", // settings.json emission is gated on the hooks feature flag in practice
    "mcp-servers": "mcp",
    "slash-commands": "commands",
    "sub-agents": "agents",
    skills: "skills",
    "claude-md": "agents",
    "native-question-tool": "nativeQuestionTool",
    "agent-teams": null, // no declared boolean — opt-in via manifest.claude.agentTeams
    "worktree-isolation": "worktree",
  },
  cursor: {
    rules: "rules",
    "mcp-json": "mcp",
    "slash-commands": "commands",
    "sub-agents": "agents",
    skills: "skills",
    "plugin-system": null,
    indexing: null,
    "environment-json": null,
    "pre-tool-use": "hooks",
    "subagent-start": "hooks",
    "native-question-tool": "nativeQuestionTool",
    "worktree-workflows": "worktree",
  },
  copilot: {
    "copilot-instructions": "rules",
    prompts: "prompts",
    "agent-definitions": "agents",
    "instructions-scoped": "rules",
    "mcp-vscode": "mcp",
    "chat-participants": null,
    skills: "skills",
    hooks: "hooks",
    "native-question-tool": "nativeQuestionTool",
    "github-agents": "githubAgents",
    handoffs: null, // no declared boolean — VS Code handoffs (GA) not yet adapter-emitted (D9-18); CL-2 candidate
    "workflow-setup-steps": null,
  },
};

/**
 * Resolve the on-disk path to the human-maintained capability-matrix doc.
 * Honours the `HATCH3R_CAPABILITY_MATRIX_DOC` env var (test override);
 * otherwise probes `docs/adapter-capability-matrix.md` relative to the
 * provided `repoRoot` (defaults to `process.cwd()`).
 */
function resolveDocPath(repoRoot?: string): string {
  if (process.env.HATCH3R_CAPABILITY_MATRIX_DOC) {
    return process.env.HATCH3R_CAPABILITY_MATRIX_DOC;
  }
  return join(repoRoot ?? process.cwd(), "docs", "adapter-capability-matrix.md");
}

/**
 * Probe the reference doc to inform the per-adapter platform-capability
 * list. The doc is human-curated — this function does NOT attempt to parse
 * the full markdown table set; it merely confirms the doc exists and reads
 * a header sentinel so a stale or empty doc surfaces as a warning. The
 * authoritative per-adapter capability list returned to callers is the
 * built-in seed `PLATFORM_CAPABILITY_SEED`, which the doc tracks via its
 * "Last verified" line.
 *
 * Silent-failure contract: ENOENT / parse failure pushes a warning string
 * onto the returned `warnings[]` array; the caller (audit synthesis) routes
 * the warnings to the global diagnostic channel. This module does NOT
 * silently fall through to `console.log` — see CONSTITUTION.md §2 P5.
 */
export async function enumeratePlatformCapabilities(
  adapter: AuditedAdapter,
  repoRoot?: string,
): Promise<PlatformCapabilities> {
  const warnings: string[] = [];
  let source: "doc" | "default" = "default";

  const docPath = resolveDocPath(repoRoot);
  let doc: string | null = null;
  try {
    doc = await readFile(docPath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      warnings.push(
        `[capabilityMatrix] reference doc not found at ${docPath} — ` +
          `falling back to built-in seed (CQ9, P3). Maintain the doc to keep ` +
          `the platform-capability list per-adapter under cycle review.`,
      );
    } else {
      warnings.push(
        `[capabilityMatrix] failed to read reference doc at ${docPath}: ` +
          `${err instanceof Error ? err.message : String(err)} — falling back to built-in seed.`,
      );
    }
  }

  if (doc !== null) {
    // Light-touch parse: confirm the doc opens with the matrix header and
    // contains a per-adapter section marker. If both checks pass, treat the
    // doc as the canonical reference and adopt the seed (which the doc
    // tracks). If either check fails, surface a warning AND still adopt
    // the seed — keeping the audit signal alive even when the doc has
    // drifted off-schema.
    const hasHeader = /^# Adapter Capability Matrix/m.test(doc);
    const adapterMarker = new RegExp(`\\*\\*${adapter}\\*\\*`, "i");
    const hasAdapterMarker = adapterMarker.test(doc);
    if (!hasHeader || !hasAdapterMarker) {
      warnings.push(
        `[capabilityMatrix] reference doc at ${docPath} did not match expected ` +
          `schema (header present: ${hasHeader}, adapter marker present: ${hasAdapterMarker}) — ` +
          `using built-in seed for ${adapter}.`,
      );
    } else {
      source = "doc";
    }
  }

  return {
    adapter,
    capabilities: PLATFORM_CAPABILITY_SEED[adapter],
    source,
    warnings,
  };
}

// ─── Diff: declared × platform ⇒ UtilizationReport ─────────────────────────

/**
 * Compute the per-row utilization classification + the scalar utilization
 * ratio. The ratio rewards full coverage at 1.0 and partial coverage at 0.5
 * per row, normalised over the count of supportable rows (i.e. rows where
 * `platformStatus !== "unsupported"`).
 *
 * Drift between this module's diff and the live `ADAPTER_CAPABILITIES`
 * matrix surfaces in `capability-matrix.test.ts` — that test compares the
 * matrix row against observed `doGenerate()` output. This module trusts the
 * matrix as source-of-truth; do not duplicate the drift check here.
 */
export function computeUtilization(
  adapter: AuditedAdapter,
  declared: AdapterCapabilities,
  platform: PlatformCapabilities,
): UtilizationReport {
  if (declared.adapter !== adapter || platform.adapter !== adapter) {
    throw new HatchError(
      `computeUtilization: adapter mismatch — expected "${adapter}", got ` +
        `declared="${declared.adapter}", platform="${platform.adapter}".`,
      undefined,
      "VALIDATION_ERROR",
    );
  }

  const keyMap = PLATFORM_TO_DECLARED_KEY[adapter];
  const rows: UtilizationRow[] = [];

  for (const cap of platform.capabilities) {
    const declaredKey = keyMap[cap.id] ?? null;
    const declaredSupport = declaredKey ? Boolean(declared.declared[declaredKey]) : false;

    let utilization: UtilizationStatus;
    if (cap.status === "unsupported") {
      utilization = "n/a";
    } else if (cap.status === "partial") {
      utilization = declaredSupport ? "partially-utilized" : "unutilized";
    } else if (declaredSupport) {
      utilization = "utilized";
    } else {
      utilization = "unutilized";
    }

    rows.push({
      capabilityId: cap.id,
      capabilityName: cap.name,
      platformStatus: cap.status,
      declaredKey,
      declaredSupport,
      utilization,
    });
  }

  // Scalar ratio: full = 1.0, partial = 0.5; normalise over supportable rows.
  // Unsupported rows are not penalty surface — they yield `n/a` and are
  // excluded from the denominator.
  let covered = 0;
  let total = 0;
  for (const row of rows) {
    if (row.platformStatus === "unsupported") continue;
    total += 1;
    if (row.utilization === "utilized") covered += 1;
    else if (row.utilization === "partially-utilized") covered += 0.5;
  }
  const utilization_ratio = total === 0 ? 1 : covered / total;

  return { adapter, rows, utilization_ratio };
}

// ─── Surface findings ──────────────────────────────────────────────────────

/**
 * Map a platform capability id to its audit-finding severity. High-leverage
 * primitives (hooks, tool-allowlists, MCP, sub-agents) surface at Medium
 * when unutilized — the platform exposes a primitive the adapter could be
 * exercising for measurable user value. Lower-leverage primitives (workflow
 * setup scripts, marketplace plugin manifests) surface at Info.
 */
const HIGH_LEVERAGE_CAPABILITIES = new Set<string>([
  "hooks",
  "settings-json",
  "mcp-servers",
  "mcp-json",
  "mcp-vscode",
  "sub-agents",
  "agent-definitions",
  "native-question-tool",
  "slash-commands",
  "skills",
  "agent-teams",
  "worktree-isolation",
  "worktree-workflows",
]);

function severityFor(capabilityId: string): FindingSeverity {
  return HIGH_LEVERAGE_CAPABILITIES.has(capabilityId) ? "Medium" : "Info";
}

/**
 * Build a finding source line for the per-adapter platform docs. Trust tier
 * `official-docs` because the targets are vendor primary documentation.
 * Access dates track `docs/adapter-capability-matrix.md` last-verified line;
 * keep this map in sync when re-verifying.
 */
function sourcesFor(adapter: AuditedAdapter): FindingSource[] {
  const ACCESS_DATE = "2026-06-06"; // docs/adapter-capability-matrix.md last-verified
  switch (adapter) {
    case "claude":
      return [
        {
          url: "https://code.claude.com/docs/en/plugins-reference",
          accessed: ACCESS_DATE,
          author: "Anthropic",
          trust_tier: "official-docs",
        },
        {
          url: "https://docs.anthropic.com/en/docs/claude-code",
          accessed: ACCESS_DATE,
          author: "Anthropic",
          trust_tier: "official-docs",
        },
      ];
    case "cursor":
      return [
        {
          url: "https://cursor.com/docs/agents",
          accessed: ACCESS_DATE,
          author: "Cursor",
          trust_tier: "official-docs",
        },
        {
          url: "https://docs.cursor.com/context/rules-for-ai",
          accessed: ACCESS_DATE,
          author: "Cursor",
          trust_tier: "official-docs",
        },
      ];
    case "copilot":
      return [
        {
          url: "https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot",
          accessed: ACCESS_DATE,
          author: "GitHub",
          trust_tier: "official-docs",
        },
        {
          url: "https://docs.github.com/copilot/how-tos/use-copilot-agents/coding-agent/create-skills",
          accessed: ACCESS_DATE,
          author: "GitHub",
          trust_tier: "official-docs",
        },
        {
          // D9-17 / D9-18 (Cycle 11 D9, P3): VS Code agent-customization surface
          // — documents the Preview PreToolUse hook (permissionDecision:"deny" +
          // agent-scoped hooks:) and agent handoffs the copilot seed now cites.
          url: "https://code.visualstudio.com/docs/copilot/customization/custom-agents",
          accessed: ACCESS_DATE,
          author: "Microsoft",
          trust_tier: "official-docs",
        },
      ];
  }
}

/**
 * Surface findings for unutilized / partially-utilized rows in a
 * UtilizationReport. Conforms to the Required Finding Output Schema in
 * `agents/shared/rigor-contract.md`. Caller routes these to
 * `.audit-workspace/D9-SA9.{N}.findings.md` per the D09 SA checklist
 * (governance/audit/domains/D09-platform-adapters.md SA 9.1–9.3).
 *
 * Rows with `utilization == "utilized"` or `"n/a"` do not yield findings —
 * those are the success rows. Only `unutilized` and `partially-utilized`
 * become enhancement-surface candidates.
 */
export function surfaceFindings(report: UtilizationReport): Finding[] {
  const findings: Finding[] = [];
  const sources = sourcesFor(report.adapter);

  for (const row of report.rows) {
    if (row.utilization === "utilized" || row.utilization === "n/a") continue;

    const severity = severityFor(row.capabilityId);
    const isPartial = row.utilization === "partially-utilized";
    const verb = isPartial ? "partially-covered" : "uncovered";
    const id = `D9-CAPUTIL-${report.adapter}-${row.capabilityId}`;

    const body =
      `The ${report.adapter} platform exposes "${row.capabilityName}" natively ` +
      `(status: ${row.platformStatus}), but the hatch3r adapter is ${verb} on this ` +
      `capability. ` +
      (row.declaredKey
        ? `The ADAPTER_CAPABILITIES declared flag "${row.declaredKey}" is ${row.declaredSupport} ` +
          `for this adapter; raising it to a covered row likely requires changes in ` +
          `src/adapters/${report.adapter}.ts.\n\n`
        : `No declared capability flag tracks this primitive yet — consider adding a column ` +
          `to ADAPTER_CAPABILITIES (src/adapters/index.ts) before authoring coverage.\n\n`) +
      `Recommendation: web-research the current platform docs (see sources), confirm the ` +
      `primitive is still exposed in the current release, then either author coverage in the ` +
      `adapter's doGenerate or downgrade the capability's platformStatus in ` +
      `docs/adapter-capability-matrix.md with a dated rationale.`;

    const causal_chain =
      `platform exposes "${row.capabilityName}" → hatch3r adapter does not exercise it → ` +
      `users miss a documented native primitive (enhancement-surface candidate)`;

    findings.push({
      id,
      severity,
      adapter: report.adapter,
      capabilityId: row.capabilityId,
      confidence: row.platformStatus === "supported" ? "high" : "medium",
      confidence_basis:
        row.platformStatus === "supported"
          ? "direct measurement (vendor docs + ADAPTER_CAPABILITIES projection)"
          : "inference from analogue (platform-partial primitive — verify scope with vendor docs before authoring coverage)",
      falsifiability:
        `Run \`grep -rn "${row.capabilityId}" src/adapters/${report.adapter}.ts\` — if the ` +
        `adapter emits or references this primitive, the finding is false.`,
      causal_chain,
      bias_check:
        "Availability bias considered (newer platform primitives may be over-represented in seed). " +
        "Mitigated by per-cycle web-research against vendor docs (D9 SA checklist item 3).",
      counter_argument:
        "A maintainer may have explicitly decided not to cover this primitive (e.g. trust-model " +
        "carve-out, scope reduction). Resolution: cross-check Intentional Omissions in " +
        "docs/adapter-capability-matrix.md before promoting this finding to a CL-2 candidate.",
      sources,
      impact_horizon: severity === "Medium" ? "medium" : "long",
      progress_toward_pillar:
        severity === "Medium"
          ? "governance.P3+0.10"
          : "content-quality.CQ9+0.05",
      body,
    });
  }

  return findings;
}
