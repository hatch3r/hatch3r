---
id: hatch3r-cost-tracking
description: Track token usage and estimate costs for agent sessions. Use when monitoring spend, approaching budget limits, or generating cost reports.
---
# Cost Tracking Workflow

## Quick Start

```
Task Progress:
- [ ] Step 1: Review cost tracking configuration
- [ ] Step 2: Estimate current session token usage
- [ ] Step 3: Identify cost optimization opportunities
- [ ] Step 4: Generate cost report
```

## Step 1: Review Configuration

1. Check `hatch.json` for a `costTracking` section.
2. Note configured budgets: `sessionBudget`, `issueBudget`, `epicBudget`.
3. Note warning thresholds and whether `hardStop` is enabled.
4. If no configuration exists, operate in report-only mode.

## Step 2: Estimate Token Usage

Estimate tokens for the current session using these rules:

| Content Type | Rule |
|-------------|------|
| Messages | ~4 characters per token |
| Tool calls | JSON length / 4 (input), response length / 4 (output) |
| File reads | Character count / 4 |
| Web searches | ~500 tokens per search |

Calculate estimated cost using the model tier rates from the `hatch3r-cost-tracking` command reference.

## Step 3: Identify Optimizations

Review usage patterns for savings:

- **Large file reads**: Were files read multiple times without changes? Cache instead.
- **Model tier**: Could routine tasks (linting, formatting) use a faster/cheaper model?
- **Context bloat**: Is irrelevant context accumulating? Summarize and trim.
- **Batching**: Were multiple small tool calls made that could be combined?
- **Scope creep**: Did work expand beyond the original issue? Scope back.

## Step 4: Generate Report

Produce a cost report using the output format from the `hatch3r-cost-tracking` command. Include:
- Total estimated tokens (input + output)
- Estimated cost at the current model tier
- Budget status (if configured)
- Top optimization opportunities

## Definition of Done

- [ ] Cost configuration reviewed (or report-only mode noted)
- [ ] Token usage estimated for current session
- [ ] Optimization opportunities identified
- [ ] Cost report generated with budget status

## Related Skills & Agents

- **Command**: `hatch3r-cost-tracking` — full cost tracking protocol with guardrails and budget enforcement
- **Skill**: `hatch3r-context-health` — context health monitoring complements cost tracking for session management
