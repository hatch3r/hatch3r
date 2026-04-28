import { HatchError, type HatchManifest, type Tool } from "../types.js";
import type { Adapter } from "./base.js";
import { AiderAdapter } from "./aider.js";
import { AmazonQAdapter } from "./amazonq.js";
import { AmpAdapter } from "./amp.js";
import { AntigravityAdapter } from "./antigravity.js";
import { ClaudeAdapter } from "./claude.js";
import { ClineAdapter } from "./cline.js";
import { CodexAdapter } from "./codex.js";
import { CopilotAdapter } from "./copilot.js";
import { CursorAdapter } from "./cursor.js";
import { GeminiAdapter } from "./gemini.js";
import { GooseAdapter } from "./goose.js";
import { KiroAdapter } from "./kiro.js";
import { OpenCodeAdapter } from "./opencode.js";
import { WindsurfAdapter } from "./windsurf.js";
import { ZedAdapter } from "./zed.js";

// Adapter factory map — instantiates adapters lazily on first access to avoid
// allocating all adapters at module load time (#117).
const adapterFactories: Record<Tool, () => Adapter> = {
  cursor: () => new CursorAdapter(),
  copilot: () => new CopilotAdapter(),
  claude: () => new ClaudeAdapter(),
  opencode: () => new OpenCodeAdapter(),
  windsurf: () => new WindsurfAdapter(),
  amp: () => new AmpAdapter(),
  codex: () => new CodexAdapter(),
  gemini: () => new GeminiAdapter(),
  cline: () => new ClineAdapter(),
  aider: () => new AiderAdapter(),
  kiro: () => new KiroAdapter(),
  goose: () => new GooseAdapter(),
  zed: () => new ZedAdapter(),
  "amazon-q": () => new AmazonQAdapter(),
  antigravity: () => new AntigravityAdapter(),
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
}

// Adapter capability matrix — last updated for hatch3r v1.6.0.
// #260 (D9-9.31): Updated "last verified" version from v1.2.0 to v1.4.0.
// Review this matrix when adding new adapters, removing adapters, or when
// an existing tool gains/loses support for a feature (e.g. a tool ships
// native hook support). Each row must match the adapter's doGenerate() output.
const ADAPTER_CAPABILITIES: Record<Tool, AdapterCapability> = {
  cursor:   { agents: true, skills: true, rules: true, hooks: true,  mcp: true,  commands: true,  prompts: false, githubAgents: false, worktree: true,  customization: true,  modelOverride: true  },
  claude:   { agents: true, skills: true, rules: true, hooks: true,  mcp: true,  commands: true,  prompts: false, githubAgents: false, worktree: true,  customization: true,  modelOverride: true  },
  gemini:   { agents: true, skills: true, rules: true, hooks: true,  mcp: true,  commands: true,  prompts: false, githubAgents: false, worktree: true,  customization: true,  modelOverride: true  },
  cline:    { agents: true, skills: true, rules: true, hooks: true,  mcp: true,  commands: true,  prompts: false, githubAgents: false, worktree: true,  customization: true,  modelOverride: true  },
  codex:      { agents: true, skills: true, rules: true, hooks: true,  mcp: true,  commands: false, prompts: false, githubAgents: false, worktree: false, customization: true,  modelOverride: true  },
  "amazon-q": { agents: true, skills: true, rules: true, hooks: true,  mcp: true,  commands: false, prompts: false, githubAgents: false, worktree: false, customization: true,  modelOverride: true  },
  copilot:  { agents: true, skills: true, rules: true, hooks: false, mcp: true,  commands: true,  prompts: true,  githubAgents: true,  worktree: true,  customization: true,  modelOverride: true  },
  opencode: { agents: true, skills: true, rules: true, hooks: false, mcp: true,  commands: true,  prompts: false, githubAgents: false, worktree: false, customization: true,  modelOverride: true  },
  // C7.5-W2B2-H31 (D9-SA9.7.1): Windsurf shipped Cascade Hooks in v1.13.12 (2026-01-25).
  // Hatch3r emits `.windsurf/hooks.json` per docs.windsurf.com/windsurf/cascade/hooks.md.
  windsurf: { agents: true, skills: true, rules: true, hooks: true,  mcp: true,  commands: true,  prompts: false, githubAgents: false, worktree: true,  customization: true,  modelOverride: true  },
  // Amp reads AGENTS.md natively; the root file is written by generateRootAgentsMd()
  // in init/update, not by this adapter. doGenerate() emits skills + MCP only.
  amp:      { agents: false, skills: true, rules: false, hooks: false, mcp: true,  commands: false, prompts: false, githubAgents: false, worktree: false, customization: true,  modelOverride: true  },
  kiro:     { agents: true, skills: true, rules: true, hooks: true,  mcp: true,  commands: false, prompts: false, githubAgents: false, worktree: false, customization: true,  modelOverride: true  },
  aider:    { agents: true, skills: true, rules: true, hooks: false, mcp: false, commands: false, prompts: false, githubAgents: false, worktree: false, customization: true,  modelOverride: true  },
  goose:    { agents: true, skills: true, rules: true, hooks: false, mcp: true,  commands: false, prompts: false, githubAgents: false, worktree: false, customization: true,  modelOverride: true  },
  zed:      { agents: true, skills: false, rules: true, hooks: false, mcp: true,  commands: false, prompts: false, githubAgents: false, worktree: false, customization: false, modelOverride: false },
  antigravity: { agents: true, skills: true, rules: true, hooks: false, mcp: true,  commands: false, prompts: false, githubAgents: false, worktree: false, customization: true,  modelOverride: true  },
};

/**
 * Return warnings for features enabled in the manifest but not supported
 * by the given tool's adapter. Used during sync to surface capability gaps.
 */
export function getUnsupportedFeatureWarnings(tool: string, manifest: HatchManifest): string[] {
  const caps = ADAPTER_CAPABILITIES[tool as Tool];
  if (!caps) return [];

  const warnings: string[] = [];
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

  for (const { key, label } of featureLabels) {
    if (manifest.features[key as keyof typeof manifest.features] && !caps[key]) {
      warnings.push(`${tool}: ${label} are enabled but not supported by this adapter`);
    }
  }
  return warnings;
}

export { AiderAdapter } from "./aider.js";
export { AmazonQAdapter } from "./amazonq.js";
export { AmpAdapter } from "./amp.js";
export { AntigravityAdapter } from "./antigravity.js";
export { ClaudeAdapter } from "./claude.js";
export { ClineAdapter } from "./cline.js";
export { CodexAdapter } from "./codex.js";
export { CopilotAdapter } from "./copilot.js";
export { CursorAdapter } from "./cursor.js";
export { GeminiAdapter } from "./gemini.js";
export { GooseAdapter } from "./goose.js";
export { KiroAdapter } from "./kiro.js";
export { OpenCodeAdapter } from "./opencode.js";
export { WindsurfAdapter } from "./windsurf.js";
export { ZedAdapter } from "./zed.js";
export type { Adapter, AdapterContext } from "./base.js";
export { BaseAdapter, output } from "./base.js";
export { readCanonicalFiles, readCanonicalFilesDetailed } from "./canonical.js";
export type { CanonicalType, CanonicalReadResult, CanonicalReadError } from "./canonical.js";
export type { CustomizationResult } from "./customization.js";
