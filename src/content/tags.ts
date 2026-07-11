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
 * Corpus state: every canonical artifact now carries the canonical facet tags defined in
 * TAG_REGISTRY (capability / floor / context / role facets); the compound
 * tag-validity + preset-coverage tests pass against the migrated corpus. Maturity is an
 * investment-calibration dial, not a content gate — it admits nothing and removes nothing;
 * the `tier:*` admission facet was retired per `rules/hatch3r-right-sizing.md` +
 * `docs/maturity-tiers.md`. The legacy tag values (`core`, `team`, `solo`, `greenfield`,
 * `brownfield`, `security` as a plain tag, `ai` as a CLI category) are no longer in use.
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
export const TAG_RIGHT_SIZING     = "right-sizing";     // maturity-tier investment calibration (anti-overengineering)
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
// (`ContentPreset.includeCustomize: boolean`). Full design rationale for the
// typed-boolean-over-capability-tag choice (D2-SA2.6-F05) lives at the locus
// of likely edit — the `ContentPreset.includeCustomize` JSDoc in presets.ts.

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
  [TAG_RIGHT_SIZING]:     "capability",
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
export const isRoleTag            = (t: string): boolean => facetOf(t) === "role";

/**
 * Single shared admission predicate for the universal-floor invariant
 * (CONSTITUTION §2 P5 "Universal floor invariant" row). An item is admitted
 * unconditionally — bypassing every content-reduction path — when it is
 * `protected` (orchestration pipeline) OR carries any `floor:*` tag
 * (security / ui-ux / protocol / content-quality).
 *
 * D16-2 (Cycle 11): the invariant was previously enforced path-dependently.
 * `resolveSelection` honoured it via inline `item.protected || isFloorTag`
 * checks, but `filterByLanguages` (language mismatch), the workspace
 * `resolveRepoConfig` exclude loop, and the custom-content picker each
 * special-cased only `protected`, dropping the ~40+ floor-tagged-unprotected
 * items (`protected` is only 6 items). Threading this one helper through
 * every reduction path makes the floor admission path-independent: a
 * `floor:security`+`lang:typescript` rule now survives on a Python repo, a
 * workspace exclude list, and a picker deselect alike.
 *
 * @param item - Any content item exposing `tags: string[]` and optional
 *               `protected: boolean`.
 */
export const admitsUnconditionally = (item: {
  tags: readonly string[];
  protected?: boolean;
}): boolean => item.protected === true || item.tags.some(isFloorTag);

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
 * 1. Items admitted unconditionally (`protected` OR any `floor:*` tag) always
 *    pass — the universal-floor invariant outranks language filtering, so a
 *    `floor:security`+`lang:typescript` rule still ships on a Python repo
 *    (D2-4 / D16-2, Cycle 11). Previously only `protected` was honoured here.
 * 2. Items with no `lang:*` tags are language-agnostic and always pass.
 * 3. Items with `lang:*` tags pass only when at least one of their language tags
 *    is in the relevant set derived from `projectLanguages`.
 *
 * Returns `items` unchanged when `projectLanguages` is empty (filter is a
 * no-op) OR when none of the detected languages resolve to a known `lang:*`
 * tag (the relevant set is empty). The empty-relevant-set guard (D14-3, Cycle
 * 11) prevents a repo whose only detected languages are unmapped — e.g. a pure
 * PHP, Swift, or Elixir project, none of which appear in `LANGUAGE_TO_TAG` —
 * from silently stripping EVERY `lang:*`-tagged item: with no resolvable
 * project-language signal there is nothing to filter against, so the filter
 * declines to narrow rather than dropping all language-specific content.
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
  // D14-3: no detected language mapped to a known lang:* tag → no signal to
  // filter on. Pass everything through instead of dropping all lang-tagged
  // items (the silent-strip bug for unmapped-language repos).
  if (relevant.size === 0) return [...items];
  return items.filter((item) => {
    if (admitsUnconditionally(item)) return true;
    const itemLangTags = item.tags.filter(isLanguageTag);
    if (itemLangTags.length === 0) return true;
    return itemLangTags.some((t) => relevant.has(t));
  });
}

