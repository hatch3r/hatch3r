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

  const isUsageError =
    err instanceof Error &&
    (err.message.includes("Invalid") ||
      err.message.includes("Unknown") ||
      err.message.includes("missing required"));
  return isUsageError ? "usage" : "unexpected";
}
