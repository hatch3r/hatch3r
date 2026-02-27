---
id: hatch3r-context-health
description: Monitor and maintain conversation context health during long sessions. Use when context may be degrading, after many turns, or when experiencing repeated errors.
---
# Context Health Monitoring

## Quick Start

```
Task Progress:
- [ ] Step 1: Assess current context health
- [ ] Step 2: Identify degradation signals
- [ ] Step 3: Apply corrective action
- [ ] Step 4: Verify health improvement
```

## Step 1: Assess Context Health

Run through the self-assessment checklist:

1. **Task recall**: Can you state the original task, acceptance criteria, and scope boundaries without looking?
2. **Progress tracking**: List what's been completed and what remains.
3. **Error check**: Count recent failed tool calls or incorrect assumptions.
4. **File currency**: List files you've modified — when did you last read each one?
5. **Scope check**: Compare your current work to the original issue description.

## Step 2: Identify Degradation

| Check | Healthy | Degraded |
|-------|---------|----------|
| Task recall | Can state requirements from memory | Need to re-read issue |
| Progress | Clear forward momentum | Cycling or stuck |
| Errors | Occasional, different causes | Repeated, same cause |
| Files | Recently read and current | Stale, may have drifted |
| Scope | Aligned with acceptance criteria | Drifted to tangential work |

## Step 3: Apply Corrective Action

### If 0-1 checks degraded (Green): Continue normally

### If 2-3 checks degraded (Yellow): Refresh
1. Re-read the issue body and acceptance criteria
2. Re-read all files you've modified in this session
3. Create a progress summary of completed work
4. Re-plan remaining steps from the refreshed context

### If 4 checks degraded (Orange): Delegate
1. Create a handoff document with all context
2. Spawn a sub-agent using the Task tool with the handoff
3. Monitor the sub-agent's output
4. Aggregate results

### If 5 checks degraded (Red): Checkpoint and Stop
1. Save all progress (files changed, tests written)
2. Document remaining work and blockers
3. Post progress on the GitHub issue
4. Recommend fresh conversation

## Step 4: Verify Improvement

After corrective action:
- Re-run the assessment checklist
- Confirm health is at Green or Yellow
- Resume work on the original task

## Definition of Done

- [ ] Context health assessed with all 5 checks
- [ ] Degradation level determined (Green/Yellow/Orange/Red)
- [ ] Appropriate corrective action taken
- [ ] Health verified at Green or Yellow after correction

## Related Skills & Agents

- **Command**: `hatch3r-context-health` — full monitoring protocol with integration points
- **Command**: `hatch3r-board-pickup` — auto-advance mode uses context health for session management
