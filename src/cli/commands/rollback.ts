/**
 * `hatch3r rollback` — revert files mutated during a recorded session.
 *
 * Decision 27 / hatch3r 2.0.0 / Bucket 2.2: companion to
 * `src/pipeline/snapshot.ts`. The CLI surface exposes two subcommands:
 *
 *   - `hatch3r rollback list`              — enumerate available sessions
 *   - `hatch3r rollback --session=<id>`    — restore files captured for <id>
 *
 * **Confirmation gate (P1):** mutating rollbacks prompt for explicit
 * confirmation unless `--yes` is passed. The prompt lists the session
 * id, timestamp, and file count so the operator has full context.
 *
 * **Dry-run (P1):** `--dry-run` exercises the rollback machinery
 * (reads + permission checks) without writing.
 *
 * **Pillar service:** P1 (confirmation + dry-run + actionable output),
 * P2 (atomic restores via `applyRollback`), P6 (no network egress, no
 * external dependencies).
 */

import chalk from "chalk";
import inquirer from "inquirer";
import {
  applyRollback,
  listSnapshots,
  type SnapshotMeta,
} from "../../pipeline/snapshot.js";
import { HatchError } from "../../types.js";
import { sweepOrphanTmpFiles, formatOrphanTmpSweepDiagnostic } from "../../merge/safeWrite.js";
import {
  createSpinner,
  error as logError,
  info,
  printBanner,
  printBox,
  warn,
  verbose,
} from "../shared/ui.js";

// ── Options ──────────────────────────────────────────────────────

/**
 * Shape of the options accepted by {@link rollbackCommand}. The
 * commander wiring in `src/cli/program.ts` maps `--session`, `--yes`,
 * and `--dry-run` flags onto these fields.
 */
