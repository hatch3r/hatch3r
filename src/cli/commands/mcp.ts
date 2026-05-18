import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { readManifest, writeManifest } from "../../manifest/hatchJson.js";
import {
  AVAILABLE_MCP_SERVERS,
  HatchError,
  type HatchManifest,
} from "../../types.js";
import {
  ensureEnvMcp,
  ensureGitignoreEntry,
  getSourceEnvMcpCommand,
  parseEnvFile,
  collectRequiredEnvVars,
} from "../../env/mcpEnv.js";
import {
  printBanner,
  printBox,
  info,
  warn,
  error as logError,
  label,
} from "../shared/ui.js";
import { pickMcpServers } from "../shared/pickers.js";
import { isWSL } from "../shared/constants.js";

/**
 * Side-door MCP setup command (plan §4.5). With the CLI-tooling pivot
 * demoting MCP behind a Yes/No gate during `hatch3r init`, this command
 * is the standalone entry point for users who skipped MCP during init
 * and want to add it later. Subcommands: setup | list | remove | env-check.
 *
 * Boundary contract: every subcommand loads the manifest itself, opens
 * the picker UI when required, and persists writes via `writeManifest`.
 * No subcommand mutates `.agents/` content — adapter regeneration is
 * delegated to `hatch3r sync` (the next run picks up the manifest change).
 */

function requireManifest(rootDir: string, manifest: HatchManifest | null): asserts manifest {
  if (!manifest) {
    logError("No .agents/hatch.json found.");
    console.log(chalk.dim(`  Run \`npx hatch3r init\` to set up your project first.\n`));
    throw new HatchError("No .agents/hatch.json found.", 1, "CONFIG_ERROR");
  }
}

function wslThemeOrUndefined(): unknown {
  return isWSL()
    ? { icon: { checked: chalk.green("[x]"), unchecked: "[ ]", cursor: ">" } }
    : undefined;
}

export async function mcpSetupCommand(): Promise<void> {
  printBanner(true);
  const rootDir = process.cwd();
  const manifest = await readManifest(rootDir);
  requireManifest(rootDir, manifest);

  const platform = manifest.platform ?? "github";
  const selected = await pickMcpServers({
    platform,
    existing: manifest.mcp.servers,
    wslTheme: wslThemeOrUndefined(),
  });

  manifest.mcp = { servers: selected };
  await writeManifest(rootDir, manifest);

  if (selected.length > 0) {
    const envResult = await ensureEnvMcp(rootDir, selected);
    await ensureGitignoreEntry(rootDir);
    if (envResult.newVars.length > 0) {
      warn(`Add new secrets to .env.mcp: ${envResult.newVars.join(", ")}`);
      info(`Run this then start/restart your editor: ${getSourceEnvMcpCommand()}`);
    }
  }

  printBox(
    "MCP configured",
    [
      label("Servers", selected.length > 0 ? selected.join(", ") : "none"),
      label("Manifest", ".agents/hatch.json"),
      label("Next", "Run `npx hatch3r sync` to regenerate adapter MCP configs"),
    ],
    "success",
  );
}

export async function mcpListCommand(): Promise<void> {
  printBanner(true);
  const rootDir = process.cwd();
  const manifest = await readManifest(rootDir);
  requireManifest(rootDir, manifest);

  const servers = manifest.mcp.servers;
  const envPath = join(rootDir, ".env.mcp");
  const hasEnvFile = existsSync(envPath);
  const envExisting = hasEnvFile ? parseEnvFile(await readFile(envPath, "utf-8")) : {};
  const requiredVars = collectRequiredEnvVars(servers);
  const missingVars = requiredVars.filter((v) => !(v.name in envExisting) || envExisting[v.name] === "");

  const lines: string[] = [];
  if (servers.length === 0) {
    lines.push("(no MCP servers configured)");
    lines.push("");
    lines.push("Run `npx hatch3r mcp setup` to open the server picker.");
  } else {
    for (const id of servers) {
      const meta = AVAILABLE_MCP_SERVERS[id];
      const desc = meta?.description ?? "(unknown server)";
      lines.push(`  ${chalk.cyan(id)} — ${desc}`);
    }
    lines.push("");
    lines.push(label(".env.mcp", hasEnvFile ? "present" : chalk.yellow("missing")));
    if (requiredVars.length > 0) {
      lines.push(label("Required vars", requiredVars.map((v) => v.name).join(", ")));
      if (missingVars.length > 0) {
        lines.push(label("Missing", chalk.yellow(missingVars.map((v) => v.name).join(", "))));
      } else {
        lines.push(label("Status", chalk.green("all required vars set")));
      }
    }
  }

  printBox("MCP servers", lines, "info");
}

export async function mcpRemoveCommand(id: string): Promise<void> {
  printBanner(true);
  const rootDir = process.cwd();
  const manifest = await readManifest(rootDir);
  requireManifest(rootDir, manifest);

  const before = manifest.mcp.servers;
  if (!before.includes(id)) {
    logError(`MCP server "${id}" is not configured.`);
    console.log(chalk.dim(`  Current servers: ${before.length > 0 ? before.join(", ") : "(none)"}\n`));
    throw new HatchError(`MCP server "${id}" not configured`, 1, "VALIDATION_ERROR");
  }

  manifest.mcp = { servers: before.filter((s) => s !== id) };
  await writeManifest(rootDir, manifest);

  printBox(
    "MCP server removed",
    [
      label("Removed", id),
      label("Remaining", manifest.mcp.servers.length > 0 ? manifest.mcp.servers.join(", ") : "none"),
      label("Next", "Run `npx hatch3r sync` to regenerate adapter MCP configs"),
    ],
    "success",
  );
}

export async function mcpEnvCheckCommand(): Promise<void> {
  printBanner(true);
  const rootDir = process.cwd();
  const manifest = await readManifest(rootDir);
  requireManifest(rootDir, manifest);

  const servers = manifest.mcp.servers;
  const envPath = join(rootDir, ".env.mcp");
  const hasEnvFile = existsSync(envPath);
  const envExisting = hasEnvFile ? parseEnvFile(await readFile(envPath, "utf-8")) : {};

  const lines: string[] = [];
  if (servers.length === 0) {
    lines.push("(no MCP servers configured — nothing to check)");
    printBox("MCP env check", lines, "info");
    return;
  }

  let missingTotal = 0;
  for (const id of servers) {
    const meta = AVAILABLE_MCP_SERVERS[id];
    const required = meta?.requiresEnv ?? [];
    if (required.length === 0) {
      lines.push(`${chalk.green("✓")} ${id} — no env vars required`);
      continue;
    }
    const missing = required.filter((name) => !(name in envExisting) || envExisting[name] === "");
    if (missing.length === 0) {
      lines.push(`${chalk.green("✓")} ${id} — ${required.join(", ")}`);
    } else {
      lines.push(`${chalk.yellow("!")} ${id} — missing: ${missing.join(", ")}`);
      missingTotal += missing.length;
    }
  }

  lines.push("");
  lines.push(label(".env.mcp", hasEnvFile ? "present" : chalk.yellow("missing")));
  if (missingTotal > 0) {
    lines.push(label("Action", `Fill ${missingTotal} env var(s) in .env.mcp, then \`${getSourceEnvMcpCommand()}\``));
  }

  printBox("MCP env check", lines, missingTotal > 0 ? "info" : "success");
}
