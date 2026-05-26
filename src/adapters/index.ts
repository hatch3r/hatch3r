import { HatchError, type HatchManifest, type Tool } from "../types.js";
import type { Adapter } from "./base.js";
import { ClaudeAdapter } from "./claude.js";
import { CopilotAdapter } from "./copilot.js";
import { CursorAdapter } from "./cursor.js";

// Adapter factory map — instantiates adapters lazily on first access to avoid
// allocating all adapters at module load time (#117).
const adapterFactories: Record<Tool, () => Adapter> = {
  cursor: () => new CursorAdapter(),
  copilot: () => new CopilotAdapter(),
  claude: () => new ClaudeAdapter(),
};

const adapterCache = new Map<Tool, Adapter>();

/**
 * Retrieve or lazily instantiate the adapter for a given tool.
 *
 * Adapters are cached after first creation so repeated calls return the
 * same instance. Throws if the tool name is not in the factory map.
 */
export function getAdapter(tool: Tool): Adapter {
  let adapter = adapterCache.get(tool);
  if (adapter) return adapter;
  const factory = adapterFactories[tool];
  if (!factory) {
    throw new HatchError(`Unknown tool: ${tool}`, 1, "VALIDATION_ERROR");
  }
  adapter = factory();
  adapterCache.set(tool, adapter);
  return adapter;
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

// Adapter capability matrix — last updated for hatch3r v1.6.0.
// #260 (D9-9.31): Updated "last verified" version from v1.2.0 to v1.4.0.
// Review this matrix when adding new adapters, removing adapters, or when
// an existing tool gains/loses support for a feature (e.g. a tool ships
// native hook support). Each row must match the adapter's doGenerate() output.
export const ADAPTER_CAPABILITIES: Record<Tool, AdapterCapability> = {
  cursor:   { agents: true, skills: true, rules: true, hooks: true,  mcp: true,  commands: true,  prompts: false, githubAgents: false, worktree: true,  customization: true,  modelOverride: true,  nativeQuestionTool: false, cliTools: true  },
  claude:   { agents: true, skills: true, rules: true, hooks: true,  mcp: true,  commands: true,  prompts: false, githubAgents: false, worktree: true,  customization: true,  modelOverride: true,  nativeQuestionTool: true,  cliTools: true  },
  copilot:  { agents: true, skills: true, rules: true, hooks: false, mcp: true,  commands: true,  prompts: true,  githubAgents: true,  worktree: true,  customization: true,  modelOverride: true,  nativeQuestionTool: false, cliTools: true  },
};

/**
 * Return warnings for features enabled in the manifest but not supported
 * by the given tool's adapter. Used during sync to surface capability gaps.
 *
 * Returns at most one combined warning per adapter listing all unsupported
 * features (e.g. `"amp: features enabled but not supported by this adapter:
 * agents, rules, hooks, commands, prompts, GitHub agents"`). When the
 * adapter supports every enabled feature, returns `[]`. This grouping keeps
 * the console output readable when many adapters and many features are
 * enabled (otherwise the cross-product produces ~42 lines for a full
 * 15-adapter / 8-feature run).
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

  // CLI-tooling pivot: `cliTools` lives on `manifest.cliTools.enabled`, not
  // `manifest.features`, so it is checked separately from the
  // feature-label loop above. Warns only when the user has selected at
  // least one CLI tool but the active adapter does not render the
  // per-tool `hatch3r-cli-*` skills (e.g. `amp` reads them natively from
  // the canonical tree; `zed` has no skills surface).
  if (
    manifest.cliTools?.enabled &&
    (manifest.cliTools.selected?.length ?? 0) > 0 &&
    !caps.cliTools
  ) {
    unsupported.push("CLI tool skills");
  }

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
