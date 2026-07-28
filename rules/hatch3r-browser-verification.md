---
id: hatch3r-browser-verification
type: rule
description: Playwright browser verification protocol for UI changes — spec-run-first invocation contract with non-launderable result tokens, exploratory snapshot-mode driving, and accessibility spot-checks
scope: conditional
globs: "**/*.vue,**/*.jsx,**/*.tsx,**/*.svelte,**/components/**,**/*.html,**/*.css,**/*.scss"
tags: [review]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Browser Verification

**Pillars:** P2 (Scientific & Practical Quality), CQ1 (UI Quality)

## When Required

Browser verification is required when changes touch user-facing surfaces:

- UI component changes (new components, modified templates, style changes)
- User-facing features with visual or interactive elements
- Bug fixes for visually observable symptoms
- Visual refactors (layout, styling, animation changes)
- Accessibility audits and fixes
- Frontend performance profiling

## When NOT Required

Skip browser verification for:

- Pure backend/API changes with no UI impact
- Configuration, environment, or infrastructure changes
- Documentation-only changes
- Data model or schema changes without corresponding UI
- CI/CD pipeline changes
- Code refactors that do not alter rendered output

## Session Prompt Pattern

Browser verification is opt-in per command session. The orchestrator follows a standardized prompt flow so the user is asked exactly once.

### Prompt Rules

1. **At the START of any command that supports browser verification**, the orchestrator MUST ask the user once: *"Would you like to enable browser verification for this session? This uses Playwright to test changes in the running application."*
2. **The user's answer applies to ALL stages of that command** — implementation, review, and verification. Do not re-ask at any subsequent stage.
3. **If yes:** all implementation, review, and verification stages include browser testing steps as defined in the Verification Protocol below. The orchestrator confirms a dev server is running (Protocol step 1) and runs the Invocation Contract at each verification point.
4. **If no:** all browser verification steps are skipped silently. Do not emit warnings, reminders, or suggestions to reconsider. The command proceeds as if the Verification Protocol section does not exist.

### Command Support Matrix

| Supports Browser Verification | Does NOT Support |
| ------------------------------ | ---------------- |
| `hatch3r-workflow` | `hatch3r-board-fill` |
| `hatch3r-board-pickup` | `hatch3r-roadmap` |
| `hatch3r-quick-change` | `hatch3r-refactor-plan` |
| `hatch3r-rework` | `hatch3r-security-audit` |
| `hatch3r-debug` | |

Commands in the "Does NOT Support" column are documentation-only, planning-only, or non-implementation commands. They MUST NOT prompt for browser verification. Skills (including `hatch3r-board-groom`, `hatch3r-board-refresh`, `hatch3r-release`) are invoked outside the orchestrator command lifecycle and therefore do not prompt for browser verification.

---

## Verification Protocol

### 1. Confirm Dev Server is Running

- Check if the project's dev server is already running (check terminal output or process list).
- If not running, start it in the background using the project's dev command (e.g., `npm run dev`).
- Wait for the server to be ready before proceeding.
- Do NOT stop shared dev servers when done — other processes may depend on them.

### 2. Run the Verification (spec run, not screenshot review)

- Write or update a Playwright spec asserting the changed behavior with web-first locators, then run it headless per the Invocation Contract below. Assertions execute in the browser process, not in agent context.
- On pass, read the one-line runner summary. On fail, read only the failure excerpt (error + locator + diff counts).
- Step-drive the browser only under the Invocation Contract's Tier 2 conditions — and read page state from accessibility snapshots, never from screenshots.

### 3. Capture Evidence

- Evidence is runner output: the summary line, failure excerpts, and the `toHaveScreenshot()` diff count. Diff images and record captures go to disk via the spec runner; link their paths in the PR or issue — reviewers open them, the agent does not.
- Note any browser console errors or warnings surfaced by the run in the verification summary.

### 4. Accessibility Spot-Check (if UI)

- Tab through new interactive elements to verify keyboard accessibility.
- Check that focus indicators are visible.
- Verify color contrast is sufficient on new or changed text.

### 5. Visual Regression Testing

Owned by `skills/hatch3r-browser-verify/SKILL.md` → "Regression screenshot diffs" (`toHaveScreenshot()` thresholds, masks, baseline management, update policy) — this rule does not restate it.

## Invocation Contract

**Tier 1 — scripted spec run (default for every verification gate):**

```
npx playwright test <spec> --reporter=line
```

Write or reuse a durable spec; run it headless; read only the failure output. Visual checks stay inside the runner as `toHaveScreenshot()` diffs — read the diff count, and open a diff image (viewport-scoped, one per failing assertion) only when the count is above zero.

**Tier 2 — step driving (exception, never the default):** allowed only when (a) no spec can express the check, (b) the failure is not yet understood, or (c) the run is plan-time exploration of an unfamiliar surface. Drive via `playwright-cli` where the host supports skills; else Playwright MCP (`@playwright/mcp`) in its default snapshot (accessibility-tree) mode. Read page state from accessibility snapshots — never `browser_take_screenshot`, never vision mode.

**Result token — every verification ends on exactly one of:**

| Token | Meaning |
|-------|---------|
| `VERIFIED-SPEC` | Tier 1 spec run exited 0 — cite the runner summary line |
| `VERIFIED-INTERACTIVE` | Tier 2 driving completed every check — cite snapshot or console evidence |
| `BLOCKED_MISSING_TOOL` | Required runner/driver absent — name the missing tool and its install command; never converts to a pass |
| `N/A-NO-UI` | Change matches the "When NOT Required" list — name the matching line |

A skipped verification that does not match "When NOT Required" is `BLOCKED_MISSING_TOOL`, not a free-text skip note — tool absence cannot launder into a pass.
