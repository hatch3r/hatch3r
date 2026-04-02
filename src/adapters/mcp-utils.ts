import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface McpServerEntry {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  _description?: string;
  _disabled?: boolean;
}

/**
 * Transforms `${env:VAR}` references to the native format for a given adapter.
 *
 * The canonical MCP config uses `${env:VAR}` syntax (matching the MCP spec).
 * Different adapters have different native env var reference syntaxes:
 * - "claude": `${VAR}` (Claude Code native)
 * - "process": `process.env.VAR` replaced at generation time (not used yet)
 * - "passthrough": keep `${env:VAR}` as-is (for adapters that support MCP spec natively)
 * - "shell": `$VAR` (for shell-based expansion)
 *
 * For adapters that don't understand `${env:VAR}`, this prevents silent failures
 * by converting to a syntax the adapter can process.
 */
export function transformEnvVarSyntax(
  value: unknown,
  format: "claude" | "shell" | "passthrough" = "passthrough",
): unknown {
  if (typeof value === "string") {
    switch (format) {
      case "claude":
        return value.replace(/\$\{env:([^}]+)\}/g, "${$1}");
      case "shell":
        return value.replace(/\$\{env:([^}]+)\}/g, "$$$1");
      case "passthrough":
        return value;
    }
  }
  if (Array.isArray(value)) {
    return value.map((v) => transformEnvVarSyntax(v, format));
  }
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = transformEnvVarSyntax(v, format);
    }
    return result;
  }
  return value;
}

const ALLOWED_COMMANDS = new Set([
  "npx",
  "node",
  "uvx",
  "docker",
  "python",
  "python3",
  "pip",
  "pip3",
  "deno",
  "bun",
  "uv",
  "go",
  "cargo",
]);

const ALLOWED_URL_SCHEMES = new Set(["http:", "https:"]);

export function validateMcpEntry(
  name: string,
  entry: McpServerEntry,
): string[] {
  const warnings: string[] = [];

  if (entry.command) {
    const baseCommand =
      entry.command.split("/").pop()?.split("\\").pop() ?? entry.command;
    if (!ALLOWED_COMMANDS.has(baseCommand)) {
      warnings.push(
        `MCP server "${name}" uses unrecognized command "${entry.command}". ` +
          `Expected one of: ${[...ALLOWED_COMMANDS].join(", ")}`,
      );
    }
  }

  if (entry.url) {
    try {
      const parsed = new URL(entry.url);
      if (!ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
        warnings.push(
          `MCP server "${name}" uses unsupported URL scheme "${parsed.protocol}". ` +
            `Allowed: ${[...ALLOWED_URL_SCHEMES].join(", ")}`,
        );
      }
    } catch {
      warnings.push(
        `MCP server "${name}" has invalid URL: "${entry.url}"`,
      );
    }
  }

  if (!entry.command && !entry.url) {
    warnings.push(
      `MCP server "${name}" has neither command nor url configured`,
    );
  }

  // #120: Validate env key names follow POSIX convention
  if (entry.env) {
    for (const key of Object.keys(entry.env)) {
      if (!VALID_ENV_KEY.test(key)) {
        warnings.push(
          `MCP server "${name}" has invalid env key "${key}". ` +
            `Environment variable names must match [A-Za-z_][A-Za-z0-9_]*.`,
        );
      }
    }
  }

  if (entry.args) {
    const SHELL_METACHAR = /[|;&`$()]/;
    for (const arg of entry.args) {
      if (SHELL_METACHAR.test(arg)) {
        warnings.push(
          `MCP server "${name}" arg contains shell metacharacters: "${arg}". ` +
            `This may indicate a command injection risk.`,
        );
      }
    }

    const hasAutoYes = entry.args.some((a) => a === "-y" || a === "--yes");
    if (hasAutoYes) {
      const pkgArg = entry.args.find(
        (a) => !a.startsWith("-") && a !== entry.command,
      );
      if (pkgArg && !pkgArg.startsWith("@")) {
        warnings.push(
          `MCP server "${name}" uses npx -y with unscoped package "${pkgArg}". ` +
            `Unscoped packages are susceptible to typosquatting. Consider using a scoped package (@org/pkg).`,
        );
      }
    }
  }

  return warnings;
}

// Env var keys must follow POSIX convention: letters, digits, and underscores.
// Keys with other characters are rejected to prevent injection.
const VALID_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Server names must contain only alphanumeric characters, hyphens, and underscores.
// Names with other special characters are rejected to prevent path traversal,
// injection, or config key manipulation.
const VALID_SERVER_NAME = /^[a-zA-Z0-9_-]+$/;

export function validateServerName(name: string): string | null {
  if (!VALID_SERVER_NAME.test(name)) {
    return (
      `MCP server name "${name}" contains invalid characters. ` +
      `Only alphanumeric characters, hyphens, and underscores are allowed.`
    );
  }
  return null;
}

function validateMcpConfig(
  parsed: unknown,
): parsed is { mcpServers: Record<string, McpServerEntry> } {
  if (typeof parsed !== "object" || parsed === null) return false;
  const obj = parsed as Record<string, unknown>;
  return typeof obj.mcpServers === "object" && obj.mcpServers !== null;
}

export interface McpConfigResult {
  servers: Record<string, McpServerEntry>;
  warnings: string[];
}

export async function readMcpConfig(
  agentsDir: string,
): Promise<McpConfigResult> {
  const mcpPath = join(agentsDir, "mcp", "mcp.json");
  const warnings: string[] = [];
  try {
    const mcpRaw = await readFile(mcpPath, "utf-8");
    const parsed: unknown = JSON.parse(mcpRaw);
    if (validateMcpConfig(parsed)) {
      const validServers: Record<string, McpServerEntry> = {};
      for (const [name, entry] of Object.entries(parsed.mcpServers)) {
        const nameWarning = validateServerName(name);
        if (nameWarning) {
          warnings.push(nameWarning);
          continue;
        }
        warnings.push(...validateMcpEntry(name, entry));
        validServers[name] = entry;
      }
      return { servers: validServers, warnings };
    }
    return { servers: {}, warnings };
  } catch (err) {
    warnings.push(`Could not read MCP config: ${err instanceof Error ? err.message : String(err)}`);
    return { servers: {}, warnings };
  }
}
