import type { Framework } from "../types.js";

/**
 * Tech-stack portability support tiers (D14-15, SA14.1-F4).
 *
 * Single source of truth for which detected stack has a dedicated canonical
 * `rules/hatch3r-*-patterns.md` rule ("full"), which is covered only by
 * language-agnostic cross-cutting rules applied via globs ("partial"), and
 * which has neither a dedicated rule nor a `lang:*` capability tag mapping
 * ("none"). The user-facing matrix `docs/stack-support-matrix.md` is rendered
 * from these same tiers; keep the two in sync when adding a stack rule.
 *
 * "partial" is the floor, never a gap: every project receives the always-on
 * rules (`hatch3r-code-standards`, `hatch3r-security`, `hatch3r-testing`) plus
 * every glob-scoped cross-cutting rule whose globs match its files. A "partial"
 * stack lacks only the stack-idiom rule (e.g. framework lifecycle, ORM, native
 * build conventions) — it is not unsupported.
 */
export type StackSupportTier = "full" | "partial" | "none";

export interface StackSupport {
  /** Support tier for the detected stack. */
  tier: StackSupportTier;
  /**
   * Canonical rule id that provides dedicated coverage when `tier === "full"`,
   * else `undefined` (the stack relies on cross-cutting glob-scoped rules).
   */
  rule?: string;
}

/**
 * Detected framework -> support tier. A `Record<Framework, ...>` so that adding
 * a value to the {@link Framework} union without classifying it here is a
 * compile error — closing the silent-drift gap where a newly detected framework
 * would surface no support signal in the `init` pointer or the matrix.
 *
 * Source for "full": the on-disk `rules/hatch3r-*-patterns.md` set (9 dedicated
 * stack rules as of 2.0.0). JS/TS web frameworks resolve to "partial" — they
 * are covered by `hatch3r-component-conventions`, `hatch3r-accessibility-standards`,
 * `hatch3r-ux-states-and-flows`, `hatch3r-theming`, and `hatch3r-design-system-detection`
 * via `.tsx` / `.jsx` / `.vue` / `.svelte` file globs, but carry no
 * framework-idiom rule.
 */
export const FRAMEWORK_SUPPORT: Record<Framework, StackSupport> = {
  // Full — dedicated stack rule (Python request-path + ORM N+1 floor).
  django: { tier: "full", rule: "hatch3r-python-patterns" },
  flask: { tier: "full", rule: "hatch3r-python-patterns" },
  fastapi: { tier: "full", rule: "hatch3r-python-patterns" },
  // Full — Ruby / Rails idioms.
  rails: { tier: "full", rule: "hatch3r-ruby-rails-patterns" },
  // Full — PHP / Laravel idioms.
  laravel: { tier: "full", rule: "hatch3r-php-laravel-patterns" },
  // Full — Rust web frameworks (covered by the Rust patterns rule).
  axum: { tier: "full", rule: "hatch3r-rust-patterns" },
  actix: { tier: "full", rule: "hatch3r-rust-patterns" },

  // Partial — JS/TS web frameworks & meta-frameworks: cross-cutting glob rules
  // only, no framework-idiom rule.
  next: { tier: "partial" },
  react: { tier: "partial" },
  vue: { tier: "partial" },
  svelte: { tier: "partial" },
  sveltekit: { tier: "partial" },
  nuxt: { tier: "partial" },
  angular: { tier: "partial" },
  astro: { tier: "partial" },
  remix: { tier: "partial" },
  "solid-start": { tier: "partial" },
  "tanstack-start": { tier: "partial" },
  qwik: { tier: "partial" },
  // Partial — Node backend frameworks: TypeScript rules apply, no framework rule.
  express: { tier: "partial" },
  fastify: { tier: "partial" },
  hono: { tier: "partial" },
  nestjs: { tier: "partial" },
  // Partial — JVM (Spring) and Elixir (Phoenix): language-agnostic rules only.
  spring: { tier: "partial" },
  phoenix: { tier: "partial" },
};

