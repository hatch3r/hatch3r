# Competitor Token-Overhead Comparison

> **Last verified**: 2026-07-12 | **hatch3r version**: 2.5.0

hatch3r generates a static agentic-setup corpus. Its distinguishing token cost is the always-on rule frame that every agent turn carries as input. This note is the maintained baseline for that overhead against Cursor and GitHub Copilot, so hatch3r's cost position rests on measured figures instead of qualitative claims. Re-measure and re-verify each release (see [Maintenance](#maintenance)).

## Always-on frame and per-task cost

| Setup | Always-on instruction frame | How it is billed | Per-task cost driver |
|-------|-----------------------------|------------------|----------------------|
| **hatch3r** (generated setup) | ~185 KB / ~46k tokens — the 15 `scope: always` canonical rules | Host model's input-token price; ~0.1x of that on a prompt-cache read | Input floor paid every turn; marginal cost depends on prompt-cache reuse |
| **Cursor** | ~30.7 KB always-on rule budget (hatch3r's tracked reading of `cursor.com/docs/context/rules`) | Per-plan monthly credit/token allotment, then metered | Heavy sessions exhaust the monthly allotment (field reports of $150 -> $300/mo still running out) |
| **GitHub Copilot** | Custom-instructions file, loaded per request | Usage-based billing since 2026-06-01: input + output + cached tokens metered at each model's rate; 1 AI Credit = $0.01; per-plan included allotment; code completions stay free | A larger instruction frame is directly billed once the plan's credit allotment is spent |

## Reading the comparison

- hatch3r's ~46k-token frame is larger than Cursor's tracked ~30.7 KB budget. Because it is a per-task input floor, its real competitive cost turns on host caching: an Anthropic prompt-cache read bills ~0.1x of the input price (other hosts discount cached input at their own rates), which amortizes the frame after the first turn.
- Input cost scales linearly with input tokens at a fixed per-token rate, so trimming the always-on frame — for example moving a large optional non-floor rule to Cursor's `agent-requested` activation — lowers per-turn input cost by the same proportion.
- On metered platforms (Cursor credits, Copilot usage-based billing) a large instruction frame is a recurring billed cost; on cache-friendly hosts it amortizes across the session. hatch3r's static-first prompt ordering (stable frame above volatile turn data) keeps the frame cacheable, which is the mechanism its cost position depends on.

## Maintenance

Re-measure the ~46k-token hatch3r figure from the `scope: always` canonical rule set each release; re-verify the Cursor budget and the Copilot billing rows against vendor documentation, keeping sources <=6 months old.

## Sources

- GitHub Copilot usage-based billing — input/output/cached token metering effective 2026-06-01, 1 credit = $0.01 — GitHub Blog + GitHub Docs, accessed 2026-07-12 (official-docs)
- GitHub Copilot token-based billing coverage — TechCrunch, published 2026-05-30, accessed 2026-07-12 (independent-analysis)
- Cursor rules always-on budget (~30.7 KB) — `cursor.com/docs/context/rules`, hatch3r-tracked figure, accessed 2026-07-12 (vendor-docs)
- Cursor token-exhaustion field report — Maxim Saplin, DEV Community (`dev.to`), accessed 2026-07-12 (blog-post)
- hatch3r always-on frame (~185 KB / ~46k tokens across 15 `scope: always` rules) — framework audit measurement, 2026-07
