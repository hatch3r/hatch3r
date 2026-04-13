/**
 * Tag taxonomy for hatch3r content files.
 *
 * Workflow tags describe what phase of the dev lifecycle a content item serves.
 * Context tags describe what kind of project/team the item is relevant to.
 * Domain tags describe specialized areas.
 */

// ── Workflow tags ──────────────────────────────────────────────
/** Essential for any hatch3r project */
export const TAG_CORE = "core";
/** Spec creation, roadmapping, feature/bug/refactor planning */
export const TAG_PLANNING = "planning";
/** Code writing, fixing, refactoring */
export const TAG_IMPLEMENTATION = "implementation";
/** Code review, QA, security auditing */
export const TAG_REVIEW = "review";
/** CI/CD, releases, deployment */
export const TAG_DEVOPS = "devops";
/** Dependency auditing, health checks, context management */
export const TAG_MAINTENANCE = "maintenance";

// ── Context tags ──────────────────────────────────────────────
/** New project specific (project-spec, roadmap) */
export const TAG_GREENFIELD = "greenfield";
/** Existing project specific (codebase-map, onboard, migration) */
export const TAG_BROWNFIELD = "brownfield";
/** Solo developer */
export const TAG_SOLO = "solo";
/** Team collaboration */
export const TAG_TEAM = "team";

// ── Domain tags ──────────────────────────────────────────────
/** Board/project management commands */
export const TAG_BOARD = "board";
/** Security-related agents/rules/skills */
export const TAG_SECURITY = "security";
/** Accessibility */
export const TAG_A11Y = "a11y";
/** Performance profiling/budgets */
export const TAG_PERFORMANCE = "performance";
/** Meta-customization commands/skills */
export const TAG_CUSTOMIZE = "customize";

// ── Language tags (Finding #71, #74) ─────────────────────────
/** TypeScript/JavaScript projects */
export const TAG_LANG_TYPESCRIPT = "lang:typescript";
/** Python projects */
export const TAG_LANG_PYTHON = "lang:python";
/** Go projects */
export const TAG_LANG_GO = "lang:go";
/** Rust projects */
export const TAG_LANG_RUST = "lang:rust";
/** Java projects */
export const TAG_LANG_JAVA = "lang:java";
/** Ruby projects */
export const TAG_LANG_RUBY = "lang:ruby";

/** All valid tags */
export const ALL_TAGS = [
  TAG_CORE,
  TAG_PLANNING,
  TAG_IMPLEMENTATION,
  TAG_REVIEW,
  TAG_DEVOPS,
  TAG_MAINTENANCE,
  TAG_GREENFIELD,
  TAG_BROWNFIELD,
  TAG_SOLO,
  TAG_TEAM,
  TAG_BOARD,
  TAG_SECURITY,
  TAG_A11Y,
  TAG_PERFORMANCE,
  TAG_CUSTOMIZE,
  TAG_LANG_TYPESCRIPT,
  TAG_LANG_PYTHON,
  TAG_LANG_GO,
  TAG_LANG_RUST,
  TAG_LANG_JAVA,
  TAG_LANG_RUBY,
] as const;

export type ContentTag = (typeof ALL_TAGS)[number];

/** Workflow tags — used in preset definitions */
export const WORKFLOW_TAGS: ContentTag[] = [
  TAG_CORE,
  TAG_PLANNING,
  TAG_IMPLEMENTATION,
  TAG_REVIEW,
  TAG_DEVOPS,
  TAG_MAINTENANCE,
];

/** Context tags — used for project type / team size filtering */
export const CONTEXT_TAGS: ContentTag[] = [
  TAG_GREENFIELD,
  TAG_BROWNFIELD,
  TAG_SOLO,
  TAG_TEAM,
];

/** Domain tags — specialized areas */
export const DOMAIN_TAGS: ContentTag[] = [
  TAG_BOARD,
  TAG_SECURITY,
  TAG_A11Y,
  TAG_PERFORMANCE,
  TAG_CUSTOMIZE,
];

/** Language tags — for language-specific content filtering (Finding #71) */
export const LANGUAGE_TAGS: ContentTag[] = [
  TAG_LANG_TYPESCRIPT,
  TAG_LANG_PYTHON,
  TAG_LANG_GO,
  TAG_LANG_RUST,
  TAG_LANG_JAVA,
  TAG_LANG_RUBY,
];

/**
 * Map detected language names to their corresponding language tags.
 * Used by resolveSelection to filter content by project language (Finding #71).
 */
export const LANGUAGE_TO_TAG: Record<string, ContentTag> = {
  typescript: TAG_LANG_TYPESCRIPT,
  javascript: TAG_LANG_TYPESCRIPT, // JS projects also benefit from TS rules
  python: TAG_LANG_PYTHON,
  go: TAG_LANG_GO,
  rust: TAG_LANG_RUST,
  java: TAG_LANG_JAVA,
  kotlin: TAG_LANG_JAVA, // Kotlin shares Java ecosystem
  ruby: TAG_LANG_RUBY,
};

/**
 * Check whether a tag is a language tag (prefixed with "lang:").
 */
export function isLanguageTag(tag: string): boolean {
  return tag.startsWith("lang:");
}
