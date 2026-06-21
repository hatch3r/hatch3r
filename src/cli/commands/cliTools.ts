import chalk from "chalk";
import { readManifest, writeManifest } from "../../manifest/hatchJson.js";
import { sweepOrphanTmpFiles, formatOrphanTmpSweepDiagnostic } from "../../merge/safeWrite.js";
import {
  type CliToolsConfig,
} from "../../types.js";
// D8-SA8.1-F8.1.8 (Cycle 10 Wave 4, P1): shared missing-manifest preflight,
// replacing the per-command copy that previously lived in this file.
import { assertManifest } from "../shared/requireManifest.js";
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
  createSpinner,
  info,
  warn,
  verbose,
  label,
} from "../shared/ui.js";
import { beginCommand, finishCommand } from "../shared/commandOutput.js";
import { pickCliTools } from "../shared/pickers.js";
import { isBack } from "../shared/initSteps.js";
import { isWSL } from "../shared/constants.js";

/** W5: standardized flags for the read-only cli-tools subcommands. */
export interface CliToolsCommandOptions {
  /** `--format <human|json>`; json emits one envelope document on stdout. */
  format?: string;
  /** `--quiet`: suppress stdout chrome (banner, boxes); stderr still emits. */
  quiet?: boolean;
}

/** W5: flags for the bare (picker) command. */
export interface CliToolsBareOptions extends CliToolsCommandOptions {
  /** `--dry-run`: show the resulting selection without writing the manifest. */
  dryRun?: boolean;
}

