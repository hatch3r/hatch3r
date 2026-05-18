---
id: hatch3r-a11y-audit
description: Run a WCAG AA accessibility audit with findings and fixes across 7 scan categories (keyboard, contrast, ARIA, reduced motion, screen reader, high contrast, automated axe). Use when auditing accessibility or verifying WCAG compliance.
tags: [review, a11y]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
# Accessibility Audit Workflow

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Read accessibility requirements from rules and specs
- [ ] Step 2: Automated scan — run axe-core or similar on all pages/components
- [ ] Step 3: Manual audit — load references/manual-audit-checklist.md
- [ ] Step 4: Catalog findings by severity (critical/major/minor)
- [ ] Step 5: Fix critical and major findings
- [ ] Step 6: Verify fixes with re-scan and manual check
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: WCAG conformance target (A vs AA vs AAA), scope (single component vs full app), surfaces to audit (which routes), fix authority (audit-only vs audit-and-fix), and screen-reader pass scope (per release vs per audit).

## Fan-out Discipline (P8 B2)

This skill delegates per task size:
- Tier 1 (trivial single-file): inline execution acceptable.
- Tier 2 (multi-file or multi-concern): spawn parallel sub-agents per concern via the Task tool.
- Tier 3 (multi-module / high-risk): one fresh sub-agent per independent module or gate; orchestrator integrates only.

Never under-fan-out to save tokens. Token cost is dominated by quality and completeness gains. Emit `sub_agents_spawned: { count, rationale }` in your output.

## Progressive Disclosure

- **Main skill file (this):** Workflow steps, automated scan, fix process, DoD.
- **`references/manual-audit-checklist.md`:** Detailed WCAG requirements matrix, per-category manual criteria, severity cataloging rubric. Load during Step 3.

## Step 1: Read Accessibility Requirements

From project component rules (Accessibility section):

- All animations: wrap in `prefers-reduced-motion` media query AND check user's reduced motion setting.
- Color contrast: >= 4.5:1 for text (WCAG AA).
- Interactive elements: keyboard focusable with visible focus indicator.
- Dynamic content changes: use `aria-live` regions.
- Support high contrast mode.

For the full WCAG requirements matrix, load `references/manual-audit-checklist.md`.

For external library docs and current best practices, follow the project's tooling hierarchy.

## Step 2: Automated Scan

- Install and run `@axe-core/vue`, `vitest-axe`, or Playwright's `@axe-core/playwright` on all pages and key components.
- Run against: main routes, key components (if testable in isolation).
- Capture all violations. Map to WCAG criteria (e.g., 1.1.1, 1.4.3, 2.1.1, 4.1.2).
- Document: rule ID, description, impact, elements affected, WCAG level.

## Step 3: Manual Audit

Load `references/manual-audit-checklist.md` and work through each category:

1. Keyboard navigation
2. Color contrast
3. ARIA attributes
4. Reduced motion
5. Screen reader
6. High contrast mode

The reference file provides the specific criteria, DevTools settings, and pass/fail conditions for each.

## Step 4: Catalog Findings

Use the severity rubric in `references/manual-audit-checklist.md` to assign severity. Produce a findings table: ID, severity, WCAG criterion, description, location, fix suggestion. Prioritize critical first, then major. Minor can be batched.

## Step 5: Fix Critical and Major Findings

- Implement fixes following project component and quality requirements.
- Use semantic HTML where possible (`<button>`, `<a>`, `<nav>`, `<main>`).
- Add `aria-*` attributes for custom components.
- Verify `prefers-reduced-motion` is respected by enabling the media query in DevTools and confirming animations are disabled or simplified.
- Add or fix focus styles. Use design tokens for focus ring.
- Verify reduced-motion behavior in tests.

## Step 6: Verify Fixes

- Re-run automated scan. No critical or major violations.
- Manual keyboard and screen reader check on fixed areas.
- Run full test suite and confirm 0 failures to verify no regressions.
- Document remaining minor findings for future backlog.

## Required Agent Delegation

You MUST spawn these agents via the Task tool (`subagent_type: "generalPurpose"`) at the appropriate points:

- **`hatch3r-a11y-auditor`** — MUST spawn to perform the full WCAG AA compliance audit autonomously. Provide the list of surfaces/components to audit and the current violation list.

## Related Rules

- **Rule**: `hatch3r-browser-verification` — follow this rule for live browser-based accessibility testing

## Error Handling

- **No automated scanner available**: If axe-core, Lighthouse, or equivalent is not installed, report the gap and proceed with manual checklist-only audit. Do not skip the audit.
- **Scanner produces false positives**: Cross-reference automated findings against manual inspection. Mark confirmed false positives with justification and exclude from the violation count.
- **Component renders differently across browsers**: Test in at least two browser engines (Chromium + Firefox or Safari). Document browser-specific a11y gaps with reproduction steps.

## Definition of Done

- [ ] No critical a11y violations
- [ ] WCAG AA compliance on all audited surfaces
- [ ] Reduced motion respected (`prefers-reduced-motion` + user setting)
- [ ] Keyboard navigation complete with visible focus
- [ ] Color contrast >= 4.5:1 for text
- [ ] ARIA live regions for dynamic content
- [ ] Automated scan clean for critical/major
- [ ] Manual verification completed
