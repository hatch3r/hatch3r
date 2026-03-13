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
