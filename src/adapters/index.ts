import { HatchError, WORKTREE_CAPABLE_TOOLS, type HatchManifest, type Tool } from "../types.js";
import type { Adapter } from "./base.js";
import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";
import { CopilotAdapter } from "./copilot.js";
import { CursorAdapter } from "./cursor.js";

// Adapter factory map — instantiates adapters lazily on each `getAdapter`
// call. #117 originally introduced lazy allocation; C9-M12 (D2 Medium, Cycle
// 10 Wave 3 rollover) removed the module-level instance cache because adapter
// instances carry per-invocation mutable state (`this.warnings`,
// `this._trackedSourceFiles`, `this._cachedOutputPaths`). Two concurrent
// `generate()` calls against the same cached instance interleave warnings
// across runs and corrupt provenance tracking. Adapter construction is
// trivial (a single `new` of a class with no I/O), so dropping the cache
// has no measurable cost and makes per-call state safe by default. See
// `BaseAdapter.warnings` JSDoc for the per-invocation contract.
const adapterFactories: Record<Tool, () => Adapter> = {
  cursor: () => new CursorAdapter(),
  copilot: () => new CopilotAdapter(),
  claude: () => new ClaudeAdapter(),
  codex: () => new CodexAdapter(),
};

/**
 * Construct a fresh adapter instance for the given tool. Throws when the tool
 * name is not in the factory map.
 *
 * C9-M12: returns a NEW instance on every call (no module-level cache) so
 * that per-invocation mutable state on `BaseAdapter` (warnings, source-file
 * provenance tracker, output-path cache) is isolated between callers. Callers
 * that need to retain an adapter reference across multiple `generate()` calls
 * may do so locally; they MUST NOT share the reference across concurrent
 * `generate()` invocations.
 */
export function getAdapter(tool: Tool): Adapter {
  const factory = adapterFactories[tool];
  if (!factory) {
    const supported = Object.keys(adapterFactories).sort().join(", ");
    // D2-SA2.5-01 (Cycle 12 Wave 3, D2, P1): pass `undefined` (not a literal
    // `1`) as the exitCode so `HatchError` derives it from
    // `ERROR_CODE_TO_EXIT_CODE["VALIDATION_ERROR"]` (= 64, the sysexits
    // EX_USAGE the docs/troubleshooting.md Exit Codes contract promises). A
    // literal `1` overrode the single-source-of-truth mapping and contradicted
    // that contract ("no exit 1 for command failures"); `undefined` keeps this
    // call site aligned with the documented `--tools` path (init.ts) that
    // already resolves to 64.
    throw new HatchError(
      `Unknown tool: ${tool}`,
      undefined,
      "VALIDATION_ERROR",
      `Supported tools: ${supported}. Re-run with one of these via \`--tools\`.`,
    );
  }
  return factory();
}

