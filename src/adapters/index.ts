import type { HatchManifest, Tool } from "../types.js";
import type { Adapter } from "./base.js";
import { AiderAdapter } from "./aider.js";
import { AmpAdapter } from "./amp.js";
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

const adapters: Record<Tool, Adapter> = {
  cursor: new CursorAdapter(),
  copilot: new CopilotAdapter(),
  claude: new ClaudeAdapter(),
  opencode: new OpenCodeAdapter(),
  windsurf: new WindsurfAdapter(),
  amp: new AmpAdapter(),
  codex: new CodexAdapter(),
  gemini: new GeminiAdapter(),
  cline: new ClineAdapter(),
  aider: new AiderAdapter(),
  kiro: new KiroAdapter(),
  goose: new GooseAdapter(),
  zed: new ZedAdapter(),
};

export function getAdapter(tool: Tool): Adapter {
  const adapter = adapters[tool];
  if (!adapter) {
    throw new Error(`Unknown tool: ${tool}`);
  }
  return adapter;
}

interface AdapterCapability {
  agents: boolean;
  skills: boolean;
  rules: boolean;
  hooks: boolean;
  mcp: boolean;
  commands: boolean;
  prompts: boolean;
  githubAgents: boolean;
}

const ADAPTER_CAPABILITIES: Record<Tool, AdapterCapability> = {
  cursor:   { agents: true, skills: true, rules: true, hooks: true,  mcp: true,  commands: true,  prompts: false, githubAgents: false },
  claude:   { agents: true, skills: true, rules: true, hooks: true,  mcp: true,  commands: true,  prompts: false, githubAgents: false },
  gemini:   { agents: true, skills: true, rules: true, hooks: true,  mcp: true,  commands: true,  prompts: false, githubAgents: false },
  cline:    { agents: true, skills: true, rules: true, hooks: true,  mcp: true,  commands: true,  prompts: false, githubAgents: false },
  codex:    { agents: true, skills: true, rules: true, hooks: false, mcp: true,  commands: false, prompts: false, githubAgents: false },
  copilot:  { agents: true, skills: true, rules: true, hooks: false, mcp: true,  commands: true,  prompts: true,  githubAgents: true  },
  opencode: { agents: true, skills: true, rules: true, hooks: false, mcp: true,  commands: true,  prompts: false, githubAgents: false },
  windsurf: { agents: true, skills: true, rules: true, hooks: false, mcp: true,  commands: true,  prompts: false, githubAgents: false },
  amp:      { agents: true, skills: true, rules: true, hooks: false, mcp: true,  commands: true,  prompts: false, githubAgents: false },
  kiro:     { agents: true, skills: true, rules: true, hooks: false, mcp: true,  commands: false, prompts: false, githubAgents: false },
  aider:    { agents: true, skills: true, rules: true, hooks: false, mcp: false, commands: false, prompts: false, githubAgents: false },
  goose:    { agents: true, skills: true, rules: true, hooks: false, mcp: false, commands: false, prompts: false, githubAgents: false },
  zed:      { agents: true, skills: true, rules: true, hooks: false, mcp: false, commands: false, prompts: false, githubAgents: false },
};

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
    if (manifest.features[key] && !caps[key]) {
      warnings.push(`${tool}: ${label} are enabled but not supported by this adapter`);
    }
  }
  return warnings;
}

export { AiderAdapter } from "./aider.js";
export { AmpAdapter } from "./amp.js";
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
export type { Adapter } from "./base.js";
export { readCanonicalFiles } from "./canonical.js";
export type { CanonicalType } from "./canonical.js";
