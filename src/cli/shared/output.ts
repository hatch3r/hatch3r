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

import { HatchError } from "../../types.js";

/**
 * Supported CLI output formats. The contract mirrors `ValidateOutputFormat`
 * in `src/cli/commands/validate.ts` so the JSON-mode opt-in is uniform
 * across every command that adopts it.
 */
export type CliOutputFormat = "human" | "json";

/**
 * Normalize a user-supplied `--format <value>` argument to a
 * {@link CliOutputFormat}. Accepts case-insensitive `"human"` / `"json"`
 * (and the equivalent mixed-case spellings); `undefined`, a non-string, or
 * an empty/whitespace-only value falls back to `"human"` so the decorated
 * surface remains the default for interactive users.
 *
 * D10-22 (Cycle 11 Wave 3, D10, P1): a `--format` value that is neither
 * `human` nor `json` (e.g. the typo `jsom`) previously degraded silently to
 * `"human"` and exited 0 — a CI consumer that asked for JSON got decorated
 * human output and no signal that its flag was wrong. An explicit, non-empty,
 * unrecognized value is now a usage error (exit 2 via the top-level funnel in
 * `src/cli/index.ts`) so the mistyped CI flag fails loudly. The empty/absent
 * fallback is preserved because Commander supplies the `"human"` default on
 * the no-flag path; only an explicitly-supplied bad value throws.
 */
export function parseFormatOption(value: string | undefined): CliOutputFormat {
  if (typeof value !== "string") return "human";
  const normalized = value.trim().toLowerCase();
  if (normalized === "") return "human";
  if (normalized === "human") return "human";
  if (normalized === "json") return "json";
  throw new HatchError(
    `Invalid --format value: ${JSON.stringify(value)}. Expected "human" or "json".`,
    2,
    "VALIDATION_ERROR",
    "Re-run with --format human or --format json (omit --format for the human default).",
  );
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
