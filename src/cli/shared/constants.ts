import { readFileSync } from "node:fs";
import {
  TOOLS,
  AVAILABLE_MCP_SERVERS,
  type Tool,
  type Features,
  type Platform,
} from "../../types.js";
import { verbose } from "./ui.js";

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
};

/**
 * Renders the invocation string for a single tool's command-invocation syntax.
 * - "/" prefix tools (Claude Code, Cursor, etc.) render as `/command-name`.
 * - " " (space-suffix) prefix tools render as `<prefix>command-name`
 *   (e.g., Windsurf -> `run workflow command-name`, Aider -> `prompt with command-name`).
 */
function renderInvocation(tool: Tool, commandName: string): string {
  const prefix = TOOL_COMMAND_SYNTAX[tool];
  return `${prefix}${commandName}`;
}

/**
 * Returns per-tool invocation hints for `commandName` across `tools`, keyed
 * by the tool id. Each value is the literal string a user types to invoke the
 * command in that tool (e.g., `cursor -> /codebase-map`,
 * `aider -> prompt with codebase-map`). Tools that share invocation syntax
 * still get individual entries — callers that want a collapsed view should
 * inspect distinct values themselves.
 */
export function formatCommandHintByTool(
  tools: Tool[],
  commandName: string,
): Record<Tool, string> {
  const out = {} as Record<Tool, string>;
  for (const tool of tools) {
    out[tool] = renderInvocation(tool, commandName);
  }
  return out;
}

/**
 * Returns a user-facing string showing how to invoke a command for the given tool(s).
 *
 * - When all selected tools share the same invocation syntax, returns the
 *   single invocation form (e.g., `/command-name` or `run workflow command-name`).
 * - When tools have mixed syntax, returns a per-tool hint string with one
 *   `Display Name: invocation` segment per tool joined by ` | `, so users see
 *   the exact phrasing for every selected tool instead of an ambiguous
 *   `the X command` placeholder.
 *
 * The function always returns a single string (no embedded newlines) so it
 * remains drop-in safe for box/log renderers that treat each argument as one
 * line.
 */
export function formatCommandHint(tools: Tool[], commandName: string): string {
  if (tools.length === 0) {
    return `the ${commandName} command`;
  }

  const distinctSyntax = new Set(tools.map((t) => TOOL_COMMAND_SYNTAX[t]));
  if (distinctSyntax.size === 1) {
    return renderInvocation(tools[0], commandName);
  }

  // Mixed syntax: emit one segment per tool so no user is left guessing.
  // Deduplicate by display name to keep the row readable when two tool ids
  // share a label (e.g., Cline / Roo Code).
  const seen = new Set<string>();
  const segments: string[] = [];
  for (const tool of tools) {
    const label = TOOL_DISPLAY_NAMES[tool] ?? tool;
    const invocation = renderInvocation(tool, commandName);
    const segment = `${label}: ${invocation}`;
    if (seen.has(segment)) continue;
    seen.add(segment);
    segments.push(segment);
  }
  return segments.join(" | ");
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
  } catch (err) {
    // /proc/version absent on non-Linux platforms — expected. Surface under
    // --verbose so unexpected failures (permission errors) stay visible.
    const message = err instanceof Error ? err.message : String(err);
    verbose(`constants: isWSL probe of /proc/version → false — ${message}`);
    return false;
  }
}