/**
 * Detected language -> support tier (the language axis, distinct from the
 * framework axis). Used for repos where a language is detected but no framework
 * indicator fired (e.g. a Kotlin/Android app, a bare Go module). Languages
 * absent from this map are "partial": they still receive every language-agnostic
 * rule but have no dedicated stack rule.
 *
 * Keys are the names {@link import("./repoAnalyzer.js").DETECTABLE_LANGUAGES}
 * can emit. Only languages with a dedicated `*-patterns` rule are listed as
 * "full"; the rest fall through to "partial" via {@link classifyLanguage}.
 */
export const LANGUAGE_SUPPORT: Record<string, StackSupport> = {
  python: { tier: "full", rule: "hatch3r-python-patterns" },
  go: { tier: "full", rule: "hatch3r-go-patterns" },
  rust: { tier: "full", rule: "hatch3r-rust-patterns" },
  ruby: { tier: "full", rule: "hatch3r-ruby-rails-patterns" },
  php: { tier: "full", rule: "hatch3r-php-laravel-patterns" },
  csharp: { tier: "full", rule: "hatch3r-dotnet-patterns" },
  dart: { tier: "full", rule: "hatch3r-flutter-patterns" },
  // Kotlin & Java share the Android Kotlin patterns rule (Gradle / Compose).
  kotlin: { tier: "full", rule: "hatch3r-android-patterns" },
  java: { tier: "full", rule: "hatch3r-android-patterns" },
};

/** Classify a single detected framework. Unknown -> partial (cross-cutting). */
export function classifyFramework(framework: Framework): StackSupport {
  return FRAMEWORK_SUPPORT[framework] ?? { tier: "partial" };
}

/** Classify a single detected language. Unknown / unlisted -> partial. */
export function classifyLanguage(language: string): StackSupport {
  return LANGUAGE_SUPPORT[language] ?? { tier: "partial" };
}

/** A detected stack the user may want a dedicated rule for (tier !== "full"). */
export interface UnsupportedStack {
  /** Detected framework or language name, as emitted by `analyzeRepo`. */
  name: string;
  /** Whether the name came from framework detection or language detection. */
  axis: "framework" | "language";
  tier: Exclude<StackSupportTier, "full">;
}

/**
 * Return the detected stacks that lack a dedicated rule ("partial" or "none"),
 * de-duplicated and framework-first. Drives the post-`init` one-line pointer
 * (D14-15) so a user on a stack without a dedicated rule learns the support
 * status and where to read the matrix.
 *
 * Detected names that map to a "full"-tier stack are omitted — there is nothing
 * to surface. When a framework already establishes the stack (e.g. `django`
 * implies the Python rule covers it), the underlying `python` language is not
 * separately reported as partial.
 *
 * @param frameworks Detected frameworks from `RepoInfo.frameworks`.
 * @param languages Detected languages from `RepoInfo.languages` (the
 *   `"unknown"` sentinel and any name already covered by a full-tier framework
 *   are filtered out).
 */
export function classifyDetectedStacks(
  frameworks: readonly Framework[],
  languages: readonly string[],
): UnsupportedStack[] {
  const out: UnsupportedStack[] = [];
  const seen = new Set<string>();

  // A language is "explained" by a full-tier framework when that framework's
  // dedicated rule is also that language's dedicated rule (e.g. django/flask/
  // fastapi -> hatch3r-python-patterns covers `python`). In that case the repo
  // IS fully supported on the framework axis, so the language must not be
  // re-reported as partial.
  const rulesFromFullFrameworks = new Set<string>();
  for (const fw of frameworks) {
    const s = classifyFramework(fw);
    if (s.tier === "full" && s.rule) rulesFromFullFrameworks.add(s.rule);
  }

  for (const fw of frameworks) {
    const s = classifyFramework(fw);
    if (s.tier === "full") continue;
    if (seen.has(fw)) continue;
    seen.add(fw);
    out.push({ name: fw, axis: "framework", tier: s.tier });
  }

  for (const lang of languages) {
    if (lang === "unknown") continue;
    const s = classifyLanguage(lang);
    if (s.tier === "full") continue;
    // Skip a language whose dedicated rule a detected full-tier framework
    // already supplies (defensive — a "full" language never reaches here, but
    // a future "partial" language sharing a rule with a full framework would).
    if (s.rule && rulesFromFullFrameworks.has(s.rule)) continue;
    if (seen.has(lang)) continue;
    seen.add(lang);
    out.push({ name: lang, axis: "language", tier: s.tier });
  }

  return out;
}
