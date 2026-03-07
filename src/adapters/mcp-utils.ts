import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface McpServerEntry {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  _description?: string;
  _disabled?: boolean;
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
      for (const [name, entry] of Object.entries(parsed.mcpServers)) {
        warnings.push(...validateMcpEntry(name, entry));
      }
      return { servers: parsed.mcpServers, warnings };
    }
    return { servers: {}, warnings };
  } catch (err) {
    warnings.push(`Could not read MCP config: ${err instanceof Error ? err.message : String(err)}`);
    return { servers: {}, warnings };
  }
}