// #258 (D9-9.29): Extended AdapterCapability to include worktree, customization, and modelOverride
// columns that were tracked in the external audit matrix but missing from the type.
// D2-SA2.5-07 (Cycle 12 Wave 4): `export`ed so the future `hatch3r add`
// validator can bind a pack manifest's `required_capabilities` to this key set
// at runtime via `ADAPTER_CAPABILITY_KEYS` (declared below the matrix).
// D2-SA2.5-02 (Cycle 12 Wave 4): added the `handoffs` column.
export interface AdapterCapability {
  agents: boolean;
  skills: boolean;
  rules: boolean;
  hooks: boolean;
  mcp: boolean;
  commands: boolean;
  prompts: boolean;
  githubAgents: boolean;
  /**
   * Whether the adapter's bridge output honours the manifest `Features.handoffs`
   * flag — emits the `.hatch3r/handoffs/` segment in the bridge Canonical
   * Structure line when the flag is on and drops it when off (D1-30). `true` for
   * all 3 adapters: `BaseAdapter.bridgeOrchestration` threads
   * `ctx.features.handoffs` into `generateBridgeOrchestration` unconditionally,
   * so the column is digest-diff observable and pinned by the
   * `capabilityMatrixDrift` feature-flag loop (D2-SA2.5-02).
   */
  handoffs: boolean;
  /** Whether the adapter supports git worktree file-isolation. */
  worktree: boolean;
  /** Whether the adapter supports per-item customization (.customize.md). */
  customization: boolean;
  /** Whether the adapter supports model override configuration. */
  modelOverride: boolean;
  /**
   * Whether the adapter expresses per-agent reasoning effort natively
   * (release/2.7.0 effort axis): claude — `effort:` frontmatter key; cursor —
   * bracket suffix on the emitted model pin, clamped to the documented
   * bracket value (`[effort=high]`, cursor.com/docs/subagents.md accessed
   * 2026-07-14); copilot — no surface (the custom-agents frontmatter
   * reference documents no effort key), so `false`. Pinned to each adapter's
   * doGenerate invoking `resolveAgentEffort` by the capabilityMatrixDrift
   * code-probe, mirroring the `modelOverride` column's probe.
   */
  effortOverride: boolean;
  /**
   * Whether the adapter exposes a documented native user-question / triage
   * tool. When true, the adapter MUST have a non-null entry in
   * `ASK_USER_TOOLS` in `src/pipeline/adapterToolTranslator.ts`; when false
   * the entry MUST be `null` (deny-by-default). Enforced by the capability
   * matrix consistency test.
   */
  nativeQuestionTool: boolean;
  /**
   * Whether the adapter participates in the CLI-tooling pivot — i.e. emits
   * the per-tool `hatch3r-cli-*` skills filtered by `manifest.cliTools.selected`.
   * `true` for the 3 supported adapters (claude, cursor, copilot), all of
   * which expose a native `skills: true` output surface.
   */
  cliTools: boolean;
}

