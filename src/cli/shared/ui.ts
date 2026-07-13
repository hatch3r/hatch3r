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
//
// D10-SA10.2-05 (Cycle 12, Info — recorded tension, not a defect): the six
// LOGO rows are ~330 non-semantic block/box-drawing codepoints. A screen
// reader announces them as noise before reaching the two text lines below
// (tagline + version), which are the banner's only text alternative. Four
// suppression paths exist — `--no-banner` (src/cli/program.ts), `--quiet`,
// `--json` (both via setQuiet/setJson), and the compact-banner path
// (`printBanner(true)`) — but none is screen-reader-specific: `NO_COLOR`
// (https://no-color.org/, accessed 2026-05-29) strips only the chalk
// gradient, NOT the glyph codepoints themselves. Optional future improvement
// (deferred, not implemented this cycle): treat `NO_COLOR` and/or
// `HATCH3R_ASCII=1` as implying the compact/no-banner path so the standard
// non-visual-environment signals also quiet the decorative block.
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
  // terminals (white-on-light themes, dimmed remote sessions). All four styles
  // use full-saturation borders, which satisfies WCAG 1.4.3 (contrast) — and
  // ONLY 1.4.3. Border colour is NOT a sufficient severity signal on its own:
  // WCAG 1.4.1 (Use of Color) prohibits colour as the only visual means of
  // conveying information (https://www.w3.org/WAI/WCAG21/Understanding/
  // use-of-color.html, accessed 2026-07-11), and chalk strips the border
  // colour entirely under NO_COLOR / non-TTY. The semantic must live in the
  // title or body text.
  //
  // D10-SA10.2-04 + D12-SA12.1-04 (Cycle 12): redundant-coding guarantee —
  // for `error`/`warning` boxes the severity glyph (`✖`/`⚠`, ASCII `[X]`/`[!]`
  // via glyph()) is prepended to the title HERE, at the render layer, so an
  // alarm box is never border-colour-only regardless of the caller's title
  // text. `info`/`success` titles stay undecorated by design: absence of an
  // alarm glyph is itself the non-alarming signal, which keeps the
  // errors-vs-warnings-vs-informational triple distinguishable in monochrome
  // without stamping a glyph on the most common (info) box variant.
  const decoratedTitle =
    style === "error"
      ? `${glyph("error")} ${title}`
      : style === "warning"
        ? `${glyph("warn")} ${title}`
        : title;
  console.log(
    boxen(content, {
      title: decoratedTitle,
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
 *
 * D10-SA10.2-03 (Cycle 12): also carries the key-cap glyphs (`upDown`,
 * `enter`) the interactive-prompt help chrome renders, so the
 * `backablePrompts.ts` fork consumes the SAME fallback path instead of
 * hardcoding `↑↓`/`⏎` literals that degrade to `?` on non-Unicode terminals.
 * One shared map removes the fork/ui.ts divergence class.
 */
const GLYPHS = {
  error: { unicode: "✖", ascii: "[X]" },
  warn: { unicode: "⚠", ascii: "[!]" },
  info: { unicode: "ℹ", ascii: "[i]" },
  success: { unicode: "✔", ascii: "[OK]" },
  upDown: { unicode: "↑↓", ascii: "up/down" },
  enter: { unicode: "⏎", ascii: "enter" },
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

/**
 * D1-SA1.7-06 (Cycle 12, P1): quiet-immune PAYLOAD writer for read-only
 * inspection commands whose primary output IS the data (explain/show/deps).
 *
 * The W5 chrome/payload split was drawn at the render-helper layer: `printBox`
 * and `info` self-gate under `--quiet`, so a command that routes 100% of its
 * payload through them (e.g. `explain --cost … --quiet`) exits 0 having
 * emitted zero bytes — `--quiet` negating a command's entire purpose violates
 * the clig.dev quiet contract ("display less output", i.e. suppress the
 * NON-essential output; https://clig.dev/, accessed 2026-07-11). This writer
 * is the payload-side channel of that split:
 *
 * - NOT gated by quiet — `--quiet` strips chrome (banner, boxes, hints),
 *   never the payload.
 * - Gated by json — in `--format json` mode stdout carries exactly one JSON
 *   envelope (see `emitJson` in src/cli/shared/output.ts); human payload must
 *   not interleave.
 *
 * Inspection commands route data lines through this writer and keep chrome on
 * `printBox`/`info`, aligning show/deps/explain on one quiet contract.
 */
export function printPayload(msg: string): void {
  if (jsonEnabled) return;
  console.log(msg);
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
 * D10-23 (Cycle 11 Wave 3, D10, P1 — WCAG 1.4.3 AA): emphasize the
 * action-critical command token (the backtick-delimited `` `cmd` `` segment) of
 * a next-step line at normal weight in bold cyan, rather than rendering the
 * whole line in `chalk.dim` (SGR 2). SGR 2 drops effective contrast below the
 * 4.5:1 AA floor on light/low-contrast terminal themes, so the most important
 * part of the guidance — the command the user must type — was the least legible.
 * The prose around the token stays at the terminal's default foreground weight
 * (no SGR 2); only the leading bullet decoration is dimmed as tertiary chrome.
 * Backticks are consumed (display markers, not literal output).
 */
function emphasizeNextStep(step: string): string {
  // Split on `` `...` `` spans; odd indices are the command tokens.
  return step
    .split(/`([^`]+)`/)
    .map((seg, i) => (i % 2 === 1 ? CYAN.bold(seg) : seg))
    .join("");
}

/**
 * D19 Medium (#415-#431): Display a success message with next-steps guidance.
 * Used after init/update to reduce first-run friction. Each step renders at the
 * terminal's default foreground weight with its command token bolded (see
 * {@link emphasizeNextStep} for the D10-23 WCAG 1.4.3 rationale).
 */
export function printNextSteps(steps: string[]): void {
  if (quietEnabled) return;
  if (steps.length === 0) return;
  console.log(chalk.dim("\n  Next steps:"));
  for (const s of steps) {
    console.log(`    ${chalk.dim("·")} ${emphasizeNextStep(s)}`);
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
