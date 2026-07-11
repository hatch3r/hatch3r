// Sync I/O (execFileSync) is used intentionally in init/update for package
// manager operations where async would add complexity without benefit.

import { resolve } from "node:path";
import { createProgram } from "./program.js";
import { classifyCliError } from "./errorClassification.js";
import { formatActionableError, writeFormattedCliError } from "./shared/errors.js";
import { checkForUpdates } from "./shared/updateNotifier.js";
import { registerBackablePrompts } from "./shared/backablePrompts.js";
import { resolveInvokedCommand } from "./shared/invokedCommand.js";
import { getRunId } from "./shared/runId.js";
import { writeFailureLog } from "../pipeline/failureLog.js";
import { HATCH3R_VERSION } from "../version.js";

// SA12.1-F-D12-M3 (D12, P1): mint the per-run correlation id once at startup
// so every subsequent log line / error block / failure log entry references
// the same identifier. Honors HATCH3R_RUN_ID from the environment to let CI
// inject a build-correlated id; otherwise mints a fresh hr-... suffix.
getRunId();

// Shift+Tab → back-nav. Each entry either routes every prompt through the step
// machine in `cli/shared/initSteps.ts` (which translates BACK into walk-back)
// or defensively checks `isBack` at each inquirer.prompt site (which translates
// BACK into graceful cancellation). Commands not in this set keep inquirer's
// stock prompts — a stray Shift+Tab there has no special meaning, preventing
// the BACK sentinel from leaking into string consumers like sanitizeInput().
//
// D3-SA3.2-04 (Cycle 12 Wave 3, D3, P5): this invariant is machine-enforced,
// not self-certified. The "BACKABLE back-nav guard invariant" suite in
// `src/__tests__/cli/index.test.ts` reads this set and asserts, per member,
// that its command source EITHER uses `runStepMachine` OR guards every
// `inquirer.prompt` site with an `isBack` check that cancels rather than falls
// through — so a command added here without wiring BACK handling fails that
// test. A hand-maintained per-command prose census used to live here and
// drifted (it claimed "update — 2 prompts" after update grew to 4 guarded
// sites); the test is the invariant's single home now, so there is no census
// to re-stale.
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

// ── Last-resort fault nets (uncaughtException / unhandledRejection) ──────────
//
// These catch a throw/rejection that escapes the `program.parseAsync()`
// try/catch below: a synchronous throw from an emitter / timer / stream
// callback, and a detached-promise rejection (the update-notifier child,
// best-effort failure-log / telemetry writes). Both nets share three helpers so
// they cannot drift apart (D8-SA8.1-02) and so the failure-log recovery pointer
// they print resolves to a real entry (D12-SA12.1-01).

/**
 * D12-SA12.1-01 (Cycle 12 Wave 3, D12, CQ2): append a top-level fault to
 * `.hatch3r/.failure-log.jsonl` for the current run so the "Check
 * .failure-log.jsonl for recent failure details" pointer the fault footer +
 * error funnel print resolves to a real entry — previously index.ts named the
 * file as a recovery surface but never wrote it, so an operator (or a CI
 * consumer grepping the run id) who followed the guidance found nothing. Returns
 * whether the entry actually persisted. `writeFailureLog` is contracted never to
 * throw and does NOT create `.hatch3r/`; on a fresh repo whose state dir was
 * never created (e.g. `init` crashed first) the append no-ops, this returns
 * false, and the caller suppresses the pointer rather than dangling it at an
 * absent file.
 */
async function recordTopLevelFailure(phase: string, err: unknown): Promise<boolean> {
  const hatch3rDir = resolve(process.cwd(), ".hatch3r");
  const result = await writeFailureLog(hatch3rDir, phase, err, {
    correlationId: getRunId(),
    version: HATCH3R_VERSION,
  });
  return result.written;
}

/**
 * Shared operator-facing fault footer (D8-SA8.1-02): troubleshooting URL, the
 * failure-log pointer (only when the entry persisted, so it never dangles), the
 * DEBUG hint, and the per-run correlation id. Both last-resort nets emit it
 * through this one helper so a future line addition cannot drift between them.
 */
function emitFaultFooter(runId: string, failureLogPersisted: boolean): void {
  console.error("  For help, see: https://github.com/hatch3r/hatch3r#troubleshooting");
  if (failureLogPersisted) {
    console.error("  Check .hatch3r/.failure-log.jsonl for recent failure details.");
  }
  console.error("  Set DEBUG=1 for a full stack trace.");
  console.error(`  Run id: ${runId}`);
}