// Adapter capability matrix — last updated for hatch3r 2.0.0 (Decision 12 — 3-adapter scope).
// Review this matrix when adding new adapters, removing adapters, or when
// an existing tool gains/loses support for a feature (e.g. a tool ships
// native hook support). Each row must match the adapter's doGenerate() output.
//
// D2-16 (Cycle 11 Wave 3, D2, P2): the `worktree` column is DERIVED from the
// single load-bearing source `WORKTREE_CAPABLE_TOOLS` (src/types.ts), the Set
// that init/config/update/manifest actually read to decide whether to enable
// worktree isolation for a tool. Before this wave `worktree` was a hand-typed
// `true` literal that no runtime path consumed, so flipping it changed no
// behaviour and failed no test — a column that could silently lie. Deriving it
// here collapses the two parallel sources into one: changing membership in
// WORKTREE_CAPABLE_TOOLS now flips the matrix column in lockstep, and the
// `capabilityMatrixDrift` test pins it to that source. The `customization` and
// `modelOverride` columns are likewise unread by runtime selection — they are
// facts about every adapter's `doGenerate` calling `applyCustomization` /
// `resolveAgentModel` (agent loop) unconditionally, so they are `true` for all
// 3 adapters and pinned to that behavioural source by the same drift test.
// release/2.7.0: `effortOverride` joins them on the same probe pattern —
// `true` exactly where doGenerate invokes `resolveAgentEffort` (claude's
// `effort:` frontmatter key, cursor's clamped bracket suffix on the model
// pin); copilot has no native effort surface, so its source must NOT invoke
// the resolver and its column is `false`.
// release/2.2.0 note: `modelOverride` is pinned to the AGENT-loop
// `resolveAgentModel` call only. Skill/command model emission is a separate
// per-adapter opt-in — the `emitModel` predicate passed to
// `processSkillsWithFmCliFiltered` / `processCommandsWithFm` in base.ts
// (claude: skills + commands; copilot: commands→prompts only; cursor: none) —
// and does not feed this boolean.
//
// D11-SA11.1-03 (Cycle 12 Wave 4): the boolean columns below are NOT the
// complete emitted surface. The `checks` artifact class (`type: check`, counted
// as its own class in governance/inventory.json) has no column here — its
// emission is DERIVED from `agents || commands` in every adapter's doGenerate
// (`["checks", ctx.features.agents || ctx.features.commands, …]` in cursor.ts /
// claude.ts / copilot.ts), not a standalone `features.checks` flag. A new
// adapter author must reproduce that derived gate; do not assume these columns
// enumerate every emitted artifact class.
export const ADAPTER_CAPABILITIES: Record<Tool, AdapterCapability> = {
  cursor:   { agents: true, skills: true, rules: true, hooks: true,  mcp: true,  commands: true,  prompts: false, githubAgents: false, handoffs: true, worktree: WORKTREE_CAPABLE_TOOLS.has("cursor"),  customization: true,  modelOverride: true,  effortOverride: true,  nativeQuestionTool: false, cliTools: true  },
  claude:   { agents: true, skills: true, rules: true, hooks: true,  mcp: true,  commands: true,  prompts: false, githubAgents: false, handoffs: true, worktree: WORKTREE_CAPABLE_TOOLS.has("claude"),  customization: true,  modelOverride: true,  effortOverride: true,  nativeQuestionTool: true,  cliTools: true  },
  // D9-H-5 (Cycle 10 D9, Pillar P4): `prompts: false`. hatch3r ships no
  // canonical `prompts/` content, so the Copilot adapter emits no
  // `.github/prompts/*.prompt.md` from a prompts source — the prior
  // `prompts: true` advertised a capability the adapter never exercised and
  // gated a dead `prompts/` read branch (now removed from copilot.ts).
  // Copilot's commands still route to `.github/prompts/` under the `commands`
  // flag; Copilot's *native* prompts-file picker support is recorded as an
  // unutilized enhancement surface in src/adapters/capabilityMatrix.ts.
  //
  // D9-17 (Cycle 11 Wave 3, D9, P3 currency): `hooks: false` for copilot stays
  // false because it tracks what the adapter EMITS (no hook file) and the
  // stable github.com surface. As of 2026-06-09 the VS Code surface DOES expose
  // an agent-customization PreToolUse hook (Preview) that returns
  // `permissionDecision: "deny"` to block a single tool call, plus an
  // agent-scoped `hooks:` frontmatter field — so the addendum's prior absolute
  // "cannot block server-side" claim is now Preview-qualified, not universal.
  // hatch3r does not yet emit that deny-gate (tracked as a CL-2 content-gap
  // candidate: a Preview-gated PreToolUse deny-gate for the Phase-2/3 code-write
  // tools). Until emission lands the boolean is unchanged; the drift test keeps
  // it pinned to the no-hook-file output. Sources (accessed 2026-06-09):
  // https://code.visualstudio.com/docs/agent-customization/hooks
  // https://code.visualstudio.com/docs/agent-customization/custom-agents
  copilot:  { agents: true, skills: true, rules: true, hooks: false, mcp: true,  commands: true,  prompts: false, githubAgents: true,  handoffs: true, worktree: WORKTREE_CAPABLE_TOOLS.has("copilot"),  customization: true,  modelOverride: true,  effortOverride: false, nativeQuestionTool: false, cliTools: true  },
  // OpenAI's repository skill surface loads `.agents/skills/*/SKILL.md` and
  // requires `name` + `description` frontmatter. This adapter emits only that
  // documented surface; every unrelated capability remains false. Source:
  // https://learn.chatgpt.com/docs/build-skills (accessed 2026-08-09).
  codex:    { agents: false, skills: true, rules: false, hooks: false, mcp: false, commands: false, prompts: false, githubAgents: false, handoffs: false, worktree: WORKTREE_CAPABLE_TOOLS.has("codex"), customization: true, modelOverride: false, effortOverride: false, nativeQuestionTool: false, cliTools: true },
};

