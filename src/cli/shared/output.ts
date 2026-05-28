/**
 * SA12.1-F-D12-M2 (Cycle 10 Wave 3, D12, P1): shared `--format json` output
 * facility for hatch3r CLI commands. Before this module only `validate` had
 * structured JSON output; CI consumers calling sync/update/status/verify had
 * to grep human-readable chrome (or parse exit codes) to determine outcome.
 *
 * Each command opts in by accepting an `--format <fmt>` option, normalizing
 * the value via {@link parseFormatOption}, and emitting a one-shot JSON
 * payload via {@link emitJson} when `format === "json"`. The payload schema
 * is intentionally per-command (shape declared in each command's
 * `{Command}JsonOutput` interface) — operators read a single JSON document
 * and branch on `summary.status` and command-specific counts.
 *
 * Why "shared" instead of inlining per-command: a single resolver guarantees
 * uniform parsing (case + alias handling), uniform serialization (one
 * trailing newline, no interleaved log lines), and one chokepoint for future
 * CI-format extensions (yaml, sarif). The function lives outside `ui.ts` so
 * the dependency graph stays minimal — no chalk/boxen/ora pull-in for
 * JSON-mode callers.
 *
 * Pillar service: P1 (CI consumers get a stable structured surface),
 * P5 (a single output funnel keeps the contract testable in one place).
 */

/**
 * Supported CLI output formats. The contract mirrors `ValidateOutputFormat`
 * in `src/cli/commands/validate.ts` so the JSON-mode opt-in is uniform
 * across every command that adopts it.
 */
export type CliOutputFormat = "human" | "json";

/**
 * Normalize a user-supplied `--format <value>` argument to a
 * {@link CliOutputFormat}. Accepts case-insensitive `"json"` /
 * `"JSON"` / `"Json"`; anything else (including empty, undefined,
 * mistyped values) falls back to `"human"` so the legacy decorated
 * surface remains the default for interactive users.
 */
export function parseFormatOption(value: string | undefined): CliOutputFormat {
  if (typeof value !== "string") return "human";
  return value.trim().toLowerCase() === "json" ? "json" : "human";
}

/**
 * Emit a one-shot JSON payload to stdout followed by a single newline.
 * Callers must not interleave any other stdout writes in JSON mode — the
 * payload is a single document for CI parsers (`jq`, `python -m json.tool`).
 * Diagnostics (errors/warnings) remain on stderr per POSIX so failures stay
 * visible when stdout is piped (matches `src/cli/shared/ui.ts` error()/warn()).
 */
export function emitJson(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload) + "\n");
}
