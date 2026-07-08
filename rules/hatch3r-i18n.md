---
id: hatch3r-i18n
type: rule
description: Internationalization, localization, and RTL support conventions for the project
scope: conditional
globs: "src/**/*.vue,src/**/*.tsx,src/**/*.jsx,src/**/*.ts,**/locales/**,**/i18n/**,**/*i18n*,**/*locale*"
tags: [implementation, floor:ui-ux, lang:typescript]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Internationalization & RTL

**Pillars:** P2 (Scientific & Practical Quality), CQ2 (UX Quality)

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

### Dynamic Keys

String extraction cannot see interpolated keys (`t('status.' + value)`, template-literal keys). Every dynamic-key call site either (a) has a test iterating the full value set and asserting each resolved key exists in the default locale (`i18n.te(key)` or equivalent), or (b) carries a co-located comment enumerating the concrete keys for the parser. CI extraction reports count dynamic call sites as unverified, never as passing. Verification pattern owner: `rules/hatch3r-dynamic-stack-verification.md` → Dynamic i18n Keys.

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
- Define font stacks per script family: Latin, CJK, Arabic, Devanagari — each stack must include a web-safe fallback and `system-ui`.
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

## Microcopy and Tone

Translation strings are user-facing copy — write them as product copy, not as technical labels.

- Use plain language. Default to second person ("you", "your") for end-user surfaces.
- Use a corrective verb in error messages: "Try again", "Reconnect", "Enter a valid email" — not "Error" or "Oops".
- Never expose to end users: protocol acronyms ("FIDO2", "WebAuthn"), raw HTTP status codes ("500", "401"), language sentinel values (`null`, `undefined`), or internal record/ID strings. Translate these into a user-visible cause + recovery.
- CTA labels are action-oriented and specific: "Save changes" beats "Submit"; "Delete project" beats "Confirm"; "Send invite" beats "OK".
- Error tone explains the cause and offers a recovery path. Do not blame the user. Replace "You entered an invalid value" with "This field needs a valid email address — for example, name@example.com".
- Use ICU MessageFormat (1.0 or 2.0 per the MF2 section above) for every plural, gender, and select pattern. Never concatenate translated fragments to build a sentence — each complete sentence is a single translation key with its own placeholders.
- Tone source-of-truth: the GOV.UK Design System content style guide (https://design-system.service.gov.uk/styles/) and IBM Carbon Design System voice and tone guidance (https://carbondesignsystem.com/guidelines/content/general/) — cite both when reviewing tone or training a translator.
- Cross-reference `rules/hatch3r-ux-states-and-flows.md` Microcopy subsection for the state-driven copy patterns (loading, empty, error, partial) that share this tone contract.
