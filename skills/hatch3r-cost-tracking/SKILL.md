---
id: hatch3r-cost-tracking
name: hatch3r-cost-tracking
type: skill
description: Tracks token usage and estimate costs for agent sessions. Use when monitoring spend, approaching budget limits, or generating cost reports.
tags: [maintenance]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
# Cost Tracking Workflow

## Quick Start

**Applies when:** the project tracks cloud/LLM spend against a budget. On a project with no cost-accounting need, skip (per `rules/hatch3r-right-sizing.md`).

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Review cost tracking configuration
- [ ] Step 2: Estimate current session token usage
- [ ] Step 2a: Re-fetch pricing before reporting (currency gate)
- [ ] Step 3: Identify cost optimization opportunities
- [ ] Step 4: Generate cost report
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: tracking scope (session vs issue vs epic), budget values when missing from hatch.json, hardStop authority (block vs warn), report format target, and whether to defer non-critical work over budget.

## Fan-out Discipline (P8 B2)

Fan-out scales with task size; token cost never justifies serializing independent work (`rules/hatch3r-fan-out-discipline.md` P8 B2; `agents/shared/efficiency-patterns.md`). Emit `sub_agents_spawned: { count, rationale }` in your output.

## Step 1: Review Configuration

1. Check `hatch.json` for a `costTracking` section.
2. Note configured budgets: `sessionBudget`, `issueBudget`, `epicBudget`.
3. Note warning thresholds and whether `hardStop` is enabled.
4. If no configuration exists, operate in report-only mode.

## Step 2: Estimate Token Usage

Estimate tokens for the current session using these rules:

| Content Type | Rule | Accuracy |
|-------------|------|----------|
| Messages | ~4 characters per token | High -- stable ratio for English text |
| Tool calls | JSON length / 4 (input), response length / 4 (output) | Medium -- JSON has more overhead characters |
| File reads | Character count / 4 | High -- but large files may be truncated by the tool |
| Web searches | ~500 tokens per search | Low -- varies widely by result length |
| Subagent spawns | Estimate full context re-sent per spawn (~2000-5000 tokens base) | Medium -- depends on included rules/context |

**Subagent cost multiplier.** Each subagent spawn carries a base cost for the agent protocol, included rules, and context. A pipeline with 8 subagents (researcher + implementer + reviewer + fixer + 4 Phase 4 specialists) has significant overhead from context re-transmission. Factor this into budget estimates.

Calculate estimated cost using named-model rates tied to model IDs. Published-vendor rates drift between model releases — re-fetch before every report per Step 2a; the `accessed:` date marks when each row was last verified.

| Model | Model ID | Input (per 1M) | Output (per 1M) | accessed |
|-------|----------|---------------:|----------------:|----------|
| Claude Haiku 4.5 | `claude-haiku-4-5` | $1.00 | $5.00 | 2026-06-05 |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | $3.00 | $15.00 | 2026-06-05 |
| Claude Opus 4.8 | `claude-opus-4-8` | $5.00 | $25.00 | 2026-06-05 |

**Cache-read multiplier.** Cached input tokens (`cache_read_input_tokens` in the API `usage` block) bill at ~0.1× the model's base input rate; cache writes bill at 1.25× (5-minute TTL) or 2× (1-hour TTL). When a session reuses a large cached prefix, price `cache_read_input_tokens` separately at 0.1× base input — counting them at full input rate overstates spend by up to 10× on cache-heavy agent loops. Total prompt size = `input_tokens` (uncached) + `cache_creation_input_tokens` + `cache_read_input_tokens`.

### Step 2a: Re-fetch Pricing Before Reporting (currency gate)

Published per-token rates change between model releases. Before emitting a cost figure, verify the rate table is current:

1. If any row's `accessed:` date is older than 30 days, re-fetch the vendor's current pricing (Anthropic: https://www.anthropic.com/pricing, or the live `claude-api` skill's models/pricing reference) and update the row's rates + `accessed:` date in place.
2. Confirm the model the session actually ran on maps to a named row. If the session used a model ID absent from the table (e.g. an older or non-Anthropic model), add a row with its published rates and `accessed:` date rather than defaulting to the nearest tier.
3. State the `accessed:` date of the rate used directly in the report (see Step 4). A cost figure with no rate-provenance date is unverifiable — never report a dollar amount without it.

If pricing cannot be re-fetched (offline, vendor page unreachable), proceed with the on-file rates but flag the figure as `(rates as of <accessed-date>, not re-verified)` in the report.

### Default Budgets

When `hatch.json` has no `costTracking` section, apply these defaults (report-only — no hard stop unless `hardStop: true`):

| Budget Type | Default |
|------------|---------|
| `sessionBudget` | $10.00 |
| `issueBudget` | $5.00 |
| `epicBudget` | $25.00 |
| `warningThresholds` | [0.5, 0.75, 0.9] |
| `hardStop` | false |

### Enforcement

| Threshold | Action |
|-----------|--------|
| 50% | Log warning, continue |
| 75% | Alert user, suggest optimization |
| 90% | Strong warning, recommend delegation or checkpoint |
| 100% | Stop (if `hardStop: true`) or alert and continue |

## Step 3: Identify Optimizations

Review usage patterns for savings:

- **Large file reads**: Were files read multiple times without changes? Cache instead.
- **Model tier**: Could routine tasks (linting, formatting) use a faster/cheaper model?
- **Context bloat**: Is irrelevant context accumulating? Summarize and trim.
- **Batching**: Were multiple small tool calls made that could be combined?
- **Scope creep**: Did work expand beyond the original issue? Scope back.

## Step 4: Generate Report

Produce a cost report in this format:

```
## Cost Report: {scope}

**Period:** {session/issue/sprint}

**Token Usage:**
- Input tokens (uncached): ~{n}
- Cache-read tokens: ~{n} (billed ~0.1x base input)
- Cache-write tokens: ~{n} (billed 1.25x / 2x by TTL)
- Output tokens: ~{n}
- Total tokens: ~{n}

**Estimated Cost:** ${amount} ({model-id}, rates accessed {YYYY-MM-DD})

**Budget Status:** {amount} / {budget} ({percentage}%)

**Breakdown:**

| Phase | Tokens | Cost | % of Total |
|-------|--------|------|-----------|
| Planning | ~{n} | ${x} | {%} |
| Implementation | ~{n} | ${x} | {%} |
| Testing | ~{n} | ${x} | {%} |
| Review | ~{n} | ${x} | {%} |
| Sub-agents | ~{n} | ${x} | {%} |

**Optimization Opportunities:**
- {suggestions based on usage patterns}
```

Include total estimated tokens (uncached input + cache-read + cache-write + output), estimated cost at the named-model rate with its `accessed:` date, budget status (if configured), and top optimization opportunities. Always present estimated values with the `~` prefix. Never report a dollar figure without the model ID and rate-access date. Never suppress threshold alerts.

## Error Handling

- **Token usage data unavailable**: If the platform does not expose token metrics, use input/output character counts divided by 4 as an estimate. Note the approximation method in the report.
- **Budget limit exceeded mid-session**: Stop non-critical operations, produce a partial cost report, and recommend which remaining tasks to defer or delegate to a lower-cost model.
- **Cost configuration missing from hatch.json**: Operate in report-only mode and note that budget enforcement is inactive. Recommend adding cost configuration to enable guardrails.

## Definition of Done

- [ ] Cost configuration reviewed (or report-only mode noted)
- [ ] Token usage estimated for current session (uncached input / cache-read / cache-write / output split)
- [ ] Pricing rates verified current per Step 2a; report cites model ID + rate `accessed:` date
- [ ] Optimization opportunities identified
- [ ] Cost report generated with budget status

## Related Skills & Agents

- **Skill**: `hatch3r-context-health` — context health monitoring complements cost tracking for session management

## References

- [Anthropic API pricing](https://www.anthropic.com/pricing) — accessed 2026-06-05, official-docs (Anthropic). Source for the per-million-token input/output rates per named model (Haiku 4.5 $1/$5, Sonnet 4.6 $3/$15, Opus 4.8 $5/$25) and the cache-read 0.1x / cache-write 1.25x-2x multipliers in Step 2; these drift between model releases — re-verify per Step 2a when running a cost report.
- [Token counting — Anthropic API docs](https://docs.anthropic.com/en/docs/build-with-claude/token-counting) — accessed 2026-06-05, official-docs (Anthropic). Source for treating the ~4-characters-per-token figure as an approximation; the documented count-tokens endpoint is authoritative when exact counts are required.
