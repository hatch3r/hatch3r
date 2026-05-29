import chalk from "chalk";
import { HatchError, HATCH3R_DIR, type HatchManifest } from "../../types.js";
import { error as logError } from "./ui.js";

/**
 * D8-SA8.1-F8.1.8 (Cycle 10 Wave 4, D8, P1): single source of truth for the
 * "manifest required, none found" preflight that every state-mutating /
 * state-reading command shares. Before this helper, seven commands
 * (`verify`, `status`, `sync`, `update`, `mcp`, `cli-tools`, `config`)
 * carried copy-pasted inline blocks — four of which drifted in message
 * wording (one-line vs two-line, trailing period) so a new user running them
 * in sequence saw inconsistent first-run stderr. Consolidating into one
 * function guarantees byte-identical wording and a single chokepoint for the
 * recovery hint.
 *
 * `validate` is intentionally NOT a caller: its missing-manifest path is a
 * non-fatal WARNING (bundled-canonical validation still runs without a
 * project manifest, see `validate.ts::validateManifest`), so it does not
 * share this throw contract.
 *
 * Pillar service: P1 (consistent first-run UX across the CLI surface),
 * P5 (one funnel keeps the message + exit-code contract testable in one
 * place — the `CONFIG_ERROR` → exit 65 mapping is exercised by
 * `src/__tests__/cli/shared/errors.test.ts`).
 */

/** Canonical missing-manifest message. Asserted verbatim by errors.test.ts. */
export const MISSING_MANIFEST_MESSAGE = `No ${HATCH3R_DIR}/hatch.json found.`;

/** Canonical recovery hint paired with {@link MISSING_MANIFEST_MESSAGE}. */
export const MISSING_MANIFEST_HINT =
  "Run `npx hatch3r init` to set up your project first.";

export interface AssertManifestOptions {
  /**
   * When `true`, the calling command has already emitted its one-shot JSON
   * error payload to stdout (CI mode); this helper then skips the human
   * stderr lines and only throws so the structured document is not polluted
   * by interleaved chrome. When `false`/omitted, the helper prints the
   * canonical two-line human message before throwing.
   */
  jsonMode?: boolean;
}

/**
 * Assert that a manifest was loaded; throw the canonical `CONFIG_ERROR` (exit
 * 65 via `ERROR_CODE_TO_EXIT_CODE`) with a uniform message + recovery hint
 * when it is `null`. TypeScript narrows `manifest` to `HatchManifest` on the
 * success path via the `asserts` predicate, so callers use the value directly
 * afterward without a redundant null check.
 */
export function assertManifest(
  manifest: HatchManifest | null,
  options: AssertManifestOptions = {},
): asserts manifest {
  if (manifest) return;
  if (!options.jsonMode) {
    logError(MISSING_MANIFEST_MESSAGE);
    console.log(chalk.dim(`  ${MISSING_MANIFEST_HINT}\n`));
  }
  throw new HatchError(
    MISSING_MANIFEST_MESSAGE,
    undefined,
    "CONFIG_ERROR",
    MISSING_MANIFEST_HINT,
  );
}