/**
 * D1-9 (Cycle 11) + D1-M17 (Cycle 10) + D8-SA8.1-02 (Cycle 12): shared body for
 * both last-resort nets. Classify clean user cancellations (Ctrl-C during a
 * prompt, in-flight shutdown) as exit 130 with no banner; for a genuine fault,
 * print the headline, persist the failure-log entry, emit the shared footer, and
 * drain stdout+stderr before exiting 1 (a naked `process.exit(1)` truncates the
 * diagnostic on slow stderr sinks — CI logs, piped redirection — so the operator
 * never learns which throw/rejection fired). Kept async so the failure-log write
 * completes before the drain+exit; invoked via `void` from the synchronous
 * `process.on` callbacks so the handler signature stays synchronous.
 */
async function reportFatal(err: unknown, phase: string, headline: string): Promise<void> {
  const kind = classifyCliError(err, { shuttingDown });
  if (kind === "exit-prompt" || kind === "shutting-down") {
    process.exit(SIGNAL_EXIT_CODES.SIGINT);
  }
  const runId = getRunId();
  console.error(`\n${headline}: ${err instanceof Error ? err.message : String(err)}`);
  const failureLogPersisted = await recordTopLevelFailure(phase, err);
  emitFaultFooter(runId, failureLogPersisted);
  if (process.env.DEBUG) {
    console.error(err);
  }
  process.stdout.write("", () => {
    process.stderr.write("", () => {
      process.exit(1);
    });
  });
}

// D8-SA8.1-02 (Cycle 12 Wave 3, P1): the `unhandledRejection` net was
// diagnostically inferior to its `uncaughtException` sibling — it printed only a
// bare "unhandled promise rejection" line with no run id, no failure-log
// pointer, and no clean-cancellation classification, so a rejection surfacing
// during Ctrl-C teardown was mislabeled a bug (exit 1) instead of a clean 130
// and a genuine detached-promise rejection handed the operator no correlation
// handle. Routing both nets through `reportFatal` brings them to parity; only
// the headline differs (a rejection vs a thrown error).
process.on("unhandledRejection", (reason) => {
  void reportFatal(reason, "cli:unhandled-rejection", "hatch3r: unhandled promise rejection");
});
process.on("uncaughtException", (err) => {
  void reportFatal(err, "cli:uncaught-exception", "hatch3r encountered an unexpected error");
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
  // tie one failure to the entries in `.hatch3r/.failure-log.jsonl` produced
  // during the same run.
  const runId = getRunId();
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
  // This branch is kept ahead of the funnel because the funnel re-emits a
  // full "usage error" banner + help pointer for a CommanderError, which would
  // duplicate what commander already wrote.
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
  // D8-1 (Cycle 11 Wave 2, P1): route every remaining caught value through the
  // single CLI error funnel `src/cli/shared/errors.ts`. Before this wave the
  // top-level catch had an inline HatchError block that surfaced ONLY
  // `err.recoveryHint` and never the errorCode-keyed `DEFAULT_RECOVERY_HINT`
  // floor — so the 53% of fatal HatchErrors with no explicit hint (28 of 53)
  // exited silently, defeating the funnel the same audit cycle built to close
  // that gap. `formatActionableError` resolves the explicit hint OR the floor,
  // boxes it, classifies generic/unknown errors (usage vs unexpected), and
  // treats ExitPromptError / shutting-down as clean cancellations — so the
  // catch no longer duplicates that logic inline. `writeFormattedCliError`
  // renders the box (or the multi-line footer) to stderr; we keep
  // `process.exit` here so the handler retains control of flush timing.
  const formatted = formatActionableError(err, { shuttingDown });
  // D12-SA12.1-01 (Cycle 12 Wave 3, D12, CQ2): the funnel's unexpected-fault
  // path prints "Check .hatch3r/.failure-log.jsonl for recent failure details."
  // Append this fault to that log for the current run so the pointer resolves to
  // a real entry (index.ts previously named the file but never wrote it). Skip
  // clean cancellations (exit 0 / 130) and usage typos — those emit no pointer.
  if (
    formatted.exitCode !== 0 &&
    formatted.kind !== "usage" &&
    formatted.kind !== "exit-prompt" &&
    formatted.kind !== "shutting-down"
  ) {
    await recordTopLevelFailure("cli:top-level", err);
  }
  writeFormattedCliError(formatted);
  if (process.env.DEBUG) {
    console.error(err);
  }
  // D1-SA1.4-01 (Cycle 12 Wave 3, D1, P1): drain stdout+stderr before exiting.
  // A command that already wrote a JSON document to stdout (verify/status
  // --format json) then threw lands here; `process.exit` truncates pending async
  // stdout writes past the OS pipe buffer (Node docs: process.exit "will force
  // the process to exit ... even if there are still asynchronous operations
  // pending ... including I/O operations to process.stdout"), corrupting the
  // machine-parsed payload exactly when the command failed. The same drain idiom
  // the signal/crash nets use guarantees the buffered payload flushes first.
  process.stdout.write("", () => {
    process.stderr.write("", () => {
      process.exit(formatted.exitCode);
    });
  });
}
