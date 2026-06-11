/**
 * Top-level CLI error classification helpers.
 *
 * D1-SA1.8.1: When the user sends SIGINT (Ctrl-C) during an inquirer prompt,
 * the prompt library throws an `ExitPromptError`. A broad catch that labels
 * this as "unexpected" misrepresents a user-initiated cancellation — this
 * module provides the narrow predicates the top-level handler uses to
 * distinguish clean exits from genuine failures.
 */

export type CliErrorKind =
  | "exit-prompt" // user pressed Ctrl-C inside an inquirer prompt
  | "shutting-down" // a signal handler already started teardown
  | "usage" // commander.js surfaced a usage/parse problem
  | "unexpected"; // genuine unexpected failure path

/**
 * Classify a top-level caught error.
 *
 * @param err The caught value (from `parseAsync`).
 * @param flags Shutdown-tracking flags observed at catch time.
 * @returns The {@link CliErrorKind} the CLI should treat the error as.
 */
export function classifyCliError(
  err: unknown,
  flags: { shuttingDown: boolean },
): CliErrorKind {
  // ExitPromptError is thrown by @inquirer/core when a SIGINT interrupts a
  // prompt. It is a clean user-initiated cancellation, not a bug.
  if (err instanceof Error && err.name === "ExitPromptError") {
    return "exit-prompt";
  }

  // Any error observed after a signal handler fired should be treated as
  // the signal's consequence — the real cause was the user's Ctrl-C.
  if (flags.shuttingDown) {
    return "shutting-down";
  }

  // D8-2 (Cycle 11 Wave 2, P1): primary signal is commander's stable error
  // contract, not its human-readable message text. Every parse/usage failure
  // commander 14.x raises is a CommanderError whose `code` is prefixed
  // `commander.` (e.g. commander.unknownOption / .unknownCommand /
  // .invalidArgument / .missingMandatoryOptionValue). Matching on `name`/`code`
  // is stable across commander's message-string wording, whereas the prior
  // capitalized-substring heuristic missed commander's lowercase messages
  // ("unknown option '--x'", "... argument 'z' is invalid") and so misreported
  // a user mistake as a hatch3r bug (exit 1 + bug-report URL) instead of a
  // usage error (exit 2).
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    if (
      err.name === "CommanderError" ||
      (typeof code === "string" && code.startsWith("commander."))
    ) {
      return "usage";
    }
  }

  // Fallback for errors that carry a usage-shaped message but are not (or are no
  // longer) CommanderError instances — e.g. a re-thrown / re-wrapped parse
  // failure. Normalize to lowercase first so commander's own lowercase wording
  // is caught here too, then key on the stable lexemes commander emits.
  const isUsageError =
    err instanceof Error &&
    (() => {
      const message = err.message.toLowerCase();
      return (
        message.includes("invalid") ||
        message.includes("unknown option") ||
        message.includes("unknown command") ||
        message.includes("missing required") ||
        message.includes("argument missing") ||
        message.includes("not specified")
      );
    })();
  return isUsageError ? "usage" : "unexpected";
}
