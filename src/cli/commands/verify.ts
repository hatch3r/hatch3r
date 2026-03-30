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
} from "../shared/ui.js";

export async function verifyCommand(): Promise<void> {
  printBanner(true);

  const rootDir = process.cwd();
  const agentsDir = join(rootDir, AGENTS_DIR);

  const spinner = createSpinner("Verifying file integrity...");
  spinner.start();

  const manifest = await readIntegrityManifest(agentsDir);
  if (!manifest) {
    spinner.fail("No integrity manifest found");
    logError("Missing .agents/.integrity.json — run `hatch3r init` or `hatch3r update` to generate it.");
    console.log();
    throw new HatchError("Missing .agents/.integrity.json", 1, "INTEGRITY_ERROR");
  }

  const results = await verifyIntegrity(agentsDir);
  spinner.stop();

  if (results.length === 0) {
    printBox("Integrity", [chalk.dim("No files to verify")], "info");
    return;
  }

  const icons: Record<string, string> = {
    pass: chalk.green("✔"),
    modified: chalk.yellow("✖"),
    missing: chalk.red("✖"),
    new: chalk.cyan("+"),
    tampered: chalk.red("⚠"),
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

  const summaryLines: string[] = [];
  if (counts.pass > 0) summaryLines.push(`${chalk.green("✔")} Passed: ${counts.pass}`);
  if (counts.modified > 0) summaryLines.push(`${chalk.yellow("✖")} Modified: ${counts.modified}`);
  if (counts.missing > 0) summaryLines.push(`${chalk.red("✖")} Missing: ${counts.missing}`);
  if (counts.new > 0) summaryLines.push(`${chalk.cyan("+")} New: ${counts.new}`);
  if (counts.tampered > 0) summaryLines.push(`${chalk.red("⚠")} Tampered: ${counts.tampered}`);

  const hasIssues = counts.modified > 0 || counts.missing > 0 || counts.tampered > 0;

  if (hasIssues) {
    printBox("Integrity check failed", summaryLines, "error");
    if (counts.tampered > 0) {
      logError("Integrity manifest has been tampered with. Re-run `hatch3r update` to regenerate it.");
    }
    if (counts.modified > 0) {
      info(`Modified files may have been tampered with. Run ${chalk.bold("hatch3r update")} to restore originals.`);
    }
    console.log();
    throw new HatchError("Integrity check failed", 1, "INTEGRITY_ERROR");
  } else {
    printBox("Integrity check passed", summaryLines, "success");
  }
}
