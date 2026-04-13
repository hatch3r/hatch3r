import { readFileSync } from "node:fs";
import {
  TOOLS,
  AVAILABLE_MCP_SERVERS,
  type Tool,
  type Features,
  type Platform,
} from "../../types.js";

export const TOOL_DISPLAY_NAMES: Record<Tool, string> = {
  cursor: "Cursor",
  copilot: "GitHub Copilot",
  claude: "Claude Code",
  opencode: "OpenCode",
  windsurf: "Windsurf",
  amp: "Amp",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
  cline: "Cline / Roo Code",
  aider: "Aider",
  kiro: "Kiro",
  goose: "Goose",
  zed: "Zed",
  "amazon-q": "Amazon Q",
  antigravity: "Antigravity",
  "agents-md": "AGENTS.md",
};

export const TOOL_PROMPT_CHOICES: { name: string; value: Tool }[] = TOOLS.map((t) => ({
  name: TOOL_DISPLAY_NAMES[t],
  value: t,
}));

export const FEATURE_CHOICES: { name: string; value: keyof Features }[] = [
  { name: "Agents", value: "agents" },
  { name: "Skills", value: "skills" },
  { name: "Rules", value: "rules" },
  { name: "Prompts", value: "prompts" },
  { name: "Commands", value: "commands" },
  { name: "MCP", value: "mcp" },
  { name: "Hooks", value: "hooks" },
  { name: "GitHub agents", value: "githubAgents" },
];

export const MCP_CHOICES = Object.entries(AVAILABLE_MCP_SERVERS).map(([id, meta]) => ({
  name: `${id}: ${meta.description}`,
  value: id,
}));

export const PLATFORM_DISPLAY_NAMES: Record<Platform, string> = {
  github: "GitHub",
  "azure-devops": "Azure DevOps",
  gitlab: "GitLab",
};

export const PLATFORM_MCP_SERVER: Record<Platform, string> = {
  github: "github",
  "azure-devops": "azure-devops",
  gitlab: "gitlab",
};

/**
 * Maps tools to their command invocation syntax (how users trigger hatch3r commands).
 * Tools that use slash commands get "/", others get a description of how to invoke.
 */
export const TOOL_COMMAND_SYNTAX: Record<Tool, string> = {
  cursor: "/",
  copilot: "/",
  claude: "/",
  opencode: "/",
  windsurf: "run workflow ",
  amp: "/",
  codex: "prompt with ",
  gemini: "/",
  cline: "run workflow ",
  aider: "prompt with ",
  kiro: "/",
  goose: "prompt with ",
  zed: "/",
  "amazon-q": "/",
  antigravity: "/",
  "agents-md": "prompt with ",
};

/**
 * Returns a user-facing string showing how to invoke a command for the given tool(s).
 * If all selected tools use slash-command syntax, returns "/command-name".
 * Otherwise returns a generic phrasing.
 */
export function formatCommandHint(tools: Tool[], commandName: string): string {
  const allSlash = tools.every((t) => TOOL_COMMAND_SYNTAX[t] === "/");
  if (allSlash) {
    return `/${commandName}`;
  }
  return `the ${commandName} command`;
}

/**
 * Per-editor notes about how MCP secrets (.env.mcp) are loaded.
 * Surfaced during tool selection to avoid post-init confusion.
 */
export const TOOL_SECRET_NOTES: Partial<Record<Tool, string>> = {
  cursor: "Cursor: auto-loads .env.mcp from project root",
  copilot: "VS Code / Copilot: auto-loads .env.mcp from project root",
  claude: "Claude Code: reads .env.mcp via shell sourcing (run `set -a && source .env.mcp && set +a` before starting)",
  windsurf: "Windsurf: auto-loads .env.mcp from project root",
  cline: "Cline / Roo Code: reads env from VS Code settings; copy values to .vscode/settings.json or use shell sourcing",
  amp: "Amp: reads env from shell; source .env.mcp in your shell profile",
  codex: "Codex CLI: reads env from shell; source .env.mcp before running",
  gemini: "Gemini CLI: reads env from shell; source .env.mcp before running",
  aider: "Aider: reads env from shell; source .env.mcp before running",
  opencode: "OpenCode: reads env from shell; source .env.mcp before running",
};

export function sanitizeInput(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "");
}

export function isWSL(): boolean {
  if (process.env.WSL_DISTRO_NAME) return true;
  try {
    return /microsoft|wsl/i.test(readFileSync("/proc/version", "utf-8"));
  } catch {
    return false;
  }
}
