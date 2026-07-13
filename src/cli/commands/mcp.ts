import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { readManifest, writeManifest } from "../../manifest/hatchJson.js";
import { acquireWriteLock, sweepOrphanTmpFiles, formatOrphanTmpSweepDiagnostic } from "../../merge/safeWrite.js";
import {
  AVAILABLE_MCP_SERVERS,
  DEFAULT_FEATURES,
  HATCH3R_DIR,
  HatchError,
  MANIFEST_FILE,
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
import { type CliOutputFormat } from "../shared/output.js";
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
 * D1-SA1.2-10 (Cycle 12, D1, P1): which supply channel satisfies a required MCP
 * env var. The runtime contract is two-channel — adapters emit `${env:VAR}`
 * references the editor resolves from ITS process environment, and `.env.mcp` is
 * only one way to populate that environment (the file's own disclaimer documents
 * shell-sourcing + launchctl, see mcpEnv.ts). `mcp list` / `mcp env-check`
 * previously parsed `.env.mcp` alone, so an operator who exports a token in their
 * shell profile — a standard secrets posture that keeps tokens out of on-disk
 * files — got a false "missing" verdict. Consulting `process.env` as the second
 * channel closes that. Runtime `process.env` is a proxy for the editor's env
 * (GUI-launched editors from Finder/Dock/Spotlight may not inherit it), so a
 * shell-sourced var is LABELLED "shell env" rather than asserted editor-visible.
 * The var names read here come from `AVAILABLE_MCP_SERVERS[*].requiresEnv`
 * (developer-controlled), not user input.
 */
type EnvVarSource = "file" | "shell" | "missing";

function resolveEnvVarSource(
  name: string,
  fileEnv: Record<string, string>,
): EnvVarSource {
  if (name in fileEnv && fileEnv[name] !== "") return "file";
  const fromProcess = process.env[name];
  if (fromProcess !== undefined && fromProcess !== "") return "shell";
  return "missing";
}

/** Caveat appended to a "From shell env" label so the GUI-inherit note travels with it. */
const SHELL_ENV_CAVEAT = "(GUI-launched editors may not inherit — see .env.mcp)";

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

/**
 * D1-SA1.2-05 (Cycle 12, D1, P2): run `fn` while holding the cross-process
 * manifest write lock, mirroring config's F1.2-H1 full-window lock. Both mutating
 * mcp subcommands (setup, remove) read-modify-write the same `.hatch3r/hatch.json`;
 * without an outer lock a concurrent config/sync/workspace-sync completing between
 * an mcp command's read and its write is clobbered by mcp's stale in-memory
 * manifest — and `mcp setup`'s window additionally spans an UNBOUNDED interactive
 * picker wait. Holding the lock across the whole critical section (fn runs every
 * early return inside it) closes that race. Reentrant via HELD_LOCKS: the inner
 * writeManifest -> atomicWriteFile acquire on the same path re-uses this lock
 * instead of self-deadlocking. A no-op unless HATCH3R_LOCK is set or a
 * workspace/worktree context enabled the default (D8-M3), so single-repo runs are
 * unchanged. Release failures are surfaced per the Silent Failure Contract (P5),
 * never swallowed. Local helper rather than the shared `withManifestMutation` the
 * finding suggests long-term — safeWrite.ts / hatchJson.ts are outside scope here.
 */
async function withManifestLock(
  rootDir: string,
  fn: () => Promise<void>,
): Promise<void> {
  const manifestPath = join(rootDir, HATCH3R_DIR, MANIFEST_FILE);
  const releaseManifestLock = await acquireWriteLock(manifestPath);
  try {
    await fn();
  } finally {
    try {
      await releaseManifestLock();
    } catch (releaseErr) {
      // The release is a no-op when locking was inactive, so reaching this catch
      // implies a real lock was taken — surface it so operators can clear a stale
      // lockfile rather than have the failure vanish.
      console.error(
        `hatch3r: failed to release manifest write lock at ${manifestPath}: ` +
          `${releaseErr instanceof Error ? releaseErr.message : String(releaseErr)}`,
      );
    }
  }
}

export async function mcpSetupCommand(opts: McpMutateOptions = {}): Promise<void> {
  // W5: setup ALWAYS opens the interactive picker (no --yes escape hatch), so
  // `--format json` is rejected here by beginCommand's interactive gate. This
  // gate runs BEFORE the lock so a rejected --format json never takes a lock.
  const format = beginCommand(opts, { banner: "compact", interactive: true });
  const rootDir = process.cwd();
  await withManifestLock(rootDir, () => mcpSetupCommandImpl(rootDir, format, opts));
}

/**
 * Body of {@link mcpSetupCommand}, lifted into a helper so {@link withManifestLock}
 * holds the manifest lock across the full critical section — the interactive
 * picker plus every early `return` — without duplicating the release per exit.
 * Mirrors the `configCommand` / `configCommandImpl` split.
 */
async function mcpSetupCommandImpl(
  rootDir: string,
  format: CliOutputFormat,
  opts: McpMutateOptions,
): Promise<void> {
  // The orphan-tmp sweep unlinks files; skip it under --dry-run (no writes).
  if (opts.dryRun !== true) await sweepOrphanTmpAtEntry(rootDir);
  const manifest = await readManifest(rootDir);
  assertManifest(manifest);

  // D1-SA1.2-07 (Cycle 12, D1, P1): non-TTY preflight, mirroring config's D1-18
  // gate. `mcp setup` always opens the inquirer checkbox picker below (even
  // under --dry-run, which previews the would-be selection). Under a pipe,
  // redirect, or CI runner stdin is not a TTY, so inquirer renders the checkbox
  // into the stream and the stdin EOF aborts it — the error funnel then
  // misclassifies that abort as a clean user cancel and exits 130 with no
  // actionable output (errors.ts). Fail fast with an exit-2 usage error instead.
  // Placed after assertManifest so a missing manifest still reports CONFIG_ERROR
  // first (config's precedence). A per-command gate rather than a beginCommand
  // hoist — the shared-path hoist would change every interactive command's
  // behavior and is out of this finding's file scope.
  if (!process.stdin.isTTY) {
    throw new HatchError(
      "`hatch3r mcp setup` requires a TTY — stdin is not interactive (piped, redirected, or CI).",
      2,
      "VALIDATION_ERROR",
      "mcp setup opens an interactive picker and has no headless mode. Run it from a terminal, or set `mcp.servers` in `.hatch3r/hatch.json` directly and run `hatch3r sync`.",
    );
  }

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

  // D1-SA1.2-04 (Cycle 12, D1, P2): SPREAD manifest.mcp rather than replacing the
  // whole object, so operator-set optional McpConfig fields (e.g. protocolVersion,
  // the documented control for staging the MCP 2026-07-28 RC — types.ts McpConfig)
  // survive the write. The prior `{ servers: selected }` whole-object replacement
  // silently dropped every non-servers field on each setup, reverting an explicit
  // operator pin (round-trip field loss / Silent Failure Contract).
  manifest.mcp = { ...manifest.mcp, servers: selected };
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
  // D1-SA1.2-10: classify each required var by supply channel (file / shell env /
  // missing) so a shell-exported token is not reported as missing.
  const requiredSources = requiredVars.map((v) => ({
    name: v.name,
    source: resolveEnvVarSource(v.name, envExisting),
  }));
  const missingVars = requiredSources.filter((r) => r.source === "missing").map((r) => r.name);
  const shellEnvVars = requiredSources.filter((r) => r.source === "shell").map((r) => r.name);

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
      if (shellEnvVars.length > 0) {
        lines.push(
          label("From shell env", `${chalk.cyan(shellEnvVars.join(", "))} ${chalk.dim(SHELL_ENV_CAVEAT)}`),
        );
      }
      if (missingVars.length > 0) {
        lines.push(label("Missing", chalk.yellow(missingVars.join(", "))));
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
      missingVars,
      shellEnvVars,
    },
  });
}

