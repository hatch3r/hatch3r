---
description: Internationalization, localization, and RTL support conventions for the project
globs: src/**/*.vue, src/**/*.tsx, src/**/*.jsx, src/**/*.ts
alwaysApply: false
---
# Internationalization & RTL

## Locale Management

- Detect locale via resolution chain: explicit user preference → `Accept-Language` header (server) → `navigator.language` (client) → default locale.
- Define a fallback chain per locale (e.g., `fr-CA` → `fr` → `en`) and always resolve to a supported locale.
- Persist user locale choice in user settings or `localStorage`; pass locale via URL segment or header — never infer from IP alone.
- Load only the active locale's translations at runtime; lazy-load additional locales on demand.

## Text & Translation

- Use ICU MessageFormat syntax for plurals, gender, and select patterns (`{count, plural, one {# item} other {# items}}`).
- Never embed HTML markup inside translation strings — pass components or slots as interpolation values instead.
- Translation keys: use dot-separated, hierarchical namespaces matching feature structure (`settings.profile.title`, `cart.empty.message`).
- Never concatenate translated fragments to build sentences — each complete sentence is a single translation key.
- Maintain a string extraction workflow (e.g., `i18next-parser`, `vue-i18n-extract`) that runs in CI to flag unused and missing keys.

## RTL Support

- Use CSS logical properties exclusively: `margin-inline-start` (not `margin-left`), `padding-inline-end` (not `padding-right`), `inset-inline-start` (not `left`), `text-align: start` (not `text-align: left`).
- Set `dir` and `lang` attributes on `<html>` dynamically based on active locale (`<html dir="rtl" lang="ar">`).
- Use `dir="auto"` on user-generated content elements to let the Unicode Bidirectional Algorithm determine direction.
- Mirror directional icons (arrows, chevrons, navigation cues) in RTL; do not mirror semantic icons (checkmarks, search, external link).
- Use `logical` keyword for `resize`, `overflow`, and `float` where supported; provide fallbacks with `[dir="rtl"]` overrides where needed.

## Number & Date Formatting

- Format all numbers with `Intl.NumberFormat` — never manually insert thousands separators or decimal points.
- Format all dates with `Intl.DateTimeFormat`; use relative time with `Intl.RelativeTimeFormat` for recent timestamps.
- Format currency with `Intl.NumberFormat` using `style: 'currency'` and the correct currency code — never hard-code symbols.
- Sort locale-sensitive strings with `Intl.Collator` — never use raw `String.prototype.localeCompare` without options.
- Always pass the active locale to all `Intl` constructors.

## Layout Accommodations

- Allow 30–40% text expansion for German/Finnish translations relative to English; test UI with pseudo-localization that pads strings.
- Use `min-height` instead of fixed `height` on text containers to accommodate CJK line-height requirements (1.6–1.8 recommended).
- Define font stacks per script family: Latin, CJK, Arabic, Devanagari — ensure each stack includes a web-safe fallback and `system-ui`.
- Truncate overflowing text with `text-overflow: ellipsis` plus `overflow: hidden` and `white-space: nowrap` only when semantically safe; provide title/tooltip with full text.
- Avoid fixed-width containers for translatable text; prefer `min-width` / `max-width` with flex/grid layout.

## Testing

- Enable pseudo-localization (e.g., `[Ḿéššàĝé]`) during development to surface hardcoded strings and layout overflow.
- Run RTL visual tests: render key pages with `dir="rtl"` and compare screenshots for layout correctness.
- Add a CI check that verifies translation completeness: every key in the default locale exists in all target locales.
- Compare screenshots across locales (especially German for expansion, Arabic for RTL, Japanese for CJK) at key viewport sizes.
- Validate that all `Intl` formatting output is correct for edge-case locales (e.g., `ar-SA` for Hindu-Arabic numerals, `de-DE` for comma decimals).

## ICU MessageFormat 2.0 (MF2)

ICU MessageFormat 2.0 reached Final Candidate status in CLDR 46.1 (January 2025). MF2 is a significant evolution from MessageFormat 1.0, designed as a platform-independent specification with improved extensibility.

### Key Syntax Changes from MF1

- **Variable references** use `$` prefix: `{$userName}` instead of positional `{0}` arguments.
- **Declarations** use `.input` and `.local` for explicit variable binding:
  ```
  .input {$count :number}
  .local $formattedDate = {$date :datetime dateStyle=medium}
  ```
- **Selection** uses `.match` instead of nested `{value, select, ...}` / `{value, plural, ...}`:
  ```
  .input {$count :number}
  .match $count
  0   {{No items}}
  one {{1 item}}
  *   {{{$count} items}}
  ```
- **Functions** are invoked with `:functionName` syntax inside placeholders: `{$date :datetime dateStyle=long}`, `{$amount :number style=currency currency=USD}`.
- **Markup** elements use `{#tag}` open, `{/tag}` close, and `{#tag /}` self-closing syntax for embedding structural elements without leaking HTML into translation strings.

### Custom Function Registry

- MF2 supports user-defined functions for domain-specific formatting. Register custom functions (e.g., `:relativeTime`, `:fileSize`, `:userName`) in the formatter's function registry.
- Custom functions receive the resolved value and a map of named options. They must return a formatted string.
- Document all custom functions in the project's i18n guide. Include: function name, accepted options, example usage, and expected output.

### Adoption Guidance

- **Runtime support:** As of early 2025, native browser/runtime support for MF2 is limited. Use the `messageformat` 4.0 npm package (or equivalent polyfill) for JavaScript/TypeScript.
- **ICU libraries:** Java (ICU4J 76+) and C/C++ (ICU4C 76+) include tech preview MF2 implementations.
- **Migration strategy:** New translation keys should use MF2 syntax. Existing MF1 keys can be migrated incrementally — both syntaxes can coexist during transition.
- **Tooling:** Verify that your translation management system (TMS) supports MF2 syntax before migrating. Test with a small key set first.
- **Stability:** The MF2 specification has stability guarantees post-approval (mid-2025). Syntax and semantics will not change incompatibly after that point.
