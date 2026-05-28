/**
 * Convention-conflict detection (F14.4-H3, D14, Cycle 10).
 *
 * Producer side already exists: `analyzeRepo` (src/detect/repoAnalyzer.ts)
 * populates `RepoInfo.linters`, `RepoInfo.testFrameworks`, and
 * `RepoInfo.ciProviders`. This module is the consumer: it inspects those
 * detected lists and surfaces conflicts where a repo carries two or more tools
 * that occupy the same mutually-exclusive role (e.g. both `vitest` and `jest`
 * test-framework configs, or both `eslint` and `biome` linter configs).
 *
 * Why it matters (causal chain, per the finding): detection flows into
 * `manifest.detected`, but no consumer compares the detected tools against one
 * another. A repo mid-migration between two test runners (or two linters) gets
 * canonical hatch3r rules that assume a single toolchain, with no warning that
 * the project actually carries two — so a generated "run `npm test` (vitest)"
 * instruction can contradict a jest config that is still present. Surfacing the
 * conflict at detection time lets `hatch3r init` warn the user and lets the
 * init flow record a permanent line in `.hatch3r/hatch.json` (the manifest +
 * init consumer is cross-WU — owned by init.ts/types.ts, see remainder note at
 * the bottom of this file).
 *
 * Scope of THIS module (the src/detect slice): pure, side-effect-free
 * detection + a human-readable formatter. It reads a `RepoInfo`-shaped input
 * and returns structured `ConventionConflict[]`. It does not read content
 * selection, write to disk, or emit CLI output — those are the init.ts
 * consumer's job.
 *
 * Sources:
 *   https://github.com/PatrickJS/awesome-cursorrules (accessed 2026-05-28) —
 *     real-world repos frequently carry overlapping linter/test configs.
 *   https://thepromptshelf.dev/blog/cursorrules-vs-claude-md/ (accessed
 *     2026-05-28) — single-toolchain assumptions in generated rule content.
 */
import type { RepoInfo } from "../types.js";

/** A detected convention dimension that admits at most one tool per project. */
export type ConventionDimension = "linter" | "formatter" | "testFramework" | "ciProvider";

/**
 * A surfaced conflict: two or more detected tools that occupy the same
 * mutually-exclusive role within one project.
 */
export interface ConventionConflict {
  /** The role the conflicting tools compete for. */
  dimension: ConventionDimension;
  /**
   * The conflicting tool names, sorted for deterministic output. Length is
   * always >= 2 (a single tool is never a conflict).
   */
  tools: string[];
  /** One-line human-readable explanation of the conflict. */
  message: string;
}

/**
 * Tools whose mere co-presence is NOT a conflict because they fill
 * complementary roles rather than competing for one.
 *
 * `eslint` (linter) + `prettier` (formatter) is the canonical complementary
 * pair: lint vs format are distinct dimensions, so we classify `prettier`,
 * `stylelint`-as-formatter, etc. into the `formatter` dimension and leave
 * `eslint` in `linter`. `black` is a Python formatter, not a linter, so it
 * never conflicts with `ruff`-as-linter. This map assigns each detected
 * linter-ish tool to its true dimension so complementary tools land in
 * different dimensions and do not trip a false conflict.
 */
const LINTER_TOOL_DIMENSION: Record<string, ConventionDimension> = {
  eslint: "linter",
  biome: "linter", // biome does both, but its lint role conflicts with eslint
  ruff: "linter",
  rubocop: "linter",
  "golangci-lint": "linter",
  clippy: "linter",
  checkstyle: "linter",
  "deno-lint": "linter",
  prettier: "formatter",
  black: "formatter",
  stylelint: "formatter",
};

/**
 * Test-runner families. Tools within the same family compete (e.g. `vitest`
 * vs `jest` vs `mocha` are interchangeable JS unit runners — picking two is a
 * migration smell). Tools in DIFFERENT families are complementary (e.g. a unit
 * runner `vitest` + an e2e runner `playwright` is a normal, non-conflicting
 * setup), so they are partitioned into sub-dimensions and never cross-conflict.
 */
const TEST_FRAMEWORK_FAMILY: Record<string, string> = {
  // JS/TS unit runners (interchangeable → conflict if >1).
  vitest: "js-unit",
  jest: "js-unit",
  mocha: "js-unit",
  // Browser/e2e runners (a separate concern from unit; complementary).
  playwright: "e2e",
  cypress: "e2e",
  // Per-language native runners (one per language; complementary across langs).
  pytest: "python-unit",
  rspec: "ruby-unit",
  junit: "jvm-unit",
  "go-test": "go-unit",
  "cargo-test": "rust-unit",
  phpunit: "php-unit",
};

/** Human-readable label for a convention dimension (used in messages). */
const DIMENSION_LABEL: Record<ConventionDimension, string> = {
  linter: "linters",
  formatter: "formatters",
  testFramework: "test frameworks",
  ciProvider: "CI providers",
};

