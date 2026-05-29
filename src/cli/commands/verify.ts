import chalk from "chalk";
import { HatchError, type HatchManifest } from "../../types.js";
import { readManifest } from "../../manifest/hatchJson.js";
import { computeAdapterDrift, renderDiffSummaryLines, type DriftReport } from "./status.js";
import { runRegenerate } from "./update.js";
import { emitJson, parseFormatOption, type CliOutputFormat } from "../shared/output.js";
import { HATCH3R_VERSION } from "../../version.js";
import {
  printBanner,
  createSpinner,
  printBox,
  error as logError,
  info,
  warn,
} from "../shared/ui.js";

/** Default verify-fix cycles when `--fix` is given without `--max-fix-attempts`. */
const DEFAULT_MAX_FIX_ATTEMPTS = 2;
/** Hard ceiling on verify-fix cycles, matching the `--max-fix-attempts` help text. */
const MAX_FIX_ATTEMPTS_CEILING = 5;

/**
 * Options for the verify command.
 *
 * Wave 7 reduced verify to a thin drift-detection wrapper over
 * `computeAdapterDrift` (drift is adapter regeneration vs. on-disk output, not
 * a frozen hash manifest). Cycle 10 (D11-H-6) re-attached the advertised
 * `--fix` / `--max-fix-attempts` flags to that drift definition so the flags
 * declared in `program.ts` are honored instead of silently ignored
 * (Silent-Failure-Contract, P5). `--fix` repairs drift by regenerating adapter
 * output (the same in-memory regeneration `hatch3r sync` performs) up to
 * `--max-fix-attempts` times, re-checking drift after each pass.
 *
 * D12-SA12.1-F04 (Cycle 10, P1): verify is READ-ONLY in its default (no
 * `--fix`) mode — it only reads the manifest and compares regenerated output
 * against on-disk files, never writing. There is therefore intentionally NO
 * `--dry-run` flag: verify IS the preview (analogous to `git status` having no
 * `--dry-run`). The write-side preview lives on the destructive twins,
 * `hatch3r sync --dry-run` and `hatch3r update --dry-run`; a `verify --dry-run`
 * would be a tautology of the default report.
 *
 * D12-SA12.2-F5 (D12, P1): `--diff` adds a symmetric before/after summary box
 * (the same one `hatch3r sync --diff` and `hatch3r status --diff` render) so an
 * operator can see WHICH files drifted without re-running sync. It is read-only
 * — it re-renders the already-computed drift report, never writes — so it does
 * not contradict the no-`--dry-run` rationale above (which is about write
 * previews, not the read-only drift summary).
 */
export interface VerifyOptions {
  /** Auto-repair drifted/missing adapter output by regenerating it. */
  fix?: boolean;
  /** Maximum regenerate→re-check cycles (default 2, clamped to [1, 5]). */
  maxFixAttempts?: number;
  /**
   * SA12.1-F-D12-M2 (D12, P1): output format for CI consumers. `"json"`
   * emits a one-shot structured payload to stdout; `"human"` (default) keeps
   * the legacy decorated chrome.
   */
  format?: string;
  /**
   * D12-SA12.2-F5 (D12, P1): when set, print the sync-style "Diff summary" box
   * (added/modified/unchanged/orphan per file) after the PASS/FAIL box.
   */
  diff?: boolean;
}

/** Render the drift counts as boxed summary lines (shared by report + fix paths). */
function buildSummaryLines(report: DriftReport): string[] {
  const summaryLines: string[] = [
    `${chalk.green("✔")} In sync:    ${report.counts.synced}`,
  ];
  if (report.counts.modified > 0) {
    summaryLines.push(`${chalk.yellow("~")} Drifted:    ${report.counts.modified}`);
  }
  if (report.counts.missing > 0) {
    summaryLines.push(`${chalk.red("+")} Missing:    ${report.counts.missing}`);
  }
  if (report.counts.unexpected > 0) {
    summaryLines.push(`${chalk.red("!")} Unexpected: ${report.counts.unexpected}`);
  }
  return summaryLines;
}

function driftCountOf(report: DriftReport): number {
  return report.counts.modified + report.counts.missing + report.counts.unexpected;
}

/**
 * D1-SA1.4-F10 (Cycle 10, P1): build the recovery hint for a drifted report.
 * `hatch3r sync` regenerates drifted/missing managed output but does NOT remove
 * orphan (`unexpected`) files — those are cleared by `hatch3r clean`. The prior
 * verify hint pointed every drift category at `sync`, so an operator whose only
 * drift was orphan files ran `sync`, saw it do nothing, and was left confused.
 * This mirrors the per-category guidance status already emits (status.ts: sync
 * for missing, clean for unexpected): emit `clean` when the drift is purely
 * orphan files, `sync` when drift includes drifted/missing output (and append a
 * `clean` note when orphans also coexist).
 */
function buildRecoveryHint(report: DriftReport): string {
  const { modified, missing, unexpected } = report.counts;
  const hasSyncable = modified > 0 || missing > 0;
  if (!hasSyncable && unexpected > 0) {
    return "Run `hatch3r clean` to remove unexpected files no longer produced by any adapter.";
  }
  const base =
    "Run `hatch3r sync` to regenerate drifted/missing files, or `hatch3r verify --fix` to auto-repair.";
  return unexpected > 0
    ? `${base} Run \`hatch3r clean\` to remove the unexpected (orphan) file(s).`
    : base;
}

/**
 * D12-SA12.2-F5 (D12, P1): print the sync-style "Diff summary" box when
 * `--diff` is set. Shared renderer ({@link renderDiffSummaryLines}) so verify,
 * status, and sync all emit the identical added/modified/unchanged/orphan box.
 * No-op in JSON mode (the per-entry list is already in the JSON payload) and
 * when `--diff` is absent.
 */
