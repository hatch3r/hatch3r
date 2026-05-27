import chalk from "chalk";
import { readManifest, writeManifest } from "../../manifest/hatchJson.js";
import {
  HatchError,
  type CliToolsConfig,
  type HatchManifest,
} from "../../types.js";
import { detectCliTools, findMissingCliTools } from "../../cliTools/detect.js";
import {
  offerInstaller,
  printMissingCliToolsDisclaimer,
} from "../../cliTools/install.js";
import {
  AVAILABLE_CLI_TOOLS,
  CLI_TOOL_SECRET_NOTES,
  type CliToolMeta,
} from "../../cliTools/registry.js";
import {
  printBanner,
  printBox,
  createSpinner,
  info,
  warn,
  error as logError,
  label,
} from "../shared/ui.js";
import { pickCliTools } from "../shared/pickers.js";
import { isBack } from "../shared/initSteps.js";
import { isWSL } from "../shared/constants.js";

/**
 * Side-door CLI-tools command (plan §4.5). Mirror of `mcp.ts`: default
 * action opens the picker, plus subcommands for list / install / detect.
 * No subcommand mutates `.agents/` content — adapter regeneration is
 * delegated to `hatch3r sync` (the next run picks up the manifest
 * change and `readCliFilteredSkills` filters skills accordingly).
 */

function requireManifest(_rootDir: string, manifest: HatchManifest | null): asserts manifest {
  if (!manifest) {
    logError("No .hatch3r/hatch.json found.");
    console.log(chalk.dim(`  Run \`npx hatch3r init\` to set up your project first.\n`));
    throw new HatchError(
      "No .hatch3r/hatch.json found.",
      1,
      "CONFIG_ERROR",
      "Run `npx hatch3r init` to set up your project first.",
    );
  }
}

function wslThemeOrUndefined(): unknown {
  return isWSL()
    ? { icon: { checked: chalk.green("[x]"), unchecked: "[ ]", cursor: ">" } }
    : undefined;
}

/**
 * Default action — open the picker, detect, offer installer. Persists
 * the new selection to `manifest.cliTools`. Run by `hatch3r cli-tools`
 * with no subcommand.
 */
export async function cliToolsCommand(): Promise<void> {
  printBanner(true);
  const rootDir = process.cwd();
  const manifest = await readManifest(rootDir);
  requireManifest(rootDir, manifest);

  const existing = manifest.cliTools?.selected ?? [];
  const selectedResult = await pickCliTools({
    existing,
    wslTheme: wslThemeOrUndefined(),
  });
  if (isBack(selectedResult)) {
    info("CLI tools setup cancelled (Shift+Tab).");
    return;
  }
  const selected = selectedResult;

  if (selected.length > 0) {
    const spinner = createSpinner(`Detecting ${selected.length} CLI tool(s)...`);
    spinner.start();
    const missing = await findMissingCliTools(selected);
    if (missing.length === 0) {
      spinner.succeed(`All ${selected.length} CLI tool(s) detected on PATH`);
    } else {
      spinner.warn(`${selected.length - missing.length}/${selected.length} CLI tool(s) detected; ${missing.length} missing`);
      await offerInstaller(missing, { interactive: true });
    }

    const secretNotes: string[] = [];
    for (const id of selected) {
      const notes = CLI_TOOL_SECRET_NOTES[id];
      if (notes && notes.length > 0) {
        secretNotes.push(`${id}: ${notes.join(", ")}`);
      }
    }
    if (secretNotes.length > 0) {
      info(chalk.dim("CLI tool environment variables required:"));
      for (const note of secretNotes) {
        info(chalk.dim(`  ${note}`));
      }
    }
  }

  const cliToolsConfig: CliToolsConfig = {
    enabled: selected.length > 0,
    selected,
  };
  manifest.cliTools = cliToolsConfig;
  await writeManifest(rootDir, manifest);

  printBox(
    "CLI tools configured",
    [
      label("Selected", selected.length > 0 ? selected.join(", ") : "none"),
      label("Manifest", ".hatch3r/hatch.json"),
      label("Next", "Run `npx hatch3r sync` so adapters re-emit the filtered skill set"),
    ],
    "success",
  );

  if (selected.length > 0) {
    const finalMissing = await findMissingCliTools(selected);
    printMissingCliToolsDisclaimer(finalMissing, selected.length);
  }
}

