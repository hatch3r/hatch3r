import chalk from "chalk";
import { printBanner } from "../shared/ui.js";

export async function addCommand(): Promise<void> {
  printBanner(true);
  console.log();
  console.log(chalk.yellow("  Coming soon!"));
  console.log(chalk.dim("  The `add` command will allow installing community packs."));
  console.log(chalk.dim("  Follow https://github.com/hatch3r for updates."));
  console.log();
}
