import chalk from "chalk";
import { HatchError, type HatchManifest } from "../../types.js";
import { readManifest } from "../../manifest/hatchJson.js";
import { computeAdapterDrift, type DriftReport } from "./status.js";
import { runRegenerate } from "./update.js";
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
 */
export interface VerifyOptions {
  /** Auto-repair drifted/missing adapter output by regenerating it. */
  fix?: boolean;
  /** Maximum regenerate→re-check cycles (default 2, clamped to [1, 5]). */
  maxFixAttempts?: number;
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
  printBanner(true);

  const rootDir = process.cwd();
  const manifest = await readManifest(rootDir);
  if (!manifest) {
    logError("No .hatch3r/hatch.json found — run `hatch3r init` first.");
    console.log();
    throw new HatchError(
      "No .hatch3r/hatch.json found",
      1,
      "CONFIG_ERROR",
      "Run `npx hatch3r init` to set up your project first.",
    );
  }

  let report: DriftReport;
  if (options.fix) {
    report = await runFixLoop(rootDir, manifest, options.maxFixAttempts);
  } else {
    const spinner = createSpinner("Verifying adapter-output drift...");
    spinner.start();
    report = await computeAdapterDrift(rootDir, manifest);
    spinner.stop();
  }

  const driftCount = driftCountOf(report);
  const summaryLines = buildSummaryLines(report);

  if (driftCount === 0) {
    printBox("verify: PASS", summaryLines, "success");
    return;
  }

  printBox(`verify: FAIL (${driftCount} drift(s))`, summaryLines, "error");
  if (options.fix) {
    info(`--fix could not clear all drift — run ${chalk.bold("hatch3r sync")} or inspect the failing tool(s).`);
  } else {
    info(`Run ${chalk.bold("hatch3r sync")} to regenerate drifted/missing files, or ${chalk.bold("hatch3r verify --fix")} to auto-repair.`);
  }
  console.log();
  throw new HatchError(
    `Adapter output drift detected (${driftCount} file(s))`,
    1,
    "INTEGRITY_ERROR",
    "Run `hatch3r sync` to regenerate drifted/missing files, or `hatch3r verify --fix` to auto-repair.",
  );
}