// ── Pillar coverage map (D22-SA22.3-01) ──────────────────────────
//
// The machine-readable substrate for D22 §22.3's weighted pillar-coverage
// tally. Before this map, §22.3 prescribed "reading `pillars:` frontmatter +
// body tag scan" with no canonical tag→pillar edge anywhere in the repo, so
// only 16/190 artifacts (the ones carrying `pillars:` frontmatter) had a
// deterministic pillar assignment and the other 174 fell back on an
// auditor-interpreted map — two auditors computed divergent tallies from an
// unchanged corpus (P5: 0 vs 46; CQ3: 1 vs 19). PILLAR_MAP fixes ONE canonical
// edge set per capability/floor tag so every future SA22.3 starts from an
// identical number; `scripts/validate-pillar-coverage.ts` consumes it.
//
// Axes (CONSTITUTION §2A/§2B): governance P1-P8, content-quality CQ1-CQ10.
// Grounding rule: each tag maps to the pillar whose definition its documented
// purpose (the tag's own comment above) most directly advances; a second edge
// is added only where the purpose materially serves another pillar. Hard
// groundings honoured verbatim: the CQ-vector comments above (security→CQ3,
// reliability→CQ4, observability→CQ4 supporting, supply-chain→CQ3 supporting,
// accessibility→CQ1 supporting), the D22 §22.3 checklist example (orchestration
// → P5 primary, P7+P8 supporting), and the floor-tag comments (floor:security
// → P6, floor:protocol → the pipeline). floor:ui-ux maps to the content-quality
// vectors it floors — CQ1 (UI) + CQ2 (UX) — under the current §2B definitions.

export type PillarRole = "primary" | "supporting";

export interface PillarWeight {
  /** A governance (P1-P8) or content-quality (CQ1-CQ10) pillar id. */
  pillar: string;
  role: PillarRole;
}

/**
 * D22 §22.3-L1 weighted-tally weights: a tag→pillar edge that is the artifact's
 * PRIMARY pillar counts 1.0; a SUPPORTING edge counts 0.4. Consumed by
 * {@link weightedPillarTally} and `scripts/validate-pillar-coverage.ts`.
 */
export const PILLAR_ROLE_WEIGHT: Record<PillarRole, number> = {
  primary: 1.0,
  supporting: 0.4,
};

/** Governance-axis pillar ids (CONSTITUTION §2A). */
export const GOVERNANCE_PILLARS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"] as const;

/** Content-quality-axis pillar ids (CONSTITUTION §2B; CQ10 added 2026-07-09). */
export const CONTENT_QUALITY_PILLARS = [
  "CQ1", "CQ2", "CQ3", "CQ4", "CQ5", "CQ6", "CQ7", "CQ8", "CQ9", "CQ10",
] as const;

/** Every valid pillar id across both axes — the id union a PILLAR_MAP edge may cite. */
export const ALL_PILLARS: readonly string[] = [
  ...GOVERNANCE_PILLARS,
  ...CONTENT_QUALITY_PILLARS,
];

/**
 * Canonical tag→pillar map. Covers every capability + floor tag (the two facets
 * the D22 §22.3 tally reads). Non-capability/floor facets (context, language,
 * cli-tool, cli-tool-category, ui-ux-specialisation, customize, role) are
 * intentionally absent — they are technical-compatibility or classification
 * markers, not pillar-service signals. {@link pillarsForTag} returns [] for any
 * tag not listed here. Completeness + edge validity are gated by
 * `scripts/validate-pillar-coverage.ts --check` (a capability/floor tag with no
 * entry, or an edge citing a pillar outside {@link ALL_PILLARS}, fails the gate).
 */
