---
id: hatch3r-cost-tracking
description: Track token usage and estimate costs for agent sessions. Use when monitoring spend, approaching budget limits, or generating cost reports.
tags: [maintenance]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
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

| Content Type | Rule | Accuracy |
|-------------|------|----------|
| Messages | ~4 characters per token | High -- stable ratio for English text |
| Tool calls | JSON length / 4 (input), response length / 4 (output) | Medium -- JSON has more overhead characters |
| File reads | Character count / 4 | High -- but large files may be truncated by the tool |
| Web searches | ~500 tokens per search | Low -- varies widely by result length |
| Subagent spawns | Estimate full context re-sent per spawn (~2000-5000 tokens base) | Medium -- depends on included rules/context |

**Subagent cost multiplier.** Each subagent spawn carries a base cost for the agent protocol, included rules, and context. A pipeline with 8 subagents (researcher + implementer + reviewer + fixer + 4 Phase 4 specialists) has significant overhead from context re-transmission. Factor this into budget estimates.

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

## Error Handling

- **Token usage data unavailable**: If the platform does not expose token metrics, use input/output character counts divided by 4 as an estimate. Note the approximation method in the report.
- **Budget limit exceeded mid-session**: Stop non-critical operations, produce a partial cost report, and recommend which remaining tasks to defer or delegate to a lower-cost model.
- **Cost configuration missing from hatch.json**: Operate in report-only mode and note that budget enforcement is inactive. Recommend adding cost configuration to enable guardrails.

## Definition of Done

- [ ] Cost configuration reviewed (or report-only mode noted)
- [ ] Token usage estimated for current session
- [ ] Optimization opportunities identified
- [ ] Cost report generated with budget status

## Related Skills & Agents

- **Command**: `hatch3r-cost-tracking` — full cost tracking protocol with guardrails and budget enforcement
- **Skill**: `hatch3r-context-health` — context health monitoring complements cost tracking for session management
