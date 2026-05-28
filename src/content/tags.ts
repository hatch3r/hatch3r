/**
 * Tag taxonomy for hatch3r content files (v2 — Wave 1 of content-pack redesign).
 *
 * Three logically distinct facets, each driving a different filter decision:
 *
 *   1. Capability   — what the artifact does (formerly "workflow" + parts of "domain")
 *   2. Floor        — non-negotiable inclusion markers; bypass preset shaping entirely
 *   3. Context      — what kind of project/team the artifact fits (technical compatibility)
 *
 * Helper facets (customize, ui-ux-specialisation, cli-tool, cli-tool-category, language)
 * carry their own admission rules but are not part of the capability/floor/context triad.
 *
 * Filenames, CLI-tool category tags, and language tags continue to use the existing flat
 * string convention but are grouped into typed sets so callers can reason about them
 * without hard-coded enumerations.
 *
 * TODO(Wave 2 — content re-tagging): Wave 1 only swaps the filter pipeline. The 175
 * canonical artifacts still carry their legacy tag values (`core`, `team`, `solo`,
 * `greenfield`, `brownfield`, `security` as a plain tag, `ai` as a CLI category). These
 * legacy values are NOT in TAG_REGISTRY and therefore fail every facet predicate — items
 * relying on them will not match the capability gate or floor admission stage and will
 * appear MISSING from preset output until Wave 2 re-tags the corpus per
 * `.audit-workspace/council-D-architect.md` §4. Wave 3 then rewrites the test suite.
 */

// ── Capability tags (the artifact's job) ─────────────────────────
// Each artifact MUST carry at least one capability tag (post-Wave-2) for the preset's
// "what work does this preset cover?" decision to admit it.

export const TAG_PLANNING       = "planning";       // specs, ADRs, roadmaps
export const TAG_IMPLEMENTATION = "implementation"; // code writing, fixing, refactoring
export const TAG_REVIEW         = "review";         // code review, QA, audits
export const TAG_DEVOPS         = "devops";         // CI/CD, releases, deploy, observability
export const TAG_MAINTENANCE    = "maintenance";    // dep audits, health checks, learnings, handoffs
export const TAG_ORCHESTRATION  = "orchestration";  // the sub-agent pipeline itself (formerly "core")
export const TAG_ORCHESTRATOR   = "orchestrator";   // orchestrator command marker (alias of orchestration for command frontmatter)
export const TAG_BOARD          = "board";          // project board management
export const TAG_PERFORMANCE    = "performance";    // perf budgets, profiling
export const TAG_AI             = "ai";             // AI feature engineering (evals, prompt mgmt)

// ── 2.0.0 content-quality vector capability tags (CQ1-CQ9 per CONSTITUTION §2B) ──
// Each tag identifies an agent or rule operating on one of the 9 content-quality vectors.
export const TAG_SECURITY        = "security";        // CQ3 — supply-chain + auth + OWASP ASI
export const TAG_RELIABILITY     = "reliability";     // CQ4 — SLO, OTel, circuit breaker
export const TAG_TESTING         = "testing";         // CQ5 — test-class mandate, eval coverage
export const TAG_SCALABILITY     = "scalability";     // CQ6 — stateless, back-pressure, idempotency
export const TAG_MAINTAINABILITY = "maintainability"; // CQ8 — jscpd, complexity, expand-contract
export const TAG_ENHANCABILITY   = "enhancability";   // CQ9 — feature flags, semver, extension points
export const TAG_OBSERVABILITY   = "observability";   // OTel + RED+USE + SLO (CQ4 supporting)
export const TAG_SUPPLY_CHAIN    = "supply-chain";    // SBOM + provenance + SHA-pin (CQ3 supporting)
export const TAG_ACCESSIBILITY   = "accessibility";   // WCAG 2.2 AA (CQ1 supporting; long form of a11y)