export const PILLAR_MAP: Record<string, PillarWeight[]> = {
  // ── Base capability (1.x) ──
  [TAG_PLANNING]:       [{ pillar: "CQ10", role: "primary" }],
  [TAG_IMPLEMENTATION]: [{ pillar: "P2", role: "primary" }, { pillar: "CQ8", role: "supporting" }],
  [TAG_REVIEW]:         [{ pillar: "P2", role: "primary" }, { pillar: "CQ5", role: "supporting" }],
  [TAG_DEVOPS]:         [{ pillar: "CQ4", role: "primary" }],
  [TAG_MAINTENANCE]:    [{ pillar: "CQ8", role: "primary" }, { pillar: "P4", role: "supporting" }],
  // Checklist 22.3-L1 authoritative example — kept verbatim.
  [TAG_ORCHESTRATION]:  [{ pillar: "P5", role: "primary" }, { pillar: "P7", role: "supporting" }, { pillar: "P8", role: "supporting" }],
  [TAG_ORCHESTRATOR]:   [{ pillar: "P5", role: "primary" }, { pillar: "P7", role: "supporting" }, { pillar: "P8", role: "supporting" }],
  [TAG_BOARD]:          [{ pillar: "P1", role: "primary" }],
  [TAG_PERFORMANCE]:    [{ pillar: "CQ7", role: "primary" }],
  [TAG_AI]:             [{ pillar: "CQ9", role: "primary" }, { pillar: "CQ5", role: "supporting" }],

  // ── CQ-vector + supporting capability (2.0.0) — CQ edges honour the tag comments above ──
  [TAG_SECURITY]:        [{ pillar: "CQ3", role: "primary" }, { pillar: "P6", role: "supporting" }],
  [TAG_RELIABILITY]:     [{ pillar: "CQ4", role: "primary" }],
  [TAG_TESTING]:         [{ pillar: "CQ5", role: "primary" }],
  [TAG_SCALABILITY]:     [{ pillar: "CQ6", role: "primary" }],
  [TAG_MAINTAINABILITY]: [{ pillar: "CQ8", role: "primary" }],
  [TAG_ENHANCABILITY]:   [{ pillar: "CQ9", role: "primary" }],
  [TAG_OBSERVABILITY]:   [{ pillar: "CQ4", role: "supporting" }],
  [TAG_SUPPLY_CHAIN]:    [{ pillar: "CQ3", role: "supporting" }, { pillar: "P6", role: "supporting" }],
  [TAG_ACCESSIBILITY]:   [{ pillar: "CQ1", role: "supporting" }],

  // ── Work-type capability (2.0.0) ──
  [TAG_SPEC]:             [{ pillar: "CQ10", role: "primary" }],
  [TAG_GREENFIELD]:       [{ pillar: "CQ10", role: "supporting" }],
  [TAG_BROWNFIELD]:       [{ pillar: "CQ10", role: "supporting" }],
  [TAG_MIGRATION]:        [{ pillar: "CQ9", role: "primary" }, { pillar: "CQ4", role: "supporting" }],
  [TAG_TELEMETRY]:        [{ pillar: "CQ4", role: "supporting" }, { pillar: "P7", role: "supporting" }],
  [TAG_COST]:             [{ pillar: "P7", role: "primary" }],
  [TAG_ANTI_DUPLICATION]: [{ pillar: "P4", role: "primary" }, { pillar: "CQ8", role: "supporting" }],
  [TAG_CODE_QUALITY]:     [{ pillar: "CQ8", role: "primary" }],
  [TAG_CODE_STANDARDS]:   [{ pillar: "CQ8", role: "primary" }],
  [TAG_RIGHT_SIZING]:     [{ pillar: "P4", role: "primary" }],
  [TAG_ADAPTERS]:         [{ pillar: "P3", role: "primary" }],
  [TAG_CAPABILITY]:       [{ pillar: "P3", role: "supporting" }],
  [TAG_CURRENCY]:         [{ pillar: "P3", role: "primary" }],
  [TAG_ITERATION]:        [{ pillar: "P1", role: "supporting" }],
  [TAG_SUMMARY]:          [{ pillar: "P1", role: "supporting" }],
  [TAG_LEARNING]:         [{ pillar: "P2", role: "supporting" }, { pillar: "P5", role: "supporting" }],
  [TAG_KNOWLEDGE_CAPTURE]: [{ pillar: "P2", role: "supporting" }],
  [TAG_PROOF]:            [{ pillar: "P2", role: "primary" }],
  [TAG_VERIFICATION]:     [{ pillar: "P2", role: "primary" }, { pillar: "CQ5", role: "supporting" }],
  [TAG_CITATION]:         [{ pillar: "P2", role: "supporting" }],
  [TAG_PLAYWRIGHT]:       [{ pillar: "CQ5", role: "primary" }, { pillar: "CQ1", role: "supporting" }],
  [TAG_VISUAL_REGRESSION]: [{ pillar: "CQ1", role: "primary" }, { pillar: "CQ5", role: "supporting" }],

  // ── Floor tags — map to the pillar(s) their coverage-floor protects ──
  [TAG_FLOOR_SECURITY]:        [{ pillar: "P6", role: "primary" }, { pillar: "CQ3", role: "supporting" }],
  [TAG_FLOOR_UI_UX]:           [{ pillar: "CQ1", role: "primary" }, { pillar: "CQ2", role: "primary" }],
  [TAG_FLOOR_PROTOCOL]:        [{ pillar: "P5", role: "primary" }, { pillar: "P8", role: "supporting" }],
  // Meta content-quality coverage floor — guarantees the CQ specialists ship in
  // every preset; maps to P4 (Lean Coverage's coverage-guarantee) rather than a
  // single CQ vector, since each CQ specialist already carries its own CQ tag.
  [TAG_FLOOR_CONTENT_QUALITY]: [{ pillar: "P4", role: "supporting" }],
};

