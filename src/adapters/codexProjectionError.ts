import { HatchError } from "../types.js";

const DEFAULT_RECOVERY_HINT =
  "Repair the invalid Codex projection input or managed surface, then retry; hatch3r did not emit partial Codex output.";

/** Structured fail-closed error shared by every Codex projection surface. */
export class CodexProjectionError extends HatchError {
  constructor(message: string, recoveryHint = DEFAULT_RECOVERY_HINT) {
    super(message, undefined, "VALIDATION_ERROR", recoveryHint);
    this.name = "CodexProjectionError";
  }
}

export function codexProjectionIssues(
  scope: string,
  issues: readonly string[],
  recoveryHint?: string,
): CodexProjectionError {
  return new CodexProjectionError(
    `${scope}:\n- ${issues.join("\n- ")}`,
    recoveryHint,
  );
}
