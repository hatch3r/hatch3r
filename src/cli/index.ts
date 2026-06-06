// Sync I/O (execFileSync) is used intentionally in init/update for package
// manager operations where async would add complexity without benefit.

import { createProgram } from "./program.js";
import { classifyCliError } from "./errorClassification.js";
import { checkForUpdates } from "./shared/updateNotifier.js";
import { registerBackablePrompts } from "./shared/backablePrompts.js";
import { resolveInvokedCommand } from "./shared/invokedCommand.js";
import { getRunId } from "./shared/runId.js";
import { HatchError } from "../types.js";

// SA12.1-F-D12-M3 (D12, P1): mint the per-run correlation id once at startup
// so every subsequent log line / error block / failure log entry references
// the same identifier. Honors HATCH3R_RUN_ID from the environment to let CI
// inject a build-correlated id; otherwise mints a fresh hr-... suffix.
getRunId();

// Shift+Tab → back-nav. Each entry has been audited to either route every
// prompt through the step machine in `cli/shared/initSteps.ts` (which
// translates BACK into walk-back) or to defensively check `isBack` at each
// inquirer.prompt site (which translates BACK into graceful cancellation).
// Commands not in this set keep inquirer's stock prompts — a stray Shift+Tab
// there has no special meaning, preventing the BACK sentinel from leaking
// into string consumers like sanitizeInput().
//
//   init             — full step machine (single-repo + workspace flows)
//   config           — step machine (main flow); defensive guards in the
//                      workspace sub-flow at end of file
//   worktree-cleanup — step machine (mode → picks → proceed)
//   clean            — defensive (2 confirms, flat sequence)
//   update           — defensive (2 prompts inside a migration checkpoint)
//   mcp / cliTools   — defensive (single picker invocation each)
const BACKABLE_COMMANDS = new Set([
  "init",
  "config",
  "worktree-cleanup",
  "clean",
  "update",
  "mcp",
  "cli-tools",
]);
// D1-8 (Cycle 11 Wave 2, P1): resolve the invoked subcommand by skipping
// leading global-flag tokens (anything starting with "-") rather than reading
// a fixed `process.argv[2]`. A global flag placed before the subcommand —
// e.g. `hatch3r --no-update-check init` — would otherwise make argv[2] the
// flag, the BACKABLE_COMMANDS check would miss, and registerBackablePrompts()
// would never fire, silently defeating Shift+Tab back-navigation in init.
// The `--no-update-check` strip below runs AFTER this block, so it cannot be
// relied on to have removed the flag from argv yet. Resolution logic lives in
// `resolveInvokedCommand` (side-effect-free, unit-tested in
// src/__tests__/cli/invokedCommand.test.ts).
const invokedCommand = resolveInvokedCommand(process.argv);
if (invokedCommand && BACKABLE_COMMANDS.has(invokedCommand)) {
  registerBackablePrompts();
}

const nodeVersion = parseInt(process.version.slice(1), 10);
if (nodeVersion < 22) {
  console.error(
    `hatch3r requires Node.js >= 22.0.0 (current: ${process.version}). Please upgrade Node.js.`,
  );
  process.exit(1);
}

let shuttingDown = false;
// D1-SA1.8-F-1.8-8 (Cycle 10 Wave 4, CQ4): handle SIGHUP (controlling terminal
// closed, SSH disconnect, container shutdown) alongside SIGINT/SIGTERM so a
// terminal-close mid-command flushes buffered output and exits with the
// POSIX-correct code 129 (128 + 1) instead of Node's default abrupt exit 1.
const SIGNAL_EXIT_CODES: Record<string, number> = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Allow pending writes to flush, then exit with POSIX-correct code (128 + signal)
    process.stdout.write("", () => {
      process.stderr.write("", () => {
        process.exit(SIGNAL_EXIT_CODES[signal] ?? 1);
      });
    });
  });
}