// ── 2.0.0 work-type capability tags ───────────────────────────────
export const TAG_SPEC             = "spec";             // specification authoring (greenfield/brownfield)
export const TAG_GREENFIELD       = "greenfield";       // new-project capability marker
export const TAG_BROWNFIELD       = "brownfield";       // existing-project capability marker
export const TAG_MIGRATION        = "migration";        // expand-contract migration work
export const TAG_TELEMETRY        = "telemetry";        // cost + observability emission (Decision 24)
export const TAG_COST             = "cost";             // cost-visibility work (Decision 24)
export const TAG_ANTI_DUPLICATION = "anti-duplication"; // duplication-scan + pattern-reuse (Decision 21)
export const TAG_CODE_QUALITY     = "code-quality";     // code-quality reviews (alias for maintainability scope)
export const TAG_CODE_STANDARDS   = "code-standards";   // code-standards enforcement
export const TAG_ADAPTERS         = "adapters";         // adapter currency / capability matrix (Decision 21)
export const TAG_CAPABILITY       = "capability";       // capability-matrix work (Decision 21)
export const TAG_CURRENCY         = "currency";         // platform-doc currency (P3)
export const TAG_ITERATION        = "iteration";        // iteration-summary work (Decision 28)
export const TAG_SUMMARY          = "summary";          // summary-emission work (Decision 28)
export const TAG_LEARNING         = "learning";         // learning-system work (Decision 27)
export const TAG_KNOWLEDGE_CAPTURE = "knowledge-capture"; // structured learning capture
export const TAG_PROOF            = "proof";            // proof-trace + verification (Decision 19)
export const TAG_VERIFICATION     = "verification";     // pre-execution verification gates (Decision 19)
export const TAG_CITATION         = "citation";         // citation + source recording
export const TAG_PLAYWRIGHT       = "playwright";       // Playwright-driven verification (Decision 16)
export const TAG_VISUAL_REGRESSION = "visual-regression"; // screenshot diff (Decision 16)

// ── Floor tags (non-negotiable inclusion) ────────────────────────
// Items carrying a floor:* tag are admitted in EVERY preset (except `custom`
// with an explicit ID list). They bypass preset shaping. Structural mechanism
// enforcing the maintainer's locked floor decision (security + UI/UX in every
// preset; pipeline-critical agents always present).

export const TAG_FLOOR_SECURITY        = "floor:security";        // P6 — security & trust
export const TAG_FLOOR_UI_UX           = "floor:ui-ux";           // P1 — UI/UX excellence (includes a11y)
export const TAG_FLOOR_PROTOCOL        = "floor:protocol";        // pipeline-critical (researcher, implementer, reviewer, fixer, test-writer)
export const TAG_FLOOR_CONTENT_QUALITY = "floor:content-quality"; // 2.0.0 — content-quality axis (CQ1-CQ9 specialist agents + supporting rules/skills)

// ── Context tags (technical compatibility) ───────────────────────
// Drive deterministic project-type / team-size filtering. These are NOT
// preferences — they are compatibility statements. If an item is tagged
// `ctx:greenfield-only`, it is unsafe in a brownfield project and is removed
// regardless of preset.

export const TAG_CTX_GREENFIELD_ONLY = "ctx:greenfield-only";
export const TAG_CTX_BROWNFIELD_ONLY = "ctx:brownfield-only";
export const TAG_CTX_TEAM_ONLY       = "ctx:team-only";
// Note: there is no `ctx:solo-only` — nothing in the corpus is solo-exclusive.

// ── Customize family (locked: standard + full only) ──────────────
// The `customize` capability is materially distinct from other capabilities
// because the maintainer locked it to specific presets. Encoded as its own
// facet so the preset DSL can express "include customize" declaratively
// (`ContentPreset.includeCustomize: boolean`).

export const TAG_CUSTOMIZE = "customize";

