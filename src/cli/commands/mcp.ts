import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { readManifest, writeManifest } from "../../manifest/hatchJson.js";
import { sweepOrphanTmpFiles, formatOrphanTmpSweepDiagnostic } from "../../merge/safeWrite.js";
import {
  AVAILABLE_MCP_SERVERS,
  DEFAULT_FEATURES,
  HatchError,
} from "../../types.js";
// D8-SA8.1-F8.1.8 (Cycle 10 Wave 4, P1): shared missing-manifest preflight,
// replacing the per-command copy that previously lived in this file.
import { assertManifest } from "../shared/requireManifest.js";
import {
  ensureEnvMcp,
  ensureGitignoreEntry,
  getSourceEnvMcpCommand,
  parseEnvFile,
  collectRequiredEnvVars,
} from "../../env/mcpEnv.js";
import {
  info,
  warn,
  verbose,
  error as logError,
  isQuiet,
  label,
} from "../shared/ui.js";
import { beginCommand, finishCommand } from "../shared/commandOutput.js";
import { pickMcpServers } from "../shared/pickers.js";
import { isBack } from "../shared/initSteps.js";
import { isWSL } from "../shared/constants.js";

/** W5: standardized flags for the read-only mcp subcommands. */
export interface McpCommandOptions {
  /** `--format <human|json>`; json emits one envelope document on stdout. */
  format?: string;
  /** `--quiet`: suppress stdout chrome (banner, boxes); stderr still emits. */
  quiet?: boolean;
}

/** W5: flags for the mutating mcp subcommands (setup / remove). */
export interface McpMutateOptions extends McpCommandOptions {
  /** `--dry-run`: print the resulting server list + features.mcp without writing. */
  dryRun?: boolean;
}

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

function wslThemeOrUndefined(): unknown {
  return isWSL()
    ? { icon: { checked: chalk.green("[x]"), unchecked: "[ ]", cursor: ">" } }
    : undefined;
}

/**
 * D1-SA1.5-F10 (Cycle 10 Wave 4, D1, P6): sweep orphan `.tmp.<8-hex>` files
 * left under the project root by a prior SIGKILL'd run before a mutating MCP
 * subcommand writes. `mcp setup` / `mcp remove` persist via `writeManifest`
 * → `atomicWriteFile` (temp+rename), so an interrupted write can strand a
 * `hatch.json.tmp.<hex>` orphan. Best-effort: only removes files older than
 * the 60s in-flight-write floor ({@link ORPHAN_MIN_AGE_MS}), surfaces removals
 * + unlink failures via `warn()` per the Silent Failure Contract (P5), never
 * aborts the command. Mirrors the `update`/`sync`/`init`/`config` sweep.
 */
