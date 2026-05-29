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

/**
 * C9-H26 (D10-SA10.2-F1): module-level quiet/json flags that command
 * implementations can set via {@link setQuiet} / {@link setJson} before
 * UI calls fire. UI primitives (`printBanner`, `printBox`, `info`,
 * `createSpinner`, `printNextSteps`, `printTimingSummary`) become no-ops
 * on stdout when `quietEnabled === true`. Diagnostics (`error`, `warn`)
 * remain on stderr so failures stay visible. `jsonEnabled` is a stricter
 * variant that callers can read directly to choose between a chrome-free
 * structured emission and the decorated success box.
 */
let quietEnabled = false;
let jsonEnabled = false;

/**
 * Enable or disable quiet mode. Suppresses stdout chrome (banner, spinner
 * text, decorated boxes, info() messages, next-step hints). No effect on
 * stderr (warnings/errors) or on explicit `console.log` callsites elsewhere
 * in the codebase — command implementations should consult {@link isQuiet}
 * before calling those.
 */
export function setQuiet(enabled: boolean): void {
  quietEnabled = enabled;
}

/** Read the current quiet-mode flag. */
export function isQuiet(): boolean {
  return quietEnabled;
}

/**
 * Enable or disable json mode. Setting `enabled = true` also turns on
 * quiet mode (json output replaces all decorated chrome). Setting
 * `enabled = false` clears only the json flag; callers must additionally
 * call `setQuiet(false)` to fully reset chrome state. Callers should
 * branch on {@link isJson} before emitting the success box and emit a
 * structured JSON line instead.
 */
export function setJson(enabled: boolean): void {
  jsonEnabled = enabled;
  if (enabled) quietEnabled = true;
}

/** Read the current json-mode flag. */
export function isJson(): boolean {
  return jsonEnabled;
}

/**
 * D1-SA1.1-F09 (CQ8 maintainability): reset EVERY module-global UI flag to its
 * default in one place. The module-global chrome flags (`quietEnabled`,
 * `jsonEnabled`, `verboseEnabled`) persist for the process lifetime; under
 * vitest the ui module is shared across tests in the same worker, so a test
 * that sets `--json`/`--quiet`/`--verbose` and forgets to reset leaks state
 * into the next test. The prior mitigation reset json+quiet inline in
 * `initCommand` but (a) omitted `verbose` and (b) lived in the command file, so
 * any FUTURE ui-flag added here could be forgotten at the call site.
 *
 * Centralizing the reset next to the flag declarations closes that leak class:
 * a new flag is added beside `quietEnabled`/`jsonEnabled`/`verboseEnabled` AND
 * to this function in the same edit. Command entry points call this once at the
 * top before deriving their own values; tests call it in `beforeEach`. The CI
 * guard at `src/__tests__/cli/ui.test.ts` asserts all getters read false after
 * a reset so an omitted flag fails loudly.
 */
export function resetUiState(): void {
  quietEnabled = false;
  jsonEnabled = false;
  verboseEnabled = false;
}