export async function cliToolsListCommand(): Promise<void> {
  printBanner(true);
  const rootDir = process.cwd();
  const manifest = await readManifest(rootDir);
  requireManifest(rootDir, manifest);

  const selected = manifest.cliTools?.selected ?? [];
  if (selected.length === 0) {
    printBox(
      "CLI tools",
      [
        "(no CLI tools selected)",
        "",
        "Run `npx hatch3r cli-tools` to open the picker.",
      ],
      "info",
    );
    return;
  }

  const results = await detectCliTools(selected);
  const lines: string[] = [];
  for (const r of results) {
    const meta = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>)[r.id];
    const tierLabel = meta ? `tier ${meta.tier}` : "(unknown)";
    const status = r.installed
      ? `${chalk.green("✓")} ${r.path}`
      : `${chalk.yellow("✗")} not on PATH`;
    lines.push(`  ${chalk.cyan(r.id)} (${tierLabel}) — ${status}`);
  }

  const installed = results.filter((r) => r.installed).length;
  lines.push("");
  lines.push(label("Detected", `${installed}/${results.length} installed`));

  printBox("CLI tools", lines, installed === results.length ? "success" : "info");
}

export async function cliToolsInstallCommand(): Promise<void> {
  printBanner(true);
  const rootDir = process.cwd();
  const manifest = await readManifest(rootDir);
  requireManifest(rootDir, manifest);

  const selected = manifest.cliTools?.selected ?? [];
  if (selected.length === 0) {
    info("No CLI tools selected — run `npx hatch3r cli-tools` first to opt in.");
    return;
  }

  const spinner = createSpinner(`Detecting ${selected.length} CLI tool(s)...`);
  spinner.start();
  const missing = await findMissingCliTools(selected);
  if (missing.length === 0) {
    spinner.succeed(`All ${selected.length} CLI tool(s) already installed`);
    return;
  }
  spinner.warn(`${missing.length}/${selected.length} CLI tool(s) missing`);
  await offerInstaller(missing, { interactive: true });

  if (selected.length > 0) {
    const finalMissing = await findMissingCliTools(selected);
    printMissingCliToolsDisclaimer(finalMissing, selected.length);
  }
}

export async function cliToolsDetectCommand(): Promise<void> {
  printBanner(true);
  const rootDir = process.cwd();
  const manifest = await readManifest(rootDir);
  requireManifest(rootDir, manifest);

  const selected = manifest.cliTools?.selected ?? [];
  if (selected.length === 0) {
    info("No CLI tools selected — run `npx hatch3r cli-tools` first to opt in.");
    return;
  }

  const results = await detectCliTools(selected);
  const lines: string[] = [];
  let installed = 0;
  for (const r of results) {
    if (r.installed) {
      lines.push(`  ${chalk.green("✓")} ${r.id} — ${r.path}`);
      installed++;
    } else {
      lines.push(`  ${chalk.yellow("✗")} ${r.id} — not on PATH`);
    }
  }
  lines.push("");
  lines.push(label("Installed", `${installed}/${results.length}`));
  if (installed < results.length) {
    lines.push("");
    lines.push(`Run ${chalk.bold("npx hatch3r cli-tools install")} to see install commands.`);
  }
  printBox("CLI tool detection", lines, installed === results.length ? "success" : "info");

  if (installed < results.length) {
    warn(`${results.length - installed} CLI tool(s) not detected`);
  }
}