// D2-SA2.5-07 (Cycle 12 Wave 4): value-level projection of the AdapterCapability
// key set. pack-trust-model §5.2 designates this key set as the closed enum the
// future `hatch3r add` uses to validate a pack manifest's `required_capabilities`
// — but a TypeScript interface erases at compile time, so no runtime list existed
// to enforce it. Derived (not hand-copied) from a live matrix row via
// `Object.keys` so a column added to `AdapterCapability` + the rows above joins
// the enum automatically, keeping §5.2's "joins the enum automatically" promise
// structurally true. Every row is compile-checked to be `AdapterCapability`, so a
// row's own-enumerable keys are exactly `keyof AdapterCapability`.
export const ADAPTER_CAPABILITY_KEYS = Object.keys(
  ADAPTER_CAPABILITIES.claude,
) as (keyof AdapterCapability)[];

/**
 * Return warnings for features enabled in the manifest but not supported
 * by the given tool's adapter. Used during sync to surface capability gaps.
 *
 * Returns at most one combined warning per adapter listing all unsupported
 * features (e.g. `"cursor: features enabled but not supported by this
 * adapter: prompts, GitHub agents"`). When the adapter supports every
 * enabled feature, returns `[]`. This grouping keeps the console output
 * readable when many adapters and many features are enabled (otherwise the
 * cross-product produces ~24 lines for a full 3-adapter / 8-feature run).
 */
export function getUnsupportedFeatureWarnings(tool: string, manifest: HatchManifest): string[] {
  const caps = ADAPTER_CAPABILITIES[tool as Tool];
  if (!caps) return [];

  const featureLabels: Array<{ key: keyof AdapterCapability; label: string }> = [
    { key: "agents", label: "agents" },
    { key: "skills", label: "skills" },
    { key: "rules", label: "rules" },
    { key: "hooks", label: "hooks" },
    { key: "mcp", label: "MCP" },
    { key: "commands", label: "commands" },
    { key: "prompts", label: "prompts" },
    { key: "githubAgents", label: "GitHub agents" },
    // D2-SA2.5-02 (Cycle 12 Wave 4): handoffs joins the warning surface so the
    // matrix contract holds — every emission-affecting Features key has a column
    // AND a warning row. All 3 adapters set `handoffs: true`, so this row never
    // fires today; it closes the contract rather than changing current output.
    { key: "handoffs", label: "handoffs" },
  ];

  const unsupported: string[] = [];
  for (const { key, label } of featureLabels) {
    if (manifest.features[key as keyof typeof manifest.features] && !caps[key]) {
      unsupported.push(label);
    }
  }

  // CLI-tooling pivot: the `!caps.cliTools` warning branch was removed in
  // 2.0.0 (D2-SA2.5-2.5.2, Cycle 10 Wave 4). All 3 retained adapters
  // (cursor, claude, copilot) set `cliTools: true`, so the negative case
  // was structurally unreachable dead code — `capability-matrix` drift test
  // codifies the invariant (`falseCount === 0`). Restore a
  // `manifest.cliTools` check here if a future adapter ships `cliTools: false`.

  if (unsupported.length === 0) return [];

  const noun = unsupported.length === 1 ? "feature" : "features";
  return [`${tool}: ${noun} enabled but not supported by this adapter: ${unsupported.join(", ")}`];
}

export { ClaudeAdapter } from "./claude.js";
export { CodexAdapter } from "./codex.js";
export { CopilotAdapter } from "./copilot.js";
export { CursorAdapter } from "./cursor.js";
export type { Adapter, AdapterContext } from "./base.js";
export { BaseAdapter, output } from "./base.js";
// D9-SA9.5-05 (Cycle 12 CL-2 U6): opt-in root AGENTS.md output class — an
// output surface shared by all adapters via BaseAdapter.generate(), not an
// adapter (Decision-12). Default OFF (`manifest.agentsMd?.enabled !== true`).
export {
  AGENTS_MD_OWNER_PRIORITY,
  AGENTS_MD_PATH,
  buildAgentsMdBody,
  buildAgentsMdOutput,
  resolveAgentsMdOwner,
} from "./agentsMd.js";
export { readCanonicalFiles, readCanonicalFilesDetailed } from "./canonical.js";
export type { CanonicalType, CanonicalReadResult, CanonicalReadError } from "./canonical.js";
export type { CustomizationResult } from "./customization.js";
