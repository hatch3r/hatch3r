// Sync I/O (execFileSync) is used intentionally in init/update for package
// manager operations where async would add complexity without benefit.

import { createProgram } from "./program.js";
import { classifyCliError } from "./errorClassification.js";
import { checkForUpdates } from "./shared/updateNotifier.js";
import { registerBackablePrompts } from "./shared/backablePrompts.js";
import { HatchError } from "../types.js";

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
const invokedCommand = process.argv[2];
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
const SIGNAL_EXIT_CODES: Record<string, number> = { SIGINT: 130, SIGTERM: 143 };
for (const signal of ["SIGINT", "SIGTERM"] as const) {
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
  console.error(
    `\nhatch3r: unhandled promise rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
  );
  if (process.env.DEBUG) {
    console.error(reason);
  }
  process.exit(1);
});

// --no-update-check: a quiet global flag that maps to HATCH3R_NO_UPDATE_CHECK=1
// for the lifetime of the run. Stripped from argv before the program parses
// so commander does not flag it as unknown when individual commands haven't
// declared it.
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
    }
    process.exit(err.exitCode);
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
    console.error("  Check .agents/.failure-log.jsonl for recent failure details.");
    console.error("  Set DEBUG=1 for a full stack trace.");
  }
  if (process.env.DEBUG) {
    console.error(err);
  }
  process.exit(isUsageError ? 2 : 1);
}