// ── UI/UX specialisation tags (sub-facet of floor:ui-ux) ─────────
// Retained for the task-router and rule scoping; they do not drive preset
// selection (the floor:ui-ux tag does that). Frontmatter authors apply both:
// `tags: [floor:ui-ux, a11y, frontend]`.

export const TAG_A11Y          = "a11y";
export const TAG_FRONTEND      = "frontend";
export const TAG_UI            = "ui";
export const TAG_UX            = "ux";
export const TAG_DESIGN_SYSTEM = "design-system";

// ── CLI tool tags ────────────────────────────────────────────────
export const TAG_CLI_TOOLS = "cli-tools";
export const TAG_OPT_IN    = "opt-in";
export const TAG_CAVEAT    = "caveat";
export const TAG_REFERENCE = "reference";

// CLI tool category tags — mirror the union in `src/cliTools/registry.ts::CliToolMeta["category"]`.
export const TAG_CAT_SEARCH      = "search";
export const TAG_CAT_JSON        = "json";
export const TAG_CAT_YAML        = "yaml";
export const TAG_CAT_GIT         = "git";
export const TAG_CAT_VIEW        = "view";
export const TAG_CAT_EDIT        = "edit";
export const TAG_CAT_ARCHIVE     = "archive";
export const TAG_CAT_DATA        = "data";
export const TAG_CAT_FORGE       = "forge";
export const TAG_CAT_BROWSER     = "browser";
export const TAG_CAT_CONTAINER   = "container";
export const TAG_CAT_AI          = "ai-cat";   // renamed from "ai" to disambiguate from capability tag
export const TAG_CAT_INTERACTIVE = "interactive";

// ── Language tags ────────────────────────────────────────────────
export const TAG_LANG_TYPESCRIPT = "lang:typescript";
export const TAG_LANG_PYTHON     = "lang:python";
export const TAG_LANG_GO         = "lang:go";
export const TAG_LANG_RUST       = "lang:rust";
export const TAG_LANG_JAVA       = "lang:java";
export const TAG_LANG_RUBY       = "lang:ruby";

// ── Role tags (D14-M6, Cycle 10 rollover) ────────────────────────
// Role tags carve the canonical content into role-shaped bundles so a team
// can ship a tighter agent / skill / rule set to a reviewer or security
// lead than the catch-all `standard`/`full` presets. Role is a separate
// admission axis from capability and team-size — a single artifact can
// carry both `capability: review` and `role:reviewer` so it survives in
// the reviewer bundle even when the user later trims capability tags.
//
// Conservatively scoped to 3 named roles per the D14-M6 finding: reviewer,
// security-lead, senior-eng. Authoring guidance: tag an existing agent /
// skill / rule with `role:<name>` to opt it into that bundle; absence is
// the default (no implicit role admission).

export const TAG_ROLE_REVIEWER      = "role:reviewer";       // PR / code review focus
export const TAG_ROLE_SECURITY_LEAD = "role:security-lead";  // OWASP ASI + supply-chain owner
export const TAG_ROLE_SENIOR_ENG    = "role:senior-eng";     // architecture + technical leadership

// ── Maturity-tier admission tags (Decision 4 / #16) ───────────────
// Frontmatter-side spellings of the per-tier admission gates consumed by
// `resolveSelection`'s tier stage in `src/content/index.ts`. Matched by
// the gate via string equality against `TIER_TAG_REQUIREMENTS`; registry
// presence here is for compound-test tag validity and `facetOf()` lookup.

export const TAG_TIER_ENTERPRISE_ONLY = "tier:enterprise-only";
export const TAG_TIER_SCALEUP_PLUS    = "tier:scaleup-plus";
export const TAG_TIER_TEAM_PLUS       = "tier:team-plus";
export const TAG_FLOOR_ENTERPRISE_ONLY = "floor:enterprise-only"; // alias for tier:enterprise-only per bucket spec

// ── Facet registry — single source of truth ──────────────────────

