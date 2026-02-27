---
id: hatch3r-cost-tracking
type: command
description: Track and report token usage and estimated costs across agent workflows and board operations
---
# Cost Tracking — Token Usage and Cost Reporting

Track token consumption and estimated costs across sub-agent workflows, board operations, and development sessions. Provides visibility into AI usage patterns and enforces cost guardrails.

---

## Cost Tracking Model

### Token Estimation

Since exact token counts are not always available from the runtime, use estimation:

| Content Type | Estimation Rule |
|-------------|----------------|
| User message | ~4 characters per token |
| Assistant response | ~4 characters per token |
| Tool call (input) | JSON stringified length / 4 |
| Tool call (output) | Response length / 4 |
| File read | File character count / 4 |
| Web search | ~500 tokens per search |

### Cost Estimation

| Model Tier | Input (per 1M tokens) | Output (per 1M tokens) |
|-----------|----------------------|----------------------|
| Fast | $0.25 | $1.00 |
| Standard | $3.00 | $15.00 |
| Premium | $15.00 | $75.00 |

These are reference rates — update based on actual provider pricing.

## Tracking Scope

### Per-Issue Tracking
- Total tokens consumed implementing an issue
- Breakdown: planning vs implementation vs testing vs review
- Sub-agent token usage (each sub-agent reports independently)
- Estimated cost at current model pricing

### Per-Session Tracking
- Total tokens in the current conversation
- Running cost estimate
- Comparison to session budget (if configured)
- Warning at 50%, 75%, 90% of budget

### Board Operation Tracking
- Tokens consumed per board-pickup cycle
- Tokens per issue type (bug fix vs feature vs refactor)
- Historical trends across sessions
- Average cost per completed issue

## Cost Guardrails

### Budget Configuration

Configure in `hatch.json`:
```json
{
  "costTracking": {
    "sessionBudget": 10.00,
    "issueBudget": 5.00,
    "epicBudget": 50.00,
    "currency": "USD",
    "warningThresholds": [0.5, 0.75, 0.9],
    "hardStop": true
  }
}
```

### Enforcement

| Threshold | Action |
|-----------|--------|
| 50% of budget | Log warning, continue |
| 75% of budget | Alert user, suggest optimization |
| 90% of budget | Strong warning, recommend delegation or checkpoint |
| 100% of budget | Stop (if hardStop=true) or alert and continue |

### Cost Optimization Strategies

When approaching budget limits:
1. **Reduce context**: Summarize long conversations, drop irrelevant file content
2. **Delegate to faster models**: Use fast-tier sub-agents for routine tasks
3. **Cache results**: Avoid re-reading unchanged files
4. **Batch operations**: Combine multiple small tool calls into fewer larger ones
5. **Scope reduction**: Break remaining work into a new issue for a fresh session

## Output Format

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

---

## Error Handling

- **Token estimation inaccuracy:** Estimates may drift ±30% from actual usage. Always present values with `~` prefix.
- **Missing budget config:** If `hatch.json` has no `costTracking` section, operate in report-only mode (no guardrails enforced).
- **Sub-agent reporting failure:** If a sub-agent does not report token usage, estimate from its output length and log a warning.

---

## Guardrails

- **Never suppress budget warnings.** All threshold alerts must be surfaced to the user.
- **Hard stop is respected.** When `hardStop: true` and budget is exhausted, the agent must stop and checkpoint.
- **Estimates are clearly labeled.** Never present estimated costs as exact figures.
- **Budget config is read-only.** This command reads budget configuration but never modifies `hatch.json`.
- **Cost data does not leak across sessions.** Each session starts with a fresh cost counter unless explicitly aggregating historical data.
