---
id: hatch3r-cli-playwright
description: "Browser automation, web testing, and UI interaction. Use when end-to-end browser test execution capturing screenshots and traces; invoke `playwright`. Built around test runners (`@playwright/test`) with deterministic locators and waits."
tags: ["cli-tools", "browser", "maintenance"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: playwright
  bin: playwright
  tier: 2
  category: browser
  homepage: https://playwright.dev/
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# playwright

Browser automation, web testing, and UI interaction

## When to Use

Reach for `playwright` when the task is in the **browser** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
npx playwright test
```
Run the full suite; non-zero exit on first failing spec.

```bash
npx playwright test --grep '@smoke' --workers=1
```
Filter by tag and serialize workers — stable output for agent log scraping.

```bash
npx playwright test tests/login.spec.ts --reporter=line
```
Single-file run with one-line-per-test reporter — fits in <1KB stdout.

```bash
npx playwright codegen https://example.com
```
Record interactions into a generated spec — human-in-the-loop authoring; not for autonomous runs.

```bash
npx playwright test --update-snapshots
```
Refresh visual/text snapshots after intentional UI changes; review the diff before committing.

```bash
npx playwright show-report
```
Open the HTML report locally — human triage step; agents should parse `test-results/results.json` instead.

## Wrong Choice When

- The system under test exposes only an HTTP API and no rendered UI — use `curl` + `jq` (Tier 1) for ~50x faster runs.
- The task is autonomous natural-language browsing (navigate, read, decide) rather than scripted assertions — Stagehand is built for that loop.
- You only need a one-off page snapshot or screenshot from a script — a headless `curl` plus a server-side renderer is cheaper than the full Playwright install.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `curl` + `jq` | API-only tests; no DOM involved. |
| Stagehand | Agent drives the browser with natural language rather than fixed scripts. |
| Cypress | Existing Cypress suite or component-test workflow; otherwise prefer Playwright for multi-browser support. |

## Detection / Install

Verify with:
```bash
command -v playwright
```

Install (mac):

```bash
# npm
npm install -D @playwright/test && npx playwright install
```

Homepage: https://playwright.dev/