/**
 * Side-door CLI-tools command (plan §4.5). Mirror of `mcp.ts`: default
 * action opens the picker, plus subcommands for list / install / detect.
 * No subcommand mutates `.agents/` content — adapter regeneration is
 * delegated to `hatch3r sync` (the next run picks up the manifest
 * change and `readCliFilteredSkills` filters skills accordingly).
 */

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
export async function cliToolsCommand(opts: CliToolsBareOptions = {}): Promise<void> {
  // W5: the bare command ALWAYS opens the picker (no --yes escape hatch), so
  // `--format json` is rejected here by beginCommand's interactive gate.
  const format = beginCommand(opts, { banner: "compact", interactive: true });
  const rootDir = process.cwd();

  // D1-SA1.5-F10 (Cycle 10 Wave 4, D1, P6): sweep orphan `.tmp.<8-hex>` files
  // left under the project root by a prior SIGKILL'd run. `cli-tools` persists
  // the selection via `writeManifest` → `atomicWriteFile` (temp+rename), so an
  // interrupted write can strand a `hatch.json.tmp.<hex>` orphan. Best-effort:
  // only removes files older than the 60s in-flight-write floor
  // ({@link ORPHAN_MIN_AGE_MS}), surfaces removals + unlink failures via
  // `warn()` per the Silent Failure Contract (P5), never aborts the command.
  // Mirrors the `update`/`sync`/`init`/`config`/`mcp` entry-point sweep.
  // Skipped under --dry-run (the sweep unlinks files; dry-run promises no writes).
  if (opts.dryRun !== true) {
    try {
      const sweptTmp = await sweepOrphanTmpFiles(rootDir, { recursive: true });
      const tmpDiag = formatOrphanTmpSweepDiagnostic(sweptTmp);
      if (tmpDiag) warn(tmpDiag);
    } catch (err) {
      verbose(`cli-tools: orphan-tmp sweep skipped — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const manifest = await readManifest(rootDir);
  assertManifest(manifest);

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

  // W5 --dry-run: show the resulting selection without detection, installer
  // offer, or manifest write.
  if (opts.dryRun === true) {
    finishCommand(format, {
      command: "cli-tools",
      title: "CLI tools (dry-run)",
      lines: [
        label("Selected", selected.length > 0 ? selected.join(", ") : "none"),
        label("Manifest", ".hatch3r/hatch.json (not written)"),
      ],
      style: "info",
      nextSteps: ["Run `hatch3r cli-tools install` to print install commands for missing tools."],
      json: { dryRun: true, selected },
    });
    return;
  }

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

  finishCommand(format, {
    command: "cli-tools",
    title: "CLI tools configured",
    lines: [
      label("Selected", selected.length > 0 ? selected.join(", ") : "none"),
      label("Manifest", ".hatch3r/hatch.json"),
      label("Next", "Run `npx hatch3r sync` so adapters re-emit the filtered skill set"),
    ],
    style: "success",
    nextSteps: ["Run `hatch3r cli-tools install` to print install commands for missing tools."],
    json: { selected, enabled: selected.length > 0 },
  });

  if (selected.length > 0) {
    const finalMissing = await findMissingCliTools(selected);
    printMissingCliToolsDisclaimer(finalMissing, selected.length);
  }
}

export async function cliToolsListCommand(opts: CliToolsCommandOptions = {}): Promise<void> {
  const format = beginCommand(opts, { banner: "compact" });
  const rootDir = process.cwd();
  const manifest = await readManifest(rootDir);
  assertManifest(manifest);

  const selected = manifest.cliTools?.selected ?? [];
  if (selected.length === 0) {
    finishCommand(format, {
      command: "cli-tools list",
      title: "CLI tools",
      lines: [
        "(no CLI tools selected)",
        "",
        "Run `npx hatch3r cli-tools` to open the picker.",
      ],
      style: "info",
      json: { selected: [], tools: [], installedCount: 0, total: 0 },
    });
    return;
  }

  const results = await detectCliTools(selected);
  const lines: string[] = [];
  for (const r of results) {
    const meta = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>)[r.id];
    const tierLabel = meta ? `tier ${meta.tier}` : "(unknown)";
    let status: string;
    if (r.installed) {
      status = `${chalk.green("✓")} ${r.path}`;
    } else if (r.extensionMissing) {
      // D21-M6 (Cycle 10): the base binary is on PATH but the registered
      // extension probe failed — surface the missing extension name so the
      // user runs `<tool> extension add` rather than re-installing.
      status = `${chalk.yellow("✗")} extension missing: ${r.extensionMissing}`;
    } else {
      status = `${chalk.yellow("✗")} not on PATH`;
    }
    lines.push(`  ${chalk.cyan(r.id)} (${tierLabel}) — ${status}`);
  }

  const installed = results.filter((r) => r.installed).length;
  lines.push("");
  lines.push(label("Detected", `${installed}/${results.length} installed`));

  finishCommand(format, {
    command: "cli-tools list",
    title: "CLI tools",
    lines,
    style: installed === results.length ? "success" : "info",
    json: {
      selected,
      tools: results.map((r) => ({
        id: r.id,
        installed: r.installed,
        path: r.path ?? null,
        extensionMissing: r.extensionMissing ?? null,
      })),
      installedCount: installed,
      total: results.length,
    },
  });
}

export async function cliToolsInstallCommand(opts: CliToolsCommandOptions = {}): Promise<void> {
  // W5: install may open the installer confirmation prompt when tools are
  // missing, so `--format json` is rejected by the interactive gate.
  beginCommand(opts, { banner: "compact", interactive: true });
  const rootDir = process.cwd();
  const manifest = await readManifest(rootDir);
  assertManifest(manifest);

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

export async function cliToolsDetectCommand(opts: CliToolsCommandOptions = {}): Promise<void> {
  const format = beginCommand(opts, { banner: "compact" });
  const rootDir = process.cwd();
  const manifest = await readManifest(rootDir);
  assertManifest(manifest);

  const selected = manifest.cliTools?.selected ?? [];
  if (selected.length === 0) {
    if (format === "json") {
      finishCommand(format, {
        command: "cli-tools detect",
        title: "CLI tool detection",
        lines: [],
        style: "info",
        json: { selected: [], tools: [], installedCount: 0, total: 0 },
      });
    } else {
      info("No CLI tools selected — run `npx hatch3r cli-tools` first to opt in.");
    }
    return;
  }

  const results = await detectCliTools(selected);
  const lines: string[] = [];
  let installed = 0;
  for (const r of results) {
    if (r.installed) {
      lines.push(`  ${chalk.green("✓")} ${r.id} — ${r.path}`);
      installed++;
    } else if (r.extensionMissing) {
      // D21-M6: base binary on PATH but extension missing — instruct user
      // to add the extension rather than re-installing the wrapper.
      lines.push(`  ${chalk.yellow("✗")} ${r.id} — extension missing: ${r.extensionMissing}`);
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
  finishCommand(format, {
    command: "cli-tools detect",
    title: "CLI tool detection",
    lines,
    style: installed === results.length ? "success" : "info",
    json: {
      selected,
      tools: results.map((r) => ({
        id: r.id,
        installed: r.installed,
        path: r.path ?? null,
        extensionMissing: r.extensionMissing ?? null,
      })),
      installedCount: installed,
      total: results.length,
    },
  });

  if (installed < results.length) {
    warn(`${results.length - installed} CLI tool(s) not detected`);
  }
}
