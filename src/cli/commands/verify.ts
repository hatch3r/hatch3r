import { join } from "node:path";
import chalk from "chalk";
import { AGENTS_DIR, HatchError } from "../../types.js";
import { readIntegrityManifest, verifyIntegrity } from "../../integrity/index.js";
import {
  printBanner,
  createSpinner,
  printBox,
  error as logError,
  info,
  warn,
} from "../shared/ui.js";

/**
 * Options for the verify command.
 *
 * Finding #61 (D8, High): Add --fix flag for self-healing loop.
 */
export interface VerifyOptions {
  /** When true, attempt to auto-fix integrity issues by running hatch3r update. */
  fix?: boolean;
  /** Maximum number of verify->fix cycles (default: 2, max: 5). */
  maxFixAttempts?: number;
}

/**
 * Run a single integrity verification pass.
 * Returns true if integrity check passed, false if issues were found.
 * Throws HatchError only if manifest is missing or results are empty.
 */
async function runVerifyPass(agentsDir: string): Promise<{
  passed: boolean;
  counts: Record<string, number>;
  hasModifiedOrMissing: boolean;
  hasTampered: boolean;
}> {
  const results = await verifyIntegrity(agentsDir);

  if (results.length === 0) {
    return { passed: true, counts: { pass: 0 }, hasModifiedOrMissing: false, hasTampered: false };
  }

  const icons: Record<string, string> = {
    pass: chalk.green("\u2714"),
    modified: chalk.yellow("\u2716"),
    missing: chalk.red("\u2716"),
    new: chalk.cyan("+"),
    tampered: chalk.red("\u26A0"),
  };

  const labels: Record<string, string> = {
    pass: chalk.green("PASS"),
    modified: chalk.yellow("MODIFIED"),
    missing: chalk.red("MISSING"),
    new: chalk.cyan("NEW"),
    tampered: chalk.red("TAMPERED"),
  };

  console.log();
  for (const r of results) {
    const icon = icons[r.status] ?? " ";
    const lbl = labels[r.status] ?? r.status;
    console.log(`  ${icon} ${lbl.padEnd(18)} ${r.file}`);
  }
  console.log();

  const counts: Record<string, number> = { pass: 0, modified: 0, missing: 0, new: 0, tampered: 0 };
  for (const r of results) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  }

  const hasModifiedOrMissing = (counts.modified ?? 0) > 0 || (counts.missing ?? 0) > 0;
  const hasTampered = (counts.tampered ?? 0) > 0;
  const passed = !hasModifiedOrMissing && !hasTampered;

  return { passed, counts, hasModifiedOrMissing, hasTampered };
}

function printSummary(counts: Record<string, number>, title: string, style: "success" | "error"): void {
  const summaryLines: string[] = [];
  if ((counts.pass ?? 0) > 0) summaryLines.push(`${chalk.green("\u2714")} Passed: ${counts.pass}`);
  if ((counts.modified ?? 0) > 0) summaryLines.push(`${chalk.yellow("\u2716")} Modified: ${counts.modified}`);
  if ((counts.missing ?? 0) > 0) summaryLines.push(`${chalk.red("\u2716")} Missing: ${counts.missing}`);
  if ((counts.new ?? 0) > 0) summaryLines.push(`${chalk.cyan("+")} New: ${counts.new}`);
  if ((counts.tampered ?? 0) > 0) summaryLines.push(`${chalk.red("\u26A0")} Tampered: ${counts.tampered}`);
  printBox(title, summaryLines, style);
}

/** Maximum allowed fix attempts to prevent infinite loops. */
const MAX_FIX_ATTEMPTS = 5;

export async function verifyCommand(options: VerifyOptions = {}): Promise<void> {
  printBanner(true);

  const rootDir = process.cwd();
  const agentsDir = join(rootDir, AGENTS_DIR);

  const spinner = createSpinner("Verifying file integrity...");
  spinner.start();

  const manifest = await readIntegrityManifest(agentsDir);
  if (!manifest) {
    spinner.fail("No integrity manifest found");
    logError("Missing .agents/.integrity.json \u2014 run `hatch3r init` or `hatch3r update` to generate it.");
    console.log();
    throw new HatchError("Missing .agents/.integrity.json", 1, "INTEGRITY_ERROR");
  }

  spinner.stop();

  // First verification pass
  let result = await runVerifyPass(agentsDir);

  if (result.passed) {
    if (result.counts.pass === 0) {
      printBox("Integrity", [chalk.dim("No files to verify")], "info");
    } else {
      printSummary(result.counts, "Integrity check passed", "success");
    }
    return;
  }

  // If --fix is not set, report failure and exit
  if (!options.fix) {
    printSummary(result.counts, "Integrity check failed", "error");
    if (result.hasTampered) {
      logError("Integrity manifest has been tampered with. Re-run `hatch3r update` to regenerate it.");
    }
    if ((result.counts.modified ?? 0) > 0) {
      info(`Modified files may have been tampered with. Run ${chalk.bold("hatch3r update")} to restore originals.`);
    }
    console.log();
    throw new HatchError("Integrity check failed", 1, "INTEGRITY_ERROR");
  }

  // --fix self-healing loop: verify -> fix -> verify
  const maxAttempts = Math.min(
    Math.max(1, options.maxFixAttempts ?? 2),
    MAX_FIX_ATTEMPTS,
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    info(`\nFix attempt ${attempt}/${maxAttempts}: running hatch3r update to repair...`);

    const fixSpinner = createSpinner(`Fix attempt ${attempt}: updating canonical files...`);
    fixSpinner.start();

    try {
      // Dynamically import to avoid circular dependency
      const { runUpdate } = await import("./update.js");
      const { readManifest } = await import("../../manifest/hatchJson.js");

      const hatchManifest = await readManifest(rootDir);
      if (!hatchManifest) {
        fixSpinner.fail("Cannot auto-fix: no hatch.json manifest found");
        throw new HatchError("Cannot auto-fix: no hatch.json manifest", 1, "CONFIG_ERROR");
      }

      await runUpdate(rootDir, hatchManifest);
      fixSpinner.succeed(`Fix attempt ${attempt}: update completed`);
    } catch (err) {
      fixSpinner.fail(`Fix attempt ${attempt}: update failed`);
      if (err instanceof HatchError) throw err;
      throw new HatchError(
        `Auto-fix failed: ${err instanceof Error ? err.message : String(err)}`,
        1,
        "UNKNOWN_ERROR",
      );
    }

    // Re-verify after fix
    const reVerifySpinner = createSpinner(`Re-verifying after fix attempt ${attempt}...`);
    reVerifySpinner.start();
    result = await runVerifyPass(agentsDir);
    reVerifySpinner.stop();

    if (result.passed) {
      printSummary(result.counts, `Integrity restored (fixed in ${attempt} attempt${attempt > 1 ? "s" : ""})`, "success");
      return;
    }

    warn(`Fix attempt ${attempt} did not resolve all issues.`);
  }

  // Exhausted all attempts
  printSummary(result.counts, `Integrity check failed after ${maxAttempts} fix attempt(s)`, "error");
  console.log();
  throw new HatchError(
    `Integrity check failed after ${maxAttempts} fix attempt(s)`,
    1,
    "INTEGRITY_ERROR",
  );
}