/**
 * Pillar edges served by a tag. Returns [] for any tag absent from
 * {@link PILLAR_MAP} — unknown tags, and every context / language / cli-tool /
 * cli-tool-category / ui-ux-specialisation / customize / role tag (those are
 * compatibility or classification markers, not pillar-service signals).
 */
export function pillarsForTag(tag: string): PillarWeight[] {
  return PILLAR_MAP[tag] ?? [];
}

/**
 * D22 §22.3 weighted pillar-coverage tally. For each artifact, every pillar it
 * touches contributes the MAX edge weight among that artifact's tags mapping to
 * that pillar (so a cross-cutting tag "does not triple-count and suppress the
 * coverage signal" per 22.3-L1); the per-artifact contributions are summed
 * across the corpus. Deterministic: identical `items` always yield an identical
 * tally — the reproducibility property D22-SA22.3-01 restores. Consumed by
 * `scripts/validate-pillar-coverage.ts` and pinned by the tags unit tests.
 *
 * @param items - Artifacts, each exposing `tags: string[]` (its frontmatter tags).
 * @returns A record from pillar id to its 3dp-rounded weighted artifact count.
 */
export function weightedPillarTally(
  items: ReadonlyArray<{ tags: readonly string[] }>,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const item of items) {
    // Per-artifact, per-pillar MAX edge weight (dedupes cross-cutting tags so a
    // pillar an artifact reaches through several tags counts once, at its
    // highest role).
    const perPillarMax: Record<string, number> = {};
    for (const tag of item.tags) {
      for (const edge of pillarsForTag(tag)) {
        const w = PILLAR_ROLE_WEIGHT[edge.role];
        const prev = perPillarMax[edge.pillar];
        if (prev === undefined || w > prev) perPillarMax[edge.pillar] = w;
      }
    }
    for (const pillar of Object.keys(perPillarMax)) {
      totals[pillar] = (totals[pillar] ?? 0) + perPillarMax[pillar];
    }
  }
  for (const pillar of Object.keys(totals)) {
    totals[pillar] = Math.round(totals[pillar] * 1000) / 1000;
  }
  return totals;
}