export function printBanner(compact = false): void {
  if (quietEnabled) return;
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

/**
 * C9-H26: minimal Ora-compatible no-op surface used when quiet mode is on.
 * Matches the subset of `Ora` methods that init/sync call so the spinner
 * call sites do not need conditional dispatch. Returns `this` from every
 * chainable method so existing chained code (e.g. `spinner.start().succeed()`)
 * keeps compiling and running.
 */
function silentSpinner(): Ora {
  const noop = (() => silent) as never;
  const silent = {
    text: "",
    prefixText: "",
    color: "cyan",
    indent: 2,
    spinner: "dots",
    isSpinning: false,
    start: noop,
    stop: noop,
    succeed: noop,
    fail: noop,
    warn: noop,
    info: noop,
    stopAndPersist: noop,
    clear: noop,
    render: noop,
    frame: () => "",
  } as unknown as Ora;
  return silent;
}

export function createSpinner(text: string): Ora {
  if (quietEnabled) return silentSpinner();
  // D10-M6 (Cycle 10): pin the ora stream to `process.stderr` so progress
  // chrome follows the same POSIX rationale already applied to `error()` /
  // `warn()` below (line 195+). Keeps stdout clean for CI consumers that
  // parse only structured output (e.g. `hatch3r status --json | jq`) while
  // leaving the spinner visible interactively. ora respects stderr's
  // `isTTY` and falls back to no-op rendering under redirection.
  return ora({
    text,
    color: "cyan",
    spinner: "dots",
    indent: 2,
    stream: process.stderr,
  });
}

export function printBox(
  title: string,
  lines: string[],
  style: "success" | "info" | "error" | "warning" = "info",
): void {
  if (quietEnabled) return;
  const colors = {
    success: "#10b981" as const,
    info: "#06b6d4" as const,
    error: "#ef4444" as const,
    warning: "#f59e0b" as const,
  };
  const content = lines.join("\n");
  // D10-M5 (Cycle 10): `dimBorder` was previously applied to `style === "info"`,
  // which made the most common box variant the least readable in low-contrast
  // terminals (white-on-light themes, dimmed remote sessions). All four
  // styles now use full-saturation borders — colour alone differentiates
  // success / info / error / warning per WCAG-equivalent contrast intent.
  console.log(
    boxen(content, {
      title,
      titleAlignment: "left",
      padding: { top: 0, bottom: 0, left: 1, right: 1 },
      margin: { top: 0, bottom: 1, left: 1, right: 0 },
      borderColor: colors[style],
      borderStyle: "round",
    }),
  );
}

// POSIX convention: diagnostics (errors, warnings) go to stderr so they remain
// visible when stdout is redirected/piped, and CI systems (GitHub Actions,
// GitLab CI) can parse stderr for failure signals.
// Reference: https://en.wikipedia.org/wiki/Standard_streams

/**
 * D10-SA10.2-F10 (Cycle 10 Wave 4, D10, P1): whether the active terminal
 * renders Unicode glyphs. `error()`/`warn()`/`info()` use the glyphs `✖ ⚠ ℹ`,
 * which Windows cmd.exe under a legacy code page (and some CI log pipelines
 * that strip non-ASCII) render as `?`. chalk auto-strips ANSI colour under
 * `NO_COLOR`/non-TTY but does NOT touch the glyph codepoints themselves, so a
 * dedicated probe is required.
 *
 * Detection mirrors sindresorhus/is-unicode-supported without the dependency:
 * non-Windows is assumed UTF-capable; on Windows, UTF-8 is signalled by
 * Windows Terminal (`WT_SESSION`), modern terminals (`TERM_PROGRAM`), CI, or a
 * UTF-8 locale on `LANG`/`LC_ALL`/`LC_CTYPE`. An explicit `HATCH3R_ASCII=1`
 * (or NO_COLOR with a non-UTF Windows locale) forces the ASCII path so the
 * fallback is testable via `HATCH3R_ASCII=1` / `LANG=C` without a real
 * cmd.exe. Result is computed per-call (not cached) so tests can toggle env.
 *
 * Reference: https://github.com/sindresorhus/is-unicode-supported (accessed
 * 2026-05-29) and https://no-color.org/ (accessed 2026-05-29).
 */
function supportsUnicode(): boolean {
  if (process.env.HATCH3R_ASCII === "1") return false;
  if (process.platform !== "win32") return true;
  if (process.env.CI !== undefined) return true;
  if (process.env.WT_SESSION !== undefined) return true; // Windows Terminal
  if (process.env.TERM_PROGRAM === "vscode") return true;
  const locale = process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || "";
  return /UTF-?8$/i.test(locale);
}

/**
 * D10-SA10.2-F10: status glyphs with an ASCII fallback for terminals that do
 * not render Unicode (legacy Windows cmd.exe, ASCII-only CI log sinks). Each
 * accessor resolves at call time so a per-invocation env toggle (`HATCH3R_ASCII=1`)
 * exercises the fallback. The glyphs keep their prior codepoints on capable
 * terminals so no interactive UX changes.
 */
const GLYPHS = {
  error: { unicode: "✖", ascii: "[X]" },
  warn: { unicode: "⚠", ascii: "[!]" },
  info: { unicode: "ℹ", ascii: "[i]" },
  success: { unicode: "✔", ascii: "[OK]" },
} as const;

/** Resolve a status glyph to its Unicode or ASCII form for the active terminal. */
export function glyph(kind: keyof typeof GLYPHS): string {
  const g = GLYPHS[kind];
  return supportsUnicode() ? g.unicode : g.ascii;
}

export function error(msg: string): void {
  console.error(`  ${chalk.red(glyph("error"))} ${msg}`);
}

export function warn(msg: string): void {
  console.error(`  ${chalk.yellow(glyph("warn"))} ${msg}`);
}

export function info(msg: string): void {
  if (quietEnabled) return;
  console.log(`  ${CYAN(glyph("info"))} ${msg}`);
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

/**
 * Read the current verbose flag. Symmetric with {@link isQuiet} /
 * {@link isJson}; lets the D1-SA1.1-F09 leak-class guard assert that
 * {@link resetUiState} cleared verbose along with quiet+json.
 */
export function isVerbose(): boolean {
  return verboseEnabled;
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
  if (quietEnabled) return;
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
  if (quietEnabled) return;
  const elapsed = Date.now() - startMs;
  const seconds = (elapsed / 1000).toFixed(1);
  console.log(chalk.dim(`  Completed in ${seconds}s\n`));
}