export async function mcpRemoveCommand(id: string, opts: McpMutateOptions = {}): Promise<void> {
  // W5: `mcp remove <id>` is headless (the id arrives as an argument; nothing
  // prompts), so `--format json` is valid without --yes.
  const format = beginCommand(opts, { banner: "compact" });
  const rootDir = process.cwd();
  // D1-SA1.2-05: same F1.2-H1 full-window manifest lock as mcp setup — mcp remove
  // read-modify-writes the same hatch.json, so a concurrent writer completing
  // between its read and write is otherwise clobbered by the stale in-memory
  // manifest. See {@link withManifestLock} for the full rationale.
  await withManifestLock(rootDir, () => mcpRemoveCommandImpl(id, rootDir, format, opts));
}

/**
 * Body of {@link mcpRemoveCommand}, lifted so {@link withManifestLock} holds the
 * manifest lock across the read-modify-write and both early returns (the
 * not-configured throw and the --dry-run report) in one place.
 */
async function mcpRemoveCommandImpl(
  id: string,
  rootDir: string,
  format: CliOutputFormat,
  opts: McpMutateOptions,
): Promise<void> {
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
      // D1-SA1.2-09 (Cycle 12, D1, P1): `mcp setup` is the real add path — there is
      // no `mcp add` subcommand (registered set: setup/list/remove/env-check in
      // program.ts), so the prior `mcp add <id>` hint dead-ended at commander's
      // unknown-command usage error (exit 2).
      "Run `npx hatch3r mcp list` to see configured servers, or `npx hatch3r mcp setup` to add one.",
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

  // D1-SA1.2-04 (Cycle 12, D1, P2): SPREAD manifest.mcp so operator-set optional
  // McpConfig fields (protocolVersion, …) survive a removal write; the prior
  // whole-object `{ servers: … }` replacement dropped them. See the mcp setup
  // write site for the full rationale.
  manifest.mcp = { ...manifest.mcp, servers: before.filter((s) => s !== id) };
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
  const shellEnvSatisfied = new Set<string>();
  const serverReports: Array<{ id: string; required: string[]; missing: string[]; fromShellEnv: string[] }> = [];
  for (const id of servers) {
    const meta = AVAILABLE_MCP_SERVERS[id];
    const required = meta?.requiresEnv ?? [];
    if (required.length === 0) {
      lines.push(`${chalk.green("✓")} ${id} — no env vars required`);
      serverReports.push({ id, required: [], missing: [], fromShellEnv: [] });
      continue;
    }
    // D1-SA1.2-10: a var set in the live process env (e.g. exported in the
    // operator's shell profile) counts as satisfied — the editor resolves
    // `${env:VAR}` from its process environment, of which `.env.mcp` is only one
    // supply channel — so it is not reported missing, but labelled "shell env".
    const missing: string[] = [];
    const fromShellEnv: string[] = [];
    for (const name of required) {
      const source = resolveEnvVarSource(name, envExisting);
      if (source === "missing") {
        missing.push(name);
      } else if (source === "shell") {
        fromShellEnv.push(name);
        shellEnvSatisfied.add(name);
      }
    }
    serverReports.push({ id, required, missing, fromShellEnv });
    if (missing.length === 0) {
      lines.push(`${chalk.green("✓")} ${id} — ${required.join(", ")}`);
    } else {
      lines.push(`${chalk.yellow("!")} ${id} — missing: ${missing.join(", ")}`);
      missingTotal += missing.length;
    }
  }

  lines.push("");
  lines.push(label(".env.mcp", hasEnvFile ? "present" : chalk.yellow("missing")));
  if (shellEnvSatisfied.size > 0) {
    lines.push(
      label("From shell env", `${chalk.cyan([...shellEnvSatisfied].join(", "))} ${chalk.dim(SHELL_ENV_CAVEAT)}`),
    );
  }
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