export interface RollbackOptions {
  /** Session id to restore. Required for the default subcommand. */
  session?: string;
  /** Skip the interactive confirmation prompt. */
  yes?: boolean;
  /** Preview the rollback without writing. */
  dryRun?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Format a {@link SnapshotMeta} record for the `list` subcommand. Each
 * line is a single row: session id, ISO timestamp, file count. The
 * leading bullet keeps the layout readable when many sessions exist.
 */
function formatSnapshotRow(meta: SnapshotMeta): string {
  const ts = meta.timestamp.replace("T", " ").replace(/\.[0-9]+Z$/, "Z");
  const count = `${meta.paths.length} file${meta.paths.length === 1 ? "" : "s"}`;
  return `  ${chalk.cyan("•")} ${chalk.bold(meta.sessionId)}  ${chalk.dim(ts)}  ${chalk.dim(count)}`;
}

/**
 * Prompt the operator to confirm an irreversible rollback. Returns
 * `true` on confirmation, `false` on decline. The default is `false`
 * so an accidental Enter keypress cancels rather than restores.
 */
async function confirmRollback(meta: SnapshotMeta): Promise<boolean> {
  const { confirmed } = (await inquirer.prompt<{ confirmed: boolean }>([
    {
      type: "confirm",
      name: "confirmed",
      message:
        `Restore ${meta.paths.length} file(s) from session ${chalk.bold(meta.sessionId)} ` +
        `(captured ${meta.timestamp})? This overwrites the current on-disk state.`,
      default: false,
    },
  ])) as { confirmed: boolean };
  return confirmed;
}

// ── Public commands ──────────────────────────────────────────────

/**
 * Default `hatch3r rollback` entry point. Reads the session id from
 * `opts.session`, confirms with the operator (unless `--yes`), and
 * applies the rollback via `applyRollback`.
 *
 * Throws `HatchError` with a usage exit code (2) when `--session` is
 * missing and an integrity exit code (1) when the restore reports
 * errors. Successful runs return without throwing.
 */
export async function rollbackCommand(opts: RollbackOptions = {}): Promise<void> {
  printBanner(true);

  if (!opts.session || typeof opts.session !== "string" || opts.session.length === 0) {
    logError("`hatch3r rollback` requires --session=<id>");
    info("Run `hatch3r rollback list` to see available sessions.");
    throw new HatchError(
      "--session=<id> is required",
      2,
      "VALIDATION_ERROR",
      "Run `hatch3r rollback list` to see available sessions.",
    );
  }

  const snapshots = await listSnapshots();
  const meta = snapshots.find((s) => s.sessionId === opts.session);
  if (!meta) {
    logError(`Session ${chalk.bold(opts.session)} not found.`);
    info("Run `hatch3r rollback list` to see available sessions.");
    throw new HatchError(
      `Session ${opts.session} not found.`,
      undefined,
      "CONFIG_ERROR",
      "Run `hatch3r rollback list` to see available sessions.",
    );
  }

  if (!opts.yes && !opts.dryRun) {
    const ok = await confirmRollback(meta);
    if (!ok) {
      info("Rollback cancelled.");
      return;
    }
  }

  // D1-SA1.5-F10 (Cycle 10 Wave 4, D1, P6): sweep orphan `.tmp.<8-hex>` files
  // under the project root before the restore writes begin. `applyRollback`
  // restores each captured file via `atomicWriteFile` (temp+rename), so an
  // interrupted rollback can strand `<target>.tmp.<hex>` orphans that no
  // entry-point sweep would otherwise reclaim. Best-effort: only removes files
  // older than the 60s in-flight-write floor ({@link ORPHAN_MIN_AGE_MS}),
  // surfaces removals + unlink failures via `warn()` per the Silent Failure
  // Contract (P5), never aborts the rollback. Skipped under --dry-run (which
  // promises no writes). Mirrors the `update`/`sync`/`init`/`config`/`mcp`/
  // `cli-tools` entry-point sweep.
  if (!opts.dryRun) {
    try {
      const sweptTmp = await sweepOrphanTmpFiles(process.cwd(), { recursive: true });
      const tmpDiag = formatOrphanTmpSweepDiagnostic(sweptTmp);
      if (tmpDiag) warn(tmpDiag);
    } catch (err) {
      verbose(`rollback: orphan-tmp sweep skipped — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const spinner = createSpinner(
    opts.dryRun
      ? `Previewing rollback for session ${meta.sessionId}...`
      : `Restoring ${meta.paths.length} file(s) from session ${meta.sessionId}...`,
  );
  spinner.start();
  const result = await applyRollback(meta.sessionId, { dryRun: opts.dryRun });
  spinner.stop();

  const summaryLines = [
    `${chalk.green("✔")} Files restored: ${result.filesRestored} / ${meta.paths.length}`,
  ];
  if (result.errors.length > 0) {
    summaryLines.push(`${chalk.red("✘")} Errors:         ${result.errors.length}`);
  }
  const tag = opts.dryRun ? "rollback (dry-run)" : "rollback";
  if (result.errors.length === 0) {
    printBox(`${tag}: PASS`, summaryLines, "success");
    return;
  }
  printBox(`${tag}: FAIL`, summaryLines, "error");
  for (const err of result.errors) {
    warn(err);
  }
  console.log();
  throw new HatchError(
    `Rollback completed with ${result.errors.length} error(s)`,
    undefined,
    "FS_ERROR",
    "Inspect the messages above; re-run with --dry-run to preview.",
  );
}

/**
 * `hatch3r rollback list` — enumerate snapshot sessions captured under
 * `.hatch3r/snapshots/`. Prints one row per session sorted by timestamp
 * descending (newest first). When no sessions exist, prints a friendly
 * hint pointing at the orchestrator commands that create snapshots.
 */
export async function rollbackListCommand(): Promise<void> {
  printBanner(true);
  const snapshots = await listSnapshots();
  if (snapshots.length === 0) {
    info("No snapshot sessions found under .hatch3r/snapshots/.");
    info("Snapshots are captured by long-running orchestrators (init, sync, audit).");
    return;
  }
  console.log(chalk.bold(`Snapshot sessions (${snapshots.length}):`));
  for (const meta of snapshots) {
    console.log(formatSnapshotRow(meta));
  }
  console.log();
  info(`Run ${chalk.cyan("hatch3r rollback --session=<id>")} to restore a session.`);
}