async function sweepOrphanTmpAtEntry(rootDir: string): Promise<void> {
  try {
    const sweptTmp = await sweepOrphanTmpFiles(rootDir, { recursive: true });
    const tmpDiag = formatOrphanTmpSweepDiagnostic(sweptTmp);
    if (tmpDiag) warn(tmpDiag);
  } catch (err) {
    verbose(`mcp: orphan-tmp sweep skipped — ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function mcpSetupCommand(opts: McpMutateOptions = {}): Promise<void> {
  // W5: setup ALWAYS opens the interactive picker (no --yes escape hatch), so
  // `--format json` is rejected here by beginCommand's interactive gate.
  const format = beginCommand(opts, { banner: "compact", interactive: true });
  const rootDir = process.cwd();
  // The orphan-tmp sweep unlinks files; skip it under --dry-run (no writes).
  if (opts.dryRun !== true) await sweepOrphanTmpAtEntry(rootDir);
  const manifest = await readManifest(rootDir);
  assertManifest(manifest);

  const platform = manifest.platform ?? "github";
  const selectedResult = await pickMcpServers({
    platform,
    existing: manifest.mcp.servers,
    wslTheme: wslThemeOrUndefined(),
  });
  if (isBack(selectedResult)) {
    info("MCP setup cancelled (Shift+Tab).");
    return;
  }
  const selected = selectedResult;

  // W5 --dry-run: report the resulting server list + derived features.mcp
  // without writing the manifest or .env.mcp.
  if (opts.dryRun === true) {
    finishCommand(format, {
      command: "mcp setup",
      title: "MCP setup (dry-run)",
      lines: [
        label("Servers", selected.length > 0 ? selected.join(", ") : "none"),
        label("features.mcp", String(selected.length > 0)),
        label("Manifest", ".hatch3r/hatch.json (not written)"),
      ],
      style: "info",
      json: { dryRun: true, servers: selected, featuresMcp: selected.length > 0 },
    });
    return;
  }

  manifest.mcp = { servers: selected };
  // W3-mcp-optin: keep the feature flag in lockstep with the server list.
  // sync/update/validate/adapters all gate MCP emission on
  // `features.mcp && mcp.servers.length > 0`, and DEFAULT_FEATURES.mcp is
  // false (opt-in) — without this flip, `mcp setup` would configure servers
  // the rest of the pipeline silently ignores. The DEFAULT_FEATURES spread
  // backfills a legacy manifest whose `features` object is absent.
  manifest.features = { ...DEFAULT_FEATURES, ...manifest.features, mcp: selected.length > 0 };
  await writeManifest(rootDir, manifest);

  // D10-M7 (Cycle 10): the `Add new secrets` warn() previously fired BEFORE
  // the `MCP configured` success box, so users scanning the box bottom-up
  // missed the credentials-action callout entirely (the visual hierarchy of
  // boxen drew the eye to the green border first). Collect the advisory
  // strings here and append them as bold rows inside the box so the
  // success message and the next-step action sit in the same visual frame.
  const envAdvisoryLines: string[] = [];
  if (selected.length > 0) {
    const envResult = await ensureEnvMcp(rootDir, selected);
    await ensureGitignoreEntry(rootDir);
    if (envResult.newVars.length > 0) {
      envAdvisoryLines.push("");
      envAdvisoryLines.push(`${chalk.yellow("!")} Add new secrets to ${chalk.bold(".env.mcp")}: ${envResult.newVars.join(", ")}`);
      envAdvisoryLines.push(`  Then run: ${chalk.dim(getSourceEnvMcpCommand())}`);
    }
  }

  finishCommand(format, {
    command: "mcp setup",
    title: "MCP configured",
    lines: [
      label("Servers", selected.length > 0 ? selected.join(", ") : "none"),
      label("Manifest", ".hatch3r/hatch.json"),
      label("Next", "Run `npx hatch3r sync` to regenerate adapter MCP configs"),
      ...envAdvisoryLines,
    ],
    style: "success",
    nextSteps: ["Fill in `.env.mcp`, then restart your editor so the servers load."],
    json: { servers: selected, featuresMcp: selected.length > 0 },
  });
}

export async function mcpListCommand(opts: McpCommandOptions = {}): Promise<void> {
  const format = beginCommand(opts, { banner: "compact" });
  const rootDir = process.cwd();
  const manifest = await readManifest(rootDir);
  assertManifest(manifest);

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

  finishCommand(format, {
    command: "mcp list",
    title: "MCP servers",
    lines,
    style: "info",
    json: {
      servers,
      envFilePresent: hasEnvFile,
      requiredVars: requiredVars.map((v) => v.name),
      missingVars: missingVars.map((v) => v.name),
    },
  });
}

export async function mcpRemoveCommand(id: string, opts: McpMutateOptions = {}): Promise<void> {
  // W5: `mcp remove <id>` is headless (the id arrives as an argument; nothing
  // prompts), so `--format json` is valid without --yes.
  const format = beginCommand(opts, { banner: "compact" });
  const rootDir = process.cwd();
  // The orphan-tmp sweep unlinks files; skip it under --dry-run (no writes).
  if (opts.dryRun !== true) await sweepOrphanTmpAtEntry(rootDir);
  const manifest = await readManifest(rootDir);
  assertManifest(manifest);

  const before = manifest.mcp.servers;
  if (!before.includes(id)) {
    logError(`MCP server "${id}" is not configured.`);
    if (!isQuiet()) {
      console.log(chalk.dim(`  Current servers: ${before.length > 0 ? before.join(", ") : "(none)"}\n`));
    }
    throw new HatchError(
      `MCP server "${id}" not configured`,
      undefined,
      "VALIDATION_ERROR",
      "Run `npx hatch3r mcp list` to see configured servers, or `npx hatch3r mcp add <id>` to add one.",
    );
  }

  // W5 --dry-run: report the post-removal state without writing the manifest.
  if (opts.dryRun === true) {
    const remaining = before.filter((s) => s !== id);
    finishCommand(format, {
      command: "mcp remove",
      title: "MCP remove (dry-run)",
      lines: [
        label("Would remove", id),
        label("Remaining", remaining.length > 0 ? remaining.join(", ") : "none"),
        label("features.mcp", String(remaining.length > 0)),
      ],
      style: "info",
      json: { dryRun: true, removed: id, remaining, featuresMcp: remaining.length > 0 },
    });
    return;
  }

  manifest.mcp = { servers: before.filter((s) => s !== id) };
  // W3-mcp-optin: recompute the feature flag from the remaining server list —
  // removing the last server turns MCP off so sync/update/validate/adapters
  // (which gate on `features.mcp && mcp.servers.length > 0`) stay consistent.
  manifest.features = {
    ...DEFAULT_FEATURES,
    ...manifest.features,
    mcp: manifest.mcp.servers.length > 0,
  };
  await writeManifest(rootDir, manifest);

  finishCommand(format, {
    command: "mcp remove",
    title: "MCP server removed",
    lines: [
      label("Removed", id),
      label("Remaining", manifest.mcp.servers.length > 0 ? manifest.mcp.servers.join(", ") : "none"),
      label("Next", "Run `npx hatch3r sync` to regenerate adapter MCP configs"),
    ],
    style: "success",
    nextSteps: ["Run `hatch3r sync` to regenerate tool configs without the removed server."],
    json: {
      removed: id,
      remaining: manifest.mcp.servers,
      featuresMcp: manifest.mcp.servers.length > 0,
    },
  });
}

export async function mcpEnvCheckCommand(opts: McpCommandOptions = {}): Promise<void> {
  const format = beginCommand(opts, { banner: "compact" });
  const rootDir = process.cwd();
  const manifest = await readManifest(rootDir);
  assertManifest(manifest);

  const servers = manifest.mcp.servers;
  const envPath = join(rootDir, ".env.mcp");
  const hasEnvFile = existsSync(envPath);
  const envExisting = hasEnvFile ? parseEnvFile(await readFile(envPath, "utf-8")) : {};

  const lines: string[] = [];
  if (servers.length === 0) {
    lines.push("(no MCP servers configured — nothing to check)");
    finishCommand(format, {
      command: "mcp env-check",
      title: "MCP env check",
      lines,
      style: "info",
      json: { servers: [], envFilePresent: hasEnvFile, missingTotal: 0 },
    });
    return;
  }

  let missingTotal = 0;
  const serverReports: Array<{ id: string; required: string[]; missing: string[] }> = [];
  for (const id of servers) {
    const meta = AVAILABLE_MCP_SERVERS[id];
    const required = meta?.requiresEnv ?? [];
    if (required.length === 0) {
      lines.push(`${chalk.green("✓")} ${id} — no env vars required`);
      serverReports.push({ id, required: [], missing: [] });
      continue;
    }
    const missing = required.filter((name) => !(name in envExisting) || envExisting[name] === "");
    serverReports.push({ id, required, missing });
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

  finishCommand(format, {
    command: "mcp env-check",
    title: "MCP env check",
    lines,
    style: missingTotal > 0 ? "info" : "success",
    json: { servers: serverReports, envFilePresent: hasEnvFile, missingTotal },
  });
}
