#!/usr/bin/env node
/**
 * scripts/clean-audit-workspace.ts
 *
 * CLI wrapper around `src/audit/cleanup.ts::checkWorkspace` and
 * `cleanWorkspace`. Code-enforces the workspace cleanup contract that
 * lives in `governance/AUDIT.md:108` today as a prompt instruction.
 *
 * Also performs coverage/ provenance hygiene (D3-SA3.5-05): a collided
 * concurrent --coverage run leaves a PARTIAL coverage-summary.json /
 * coverage-final.json / .tmp that misrepresents repo coverage to any tool that
 * reads coverage/ without checking provenance. --auto removes those stale
 * summary artifacts; --check reports them. Honors HATCH3R_COVERAGE_DIR (the same
 * override vitest.config.ts reads).
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
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
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

// D3-SA3.5-05 (Cycle 12): coverage/ provenance hygiene. A collision between a
// full-suite --coverage run and a concurrent scoped run — both sharing the
// default coverage/ tree — leaves a PARTIAL coverage-summary.json /
// coverage-final.json (and a half-written .tmp) on disk that misrepresents repo
// coverage to any tool or agent that reads coverage/ without checking
// provenance. Remove those stale summary artifacts at audit reset so a fresh
// cycle never reads a leftover partial one. coverage/ is .gitignore'd and
// regenerated per run, so removal is safe. Honors the same HATCH3R_COVERAGE_DIR
// override vitest.config.ts reads (a relative value resolves against the repo
// root).
const COVERAGE_SUMMARY_ARTIFACTS = [
  "coverage-summary.json",
  "coverage-final.json",
  ".tmp",
] as const;

function coverageDirPath(): string {
  const override = process.env.HATCH3R_COVERAGE_DIR;
  return override ? resolve(ROOT, override) : resolve(ROOT, "coverage");
}

async function cleanStaleCoverageArtifacts(opts: {
  dryRun: boolean;
}): Promise<string[]> {
  const dir = coverageDirPath();
  const removed: string[] = [];
  for (const name of COVERAGE_SUMMARY_ARTIFACTS) {
    const target = join(dir, name);
    if (!existsSync(target)) continue;
    if (!opts.dryRun) {
      await rm(target, { recursive: true, force: true });
    }
    removed.push(relative(ROOT, target));
  }
  return removed;
}

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

    const coverageRemoved = await cleanStaleCoverageArtifacts({
      dryRun: flags.dryRun,
    });
    emit("");
    if (coverageRemoved.length === 0) {
      emit("audit:reset: coverage hygiene — no stale summary artifacts");
    } else {
      emit(
        `audit:reset: coverage hygiene — ${flags.dryRun ? "dry-run — would remove" : "removed"} ${coverageRemoved.length} stale summary artifact(s):`,
      );
      for (const r of coverageRemoved) emit(`  - ${r}`);
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
  const staleCoverage = await cleanStaleCoverageArtifacts({ dryRun: true });
  if (staleCoverage.length > 0) {
    emit(
      `audit:reset: ${staleCoverage.length} stale coverage summary artifact(s) present — run \`--auto\` to remove: ${staleCoverage.join(", ")}`,
    );
    emit("");
  }
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
