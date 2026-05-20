import chalk from "chalk";
import { HatchError } from "../../types.js";
import { readManifest } from "../../manifest/hatchJson.js";
import { computeAdapterDrift } from "./status.js";
import {
  printBanner,
  createSpinner,
  printBox,
  error as logError,
  info,
} from "../shared/ui.js";

/**
 * Options for the verify command.
 *
 * Wave 7: verify is a thin drift-detection wrapper. The integrity-manifest
 * subsystem (and the `--fix` self-healing loop attached to it) was removed
 * along with `.integrity.json` itself — drift is now defined by adapter
 * regeneration vs. on-disk output, not by a frozen hash manifest.
 */
export type VerifyOptions = Record<string, never>;

export async function verifyCommand(_options: VerifyOptions = {}): Promise<void> {
  printBanner(true);

  const rootDir = process.cwd();
  const manifest = await readManifest(rootDir);
  if (!manifest) {
    logError("No .hatch3r/hatch.json found — run `hatch3r init` first.");
    console.log();
    throw new HatchError("No .hatch3r/hatch.json found", 1, "CONFIG_ERROR");
  }

  const spinner = createSpinner("Verifying adapter-output drift...");
  spinner.start();

  const report = await computeAdapterDrift(rootDir, manifest);
  spinner.stop();

  const driftCount = report.counts.modified + report.counts.missing + report.counts.unexpected;
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

  if (driftCount === 0) {
    printBox("verify: PASS", summaryLines, "success");
    return;
  }

  printBox(`verify: FAIL (${driftCount} drift(s))`, summaryLines, "error");
  info(`Run ${chalk.bold("hatch3r sync")} to regenerate drifted/missing files.`);
  console.log();
  throw new HatchError(
    `Adapter output drift detected (${driftCount} file(s))`,
    1,
    "INTEGRITY_ERROR",
  );
}
