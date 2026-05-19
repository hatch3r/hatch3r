/**
 * C9-M17 (D10-SA10.2-F2 extension): central funnel for top-level CLI
 * error formatting. All 14 hatch3r CLI commands surface failures through
 * `formatActionableError(err)` so the user-facing error contract is
 * consistent across init/sync/status/update/validate/verify/config/clean
 * /add/worktree-setup/worktree-cleanup/mcp/cli-tools/explain.
 *
 * The funnel reads the structured `recoveryHint` populated by C9-H27 on
 * HatchError and:
 *   - emits a chalk.red-titled boxen block when a hint is present
 *     (visually distinct + scannable in CI logs)
 *   - falls back to a plain stderr line when no hint is available
 *   - classifies unknown errors as "usage" vs "unexpected" via
 *     `classifyCliError` and supplies the corresponding generic guidance
 *
 * The funnel does NOT call `process.exit`. It returns the structured
 * result so the top-level handler (`src/cli/index.ts`) and tests retain
 * control over exit timing (matters for `process.stdout.write` flushing
 * and for assertion in vitest).
 */

import chalk from "chalk";
import boxen from "boxen";
import { HatchError } from "../../types.js";
import { classifyCliError, type CliErrorKind } from "../errorClassification.js";

/** Structured result emitted by {@link formatActionableError}. */
export interface FormattedCliError {
  /** Lines to write to stderr in order (each line is emitted with `console.error`). */
  lines: string[];
  /** Optional boxen block to write to stderr instead of `lines` (when a hint is present). */
  box?: string;
  /** POSIX exit code: 0 = clean cancel, 2 = usage error, 1 = anything else. */
  exitCode: number;
  /** Classification of the error (useful for callers/tests). */
  kind: CliErrorKind | "hatch-error" | "hatch-cancel";
  /** The hint surfaced to the user (when present). */
  hint?: string;
}

/**
 * Convert a caught value at the top-level CLI handler into a structured
 * formatted error. Call sites:
 *   - `src/cli/index.ts` top-level `parseAsync` catch
 *   - future per-command `try/catch` blocks that want to reuse the
 *     contract without re-throwing
 *
 * @param err The caught value (any type — funnel handles `unknown`).
 * @param flags Optional shutdown-tracking flags forwarded to
 *   {@link classifyCliError}. Defaults to `{ shuttingDown: false }`.
 */
export function formatActionableError(
  err: unknown,
  flags: { shuttingDown?: boolean } = {},
): FormattedCliError {
  // 1. HatchError path — already structured. Two subcases:
  //    a) exitCode === 0: clean user cancellation; emit nothing and exit 0.
  //    b) exitCode !== 0: surface message + optional recoveryHint.
  if (err instanceof HatchError) {
    if (err.exitCode === 0) {
      return { lines: [], exitCode: 0, kind: "hatch-cancel" };
    }
    if (err.recoveryHint) {
      // Box format: red title + bold message + dim "Try:" hint. Boxen
      // bounds the message visually in terminals and keeps each hint
      // grep-able in plain-text CI logs.
      const title = chalk.red.bold("hatch3r error");
      const body = `${err.message}\n\n${chalk.dim("Try:")} ${err.recoveryHint}`;
      const box = boxen(body, {
        title,
        titleAlignment: "left",
        padding: { top: 0, bottom: 0, left: 1, right: 1 },
        margin: { top: 1, bottom: 1, left: 0, right: 0 },
        borderColor: "red",
        borderStyle: "round",
      });
      return {
        lines: [],
        box,
        exitCode: err.exitCode,
        kind: "hatch-error",
        hint: err.recoveryHint,
      };
    }
    // HatchError without a hint — keep parity with the pre-funnel
    // behavior (silent exit with structured code) so already-passing
    // tests that throw `new HatchError("msg")` without a hint don't
    // suddenly start emitting two-line stderr.
    return {
      lines: [],
      exitCode: err.exitCode,
      kind: "hatch-error",
    };
  }

  // 2. Generic Error / unknown — classify and emit the legacy multi-line
  //    troubleshooting footer. `classifyCliError` distinguishes clean
  //    user cancellations (ExitPromptError / shutting-down) from
  //    usage / unexpected failures.
  const shuttingDown = flags.shuttingDown ?? false;
  const kind = classifyCliError(err, { shuttingDown });

  if (kind === "exit-prompt" || kind === "shutting-down") {
    // Clean user cancellation — POSIX convention is 130 (128 + SIGINT).
    return { lines: [], exitCode: 130, kind };
  }

  const isUsageError = kind === "usage";
  const msg = err instanceof Error ? err.message : String(err);
  const lines: string[] = [
    "",
    `hatch3r encountered an ${isUsageError ? "usage" : "unexpected"} error: ${msg}`,
  ];
  if (isUsageError) {
    lines.push(`  Run "hatch3r --help" for usage information.`);
  } else {
    lines.push("  For help, see: https://github.com/hatch3r/hatch3r#troubleshooting");
    lines.push("  Check .agents/.failure-log.jsonl for recent failure details.");
    lines.push("  Set DEBUG=1 for a full stack trace.");
  }
  return {
    lines,
    exitCode: isUsageError ? 2 : 1,
    kind,
  };
}

/**
 * Write a {@link FormattedCliError} to stderr. Separated from
 * {@link formatActionableError} so tests can assert structure without
 * spying on `console.error`, and so call sites can decide whether to
 * write before/after their own teardown.
 */
export function writeFormattedCliError(formatted: FormattedCliError): void {
  if (formatted.box) {
    console.error(formatted.box);
    return;
  }
  for (const line of formatted.lines) {
    console.error(line);
  }
}