process.on("unhandledRejection", (reason) => {
  // D1-M17 (Cycle 10 Wave-3 Medium): apply the same stdout/stderr flush
  // pattern used by the SIGINT/SIGTERM handlers above. A naked
  // `process.exit(1)` truncates the diagnostic on slow stderr sinks
  // (CI logs, piped redirection), so the operator never learns which
  // promise rejected. Drain both streams before exiting.
  console.error(
    `\nhatch3r: unhandled promise rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
  );
  if (process.env.DEBUG) {
    console.error(reason);
  }
  process.stdout.write("", () => {
    process.stderr.write("", () => {
      process.exit(1);
    });
  });
});

// D1-9 (Cycle 11 Wave 2, P1): uncaughtException safety net. The signal handlers
// and unhandledRejection handler above do not cover a synchronous throw raised
// from an emitter / timer / stream callback — such a throw escapes the
// `program.parseAsync()` try/catch below, so its run-id block + failure-log
// pointer (the operator's only triangulation handles) are never printed and
// Node exits with a bare uncaught-exception trace. Mirror the catch block:
// classify clean user cancellations (Ctrl-C during a prompt, in-flight
// shutdown) as exit code 130 with no banner, and surface getRunId() + the
// failure-log pointer for genuine faults before draining and exiting 1.
process.on("uncaughtException", (err) => {
  const kind = classifyCliError(err, { shuttingDown });
  if (kind === "exit-prompt" || kind === "shutting-down") {
    process.exit(SIGNAL_EXIT_CODES.SIGINT);
  }
  const runId = getRunId();
  console.error(
    `\nhatch3r encountered an unexpected error: ${err instanceof Error ? err.message : String(err)}`,
  );
  console.error("  For help, see: https://github.com/hatch3r/hatch3r#troubleshooting");
  console.error("  Check .hatch3r/.failure-log.jsonl for recent failure details.");
  console.error("  Set DEBUG=1 for a full stack trace.");
  console.error(`  Run id: ${runId}`);
  if (process.env.DEBUG) {
    console.error(err);
  }
  process.stdout.write("", () => {
    process.stderr.write("", () => {
      process.exit(1);
    });
  });
});

// --no-update-check: a quiet global flag that maps to HATCH3R_NO_UPDATE_CHECK=1
// for the lifetime of the run. Stripped from argv before the program parses
// so commander does not flag it as unknown when individual commands haven't
// declared it. D1-SA1.8-F-1.8-4 / D10-SA10.2-F9 (Cycle 10 Wave 4, P1): the
// flag is now declared on the program in `program.ts` so `hatch3r --help`
// enumerates it. The strip below must remain the runtime source of truth —
// `checkForUpdates()` reads HATCH3R_NO_UPDATE_CHECK at startup, BEFORE
// `program.parseAsync()`, so the value cannot come from `program.opts()`.
const argvNoCheck = process.argv.indexOf("--no-update-check");
if (argvNoCheck !== -1) {
  process.env.HATCH3R_NO_UPDATE_CHECK = "1";
  process.argv.splice(argvNoCheck, 1);
}

// Queue the registry probe BEFORE parsing so notify({ defer: true }) attaches
// its 'exit' handler in time to run after the command's own output. The probe
// itself runs in a detached child process (cached for 24h), so this call is
// non-blocking even on a cold first run.
checkForUpdates();

const program = createProgram();

try {
  await program.parseAsync();
} catch (err) {
  // SA12.1-F-D12-M3 (D12, P1): always surface the per-run correlation id in
  // the error block so an operator (or a CI consumer grepping logs) can
  // tie one failure to the entries in `.hatch3r/.failures.log` produced
  // during the same run.
  const runId = getRunId();
  if (err instanceof HatchError) {
    // C9-H27 (D10-SA10.2-F2): surface the structured recoveryHint on stderr
    // before exiting so the user sees an actionable next step. Skip on exit 0
    // (clean user-initiated cancellation) — printing a recovery hint there
    // would imply a failure happened. Diagnostics go to stderr per POSIX so
    // they remain visible when stdout is piped (matches src/cli/shared/ui.ts
    // error()/warn() conventions).
    if (err.exitCode !== 0 && err.recoveryHint) {
      console.error(`\nhatch3r: ${err.message}`);
      console.error(`  Try: ${err.recoveryHint}`);
      console.error(`  Run id: ${runId}`);
    } else if (err.exitCode !== 0) {
      // Even when no hint is available, embed the run id so the failure can
      // be correlated across logs.
      console.error(`  Run id: ${runId}`);
    }
    process.exit(err.exitCode);
  }
  // D10-5 (Cycle 11 Wave 2, P1): `program.exitOverride()` (program.ts) makes
  // commander THROW instead of calling `process.exit` itself, so every parse
  // outcome now arrives here as a `CommanderError`. Commander has already
  // written its own message to the right stream before throwing (verified
  // against commander 14.0.3): help/version go to stdout with exitCode 0; a
  // usage error (unknown option, excess/missing args) goes to stderr —
  // `error: <msg>` plus the `showHelpAfterError` pointer — with exitCode 1.
  //   - exitCode 0 → clean help/version request: exit 0, emit nothing more.
  //   - exitCode ≠ 0 → usage error: append ONLY the run id (commander already
  //     printed the message + help pointer; re-printing a "usage error" banner
  //     would duplicate it) and exit 2 so CI can branch on the usage class.
  if (err instanceof Error && err.name === "CommanderError") {
    const commanderExit = (err as { exitCode?: number }).exitCode ?? 0;
    if (commanderExit === 0) {
      process.exit(0);
    }
    console.error(`  Run id: ${runId}`);
    if (process.env.DEBUG) {
      console.error(err);
    }
    process.exit(2);
  }
  // D1-SA1.8.1: Classify ExitPromptError (SIGINT during inquirer prompt) and
  // shuttingDown as clean user cancellations — emitting an "unexpected error"
  // banner for a user-initiated Ctrl-C is a CLI UX regression (P1).
  const kind = classifyCliError(err, { shuttingDown });
  if (kind === "exit-prompt" || kind === "shutting-down") {
    process.exit(SIGNAL_EXIT_CODES.SIGINT);
  }
  const isUsageError = kind === "usage";
  console.error(
    `\nhatch3r encountered an ${isUsageError ? "usage" : "unexpected"} error: ${err instanceof Error ? err.message : String(err)}`,
  );
  if (isUsageError) {
    console.error(`  Run "hatch3r --help" for usage information.`);
  } else {
    console.error("  For help, see: https://github.com/hatch3r/hatch3r#troubleshooting");
    console.error("  Check .hatch3r/.failure-log.jsonl for recent failure details.");
    console.error("  Set DEBUG=1 for a full stack trace.");
  }
  // SA12.1-F-D12-M3: per-run correlation id for log triangulation.
  console.error(`  Run id: ${runId}`);
  if (process.env.DEBUG) {
    console.error(err);
  }
  process.exit(isUsageError ? 2 : 1);
}
