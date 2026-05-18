---
id: hatch3r-ui-ux-verify
type: skill
description: UI/UX verification gate before declaring a feature done — axe-core, scripted keyboard trace, accessibility-tree snapshot, four-state coverage, visual-regression baseline, one human screen-reader pass per release
tags: [ui, ux, a11y]
quality_charter: agents/shared/quality-charter.md
---
# UI/UX Verification Gate

## Quick Start

This skill defines what "done" means for any feature shipping UI. Run before declaring a feature complete. The 9 gates below mix automated checks (machine-checkable on every PR) with one manual gate (one human screen-reader pass per release). Skipping any gate = the feature is not done. Browser tests and screenshots from `hatch3r-qa-validation` alone do not satisfy this bar.

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: routes in scope (single vs all interactive), WCAG target (2.1 AA vs 2.2 AA), visual-regression baseline policy (regenerate vs keep), AI-UX gate applicability, and whether Gate 9 (manual SR pass) is required this run.

## Fan-out Discipline (P8 B2)

This skill delegates per task size:
- Tier 1 (trivial single-file): inline execution acceptable.
- Tier 2 (multi-file or multi-concern): spawn parallel sub-agents per concern via the Task tool.
- Tier 3 (multi-module / high-risk): one fresh sub-agent per independent module or gate; orchestrator integrates only.

Never under-fan-out to save tokens. Token cost is dominated by quality and completeness gains. Emit `sub_agents_spawned: { count, rationale }` in your output.

## Gate 1: Automated a11y scan (axe-core via Playwright)

- Command: `npx playwright test --grep @a11y` with `@axe-core/playwright` integration on every interactive route.
- Pass criteria: 0 serious / 0 critical violations.
- WCAG 2.2 AA target with explicit checks for the new success criteria:
  - **SC 2.5.8 Target Size:** assert minimum 24x24 CSS px on every focusable element.
  - **SC 2.4.11 Focus Not Obscured:** assert the focus ring is fully visible — not hidden behind sticky headers, banners, or chatbots.
  - **SC 2.5.7 Dragging Movements:** assert a non-drag alternative exists for any drag operation.
- Output: a11y report committed to PR. Merge gate: 0 violations.
- Setup: `import AxeBuilder from '@axe-core/playwright'`; call `new AxeBuilder({ page }).analyze()` inside each route test and assert `results.violations.length === 0` after filtering for `impact in ['serious', 'critical']`.

## Gate 2: Scripted keyboard trace

- Playwright script Tabs / Shift+Tabs / Enter / Space / Escape / Arrows through every interactive element on every route.
- Per-element assertions:
  - Focus is visible (computed outline width > 0 or detectable focus ring).
  - Focused element is within the viewport (scroll into view if not).
  - No keyboard trap — Tab on the last element exits to the next region.
- Pass criteria: 100% interactive elements reached + 0 traps + 0 focus-visibility failures.
- Implementation: enumerate focusable elements via `page.locator('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])')`; iterate Tab presses up to `count + 5` and record the activeElement chain. Diff against the enumeration; any unreached element fails the gate.

## Gate 3: Accessibility-tree snapshot

- Playwright captures the accessibility tree on each route via `page.accessibility.snapshot()`.
- Per-route assertions:
  - Exactly one `<h1>`.
  - Landmark coverage: `banner`, `main`, `nav`, `contentinfo` present.
  - Every form input has an accessible name.
  - Every image has an `alt` attribute or `role="presentation"`.
- Snapshots committed to the repo. Diff on every PR surfaces visual a11y regression.

## Gate 4: Four-state coverage check

- For every async surface, assert snapshots exist for all four states:
  - **loading** (skeleton)
  - **empty** (with CTA)
  - **error** (cause + retry)
  - **partial** (banner + degraded data)
- Missing snapshot = blocker.
- Convention: `src/__tests__/states/<feature>.<state>.spec.ts`.
- Discovery: a pre-test script greps for async data hooks (`useQuery`, `useSWR`, `fetch`, `axios`) and emits the list of features that must have all four state files. Missing files fail the gate before any test runs.

