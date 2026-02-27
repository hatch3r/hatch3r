import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AVAILABLE_MCP_SERVERS, ENV_VAR_HELP } from "../types.js";

export interface EnvVar {
  name: string;
  server: string;
  comment: string;
  url: string;
}

const ENV_MCP_FILE = ".env.mcp";

const SOURCE_POSIX = "set -a && source .env.mcp && set +a";
const SOURCE_POWERSHELL =
  'Get-Content .env.mcp | ForEach-Object { if ($_ -match \'^\\s*([^#][^=]+)=(.*)$\') { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), \'Process\') } }';

/**
 * Returns the sourcing command for the current OS.
 * Run this, then start or restart your editor (VS Code/Copilot auto-loads .env.mcp).
 */
export function getSourceEnvMcpCommand(): string {
  return process.platform === "win32" ? SOURCE_POWERSHELL : SOURCE_POSIX;
}

/**
 * Returns the sourcing disclaimer block for the .env.mcp template.
 * Includes both POSIX and Windows commands so the file is useful on any OS.
 */
export function getSourceEnvMcpDisclaimer(): string {
  return [
    "# Cursor / Claude Code: Source this file, then start or restart your editor (VS Code/Copilot auto-loads it).",
    "# macOS/Linux (bash/zsh):",
    `#   ${SOURCE_POSIX}`,
    "# Windows (PowerShell):",
    `#   ${SOURCE_POWERSHELL}`,
    "# Windows (Git Bash): same as macOS/Linux",
    "",
  ].join("\n");
}

/**
 * Collects every environment variable required by the given MCP server list.
 * Returns a deduped, deterministic array.
 */
export function collectRequiredEnvVars(servers: string[]): EnvVar[] {
  const seen = new Set<string>();
  const vars: EnvVar[] = [];

  for (const id of servers) {
    const meta = AVAILABLE_MCP_SERVERS[id];
    if (!meta?.requiresEnv) continue;
    for (const name of meta.requiresEnv) {
      if (seen.has(name)) continue;
      seen.add(name);
      const help = ENV_VAR_HELP[name];
      vars.push({
        name,
        server: id,
        comment: help?.comment ?? id,
        url: help?.url ?? "",
      });
    }
  }

  return vars;
}

/**
 * Renders the contents of a `.env.mcp` file.
 * Existing values (from a prior file) are preserved; new vars get empty placeholders.
 */
export function generateEnvMcpContent(
  vars: EnvVar[],
  existing: Record<string, string> = {},
): string {
  if (vars.length === 0) return "";

  const lines: string[] = [
    "# hatch3r MCP secrets",
    "# Fill in your values below. This file is gitignored — never commit it.",
    "# Docs: https://github.com/hatch3r-dev/hatch3r/blob/main/docs/mcp-setup.md",
    "",
    getSourceEnvMcpDisclaimer(),
  ];

  for (const v of vars) {
    const urlPart = v.url ? ` — ${v.url}` : "";
    lines.push(`# ${v.comment}${urlPart}`);
    lines.push(`${v.name}=${existing[v.name] ?? ""}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Parses a KEY=VALUE env file, ignoring comments and blank lines.
 * Handles optional quoting and `export` prefix.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const stripped = line.startsWith("export ") ? line.slice(7) : line;
    const eqIdx = stripped.indexOf("=");
    if (eqIdx < 1) continue;
    const key = stripped.slice(0, eqIdx).trim();
    let val = stripped.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

export interface EnsureResult {
  action: "created" | "updated" | "skipped";
  path: string;
  newVars: string[];
}

/**
 * Creates or updates `.env.mcp` in the given root directory.
 * Never overwrites existing values — only appends missing vars.
 */
export async function ensureEnvMcp(
  rootDir: string,
  servers: string[],
): Promise<EnsureResult> {
  const envPath = join(rootDir, ENV_MCP_FILE);
  const vars = collectRequiredEnvVars(servers);

  if (vars.length === 0) {
    return { action: "skipped", path: ENV_MCP_FILE, newVars: [] };
  }

  let existing: Record<string, string> = {};
  let hadFile = false;

  if (existsSync(envPath)) {
    hadFile = true;
    const raw = await readFile(envPath, "utf-8");
    existing = parseEnvFile(raw);
  }

  const newVars = vars.filter((v) => !(v.name in existing)).map((v) => v.name);

  if (hadFile && newVars.length === 0) {
    return { action: "skipped", path: ENV_MCP_FILE, newVars: [] };
  }

  const content = generateEnvMcpContent(vars, existing);
  await writeFile(envPath, content, "utf-8");

  return {
    action: hadFile ? "updated" : "created",
    path: ENV_MCP_FILE,
    newVars,
  };
}