/**
 * Detect convention conflicts from the detected-toolchain lists on a
 * `RepoInfo`. A conflict is two or more tools competing for one
 * mutually-exclusive role.
 *
 * Rules:
 *   - Linters: `eslint`/`biome`/`ruff`/… in the `linter` dimension conflict if
 *     two or more are present. Formatters (`prettier`/`black`/`stylelint`) sit
 *     in their own `formatter` dimension — `eslint` + `prettier` never trips.
 *   - Test frameworks: tools within the same family (e.g. JS unit runners
 *     `vitest`/`jest`/`mocha`) conflict; cross-family tools (a unit runner +
 *     an e2e runner, or runners for different languages) are complementary and
 *     never conflict. The conflict is reported under the `testFramework`
 *     dimension.
 *   - CI providers: two or more configured CI systems (e.g. `github-actions` +
 *     `gitlab-ci`) conflict under the `ciProvider` dimension.
 *
 * Returns an empty array when no conflicts are present. Output is sorted by
 * dimension then by the joined tool list for determinism.
 *
 * @param info - A `RepoInfo` (or any object exposing the same detected-tool
 *   list fields). Missing/empty lists contribute no conflicts.
 */
export function detectConventionConflicts(
  info: Pick<RepoInfo, "linters" | "testFrameworks" | "ciProviders">,
): ConventionConflict[] {
  const conflicts: ConventionConflict[] = [];

  // ── Linters / formatters (partitioned by true dimension) ──────────
  const byLinterDimension = new Map<ConventionDimension, Set<string>>();
  for (const raw of info.linters ?? []) {
    const tool = raw.trim();
    if (tool.length === 0) continue;
    const dimension = LINTER_TOOL_DIMENSION[tool] ?? "linter";
    if (!byLinterDimension.has(dimension)) byLinterDimension.set(dimension, new Set());
    byLinterDimension.get(dimension)!.add(tool);
  }
  for (const [dimension, tools] of byLinterDimension) {
    if (tools.size >= 2) conflicts.push(buildConflict(dimension, tools));
  }

  // ── Test frameworks (partitioned by runner family) ────────────────
  const byFamily = new Map<string, Set<string>>();
  for (const raw of info.testFrameworks ?? []) {
    const tool = raw.trim();
    if (tool.length === 0) continue;
    // Unknown frameworks each get their own unique family bucket so they never
    // conflict with a known tool or with each other.
    const family = TEST_FRAMEWORK_FAMILY[tool] ?? `unknown:${tool}`;
    if (!byFamily.has(family)) byFamily.set(family, new Set());
    byFamily.get(family)!.add(tool);
  }
  for (const tools of byFamily.values()) {
    if (tools.size >= 2) conflicts.push(buildConflict("testFramework", tools));
  }

  // ── CI providers (any two configured providers conflict) ──────────
  const ciTools = new Set(
    (info.ciProviders ?? []).map((c) => c.trim()).filter((c) => c.length > 0),
  );
  if (ciTools.size >= 2) conflicts.push(buildConflict("ciProvider", ciTools));

  conflicts.sort((a, b) => {
    if (a.dimension !== b.dimension) return a.dimension.localeCompare(b.dimension);
    return a.tools.join(",").localeCompare(b.tools.join(","));
  });
  return conflicts;
}

/** Build a `ConventionConflict` with a sorted tool list and a stock message. */
function buildConflict(dimension: ConventionDimension, toolSet: Set<string>): ConventionConflict {
  const tools = [...toolSet].sort((a, b) => a.localeCompare(b));
  const label = DIMENSION_LABEL[dimension];
  const message =
    `Detected ${tools.length} competing ${label} (${tools.join(", ")}); ` +
    `generated guidance assumes a single ${singular(label)}. ` +
    `Pick one or scope rules per package.`;
  return { dimension, tools, message };
}

/** Crude singularisation of a dimension label for the conflict message. */
function singular(label: string): string {
  if (label === "linters") return "linter";
  if (label === "formatters") return "formatter";
  if (label === "test frameworks") return "test framework";
  if (label === "CI providers") return "CI provider";
  return label;
}

/**
 * Format a list of conflicts as a multi-line, human-readable block for CLI
 * output. Returns an empty string when there are no conflicts so callers can
 * conditionally append it.
 */
export function formatConventionConflicts(conflicts: ConventionConflict[]): string {
  if (conflicts.length === 0) return "";
  const lines = ["Convention conflicts detected:"];
  for (const c of conflicts) {
    lines.push(`  - ${c.message}`);
  }
  return lines.join("\n");
}

// ── Cross-WU remainder (F14.4-H3 consumer) ───────────────────────────
// The init.ts / types.ts slices are owned by another work unit. To finish the
// feature end-to-end, the init flow must:
//   1. Call `detectConventionConflicts(repoInfo)` after `analyzeRepo`.
//   2. Print `formatConventionConflicts(...)` as a warning in the post-init box
//      when the result is non-empty.
//   3. Persist a permanent record on the manifest, e.g. a `conflicts:
//      ConventionConflict[]` field on `Manifest` round-tripped through
//      `src/manifest/hatchJson.ts` (the finding's `.hatch3r/hatch.json.conflicts`
//      line). Adding that field is a `src/types.ts` edit (cross-WU).
// This module deliberately exposes both the detector and the formatter so the
// init consumer needs zero additional logic — it wires the two calls only.
