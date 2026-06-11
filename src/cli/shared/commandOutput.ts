/**
 * Wave 5 (W5s1-commandOutput, P1+P5): standardized begin/end lifecycle for
 * hatch3r CLI commands. Before this module each command hand-rolled the same
 * preamble (reset UI state, resolve `--format`, wire quiet/verbose, print the
 * banner) and the same epilogue (success box + next steps + timing OR a
 * one-shot JSON document), so the flag surface and the JSON envelope drifted
 * per command. {@link beginCommand} / {@link finishCommand} are the single
 * chokepoint both contracts flow through; commands adopt incrementally in a
 * later wave (no call sites are migrated in this slice).
 *
 * Division of labor: `output.ts` owns format parsing + raw JSON emission
 * (chalk-free for JSON-mode callers); `ui.ts` owns the decorated chrome and
 * its quiet/json gating. This module composes the two — it adds no third
 * output channel.
 */

import { HatchError } from "../../types.js";
import { HATCH3R_VERSION } from "../../version.js";
import { type CliOutputFormat, parseFormatOption, emitJson } from "./output.js";
import {
  resetUiState,
  setJson,
  setQuiet,
  setVerbose,
  printBanner,
  printBox,
  printNextSteps,
  printTimingSummary,
} from "./ui.js";

/** Flags every standardized command's Commander opts can carry. */
export interface StandardCliFlags {
  /** `--format <human|json>` (normalized via {@link parseFormatOption}). */
  format?: string;
  /** `--quiet`: suppress stdout chrome (banner, boxes, next steps, timing). */
  quiet?: boolean;
  /** `--verbose`: enable verbose stderr diagnostics (only where registered). */
  verbose?: boolean;
  /** Legacy `--json` boolean alias (init back-compat); upgrades format to "json". */
  json?: boolean;
  /** `--yes` headless marker; gates `--format json` on interactive commands. */
  yes?: boolean;
}

/** Per-command configuration for {@link beginCommand}. */
export interface BeginCommandConfig {
  /** Banner style for human mode. Default "none" (no banner). */
  banner?: "compact" | "full" | "none";
  /**
   * Whether the command prompts the user (inquirer flows). When true,
   * `--format json` without `--yes` is a usage error: an interactive prompt
   * would interleave with the single-document stdout contract.
   */
  interactive?: boolean;
}

/**
 * Entry preamble for a standardized command. In order:
 * 1. {@link resetUiState} — clear module-global quiet/json/verbose flags
 *    (D1-SA1.1-F09 leak-class guard; vitest workers share the ui module).
 * 2. Resolve the output format: `--format` via {@link parseFormatOption}
 *    (invalid values throw exit-2 per D10-22), with the legacy `--json`
 *    boolean as a one-way upgrade to `"json"`.
 * 3. Reject `--format json` on an interactive command without `--yes`
 *    (exit 2, VALIDATION_ERROR) BEFORE any UI flag mutates.
 * 4. Wire ui flags: `setJson(format === "json")`, then `setQuiet(true)` /
 *    `setVerbose(true)` only when the flag is set — never `setQuiet(false)`,
 *    which would undo the quiet mode `setJson(true)` implies.
 * 5. Print the configured banner in human mode only (JSON mode is a single
 *    stdout document; quiet mode is additionally self-gated inside ui.ts).
 *
 * @returns The resolved format the command should branch on.
 */
export function beginCommand(
  opts: StandardCliFlags,
  cfg: BeginCommandConfig = {},
): CliOutputFormat {
  resetUiState();
  const parsed = parseFormatOption(opts.format);
  const format: CliOutputFormat =
    parsed === "json" || opts.json === true ? "json" : parsed;
  if (format === "json" && cfg.interactive === true && opts.yes !== true) {
    throw new HatchError(
      "--format json cannot drive an interactive prompt flow: the prompts would interleave with the single JSON document on stdout.",
      2,
      "VALIDATION_ERROR",
      "Add --yes (or use the scalar form, e.g. `hatch3r config get <key>`), or drop --format json.",
    );
  }
  setJson(format === "json");
  if (opts.quiet === true) setQuiet(true);
  if (opts.verbose === true) setVerbose(true);
  if (format !== "json" && cfg.banner !== undefined && cfg.banner !== "none") {
    printBanner(cfg.banner === "compact");
  }
  return format;
}

/** Terminal outcome of a standardized command, rendered by {@link finishCommand}. */
export interface CommandOutcome {
  /** Command identity for the JSON envelope (e.g. "sync", "mcp setup"). */
  command: string;
  /** Box title — callers pass their existing title strings VERBATIM. */
  title: string;
  /** Box body lines (human mode). */
  lines: string[];
  /** Box style; also derives the JSON `status`. Default "success". */
  style?: "success" | "info" | "warning" | "error";
  /** 0-3 follow-up suggestions (human mode only). */
  nextSteps?: string[];
  /** Command-entry wall clock; when present, prints the timing summary. */
  startMs?: number;
  /** Command-specific JSON fields, spread into the envelope. */
  json?: Record<string, unknown>;
}

/** style → JSON envelope `status` derivation (overridable via `outcome.json.status`). */
const STYLE_TO_STATUS: Record<NonNullable<CommandOutcome["style"]>, string> = {
  success: "passed",
  info: "ok",
  warning: "partial",
  error: "failed",
};

/**
 * Exit epilogue for a standardized command: one outcome box (+ next steps +
 * timing) in human mode, OR one JSON document in JSON mode — never both.
 *
 * JSON envelope: `{ status, command, ...outcome.json, hatch3rVersion,
 * timestamp }`. `status` derives from `style` but a `status` key inside
 * `outcome.json` wins (spread order); `hatch3rVersion` and `timestamp` are
 * appended last so commands cannot clobber the envelope's provenance fields.
 */
export function finishCommand(format: CliOutputFormat, outcome: CommandOutcome): void {
  const style = outcome.style ?? "success";
  if (format === "json") {
    emitJson({
      status: STYLE_TO_STATUS[style],
      command: outcome.command,
      ...outcome.json,
      hatch3rVersion: HATCH3R_VERSION,
      timestamp: new Date().toISOString(),
    });
    return;
  }
  printBox(outcome.title, outcome.lines, style);
  if (outcome.nextSteps !== undefined && outcome.nextSteps.length > 0) {
    printNextSteps(outcome.nextSteps);
  }
  if (outcome.startMs !== undefined) {
    printTimingSummary(outcome.startMs);
  }
}
