---
id: hatch3r-cost-tracking
name: hatch3r-cost-tracking
description: Track token usage and estimate costs for agent sessions. Use when monitoring spend, approaching budget limits, or generating cost reports.
tags: [maintenance, tier:enterprise-only]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
# Cost Tracking Workflow

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Review cost tracking configuration
- [ ] Step 2: Estimate current session token usage
- [ ] Step 3: Identify cost optimization opportunities
- [ ] Step 4: Generate cost report
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: tracking scope (session vs issue vs epic), budget values when missing from hatch.json, hardStop authority (block vs warn), report format target, and whether to defer non-critical work over budget.

## Fan-out Discipline (P8 B2)

This skill delegates per task size:
- Tier 1 (trivial single-file): inline execution acceptable.
- Tier 2 (multi-file or multi-concern): spawn parallel sub-agents per concern via the Task tool.
- Tier 3 (multi-module / high-risk): one fresh sub-agent per independent module or gate; orchestrator integrates only.

Never under-fan-out to save tokens. Token cost is dominated by quality and completeness gains. Emit `sub_agents_spawned: { count, rationale }` in your output.

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

Calculate estimated cost using these model tier rates (reference rates — update based on actual provider pricing):

| Model Tier | Input (per 1M tokens) | Output (per 1M tokens) |
|-----------|----------------------|----------------------|
| Fast | $0.25 | $1.00 |
| Standard | $3.00 | $15.00 |
| Premium | $15.00 | $75.00 |

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
- Input tokens: ~{n}
- Output tokens: ~{n}
- Total tokens: ~{n}

**Estimated Cost:** ${amount}

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

Include total estimated tokens (input + output), estimated cost at current model tier, budget status (if configured), and top optimization opportunities. Always present estimated values with the `~` prefix. Never suppress threshold alerts.

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

- **Skill**: `hatch3r-context-health` — context health monitoring complements cost tracking for session management
