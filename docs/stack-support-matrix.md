# Stack Support Matrix

> **Last verified**: 2026-06-06 | **hatch3r version**: 2.0.0

Per-stack portability reference: which tech stacks hatch3r covers with a **dedicated stack rule**, which it covers only with **cross-cutting rules** applied by glob, and where the gaps are. The source of truth for these tiers is `src/detect/stackSupport.ts` (`FRAMEWORK_SUPPORT`, `LANGUAGE_SUPPORT`); the `init` summary reads the same map to print a one-line pointer when a detected stack has no dedicated rule.

This document tracks stack idioms (framework lifecycle, ORM, native build, language conventions). It does **not** track UI/security/testing floors — those ship to every stack regardless of tier (see [Universal floor](#universal-floor)).

## Legend

| Tier | Meaning |
|------|---------|
| **full** | A dedicated `rules/hatch3r-*-patterns.md` rule encodes stack-specific idioms |
| **partial** | No dedicated rule; covered by language-agnostic cross-cutting rules applied via globs (framework/ORM idioms not encoded) |
| **none** | No dedicated rule and no `lang:*` capability-tag mapping; language-agnostic rules still apply |

**partial is a floor, not an absence.** Every stack receives the three always-on rules (`hatch3r-code-standards`, `hatch3r-security`, `hatch3r-testing`) plus every glob-scoped cross-cutting rule whose globs match its files. A partial stack lacks only the stack-idiom rule.

---

## Detection inputs

A stack is detected two ways, both in `src/detect/repoAnalyzer.ts`:

- **Framework** — config-file probes (`next.config.*`, `angular.json`, `manage.py`, `artisan`, `mix.exs`, …) and `package.json` / `Cargo.toml` / `pyproject.toml` / `requirements.txt` dependency-name scans. Emits a `Framework` value (`src/types.ts`).
- **Language** — config-file probes per `LANGUAGE_INDICATORS` (`tsconfig.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, `Gemfile`, `composer.json`, `Package.swift`, `pubspec.yaml`, …) plus a C# extension scan.

`init` calls `classifyDetectedStacks(frameworks, languages)`; any detected stack at tier `partial`/`none` is named in the success-box pointer.

---

## Framework support

One row per detected `Framework`. "Cross-cutting rules" lists the glob-scoped rules that apply to a partial stack's files (the always-on trio is implicit on every row).

| Framework | Tier | Dedicated rule | Cross-cutting coverage / gap |
|-----------|:----:|----------------|------------------------------|
| **django** | full | `hatch3r-python-patterns` | uv, Ruff, mypy strict, pytest, request-path + ORM N+1 floor |
| **flask** | full | `hatch3r-python-patterns` | same Python rule (request-path + ORM N+1 floor) |
| **fastapi** | full | `hatch3r-python-patterns` | same Python rule (ASGI request-path floor) |
| **rails** | full | `hatch3r-ruby-rails-patterns` | Hotwire, ActiveRecord, Sidekiq, RSpec, RuboCop, YJIT |
| **laravel** | full | `hatch3r-php-laravel-patterns` | Eloquent, Service Container DI, Pest, queues, Pint |
| **axum** | full | `hatch3r-rust-patterns` | 2024 edition, thiserror/anyhow, Tokio, Cargo workspaces |
| **actix** | full | `hatch3r-rust-patterns` | same Rust rule |
| **next** | partial | — | `component-conventions`, `accessibility-standards`, `ux-states-and-flows`, `theming`, `design-system-detection` cover `**/*.{tsx,jsx}`. **Gap:** App Router / RSC / route-handler idioms |
| **react** | partial | — | same frontend cross-cutting rules. **Gap:** hooks-rules, suspense/transitions idioms |
| **vue** | partial | — | frontend cross-cutting rules cover `**/*.vue`. **Gap:** Composition API / Pinia / Nuxt-server idioms |
| **nuxt** | partial | — | `**/*.vue` cross-cutting rules. **Gap:** Nitro server / auto-import idioms |
| **angular** | partial | — | `**/*.{tsx,ts}` + a11y/ux cross-cutting rules. **Gap:** signals, DI, standalone-component, RxJS idioms |
| **svelte** | partial | — | a11y/ux/design-system rules cover `**/*.svelte`. **Gap:** runes / store idioms |
| **sveltekit** | partial | — | `**/*.svelte` cross-cutting rules. **Gap:** load-function / form-action / hooks.server idioms |
| **astro** | partial | — | frontend cross-cutting rules on `.tsx`/`.jsx`. **Gap:** island / content-collection idioms |
| **remix** | partial | — | React cross-cutting rules. **Gap:** loader/action / nested-route idioms |
| **solid-start** | partial | — | `.tsx`/`.jsx` cross-cutting rules. **Gap:** signals / resource idioms |
| **tanstack-start** | partial | — | `.tsx`/`.jsx` cross-cutting rules. **Gap:** server-function / router idioms |
| **qwik** | partial | — | `.tsx`/`.jsx` cross-cutting rules. **Gap:** resumability / `$`-boundary idioms |
| **express** | partial | — | TypeScript + `api-design`, `auth-patterns`, `resilience-patterns`, `observability-*` on `**/api/**`, `**/middleware/**`. **Gap:** Express-specific middleware idioms |
| **fastify** | partial | — | same backend cross-cutting rules. **Gap:** plugin/decorator/schema idioms |
| **hono** | partial | — | same backend cross-cutting rules. **Gap:** middleware/adapter idioms |
| **nestjs** | partial | — | same backend cross-cutting rules. **Gap:** module/provider/decorator idioms |
| **spring** | partial | — | language-agnostic rules + `auth-patterns`, `api-design`, `migrations`, `observability-*`. **Gap:** Spring Boot DI, JPA, annotation idioms |
| **phoenix** | partial | — | language-agnostic + backend cross-cutting rules. **Gap:** LiveView / Ecto / OTP idioms |

---

## Language support

For repos where a language is detected but no framework indicator fired (a bare Go module, a Kotlin/Android app, a Swift package). Languages absent from `LANGUAGE_SUPPORT` are tier `partial` (or `none` when they also map to no `lang:*` capability tag).

| Language | Tier | Dedicated rule | Notes |
|----------|:----:|----------------|-------|
| **python** | full | `hatch3r-python-patterns` | also the rule for django/flask/fastapi |
| **go** | full | `hatch3r-go-patterns` | modules, error wrapping, context, table-driven tests, `log/slog` |
| **rust** | full | `hatch3r-rust-patterns` | also the rule for axum/actix |
| **ruby** | full | `hatch3r-ruby-rails-patterns` | also the Rails rule |
| **php** | full | `hatch3r-php-laravel-patterns` | also the Laravel rule |
| **csharp** | full | `hatch3r-dotnet-patterns` | minimal APIs, EF Core, DI, xUnit (detected via `.cs` scan) |
| **dart** | full | `hatch3r-flutter-patterns` | null safety, Riverpod/Bloc, Material 3, integration tests |
| **kotlin** | full | `hatch3r-android-patterns` | Jetpack Compose, coroutines + Flow, Hilt, Room, Gradle |
| **java** | full | `hatch3r-android-patterns` | shares the Android Kotlin rule (Gradle / Compose) |
| **typescript** | partial | — | `hatch3r-typescript-patterns` exists (TS-idiom rule, glob-scoped to `**/*.ts*`) but is not tier-mapped here; tier stays partial because `LANGUAGE_SUPPORT` promotion is framework-axis-driven, not rule-existence-driven. Also covered by always-on + frontend/backend cross-cutting rules |
| **javascript** | partial | — | same as TypeScript (JS repos receive the `hatch3r-typescript-patterns` rule by glob) |
| **swift** | partial | — | `hatch3r-swiftui-patterns` exists but is glob-scoped, not tier-mapped here; see [SwiftUI note](#swiftui-note) |
| **elixir** | none | — | maps to no `lang:*` tag; language-agnostic rules only |
| **scala** | none | — | no dedicated rule, no `lang:*` tag |
| **zig** | none | — | no dedicated rule, no `lang:*` tag |
| **ocaml** | none | — | no dedicated rule, no `lang:*` tag |
| **haskell** | none | — | no dedicated rule, no `lang:*` tag |
| **clojure** | none | — | no dedicated rule, no `lang:*` tag |
| **lua** | none | — | no dedicated rule, no `lang:*` tag |

### SwiftUI note

`rules/hatch3r-swiftui-patterns.md` is a dedicated rule covering Swift 6 concurrency, `@Observable`/`@Bindable`, navigation stacks, SPM, and XCTest, applied to `**/*.swift` files. It is not yet wired into `LANGUAGE_SUPPORT` because Swift is detected by the `swift` language probe but no Swift-specific `Framework` value exists, so the framework axis cannot promote it to `full`. Tracked for promotion once a Swift framework indicator (SwiftPM target type) is added to detection — until then a Swift repo sees the rule applied by glob but the `init` pointer reports `swift` as partial. This is the only stack where the matrix tier understates on-disk coverage.

---

## Universal floor

Every stack — full, partial, or none — receives these regardless of tier:

- **Always-on rules** (`scope: always`): `hatch3r-code-standards`, `hatch3r-security`, `hatch3r-testing`.
- **Floor-tagged content** (`floor:security`, `floor:ui-ux`, `floor:protocol`, `floor:content-quality`): admitted by every non-custom preset and never disabled at any maturity tier (the universal content-quality floor invariant).
- **Glob-scoped cross-cutting rules** whose globs match the repo's files: accessibility, ux-states, theming, design-system, api-design, auth-patterns, migrations, observability (logging/metrics/tracing), resilience, container-hardening, dependency-management, and more.

So "partial" means *no framework-idiom rule*, not *no coverage*. A partial-stack repo still ships the security, accessibility, testing, and observability floors.

---

## Closing a gap

To promote a stack from partial/none to full:

1. Author a `rules/hatch3r-<stack>-patterns.md` (+ `.mdc` twin) following [Content Authoring](https://github.com/hatch3r/hatch3r/blob/main/.claude/rules/content-authoring.md) — `scope: conditional` with stack-file globs, a `lang:<x>` tag, and ≥2 reputable sources in a `## References` section.
2. Map the stack in `src/detect/stackSupport.ts` (`FRAMEWORK_SUPPORT` and/or `LANGUAGE_SUPPORT`) to `{ tier: "full", rule: "hatch3r-<stack>-patterns" }`.
3. If the stack is detected by a new framework/language, add the indicator to `src/detect/repoAnalyzer.ts` and the `Framework` union (`src/types.ts`) or `LANGUAGE_INDICATORS`.
4. If a new language maps to a `lang:*` capability tag, add it to `LANGUAGE_TO_TAG` (`src/content/tags.ts`) so the rule is selected on that stack.
5. Add the row here and update `> Last verified`.
6. Run `npx hatch3r validate`, `npm test`, `npx tsc --noEmit`, `npm run lint`.

A `Record<Framework, ...>` typing on `FRAMEWORK_SUPPORT` makes step 2 mandatory: adding a `Framework` value without classifying it fails the type-check.

---

## Related references

| Topic | Doc |
|-------|-----|
| Per-tool output paths and capabilities | [Adapter Capability Matrix](adapter-capability-matrix.md) |
| Investment depth per project maturity | [Maturity Tiers](maturity-tiers.md) |
| Detection-driven content selection | `src/detect/repoAnalyzer.ts`, `src/content/tags.ts` |