/**
 * Tag values remain plain strings so frontmatter authoring is unchanged.
 * The TAG_REGISTRY below assigns each known tag to exactly one facet;
 * unknown / legacy tag values return `undefined` from `facetOf()` and are
 * skipped by every facet-predicate.
 */
export type ContentTag = string;

export type TagFacet =
  | "capability"
  | "floor"
  | "context"
  | "customize"
  | "ui-ux-specialisation"
  | "cli-tool"
  | "cli-tool-category"
  | "language"
  | "tier"
  | "role";

/**
 * The single source of truth. Every recognised tag is registered with exactly
 * one facet. Callers do not enumerate tags by name — they ask `facetOf(tag)`
 * or `tagsForFacet(facet)`.
 */
export const TAG_REGISTRY: Record<string, TagFacet> = {
  [TAG_PLANNING]:       "capability",
  [TAG_IMPLEMENTATION]: "capability",
  [TAG_REVIEW]:         "capability",
  [TAG_DEVOPS]:         "capability",
  [TAG_MAINTENANCE]:    "capability",
  [TAG_ORCHESTRATION]:  "capability",
  [TAG_ORCHESTRATOR]:   "capability",
  [TAG_BOARD]:          "capability",
  [TAG_PERFORMANCE]:    "capability",
  [TAG_AI]:             "capability",

  // 2.0.0 — content-quality vector + supporting capability tags
  [TAG_SECURITY]:        "capability",
  [TAG_RELIABILITY]:     "capability",
  [TAG_TESTING]:         "capability",
  [TAG_SCALABILITY]:     "capability",
  [TAG_MAINTAINABILITY]: "capability",
  [TAG_ENHANCABILITY]:   "capability",
  [TAG_OBSERVABILITY]:   "capability",
  [TAG_SUPPLY_CHAIN]:    "capability",
  [TAG_ACCESSIBILITY]:   "capability",

  // 2.0.0 — work-type capability tags
  [TAG_SPEC]:             "capability",
  [TAG_GREENFIELD]:       "capability",
  [TAG_BROWNFIELD]:       "capability",
  [TAG_MIGRATION]:        "capability",
  [TAG_TELEMETRY]:        "capability",
  [TAG_COST]:             "capability",
  [TAG_ANTI_DUPLICATION]: "capability",
  [TAG_CODE_QUALITY]:     "capability",
  [TAG_CODE_STANDARDS]:   "capability",
  [TAG_ADAPTERS]:         "capability",
  [TAG_CAPABILITY]:       "capability",
  [TAG_CURRENCY]:         "capability",
  [TAG_ITERATION]:        "capability",
  [TAG_SUMMARY]:          "capability",
  [TAG_LEARNING]:         "capability",
  [TAG_KNOWLEDGE_CAPTURE]: "capability",
  [TAG_PROOF]:            "capability",
  [TAG_VERIFICATION]:     "capability",
  [TAG_CITATION]:         "capability",
  [TAG_PLAYWRIGHT]:       "capability",
  [TAG_VISUAL_REGRESSION]: "capability",

  [TAG_FLOOR_SECURITY]:        "floor",
  [TAG_FLOOR_UI_UX]:           "floor",
  [TAG_FLOOR_PROTOCOL]:        "floor",
  [TAG_FLOOR_CONTENT_QUALITY]: "floor",

  [TAG_CTX_GREENFIELD_ONLY]: "context",
  [TAG_CTX_BROWNFIELD_ONLY]: "context",
  [TAG_CTX_TEAM_ONLY]:       "context",

  [TAG_CUSTOMIZE]: "customize",

  [TAG_A11Y]:          "ui-ux-specialisation",
  [TAG_FRONTEND]:      "ui-ux-specialisation",
  [TAG_UI]:            "ui-ux-specialisation",
  [TAG_UX]:            "ui-ux-specialisation",
  [TAG_DESIGN_SYSTEM]: "ui-ux-specialisation",

  [TAG_CLI_TOOLS]: "cli-tool",
  [TAG_OPT_IN]:    "cli-tool",
  [TAG_CAVEAT]:    "cli-tool",
  [TAG_REFERENCE]: "cli-tool",

  [TAG_CAT_SEARCH]:      "cli-tool-category",
  [TAG_CAT_JSON]:        "cli-tool-category",
  [TAG_CAT_YAML]:        "cli-tool-category",
  [TAG_CAT_GIT]:         "cli-tool-category",
  [TAG_CAT_VIEW]:        "cli-tool-category",
  [TAG_CAT_EDIT]:        "cli-tool-category",
  [TAG_CAT_ARCHIVE]:     "cli-tool-category",
  [TAG_CAT_DATA]:        "cli-tool-category",
  [TAG_CAT_FORGE]:       "cli-tool-category",
  [TAG_CAT_BROWSER]:     "cli-tool-category",
  [TAG_CAT_CONTAINER]:   "cli-tool-category",
  [TAG_CAT_AI]:          "cli-tool-category",
  [TAG_CAT_INTERACTIVE]: "cli-tool-category",

  [TAG_LANG_TYPESCRIPT]: "language",
  [TAG_LANG_PYTHON]:     "language",
  [TAG_LANG_GO]:         "language",
  [TAG_LANG_RUST]:       "language",
  [TAG_LANG_JAVA]:       "language",
  [TAG_LANG_RUBY]:       "language",

  // Decision 4 / #16 — maturity-tier admission tags (consumed by
  // `resolveSelection` tier stage; registry placement keeps compound
  // tag-validity tests honest without changing gate semantics).
  [TAG_TIER_ENTERPRISE_ONLY]:  "tier",
  [TAG_TIER_SCALEUP_PLUS]:     "tier",
  [TAG_TIER_TEAM_PLUS]:        "tier",
  [TAG_FLOOR_ENTERPRISE_ONLY]: "tier",

  // D14-M6 (Cycle 10 rollover) — role admission tags.
  [TAG_ROLE_REVIEWER]:      "role",
  [TAG_ROLE_SECURITY_LEAD]: "role",
  [TAG_ROLE_SENIOR_ENG]:    "role",
};

