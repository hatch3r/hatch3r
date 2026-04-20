import chalk from "chalk";
import ora, { type Ora } from "ora";
import boxen from "boxen";
import { HATCH3R_VERSION } from "../../version.js";

const CYAN = chalk.hex("#06b6d4");
const DIM_CYAN = chalk.hex("#67e8f9");

const SHADOW_CHARS = new Set("╔═╗╚╝║");

function gradient(
  text: string,
  from: [number, number, number],
  to: [number, number, number],
): string {
  const chars = [...text];
  const len = chars.filter((c) => c !== " ").length;
  let idx = 0;
  return chars
    .map((c) => {
      if (c === " ") return c;
      const t = len > 1 ? idx / (len - 1) : 0;
      idx++;
      const r = Math.round(from[0] + (to[0] - from[0]) * t);
      const g = Math.round(from[1] + (to[1] - from[1]) * t);
      const b = Math.round(from[2] + (to[2] - from[2]) * t);
      if (SHADOW_CHARS.has(c)) {
        const DIM = 0.55;
        return chalk.rgb(
          Math.round(r * DIM),
          Math.round(g * DIM),
          Math.round(b * DIM),
        )(c);
      }
      return chalk.rgb(r, g, b).bold(c);
    })
    .join("");
}

// ANSI Shadow style — 6-row glyphs with 3D depth via block + box-drawing chars
const LOGO = [
  "██╗  ██╗ █████╗ ████████╗ ██████╗██╗  ██╗██████╗ ██████╗ ",
  "██║  ██║██╔══██╗╚══██╔══╝██╔════╝██║  ██║╚════██╗██╔══██╗",
  "███████║███████║   ██║   ██║     ███████║ █████╔╝██████╔╝",
  "██╔══██║██╔══██║   ██║   ██║     ██╔══██║ ╚═══██╗██╔══██╗",
  "██║  ██║██║  ██║   ██║   ╚██████╗██║  ██║██████╔╝██║  ██║",
  "╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝    ╚═════╝╚═╝  ╚═╝╚═════╝ ╚═╝  ╚═╝",
].map((row) => gradient(row, [6, 182, 212], [20, 184, 166]));

function buildBanner(): string[] {
  const lines: string[] = [""];
  for (const row of LOGO) {
    lines.push(`  ${row}`);
  }
  lines.push(`  ${DIM_CYAN("Crack the egg. Hatch better agents.")}`);
  lines.push(`  ${chalk.dim(`v${HATCH3R_VERSION}`)}`);
  lines.push("");
  return lines;
}

const BANNER_LINES = buildBanner();

export function printBanner(compact = false): void {
  if (compact) {
    console.log(
      `\n  ${CYAN.bold("hatch3r")} ${chalk.dim(`v${HATCH3R_VERSION}`)}\n`,
    );
    return;
  }
  for (const line of BANNER_LINES) {
    console.log(line);
  }
}

export function createSpinner(text: string): Ora {
  return ora({
    text,
    color: "cyan",
    spinner: "dots",
    indent: 2,
  });
}

export function printBox(
  title: string,
  lines: string[],
  style: "success" | "info" | "error" = "info",
): void {
  const colors = {
    success: "#10b981" as const,
    info: "#06b6d4" as const,
    error: "#ef4444" as const,
  };
  const content = lines.join("\n");
  console.log(
    boxen(content, {
      title,
      titleAlignment: "left",
      padding: { top: 0, bottom: 0, left: 1, right: 1 },
      margin: { top: 0, bottom: 1, left: 1, right: 0 },
      borderColor: colors[style],
      borderStyle: "round",
      dimBorder: style === "info",
    }),
  );
}

// POSIX convention: diagnostics (errors, warnings) go to stderr so they remain
// visible when stdout is redirected/piped, and CI systems (GitHub Actions,
// GitLab CI) can parse stderr for failure signals.
// Reference: https://en.wikipedia.org/wiki/Standard_streams

export function error(msg: string): void {
  console.error(`  ${chalk.red("✖")} ${msg}`);
}

export function warn(msg: string): void {
  console.error(`  ${chalk.yellow("⚠")} ${msg}`);
}

export function info(msg: string): void {
  console.log(`  ${CYAN("ℹ")} ${msg}`);
}

export function step(n: number, total: number, msg: string): string {
  return `${chalk.dim(`[${n}/${total}]`)} ${msg}`;
}

export function label(name: string, value: string): string {
  return `${chalk.dim(name.padEnd(12))} ${value}`;
}

/** Whether verbose output is enabled for the current command. */
let verboseEnabled = false;

/** Enable or disable verbose output. Call before command execution. */
export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled;
}

/** Print a verbose-only message to stderr. No-op when verbose is off. */
export function verbose(msg: string): void {
  if (!verboseEnabled) return;
  console.error(`  ${chalk.dim("[verbose]")} ${msg}`);
}

/**
 * D19 Medium (#415-#431): Display a success message with next-steps guidance.
 * Used after init/update to reduce first-run friction.
 */
export function printNextSteps(steps: string[]): void {
  if (steps.length === 0) return;
  console.log(chalk.dim("\n  Next steps:"));
  for (const s of steps) {
    console.log(chalk.dim(`    ${s}`));
  }
  console.log();
}

/**
 * D19 Medium (#415-#431): Print a compact timing summary.
 * Used at the end of sync/validate to show elapsed time.
 */
export function printTimingSummary(startMs: number): void {
  const elapsed = Date.now() - startMs;
  const seconds = (elapsed / 1000).toFixed(1);
  console.log(chalk.dim(`  Completed in ${seconds}s\n`));
}