## Gate 5: Visual regression baseline

- `playwright.toHaveScreenshot()` for component-library projects; Chromatic or Percy for Storybook-heavy projects.
- Baselines committed to git or stored in the registry. Never auto-regenerated in CI on the same commit that introduces a visual change.
- Pass criteria: 0 unintentional drift. Intentional drift requires a reviewer to update the baseline.
- Pixel threshold: `maxDiffPixels: 0` for layout-critical screens (header, nav, primary CTA); `maxDiffPixelRatio: 0.001` for content-heavy screens. Tighter thresholds catch silent regressions; looser thresholds tolerate font-rendering noise on content text.

## Gate 6: Microcopy lint

- Forbid filler tokens in user-facing strings: "oops", "whoops", "something went wrong", "uh oh".
- Require a corrective verb on error strings — scan the messages files for error messages, fail when no imperative verb appears.
- Require the `autocomplete` attribute on every input matching `email`, `password`, `name`, or `address`. axe-core covers part of this; add a custom rule for the rest.

## Gate 7: Core Web Vitals (2026 thresholds)

- Lighthouse CI or the `web-vitals` library in a synthetic environment.
- p75 thresholds, measured on mobile with slow-4G + 4x CPU throttle:
  - **LCP** <= 2.5s
  - **INP** <= 200ms
  - **CLS** <= 0.1
- Failure on any metric = merge blocker.
- Field data follow-up: when production has RUM (Real User Monitoring) wired via `web-vitals` posting to an analytics endpoint, compare p75 field values to synthetic budgets weekly. A 25% gap between synthetic and field is a finding — re-tune the synthetic environment.

## Gate 8: AI-UX checks (when applicable)

Applies only when the feature ships LLM-driven UI:

- Streaming hooks in use — grep for `useChat`, `useCompletion`, `streamUI`, or the framework equivalent.
- Tool-call cards visible by default — assert at least one rendered card per tool invocation in fixtures.
- Human-approval gates present for side-effectful tools — assert an approval card before `write`, `send`, or `post` tool calls.
- Cancel/abort controls present and wired to an `AbortController`.

Cross-reference: `rules/hatch3r-ai-ux-patterns.md` (Slice 5).

## Gate 9: Manual screen-reader pass (per release, not per PR)

- One human pass with VoiceOver (macOS or iOS) or NVDA (Windows) per release on the key user flow.
- Document the trace in the release notes: route walked, issues found, fixes applied.
- This gate cannot be skipped or automated away.
- Trace template: open route, enable screen reader, navigate by heading / by landmark / by form control. Record three things — what was announced, what was missing, what was wrong. Fix or file before release.

## Verdict

All 9 gates pass = the feature is "done". Anything less = not done.

The orchestrator running this skill emits a single-line verdict per gate (`GATE_N: PASS|FAIL <evidence-path>`) and aggregates them. One FAIL on a required gate blocks the merge regardless of QA validation status.

## When this skill runs

- After `hatch3r-implementer` finishes feature code and before `hatch3r-qa-validation` runs.
- On every PR that touches `src/components/`, `src/pages/`, `src/routes/`, or any file matched by the design-system glob.
- Gate 9 (manual screen-reader pass) skipped on PR runs and required at release-cut time only.

## Cross-References

- `rules/hatch3r-accessibility-standards.md`
- `rules/hatch3r-ux-states-and-flows.md`
- `rules/hatch3r-ai-ux-patterns.md`
- `rules/hatch3r-design-system-detection.md`
- `rules/hatch3r-performance-budgets.md`

## References

- Playwright accessibility testing — `playwright.dev/docs/accessibility-testing`
- Deque axe-core — `github.com/dequelabs/axe-core`
- Google Core Web Vitals 2026 thresholds — `web.dev/articles/vitals`
- Vercel AI SDK UI documentation — `sdk.vercel.ai/docs/ai-sdk-ui`
- WCAG 2.2 — `www.w3.org/TR/WCAG22/`
