import { readFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { readManifest } from "../../manifest/hatchJson.js";
import { getAdapter } from "../../adapters/index.js";
import { AGENTS_DIR } from "../../types.js";
import { extractManagedBlock } from "../../merge/managedBlocks.js";
import {
  printBanner,
  createSpinner,
  printBox,
  error as logError,
  info,
} from "../shared/ui.js";

export async function statusCommand(): Promise<void> {
  printBanner(true);

  const rootDir = process.cwd();
  const agentsDir = join(rootDir, AGENTS_DIR);
  const manifest = await readManifest(rootDir);

  if (!manifest) {
    logError("No .agents/hatch.json found.");
    console.log(chalk.dim("  Run `npx hatch3r init` to set up your project first.\n"));
    process.exit(1);
  }

  const spinner = createSpinner("Checking sync status...");
  spinner.start();

  const stats = { synced: 0, drifted: 0, missing: 0 };
  const fileLines: string[] = [];

  for (const tool of manifest.tools) {
    const adapter = getAdapter(tool);
    const outputs = await adapter.generate(agentsDir, manifest);

    fileLines.push(chalk.bold(`${tool}:`));

    for (const out of outputs) {
      const destPath = join(rootDir, out.path);
      try {
        const existing = await readFile(destPath, "utf-8");
        const existingBlock = extractManagedBlock(existing);
        const expectedBlock = out.managedContent ?? extractManagedBlock(out.content);
        if (existingBlock !== null && expectedBlock !== null ? existingBlock === expectedBlock : existing === out.content) {
          fileLines.push(`  ${chalk.green("=")} ${out.path}`);
          stats.synced++;
        } else {
          fileLines.push(`  ${chalk.yellow("~")} ${out.path} ${chalk.dim("(drifted)")}`);
          stats.drifted++;
        }
      } catch {
        fileLines.push(`  ${chalk.red("+")} ${out.path} ${chalk.dim("(missing)")}`);
        stats.missing++;
      }
    }
  }

  spinner.stop();
  console.log();

  for (const line of fileLines) {
    console.log(`  ${line}`);
  }
  console.log();

  const summaryLines = [
    `${chalk.green("=")} In sync: ${stats.synced}`,
  ];
  if (stats.drifted > 0) {
    summaryLines.push(`${chalk.yellow("~")} Drifted: ${stats.drifted}`);
  }
  if (stats.missing > 0) {
    summaryLines.push(`${chalk.red("+")} Missing: ${stats.missing}`);
  }

  const style = stats.drifted > 0 || stats.missing > 0 ? "info" as const : "success" as const;
  printBox("Status", summaryLines, style);

  if (stats.drifted > 0 || stats.missing > 0) {
    info(`Run ${chalk.bold("hatch3r sync")} to regenerate drifted/missing files.`);
    console.log();
  }
}
