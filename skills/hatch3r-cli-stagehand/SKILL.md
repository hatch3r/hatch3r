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

Reach for `stagehand` when the task is in the **browser** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
npx stagehand init
```
Scaffold a Stagehand project with sample TypeScript actions and a `stagehand.config.ts`.

```bash
npx stagehand run scripts/login.ts
```
Execute an AI-driven action script — Stagehand resolves selectors from natural-language intent at runtime.

```bash
npx stagehand record --selector-mode=ai
```
Record an interactive session, capturing AI-resolved selectors for replay.

```bash
npx stagehand observe https://example.com 'find the login form'
```
One-shot observation — returns the structured action(s) without executing them. Useful for dry-run agent loops.

## Wrong Choice When

- **Deterministic E2E test flow with stable selectors:** the AI resolution adds latency and flakiness for selectors you already control. Use `hatch3r-cli-playwright` (tier 2) instead.
- **High-volume scraping at scale:** Stagehand's per-action LLM round-trip is cost-prohibitive past a few hundred pages — use the Browserbase remote-browser product or raw Playwright with explicit selectors.
- **Headless CI in air-gapped environments:** Stagehand requires outbound LLM API access for selector resolution; offline environments fail open-loop.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `hatch3r-cli-playwright` (tier 2) | Stable selectors, deterministic CI, no LLM round-trips needed |
| Browserbase managed browsers | Production scale, session recording, anti-bot evasion |
| Skyvern / Browser-Use | Workflow-style automation with embedded LLM agents |

## Detection / Install

Verify with:
```bash
command -v stagehand
```

Install (mac):

```bash
# npm
npm install -g @browserbasehq/stagehand
```

Homepage: https://github.com/browserbase/stagehand
