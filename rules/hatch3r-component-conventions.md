---
id: hatch3r-component-conventions
type: rule
description: Component structure, styling tokens, loading/error/empty states, form validation timing, and accessible label patterns for Vue, React, and JSX
scope: conditional
globs: "src/**/*.vue,src/**/*.tsx,src/**/*.jsx"
tags: [implementation, floor:ui-ux, lang:typescript]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Component Conventions

## Library and Token Detection (Mandatory Pre-Author Step)

Before authoring any new UI primitive, complete this scan and reuse > extend > create:

- Scan `package.json` for `@radix-ui/*`, shadcn (`components.json`), Tailwind v4, MUI, or Chakra. If a matching primitive exists in those libraries, extend it instead of writing a new one.
- Locate the token source: `tokens.json` (DTCG spec, 2025.10 revision), `src/styles/tokens.css`, Tailwind `@theme` block (v4), or `tailwind.config.{js,ts}` (v3 fallback). Reference the token by name — never hardcode the resolved value.
- Map the component library convention before writing files: shadcn projects use `src/components/ui/*`; non-shadcn projects typically use `src/components/primitives/*`. Place new files in the existing directory layout.
- Cross-reference `rules/hatch3r-design-system-detection.md` for the full detection workflow and tooling.

## Structure

- Use framework-recommended component syntax (e.g., `<script setup>` for Vue).
- Define props with typed interfaces.
- Define emits/events with typed interfaces.
- Use composables/hooks from project composables directory — never mixins.
- Use stores or equivalent for shared state.

## Naming

- Component files: PascalCase (e.g., `PetWidget.vue`, `QuestPanel.vue`).
- Component names match file names.
- Props: camelCase. Events: kebab-case.

## Styling

- Use the project's design tokens for colors, spacing, typography.
- Prefer utility classes or scoped CSS with BEM naming.
- No inline styles except for dynamic values that can't be expressed as classes.
- No hardcoded color values — use tokens.

## Accessibility (Required)

- All animations: wrap in `prefers-reduced-motion` media query AND check user's `reducedMotion` setting.
- Color contrast: ≥ 4.5:1 for text (WCAG AA).
- Interactive elements: keyboard focusable with visible focus indicator.
- Dynamic content changes: use `aria-live` regions.
- Support high contrast mode.

## State Patterns (Required)

### Four-State Surface Contract

Every async view must render all four states. A missing state is a blocker for merge.

- **Loading:** skeleton with explicit `width` and `height` matching the final content dimensions to prevent Cumulative Layout Shift (CLS). Generic spinners on content surfaces are insufficient.
- **Empty:** distinguish three sub-types, each with the matching CTA:
  - Cold-start (no data ever) — onboarding CTA (e.g., "Create your first project").
  - Active-filter (filters/search exclude all data) — clear-filters CTA.
  - No-permission (auth scope blocks access) — request-access CTA.
- **Error:** show the cause, a retry action, and a fallback path; use a corrective verb ("Try again", "Reload"). Never use "Oops" or generic copy that hides the cause.
- **Partial:** when some data resolves and some fails, render a banner explaining the gap plus the degraded data plus a retry control for the failed slice.

Cross-reference `rules/hatch3r-ux-states-and-flows.md` for the full state-flow specification.

### Loading States
- Use skeleton screens (not spinners) for content areas — match the layout shape of the loaded content.
- Apply a shimmer/pulse CSS animation on skeletons to indicate activity.
- Load content progressively: show available data immediately, fill remaining sections as they resolve.
- Buttons that trigger async actions must show an inline loading indicator (spinner + disabled state) and prevent double-click.

### Error States
- Wrap route-level components in an error boundary that catches render failures and displays a fallback UI.
- Show inline error messages directly below the failed content area with a retry action button.
- Use toast/notification for non-blocking errors (network hiccups, background sync failures) — auto-dismiss after 5–8 seconds with a manual dismiss option.
- Failed components must never render a blank space — always show a fallback with a brief explanation and recovery action.

### Empty States
- Display an illustration or icon with a concise, helpful message explaining why the area is empty.
- Include a primary action CTA that guides the user toward populating the area (e.g., "Create your first project").
- Provide contextual guidance or links to documentation when relevant.
- Differentiate "no data yet" (first-time experience) from "no results found" (active filter/search with a clear-filters action).

### Transition States
- Apply optimistic updates for mutations: reflect the expected outcome immediately, roll back on failure with an error toast.
- Show a pending/saving indicator for in-flight mutations (e.g., subtle progress bar or "Saving..." text).
- Use stale-while-revalidate patterns: display cached data immediately, update in the background, and indicate when a refresh is available.

## Form UX (Required)

### Validation Timing
- Validate on blur for the user's initial input into a field.
- After the first validation error, switch to validate on change so the user sees corrections in real time.
- Always run full form validation on submit as a fallback.

### Error Display
- Show inline error messages directly below the field, linked via `aria-errormessage` and `aria-invalid="true"`.
- Provide an error summary at the top of the form (linked to individual fields) for screen reader users.
- Use a clear visual error indicator: red border + error icon + descriptive text — never rely on color alone.

### Field Patterns
- Group related fields with `<fieldset>` and `<legend>` (e.g., "Shipping Address", "Payment Details").
- Use progressive disclosure for complex forms: show advanced options behind an expandable section or a follow-up step.
- Autofocus the first input field on form mount.
- Verify tab order follows the visual layout order by tabbing through the form — never use positive `tabindex` values.

### Submit Behavior
- Disable the submit button when the form has known validation errors (but keep it focusable for screen readers).
- Show a loading indicator on the submit button during submission.
- Provide clear success feedback: redirect to the result page or display a success toast.
- Prevent double submission by disabling the button and ignoring duplicate submit events during pending requests.

### Error Recovery
- Clear inline field errors immediately when the user enters a corrective character — no debounce on the clear path.
- Re-enable the submit button in real time as the form returns to a valid state.
- On submit with errors, render an error summary at the top of the form with anchor links to each invalid field; move focus to the summary container, not to the first invalid field.
- Required attributes on inputs: `autocomplete` (HTML autofill tokens), `inputmode` (matches expected character set), `aria-describedby` (links help/format hints), and `aria-invalid="true"` once invalid.
- Never use a disabled submit button as the only error signal — disabled state is unreadable to many screen readers and gives no recovery path.

### Accessible Labels
- Every `<input>`, `<select>`, and `<textarea>` must have a visible `<label>` element with a matching `for`/`id` pair.
- Mark required fields with a visual asterisk (`*`) and screen-reader-only text ("required").
- Associate help text or format hints with the field via `aria-describedby`.

## Performance

- UI must render at 60fps (≤ 16ms per frame).
- Prefer CSS animations/transitions over JavaScript animations.
- Use conditional visibility (e.g., `v-show`) over conditional mount (e.g., `v-if`) for frequently toggled elements.
- Lazy-load panels that aren't immediately visible.

## Testing

- Snapshot tests for all visual states.
- Component tests for interactive behavior.
- Verify reduced-motion behavior in tests.
