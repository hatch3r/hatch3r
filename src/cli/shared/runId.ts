/**
 * SA12.1-F-D12-M3 (Cycle 10 Wave 3, D12, P1): per-run correlation ID minted
 * once at CLI startup and embedded in the top-level error block so a single
 * failing run can be traced across stdout / stderr / `.hatch3r/.failure-log.jsonl`
 * / CI build logs. Before this module, the error funnel emitted no per-run
 * marker — operators correlating a CI failure with a local repro had to grep
 * by timestamp.
 *
 * **Contract:**
 *   - One `HATCH3R_RUN_ID` per process invocation. Read-only after first call.
 *   - Honors `process.env.HATCH3R_RUN_ID` when present (lets CI override with
 *     a build-correlated id so the same identifier appears in workflow logs
 *     and tool output).
 *   - Otherwise mints `hr-<timestamp>-<random>` using a short base36 random
 *     suffix. Length is bounded so it embeds cleanly in stderr lines and JSON
 *     payloads.
 *
 * Pillar service: P1 (operator can correlate one failure across multiple
 * observation channels).
 */

import { randomBytes } from "node:crypto";

/**
 * Cached run id. Lazy-initialised on first read so importing this module
 * does not perform side effects (matches the rest of `src/cli/shared/`).
 */
let cachedRunId: string | null = null;

/**
 * Generate the default run id. Format: `hr-<base36-ms-since-epoch>-<rand>`.
 * Total length ≤ 22 characters so the id fits inside a single
 * 80-column terminal line alongside the failing message.
 */
function mintRunId(): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(4).toString("hex");
  return `hr-${ts}-${rand}`;
}

/**
 * Return the run id for the current process. The first call mints (or reads
 * `HATCH3R_RUN_ID` from the environment) and caches; subsequent calls return
 * the same value.
 *
 * Side effect: when the function mints a fresh id (no env override) it also
 * exports the value back to `process.env.HATCH3R_RUN_ID` so child processes
 * spawned by long-running commands (e.g. `hatch3r update`'s re-exec, the
 * `tsx`-spawned sub-validators in `validate`) inherit the same id and emit
 * matching log entries.
 */
export function getRunId(): string {
  if (cachedRunId !== null) return cachedRunId;
  const fromEnv = process.env.HATCH3R_RUN_ID;
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    cachedRunId = fromEnv;
  } else {
    cachedRunId = mintRunId();
    process.env.HATCH3R_RUN_ID = cachedRunId;
  }
  return cachedRunId;
}

/**
 * Test-only helper: reset the cached id so a fresh test can mint its own.
 * Production code never calls this — the contract is one id per process.
 */
export function resetRunIdForTesting(): void {
  cachedRunId = null;
  delete process.env.HATCH3R_RUN_ID;
}
