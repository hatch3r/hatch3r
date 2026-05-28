import chalk from "chalk";
import inquirer from "inquirer";
import type { CliToolId } from "../types.js";
import { printBox } from "../cli/shared/ui.js";
import { AVAILABLE_CLI_TOOLS, type InstallCommand, type OsKey } from "./registry.js";
import { buildOneLiner } from "./oneLiner.js";

/**
 * Map the current Node.js `process.platform` to the registry's `OsKey`.
 * Linux/FreeBSD/WSL all use the linux install commands (apt + cargo
 * fallback); win32 maps to `win`; everything else (including unknown)
 * falls back to `mac` for the broadest brew-compatible coverage.
 */
export function currentOsKey(): OsKey {
  if (process.platform === "win32") return "win";
  if (process.platform === "linux" || process.platform === "freebsd") return "linux";
  return "mac";
}

/**
 * One install-plan entry — the first install command for a given tool on
 * the current OS. `command` is `undefined` when the tool exists in the
 * registry but does not list an install command for the active OS (a
 * configuration bug that should not happen in production; defensive in
 * case a future entry is partially populated).
 */
export interface InstallPlan {
  id: CliToolId;
  probe: string;
  manager?: string;
  command?: string;
  homepage: string;
}

/**
 * Build the install plan for a list of missing tool ids. Returns one
 * entry per id, ordered to match `ids`. The first install command from
 * each tool's `install[os]` array is selected — entries in the registry
 * are ordered most-preferred first (brew on mac, apt on linux, scoop on
 * win) so picking index 0 matches the user's expected manager.
 */
export function buildInstallPlan(ids: readonly CliToolId[], os: OsKey = currentOsKey()): InstallPlan[] {
  const plans: InstallPlan[] = [];
  for (const id of ids) {
    const meta = (AVAILABLE_CLI_TOOLS as Record<string, { id: CliToolId; probe: string; install: Record<OsKey, InstallCommand[]>; homepage: string } | undefined>)[id];
    if (!meta) continue;
    const cmd = meta.install[os]?.[0];
    plans.push({
      id: meta.id,
      probe: meta.probe,
      manager: cmd?.manager,
      command: cmd?.command,
      homepage: meta.homepage,
    });
  }
  return plans;
}

/** Options controlling the user-facing prompt behaviour. */
export interface OfferInstallerOptions {
  /** When false, skip the inquirer confirm (used by `--yes` flows). */
  interactive?: boolean;
  /** Override the OS key (for tests / cross-OS rendering). */
  os?: OsKey;
}

/**
 * Print copy-paste install commands for `missing`, grouped by tool with
 * manager hint and homepage. **Never** executes the commands itself —
 * sudo / PATH-mutation footguns are the user's call (plan §2).
 *
 * In interactive mode, prompts with a single confirm:
 *   "Mark these tools as 'install pending' and continue?"
 * Returning the user's choice so callers can decide whether to persist
 * the selection regardless of detection state. Non-interactive mode
 * returns `true` after printing.
 */
export async function offerInstaller(
  missing: readonly CliToolId[],
  opts: OfferInstallerOptions = {},
): Promise<boolean> {
  if (missing.length === 0) return true;
  const os = opts.os ?? currentOsKey();
  const interactive = opts.interactive ?? true;

  const plan = buildInstallPlan(missing, os);
  const osLabel = os === "mac" ? "macOS" : os === "linux" ? "Linux" : "Windows";

  console.log("");
  console.log(chalk.yellow(`${missing.length} CLI tool${missing.length === 1 ? "" : "s"} not detected on PATH (${osLabel}):`));
  console.log("");

  // D10-M8 (Cycle 10): lead with the batched per-package-manager one-liner so
  // copy-paste is a single operation, then show the per-tool breakdown
  // (manager + homepage) underneath for users who need to install only a
  // subset or whose manager is not in the GROUPABLE_MANAGERS set
  // (`src/cliTools/oneLiner.ts`). The prior layout reversed this order —
  // per-tool first, batched one-liner last — which forced a second pass to
  // find the single copy operation.
  const oneLiner = buildOneLiner(plan);
  if (oneLiner) {
    console.log(chalk.yellow("Copy-paste this one-liner to install everything at once:"));
    console.log("");
    for (const line of oneLiner.split("\n")) {
      console.log(`  ${chalk.cyan(line)}`);
    }
    console.log("");
    console.log(chalk.gray("Or install individually:"));
    console.log("");
  }

  for (const entry of plan) {
    const header = entry.manager
      ? `${chalk.cyan(entry.id)} (${entry.manager})`
      : chalk.cyan(entry.id);
    console.log(`  ${header}`);
    if (entry.command) {
      console.log(`    ${chalk.gray("$")} ${entry.command}`);
    } else {
      console.log(`    ${chalk.gray("see")} ${entry.homepage}`);
    }
  }
  console.log("");
  console.log(chalk.gray("hatch3r will not run these commands for you — copy-paste in your shell."));
  console.log("");

  if (!interactive) return true;

  const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
    {
      type: "confirm",
      name: "proceed",
      message: "Mark these tools as 'install pending' and continue?",
      default: true,
    },
  ]);
  return proceed;
}

export function printMissingCliToolsDisclaimer(
  missing: readonly CliToolId[],
  totalSelected: number,
  os: OsKey = currentOsKey(),
): void {
  if (missing.length === 0) return;
  const plan = buildInstallPlan(missing, os);
  const oneLiner = buildOneLiner(plan);
  const osLabel = os === "mac" ? "macOS" : os === "linux" ? "Linux" : "Windows";
  const lines = [
    `${missing.length} of ${totalSelected} selected CLI tools are missing.`,
    `hatch3r does NOT install them for you.`,
    "",
    `Copy-paste to install everything (${osLabel}):`,
    "",
    ...oneLiner.split("\n").map((l) => `  ${l}`),
  ];
  printBox("CLI tools not installed", lines, "warning");
}