export function facetOf(tag: string): TagFacet | undefined {
  return TAG_REGISTRY[tag];
}

export function tagsForFacet(facet: TagFacet): string[] {
  return Object.keys(TAG_REGISTRY).filter((t) => TAG_REGISTRY[t] === facet);
}

/** All registered tag values (no legacy tags). */
export const ALL_TAGS: string[] = Object.keys(TAG_REGISTRY);

/** Convenience predicates used by resolveSelection (no hard-coded string lists). */
export const isCapabilityTag      = (t: string): boolean => facetOf(t) === "capability";
export const isFloorTag           = (t: string): boolean => facetOf(t) === "floor";
export const isContextTag         = (t: string): boolean => facetOf(t) === "context";
export const isCustomizeTag       = (t: string): boolean => facetOf(t) === "customize";
export const isUiUxSpecialisation = (t: string): boolean => facetOf(t) === "ui-ux-specialisation";
export const isLanguageTag        = (t: string): boolean => facetOf(t) === "language";
export const isTierTag            = (t: string): boolean => facetOf(t) === "tier";
export const isRoleTag            = (t: string): boolean => facetOf(t) === "role";

/**
 * D14-M6 (Cycle 10 rollover): Known role identifiers — string values minus
 * the `role:` prefix, accepted by `init --role <id>` and consumed by
 * `resolveSelection`'s role gate.
 */
export const KNOWN_ROLES = ["reviewer", "security-lead", "senior-eng"] as const;
export type RoleId = typeof KNOWN_ROLES[number];

