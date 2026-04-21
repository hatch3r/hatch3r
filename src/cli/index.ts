// Sync I/O (execFileSync) is used intentionally in init/update for package
// manager operations where async would add complexity without benefit.

import { createProgram } from "./program.js";
import { classifyCliError } from "./errorClassification.js";
import { HatchError } from "../types.js";

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

const program = createProgram();

try {
  await program.parseAsync();
} catch (err) {
  if (err instanceof HatchError) {
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
