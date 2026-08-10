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
  claude: "Claude Code",
  cursor: "Cursor",
  copilot: "GitHub Copilot",
  codex: "Codex",
};

export const TOOL_PROMPT_CHOICES: { name: string; value: Tool }[] = TOOLS.map((t) => ({
  name: TOOL_DISPLAY_NAMES[t],
  value: t,
}));

// release/2.8.5 (BUG-4): the config features checkbox that consumed this list
// was removed (init/config parity — feature flags now derive from the
// persisted manifest; MCP opt-in lives behind `hatch3r mcp setup` /
// `init --mcp`). The list is retained as the authoritative feature-surface
// enumeration (constants.test.ts pins it) and as the candidate choice set for
// a future scalar `config features.*` surface.
export const FEATURE_CHOICES: { name: string; value: keyof Features }[] = [
  { name: "Agents", value: "agents" },
  { name: "Skills", value: "skills" },
  { name: "Rules", value: "rules" },
  { name: "Prompts", value: "prompts" },
  { name: "Commands", value: "commands" },
  { name: "MCP", value: "mcp" },
  { name: "Hooks", value: "hooks" },
  { name: "GitHub agents", value: "githubAgents" },
  // 2.1.0 (Task D): handoffs was a live control surface (DEFAULT_FEATURES.handoffs
  // = true, threaded into bridge-orchestration emission) but absent from the
  // picker, so the config feature-rebuild loop silently forced it false on every
  // run. Listed here (default checked) so it round-trips; the rebuild loop is
  // additionally hardened to preserve unlisted features (see config.ts).
  { name: "Handoffs", value: "handoffs" },
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
  claude: "/",
  cursor: "/",
  copilot: "/",
  codex: "$",
};

/**
 * Renders the invocation string for a single tool's command-invocation syntax.
 * Claude Code, Cursor, and GitHub Copilot expose repository slash commands.
 * Codex exposes command sources as generated `hatch3r-command-*` skills, so a
 * canonical `hatch3r-foo` command renders as `$hatch3r-command-foo`.
 */
function renderInvocation(tool: Tool, commandName: string): string {
  if (
    tool === "codex" &&
    commandName.startsWith("hatch3r-") &&
    !commandName.startsWith("hatch3r-command-")
  ) {
    return `$hatch3r-command-${commandName.slice("hatch3r-".length)}`;
  }
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
 *   single invocation form (e.g., `/command-name`).
 * - When tools have mixed syntax, returns a per-tool hint string with one
 *   `Display Name: invocation` segment per tool joined by ` | `, so users see
 *   the exact phrasing for every selected tool instead of an ambiguous
 *   `the X command` placeholder. Codex plus any slash-command adapter reaches
 *   this branch because Codex invokes projected commands as skills.
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
  // Codex plus any slash-command adapter reaches this branch. Deduplicate by
  // display name to keep the row readable if two future tool ids share a label.
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
 *
 * D11-M7 (Cycle 10 Wave-3 Medium, P2): the prior notes claimed Cursor and
 * VS Code "auto-load .env.mcp from project root" without distinguishing the
 * terminal-launch path from the GUI-launch path on macOS. macOS editors
 * launched from Finder/Dock/Spotlight do not inherit shell-sourced env vars
 * (they get only launchd's env); only the terminal-launched path
 * (`code .`, `cursor .`, `open -a` from a shell that has sourced .env.mcp)
 * reliably propagates the secrets to MCP STDIO server child processes.
 * The notes now flag the caveat so users do not silently get empty tokens.
 *
 * D11-7 (Cycle 11 D11, P6/CQ4): the copilot note now distinguishes the two
 * VS Code secret paths the adapter actually emits — STDIO server `env` via
 * the `.env.mcp` envFile loader, and HTTP/header secrets via VS Code's
 * `${input:NAME}` prompt (top-level `inputs[]`), which VS Code prompts for
 * on first use rather than reading from `.env.mcp`.
 *
 * D10-SA10.5-02 (Cycle 12 D10, P1): the cursor note previously claimed
 * ".env.mcp auto-loads from project root", contradicting the cursor adapter's
 * `${env:NAME}` passthrough (`src/adapters/cursor.ts`) — Cursor resolves
 * `${env:...}` from the launching process environment, not from any file it
 * reads — and both doc surfaces (`docs/adapter-capability-matrix.md`,
 * `website/docs/guides/customization.md`, which say "user must source"). The
 * note now states the source-before-launch requirement, matching the claude
 * sibling. The copilot note's "auto-loads" is accurate (real envFile loader)
 * and is intentionally left unchanged.
 */
export const TOOL_SECRET_NOTES: Partial<Record<Tool, string>> = {
  claude: "Claude Code: reads .env.mcp via shell sourcing (run `set -a && source .env.mcp && set +a` before starting; macOS GUI launchers do not inherit shell env)",
  cursor: "Cursor: reads MCP secrets from its process environment via ${env:VAR}; it does NOT read .env.mcp from disk. Source .env.mcp before launch (set -a && source .env.mcp && set +a && cursor .). macOS Dock/Finder launches need `launchctl setenv` per var.",
  copilot: "VS Code / Copilot: STDIO server env auto-loads from .env.mcp (terminal-launch only on macOS; Dock/Finder launches need `launchctl setenv` per var); MCP header secrets are prompted via VS Code ${input:NAME} variables on first use",
  codex: "Codex: reads MCP secrets from its launching process environment. Source .env.mcp using the platform-appropriate shell command before starting or restarting Codex; macOS GUI launchers do not inherit shell env.",
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