/**
 * D14-M9 (Cycle 10 rollover): graduated customization facets. The
 * `--facets` flag lets a user add named capability clusters on top of a
 * preset without dropping to full `custom` per-item selection. Each
 * named facet maps to the tag(s) that admit the matching content; the
 * additive admission step runs alongside the preset's capability gate so
 * an item tagged with the facet is admitted even when the preset's
 * capabilities would not have admitted it on their own.
 *
 * Scoped to 3 facets per the D14-M9 finding: a11y (accessibility),
 * performance (perf budgets, profiling), observability (OTel + RED+USE +
 * SLO). Authoring guidance: an existing capability-tagged artifact
 * (performance, observability, accessibility / a11y) automatically maps
 * to its facet — no re-tagging required.
 */
export const KNOWN_FACETS = ["a11y", "performance", "observability"] as const;
export type FacetId = typeof KNOWN_FACETS[number];

/**
 * D14-M9: tag-set admitted by each facet. A facet may admit items that
 * carry ANY of the listed tags — `a11y` admits both the long-form
 * `accessibility` capability tag and the shorter `a11y` UI-UX
 * specialisation tag so existing canonical artifacts tagged with either
 * spelling land under the facet.
 */
export const FACET_TAG_ADMISSIONS: Record<FacetId, ReadonlyArray<string>> = {
  a11y: [TAG_ACCESSIBILITY, TAG_A11Y],
  performance: [TAG_PERFORMANCE],
  observability: [TAG_OBSERVABILITY],
};

// ── Language helpers ─────────────────────────────────────────────

/**
 * Map detected language names to their corresponding language tags.
 * Used by resolveSelection to filter content by project language (Finding #71).
 */
export const LANGUAGE_TO_TAG: Record<string, string> = {
  typescript: TAG_LANG_TYPESCRIPT,
  javascript: TAG_LANG_TYPESCRIPT, // JS projects also benefit from TS rules
  python:     TAG_LANG_PYTHON,
  go:         TAG_LANG_GO,
  rust:       TAG_LANG_RUST,
  java:       TAG_LANG_JAVA,
  kotlin:     TAG_LANG_JAVA,       // Kotlin shares Java ecosystem
  ruby:       TAG_LANG_RUBY,
};

/**
 * Resolve a list of detected project language names to the set of `lang:*`
 * content tags that should match. Unknown languages are silently dropped.
 *
 * Example: `resolveLanguageTags(["typescript", "python"])`
 *   → `Set { "lang:typescript", "lang:python" }`
 */
export function resolveLanguageTags(projectLanguages: readonly string[]): Set<string> {
  const result = new Set<string>();
  for (const lang of projectLanguages) {
    const tag = LANGUAGE_TO_TAG[lang];
    if (tag) result.add(tag);
  }
  return result;
}

/**
 * Filter a list of items by language tags.
 *
 * Rules:
 * 1. Items marked `protected: true` always pass (universal opt-out from filtering).
 * 2. Items with no `lang:*` tags are language-agnostic and always pass.
 * 3. Items with `lang:*` tags pass only when at least one of their language tags
 *    is in the relevant set derived from `projectLanguages`.
 *
 * Returns `items` unchanged when `projectLanguages` is empty (filter is a no-op).
 *
 * @param items - The items to filter. Each must expose `tags: string[]` and
 *                an optional `protected: boolean`.
 * @param projectLanguages - The detected project languages (e.g. `["typescript"]`).
 */
export function filterByLanguages<T extends { tags: string[]; protected?: boolean }>(
  items: readonly T[],
  projectLanguages: readonly string[],
): T[] {
  if (projectLanguages.length === 0) return [...items];
  const relevant = resolveLanguageTags(projectLanguages);
  return items.filter((item) => {
    if (item.protected) return true;
    const itemLangTags = item.tags.filter(isLanguageTag);
    if (itemLangTags.length === 0) return true;
    return itemLangTags.some((t) => relevant.has(t));
  });
}
