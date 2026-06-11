import { HatchError, WORKTREE_CAPABLE_TOOLS, type HatchManifest, type Tool } from "../types.js";
import type { Adapter } from "./base.js";
import { ClaudeAdapter } from "./claude.js";
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
    throw new HatchError(
      `Unknown tool: ${tool}`,
      1,
      "VALIDATION_ERROR",
      `Supported tools: ${supported}. Re-run with one of these via \`--tools\`.`,
    );
  }
  return factory();
}

// #258 (D9-9.29): Extended AdapterCapability to include worktree, customization, and modelOverride
// columns that were tracked in the external audit matrix but missing from the type.
interface AdapterCapability {
  agents: boolean;
  skills: boolean;
  rules: boolean;
  hooks: boolean;
  mcp: boolean;
  commands: boolean;
  prompts: boolean;
  githubAgents: boolean;
  /** Whether the adapter supports git worktree file-isolation. */
  worktree: boolean;
  /** Whether the adapter supports per-item customization (.customize.md). */
  customization: boolean;
  /** Whether the adapter supports model override configuration. */
  modelOverride: boolean;
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
// `resolveAgentModel` unconditionally, so they are `true` for all 3 adapters
// and pinned to that behavioural source by the same drift test.
export const ADAPTER_CAPABILITIES: Record<Tool, AdapterCapability> = {
  cursor:   { agents: true, skills: true, rules: true, hooks: true,  mcp: true,  commands: true,  prompts: false, githubAgents: false, worktree: WORKTREE_CAPABLE_TOOLS.has("cursor"),  customization: true,  modelOverride: true,  nativeQuestionTool: false, cliTools: true  },
  claude:   { agents: true, skills: true, rules: true, hooks: true,  mcp: true,  commands: true,  prompts: false, githubAgents: false, worktree: WORKTREE_CAPABLE_TOOLS.has("claude"),  customization: true,  modelOverride: true,  nativeQuestionTool: true,  cliTools: true  },
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
  copilot:  { agents: true, skills: true, rules: true, hooks: false, mcp: true,  commands: true,  prompts: false, githubAgents: true,  worktree: WORKTREE_CAPABLE_TOOLS.has("copilot"),  customization: true,  modelOverride: true,  nativeQuestionTool: false, cliTools: true  },
};

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
export { CopilotAdapter } from "./copilot.js";
export { CursorAdapter } from "./cursor.js";
export type { Adapter, AdapterContext } from "./base.js";
export { BaseAdapter, output } from "./base.js";
export { readCanonicalFiles, readCanonicalFilesDetailed } from "./canonical.js";
export type { CanonicalType, CanonicalReadResult, CanonicalReadError } from "./canonical.js";
export type { CustomizationResult } from "./customization.js";
