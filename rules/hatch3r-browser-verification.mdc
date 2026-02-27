---
description: Browser-based verification for UI and user-facing changes
alwaysApply: false
---
# Browser Verification

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

## Verification Protocol

### 1. Ensure Dev Server is Running

- Check if the project's dev server is already running (check terminal output or process list).
- If not running, start it in the background using the project's dev command (e.g., `npm run dev`).
- Wait for the server to be ready before proceeding.
- Do NOT stop shared dev servers when done — other processes may depend on them.

### 2. Navigate and Verify

- Open the browser and navigate to the page or surface affected by the change.
- Visually confirm the implementation matches acceptance criteria.
- Interact with the changed elements: click buttons, fill forms, trigger state changes.
- Check the browser console for errors or warnings introduced by the change.
- If the change is responsive, test at multiple viewport sizes.

### 3. Capture Evidence

- Take screenshots of the affected surfaces showing the change works correctly.
- For before/after changes (visual refactors, bug fixes), capture both states when possible.
- Note any browser console errors or warnings in the verification summary.
- Include screenshots in the PR description or attach to the issue.

### 4. Accessibility Spot-Check (if UI)

- Tab through new interactive elements to verify keyboard accessibility.
- Check that focus indicators are visible.
- Verify color contrast is sufficient on new or changed text.

### 5. Visual Regression Testing

- **Screenshot comparison**: Use Playwright screenshot assertions (`expect(page).toHaveScreenshot()`) for page-level regression. For component-level visual regression, use Chromatic, Percy, or Playwright component screenshots. Compare against approved baselines on every PR.
- **Baseline management**: Store baseline images in version control (for Playwright) or in a cloud service (Chromatic/Percy). Review and approve visual diffs as part of the PR review workflow — treat unapproved visual changes as blocking.
- **What to capture**: Key pages and critical user flows at multiple viewport sizes: mobile (375px), tablet (768px), desktop (1440px). Capture dark and light theme variants. Capture empty, loading, and error states for data-driven pages.
- **Thresholds**: Configure a pixel-level variance threshold of 0.1–0.5% to tolerate anti-aliasing and font rendering differences across environments. Flag structural changes (layout shifts, missing elements, new elements) as hard failures regardless of threshold.
- **CI integration**: Run visual regression tests in the PR pipeline alongside unit and integration tests. Block merge on unapproved visual changes. Generate visual diff reports (side-by-side, overlay, or slider) and link them in the PR for reviewer access.

## Tools

Use the browser automation MCP available in your environment:

- **Cursor:** `cursor-ide-browser` MCP (browser_navigate, browser_snapshot, browser_click, browser_type, browser_screenshot, browser_tabs)
- **Playwright MCP:** `@anthropic/mcp-playwright` for headless or headed browser automation
- **Fallback:** If no browser MCP is available, document that browser verification was skipped and why.
