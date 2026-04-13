import chalk from "chalk";
import { printBanner, warn } from "../shared/ui.js";
import { HatchError } from "../../types.js";

export async function addCommand(): Promise<void> {
  printBanner(true);
  console.log();
  warn("The `add` command is not yet implemented.");
  console.log(chalk.dim("  It will allow installing community packs in a future release."));
  console.log(chalk.dim("  Follow https://github.com/hatch3r for updates."));
  console.log();
  throw new HatchError(
    "The `add` command is not yet implemented.",
    2,
    "VALIDATION_ERROR",
  );
}
