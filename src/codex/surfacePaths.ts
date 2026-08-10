import type { Tool } from "../types.js";

export const CODEX_CONFIG_PATH = ".codex/config.toml";
export const CODEX_HOOKS_PATH = ".codex/hooks.json";
export const CODEX_HOOK_SUPPORT_DIR = ".codex/hatch3r/hooks";

export const TOOL_PATH_PREFIXES: Record<Tool, string[]> = {
  cursor: [".cursor/"],
  claude: [".claude/", "CLAUDE.md", ".mcp.json"],
  copilot: [
    ".github/copilot-instructions.md",
    ".github/workflows/copilot-setup-steps.yml",
    ".vscode/mcp.json",
    ".github/instructions/",
    ".github/agents/",
    ".github/prompts/",
    ".github/skills/",
    ".github/checks/",
  ],
  codex: [
    ".agents/skills/hatch3r-*/",
    ".codex/agents/hatch3r-*.toml",
    CODEX_CONFIG_PATH,
    CODEX_HOOKS_PATH,
    ".codex/hatch3r/hooks/hatch3r-*.mjs",
    ".hatch3r/codex-support/",
    "AGENTS.md",
    "AGENTS.override.md",
  ],
};

function posixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function pathMatchesOutputPrefix(filePath: string, prefix: string): boolean {
  const path = posixPath(filePath);
  const wildcard = prefix.indexOf("*");
  if (wildcard === -1) {
    return prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix;
  }
  const literal = prefix.slice(0, wildcard);
  const suffix = prefix.slice(wildcard + 1);
  if (!path.startsWith(literal)) return false;
  if (!suffix.endsWith("/")) {
    return path.length > literal.length + suffix.length && path.endsWith(suffix);
  }
  return path.indexOf(suffix, literal.length) > literal.length;
}

export function fileMatchesTool(filePath: string, tool: Tool): boolean {
  return TOOL_PATH_PREFIXES[tool].some((prefix) => pathMatchesOutputPrefix(filePath, prefix));
}

export function isCodexSharedPath(relPath: string): boolean {
  const path = posixPath(relPath);
  return path === CODEX_CONFIG_PATH || path === CODEX_HOOKS_PATH ||
    path === "AGENTS.md" || path === "AGENTS.override.md";
}

export function isCodexExclusivePath(relPath: string): boolean {
  const path = posixPath(relPath);
  return /^\.agents\/skills\/hatch3r-[^/]+\/.+/.test(path) ||
    /^\.codex\/agents\/hatch3r-[^/]+\.toml$/.test(path) ||
    path.startsWith(".hatch3r/codex-support/") ||
    /^\.codex\/hatch3r\/hooks\/hatch3r-[^/]+\.mjs$/.test(path);
}
