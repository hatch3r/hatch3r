---
id: hatch3r-cli-stagehand
description: "Browserbase Stagehand — AI-driven browser automation. Use when natural-language browser steering with on-the-fly DOM reasoning; invoke `stagehand`. Wraps Browserbase Stagehand so prompts decide which DOM nodes to inspect or click."
tags: ["cli-tools", "browser", "opt-in"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: stagehand
  bin: stagehand
  tier: 3
  category: browser
  homepage: https://github.com/browserbase/stagehand
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# stagehand

Browserbase Stagehand — AI-driven browser automation

## When to Use

Reach for `stagehand` when the task is in the **browser** category and the agent would otherwise call an MCP tool or read large outputs into context. v3 (released 2025-10-29) operates directly on the Chrome DevTools Protocol — choose Stagehand when the target page changes shape often enough that hand-written selectors break, or when a prompt is the most compact spec of intent.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## v3 Driver Model

v3 dropped the hard Playwright dependency and exposes a modular driver layer. Pick the driver that matches the host environment:

- **CDP-native (default):** Stagehand talks Chrome DevTools Protocol directly — no test-runner dependency, smallest install, Bun-compatible.
- **Playwright peer:** install `playwright-core` alongside Stagehand to reuse existing Playwright fixtures, traces, or `@playwright/test` reporters.
- **Puppeteer peer:** install `puppeteer-core` to share a launcher with existing Puppeteer scripts.
- **Patchright peer:** install `patchright-core` for stealth-patched CDP profiles.

`playwright-core`, `puppeteer-core`, and `patchright-core` are peer dependencies in v3 — install only the driver you use.

## Recipes

```bash
npx create-browser-app
```
Scaffold a v3 Stagehand project with TypeScript wiring, a `stagehand.config.ts`, and an example `act`/`extract`/`observe` script. Replaces the v2 `npx stagehand init` workflow.

```bash
node scripts/login.ts
```
Execute an AI-driven action script. The script imports `Stagehand` from `@browserbasehq/stagehand`, calls `stagehand.act("click the login button")`, and Stagehand resolves the action at runtime via CDP — no test runner required.

```bash
npx browse get markdown https://example.com
```
One-shot page extraction via `browse-cli` (v0.6+). Returns structured Markdown the agent can consume directly; cheaper than spawning a full Stagehand session for a single read.

```bash
npx browse cdp wss://browser.example.com
```
Attach to an existing CDP endpoint (Browserbase managed session, local Chrome, or a custom launcher). Useful when the script delegates browser lifecycle to another supervisor.

```typescript
// scripts/observe.ts — observe primitive returns actions without executing
import { Stagehand } from "@browserbasehq/stagehand";
const stagehand = new Stagehand({ env: "LOCAL" });
await stagehand.init();
const actions = await stagehand.observe("find the login form");
console.log(JSON.stringify(actions, null, 2));
await stagehand.close();
```
Dry-run agent loop: `observe` returns the candidate action set without performing it, so a caller can route the decision (execute, ask the user, or reject).

## Wrong Choice When

- **High-volume scraping at scale:** Stagehand's per-action LLM round-trip is cost-prohibitive past a few hundred pages — use the Browserbase managed-browser product, raw CDP with cached locators (v3's `deepLocator`), or Stagehand's action cache once a workflow is recorded as a deterministic script.
- **Headless CI in air-gapped environments:** Stagehand requires outbound LLM API access for selector resolution; offline environments fail the `act`/`extract`/`observe` calls. Pre-record actions with v3's automatic action cache, then replay the cached deterministic script in the air-gapped runner.
- **Workflows already covered by a stable test suite:** if Playwright tests with hand-tuned locators already pass green, Stagehand adds an LLM round-trip per step with no behavioural gain. Use `hatch3r-cli-playwright` (tier 2) for the test surface; reserve Stagehand for the agent-driven exploratory flows.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `hatch3r-cli-playwright` (tier 2) | Existing test fixtures, deterministic CI, no LLM round-trips needed |
| Browserbase managed browsers | Production scale, session recording, anti-bot evasion, CAPTCHA solving |
| Stagehand action cache (built into v3) | Same workflow re-run many times — record once, replay deterministically |
| Skyvern / Browser-Use | Workflow-style automation with embedded LLM agents and built-in task loops |

## Detection / Install

Verify with:
```bash
command -v stagehand
```

Install (mac):

```bash
# npm — v3 (Oct 29 2025); drivers are peer deps, install only what you use
npm install -g @browserbasehq/stagehand
# Add a driver only if you need Playwright/Puppeteer/Patchright interop:
# npm install -g playwright-core   # OR
# npm install -g puppeteer-core    # OR
# npm install -g patchright-core
```

References:
- v3 release announcement (2025-10-29): https://www.browserbase.com/blog/stagehand-v3
- Latest npm releases: https://github.com/browserbase/stagehand/releases
- v3 docs: https://docs.stagehand.dev/v3/get_started/introduction

Homepage: https://github.com/browserbase/stagehand
