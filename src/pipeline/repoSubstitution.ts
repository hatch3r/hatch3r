/**
 * Detected-repo substitution tokens (C9-H47 / D14-SA14.4-H01).
 *
 * Audit context:
 *   - `repoAnalyzer.detectLinters` / `detectTestFrameworks` / `detectCIProviders`
 *     produce three lists at `hatch3r init` time but, prior to this finding,
 *     the only consumer was `formatRepoSummary` (a one-shot CLI banner). The
 *     detection result never reached the agent prompts the framework
 *     generates, so canonical content could not branch on the project's
 *     actual toolchain.
 *   - D14-SA14.4-H01 (High, P3+P4): wire the detection chain end-to-end via
 *     a sync-time substitution mechanism so an agent prompt like
 *     `run ${HATCH3R:LINTER}` reaches the runtime as `run eslint` (or
 *     `run unknown` when detection found nothing).
 *
 * Why output-time substitution (not in-place rewriting on disk):
 *   Canonical source files under `agents/`, `commands/`, `rules/`, `skills/`,
 *   `hooks/` MUST keep the literal `${HATCH3R:...}` tokens so:
 *     1. Canonical content is portable — a different project with a different
 *        toolchain renders different output from the same source.
 *     2. Re-running `hatch3r sync` after the project switches linters
 *        (e.g. eslint -> biome) produces fresh adapter output without
 *        regenerating the canonical layer.
 *     3. The integrity SHA over `.agents/<canonical>.md` stays stable across
 *        every project, so a tampered canonical file is detectable.
 *
 *   The substitution runs at adapter output time — the same hook point the
 *   PLATFORM-TOOL marker uses (see {@link substituteAskUserMarker} in
 *   `src/adapters/base.ts`). Each adapter calls
 *   {@link substituteRepoTokens} on every canonical body it inlines/emits
 *   so the generated artifact (e.g. `.cursor/rules/hatch3r-*.mdc`,
 *   `.claude/commands/*.md`) carries resolved values.
 *
 * Fallback semantics:
 *   When detection returns an empty array (e.g. a project with no
 *   detectable linter), the token is replaced with the sentinel
 *   {@link DETECTION_UNKNOWN}. Canonical content can branch on this value:
 *   `If linter is "${HATCH3R:LINTER}" and that resolves to "unknown",
 *   ask the maintainer.` This is the conservative choice — leaving the
 *   raw token visible in adapter output would surface as a leaked
 *   template variable to the runtime agent.
 *
 *   When detection returns multiple values (e.g. linters detected:
 *   `["eslint", "prettier"]`), the token is replaced with a
 *   comma-separated string (`"eslint, prettier"`). This matches the
 *   downstream `formatRepoSummary` rendering and keeps the result
 *   readable inside a sentence — the canonical agent prompt should
 *   treat the substituted string as a hint, not a parseable list.
 *
 * Idempotency: a content body with zero tokens passes through unchanged.
 * Calling {@link substituteRepoTokens} twice on the same body yields the
 * same result as one call (after the first call, all tokens are gone).
 */

import type { HatchManifest } from "../types.js";

/**
 * Sentinel value emitted when detection returned an empty array. Lower-case
 * "unknown" matches the analogous fallback used by `repoAnalyzer.detectLanguages`
 * when no language indicator file is found.
 */
export const DETECTION_UNKNOWN = "unknown";

/** Token replaced with the project's detected linter(s). */
export const LINTER_TOKEN = "${HATCH3R:LINTER}";

/** Token replaced with the project's detected test framework(s). */
export const TEST_FRAMEWORK_TOKEN = "${HATCH3R:TEST_FRAMEWORK}";

/** Token replaced with the project's detected CI provider(s). */
export const CI_PROVIDER_TOKEN = "${HATCH3R:CI_PROVIDER}";

/**
 * Subset of the manifest that carries detection results. Defined separately
 * from {@link HatchManifest} so callers can pass a minimal context (e.g. a
 * test fixture or a partial manifest in a snapshot) without constructing
 * the full manifest object.
 */
export interface DetectedRepoContext {
  linters?: string[];
  testFrameworks?: string[];
  ciProviders?: string[];
}

/**
 * Render a detection list as a single substitution value. Empty arrays and
 * undefined values collapse to {@link DETECTION_UNKNOWN}; single-element
 * arrays render as the bare value; multi-element arrays render as a
 * comma-separated string.
 */
export function renderDetectionList(values: readonly string[] | undefined): string {
  if (!values || values.length === 0) return DETECTION_UNKNOWN;
  if (values.length === 1) return values[0];
  return values.join(", ");
}

/**
 * Extract the detection context from a {@link HatchManifest}. Returns an
 * empty context when the manifest has no `detected` block (pre-1.8.0
 * manifests, or projects where init ran before C9-H47 landed).
 */
export function detectionContextFromManifest(manifest: HatchManifest): DetectedRepoContext {
  return manifest.detected ?? {};
}

/**
 * Replace every `${HATCH3R:LINTER}` / `${HATCH3R:TEST_FRAMEWORK}` /
 * `${HATCH3R:CI_PROVIDER}` occurrence in `content` with the values from
 * `ctx`. Idempotent: a body with zero tokens passes through unchanged.
 *
 * Implementation uses literal string splits (not regex) so the token
 * delimiters cannot accidentally match a partial substring elsewhere in
 * the body, and so the result is byte-exact for non-token bodies.
 */
export function substituteRepoTokens(content: string, ctx: DetectedRepoContext): string {
  let out = content;
  if (out.includes(LINTER_TOKEN)) {
    out = out.split(LINTER_TOKEN).join(renderDetectionList(ctx.linters));
  }
  if (out.includes(TEST_FRAMEWORK_TOKEN)) {
    out = out.split(TEST_FRAMEWORK_TOKEN).join(renderDetectionList(ctx.testFrameworks));
  }
  if (out.includes(CI_PROVIDER_TOKEN)) {
    out = out.split(CI_PROVIDER_TOKEN).join(renderDetectionList(ctx.ciProviders));
  }
  return out;
}

/**
 * Public list of token literals — exposed for validators and tests that
 * need to assert the wire format without re-declaring the constants.
 */
export const REPO_SUBSTITUTION_TOKENS = [
  LINTER_TOKEN,
  TEST_FRAMEWORK_TOKEN,
  CI_PROVIDER_TOKEN,
] as const;