function maybePrintDiffSummary(options: VerifyOptions, report: DriftReport): void {
  if (!options.diff) return;
  const diffLines = renderDiffSummaryLines(report);
  if (diffLines.length > 0) {
    printBox("Diff summary", diffLines, "info");
    console.log();
  }
}

/**
 * Bounded regenerate→re-check loop backing `verify --fix`. Each iteration
 * regenerates adapter output from the bundled canonical content (no network)
 * and recomputes drift. Returns the final report; the caller decides PASS/FAIL.
 */
async function runFixLoop(
  rootDir: string,
  manifest: HatchManifest,
  requestedAttempts: number | undefined,
): Promise<DriftReport> {
  const raw = Number.isFinite(requestedAttempts) ? Number(requestedAttempts) : DEFAULT_MAX_FIX_ATTEMPTS;
  const attempts = Math.min(Math.max(Math.trunc(raw), 1), MAX_FIX_ATTEMPTS_CEILING);

  let report = await computeAdapterDrift(rootDir, manifest);
  for (let attempt = 1; attempt <= attempts && driftCountOf(report) > 0; attempt++) {
    info(`--fix attempt ${attempt}/${attempts}: regenerating drifted adapter output...`);
    const result = await runRegenerate(rootDir, manifest, { snapshotCommandName: "verify-fix" });
    if (result.failedTools > 0 && result.syncedTools === 0) {
      warn(`Regeneration produced no output (${result.failedTools} tool(s) failed); aborting --fix loop.`);
      break;
    }
    report = await computeAdapterDrift(rootDir, manifest);
  }
  return report;
}

export async function verifyCommand(options: VerifyOptions = {}): Promise<void> {
  // SA12.1-F-D12-M2 (D12, P1): JSON mode emits a single structured document
  // for CI consumers (PASS/FAIL + drift counts + per-entry list). Human mode
  // keeps the legacy decorated chrome (banner, spinner, printBox panels).
  const format: CliOutputFormat = parseFormatOption(options.format);
  const jsonMode = format === "json";
  if (!jsonMode) printBanner(true);

  const rootDir = process.cwd();
  const manifest = await readManifest(rootDir);
  if (!manifest) {
    if (jsonMode) {
      emitJson({
        status: "failed",
        // D8-SA8.1-F8.1.8 (Cycle 10, P1): align the JSON `error` string with the
        // human-mode message and status's JSON payload (trailing period).
        error: "No .hatch3r/hatch.json found.",
        errorCode: "CONFIG_ERROR",
        recoveryHint: "Run `npx hatch3r init` to set up your project first.",
        hatch3rVersion: HATCH3R_VERSION,
        timestamp: new Date().toISOString(),
      });
    } else {
      // D8-SA8.1-F8.1.8 (Cycle 10, P1): emit the same two-line missing-manifest
      // message the other manifest-required commands use (status, mcp,
      // cli-tools, config) so first-run stderr is consistent across the CLI.
      logError("No .hatch3r/hatch.json found.");
      console.log(chalk.dim("  Run `npx hatch3r init` to set up your project first.\n"));
    }
    throw new HatchError(
      "No .hatch3r/hatch.json found.",
      undefined,
      "CONFIG_ERROR",
      "Run `npx hatch3r init` to set up your project first.",
    );
  }

  let report: DriftReport;
  if (options.fix) {
    report = await runFixLoop(rootDir, manifest, options.maxFixAttempts);
  } else {
    const spinner = jsonMode ? null : createSpinner("Verifying adapter-output drift...");
    spinner?.start();
    report = await computeAdapterDrift(rootDir, manifest);
    spinner?.stop();
  }

  const driftCount = driftCountOf(report);
  const summaryLines = buildSummaryLines(report);

  if (jsonMode) {
    emitJson({
      status: driftCount === 0 ? "pass" : "fail",
      driftCount,
      counts: report.counts,
      driftKindCounts: report.driftKindCounts,
      entries: report.entries,
      fixApplied: !!options.fix,
      hatch3rVersion: HATCH3R_VERSION,
      timestamp: new Date().toISOString(),
    });
    if (driftCount === 0) return;
    throw new HatchError(
      `Adapter output drift detected (${driftCount} file(s))`,
      undefined,
      "INTEGRITY_ERROR",
      buildRecoveryHint(report),
    );
  }

  if (driftCount === 0) {
    printBox("verify: PASS", summaryLines, "success");
    maybePrintDiffSummary(options, report);
    return;
  }

  // D1-SA1.4-F10 (P1): the recovery hint is now drift-category-aware so an
  // orphan-only failure points at `hatch3r clean`, not `hatch3r sync` (which
  // would do nothing). Mirrors status.ts per-category guidance.
  const recoveryHint = buildRecoveryHint(report);
  printBox(`verify: FAIL (${driftCount} drift(s))`, summaryLines, "error");
  maybePrintDiffSummary(options, report);
  if (options.fix) {
    info(`--fix could not clear all drift — run ${chalk.bold("hatch3r sync")} or inspect the failing tool(s).`);
  } else {
    info(recoveryHint);
  }
  // D11-SA11.2-F10 (D11, P1): scope disclosure — verify compares only the
  // hatch3r-managed block, never content outside HATCH3R:BEGIN/END. Mirrors the
  // note status emits so the two commands describe their scope identically.
  console.log(
    chalk.dim(
      "  Note: verify covers hatch3r-managed blocks only (HATCH3R:BEGIN/END). " +
      "Content outside the markers is yours — use `git diff` to inspect it.",
    ),
  );
  console.log();
  throw new HatchError(
    `Adapter output drift detected (${driftCount} file(s))`,
    undefined,
    "INTEGRITY_ERROR",
    recoveryHint,
  );
}
