#!/usr/bin/env node
/**
 * scripts/clean-audit-workspace.ts
 *
 * CLI wrapper around `src/audit/cleanup.ts::checkWorkspace` and
 * `cleanWorkspace`. Code-enforces the workspace cleanup contract that
 * lives in `governance/AUDIT.md:108` today as a prompt instruction.
 *
 * Pillars: P5 (Governance Self-Quality), P4 (Lean Coverage).
 *
 * Mode matrix:
 *   (default) --check      Print report. Exit 0 if 0 stale + 0 fresh-non-preserved.
 *                          Exit 1 if any stale.
 *   --strict               Same as --check but exit 1 even if only fresh-non-preserved exist.
 *   --auto                 Remove stale; print summary; exit 0.
 *   --auto --strict        Remove stale + fresh-non-preserved; exit 0.
 *   --auto --dry-run       Print what would be removed; exit 0.
 *
 * Usage:
 *   npm run audit:reset                       # check (exit 1 on stale)
 *   npm run audit:reset -- --strict           # exit 1 on any non-preserved
 *   npm run audit:reset -- --auto             # remove stale, exit 0
 *   npm run audit:reset -- --auto --strict    # remove all non-preserved, exit 0
 *   npm run audit:reset -- --auto --dry-run   # preview removal plan
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkWorkspace,
  cleanWorkspace,
  CleanupError,
  readBaselineCommitTime,
  type CleanupReport,
} from "../src/audit/cleanup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

const PATHS = {
  workspaceDir: resolve(ROOT, ".audit-workspace"),
  baseline: resolve(ROOT, "governance/audit/baseline.json"),
};

interface CliFlags {
  auto: boolean;
  strict: boolean;
  dryRun: boolean;
}

function parseFlags(argv: ReadonlyArray<string>): CliFlags {
  let auto = false;
  let strict = false;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--auto") auto = true;
    else if (arg === "--strict") strict = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--check") {
      // explicit form of the default; tolerated as a no-op flag
    }
  }
  return { auto, strict, dryRun };
}

function emit(line: string): void {
  // eslint-disable-next-line no-console
  console.log(line);
}

function emitError(line: string): void {
  // eslint-disable-next-line no-console
  console.error(line);
}

function formatReport(report: CleanupReport, cutoffSource: string): string {
  const cutoffIso = new Date(report.cutoffMs).toISOString();
  return [
    `audit:reset: workspace report`,
    `  staleness cutoff: ${cutoffIso}  (${cutoffSource})`,
    `  scanned non-preserved: ${report.scanned}`,
    `  preserved (root): ${report.preserved.length}` +
      (report.preserved.length > 0 ? ` — ${report.preserved.join(", ")}` : ""),
    `  stale: ${report.stale.length}` +
      (report.stale.length > 0 ? `\n    - ${report.stale.join("\n    - ")}` : ""),
    `  fresh (non-preserved): ${report.fresh.length}` +
      (report.fresh.length > 0 ? `\n    - ${report.fresh.join("\n    - ")}` : ""),
  ].join("\n");
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));

  const baselineMs = await readBaselineCommitTime(PATHS.baseline);
  const cutoffSource =
    baselineMs === null
      ? "fallback: 7 days ago (baseline.json missing or unparseable)"
      : `from ${PATHS.baseline}`;

  if (flags.auto) {
    let result: { report: CleanupReport; removed: string[] };
    try {
      result = await cleanWorkspace({
        workspaceDir: PATHS.workspaceDir,
        baselineCommitTime: baselineMs ?? undefined,
        strict: flags.strict,
        dryRun: flags.dryRun,
      });
    } catch (err) {
      if (err instanceof CleanupError) {
        emitError(`audit:reset: ${err.message}`);
      } else {
        emitError(`audit:reset: unexpected error: ${(err as Error).message}`);
      }
      process.exit(1);
      return;
    }

    emit(formatReport(result.report, cutoffSource));
    if (flags.dryRun) {
      const targets = flags.strict
        ? [...result.report.stale, ...result.report.fresh]
        : result.report.stale;
      emit("");
      if (targets.length === 0) {
        emit("audit:reset: dry-run — nothing to remove");
      } else {
        emit(`audit:reset: dry-run — would remove ${targets.length} entries:`);
        for (const t of targets) emit(`  - ${t}`);
      }
    } else {
      emit("");
      if (result.removed.length === 0) {
        emit("audit:reset: applied — nothing to remove");
      } else {
        emit(
          `audit:reset: applied — removed ${result.removed.length} entries${flags.strict ? " (strict: stale + fresh)" : " (stale only)"}`,
        );
        for (const r of result.removed) emit(`  - ${r}`);
      }
    }
    process.exit(0);
    return;
  }

  // Check mode (default).
  let report: CleanupReport;
  try {
    report = await checkWorkspace({
      workspaceDir: PATHS.workspaceDir,
      baselineCommitTime: baselineMs ?? undefined,
    });
  } catch (err) {
    emitError(`audit:reset: ${(err as Error).message}`);
    process.exit(1);
    return;
  }

  emit(formatReport(report, cutoffSource));
  emit("");
  const hasStale = report.stale.length > 0;
  const hasFresh = report.fresh.length > 0;
  if (hasStale) {
    emit(
      `audit:reset: ${report.stale.length} stale entries detected. Run \`npm run audit:reset -- --auto\` to remove.`,
    );
    process.exit(1);
    return;
  }
  if (flags.strict && hasFresh) {
    emit(
      `audit:reset: --strict — ${report.fresh.length} non-preserved entries present (no stale, but strict mode fails on any).`,
    );
    process.exit(1);
    return;
  }
  emit("audit:reset: workspace clean");
  process.exit(0);
}

main().catch((err: unknown) => {
  emitError(`audit:reset failed: ${(err as Error).message}`);
  process.exit(1);
});
