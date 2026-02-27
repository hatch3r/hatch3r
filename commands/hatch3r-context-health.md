---
id: hatch3r-context-health
type: command
description: Monitor conversation context health, detect degradation, and auto-suggest fresh context or sub-agent delegation
---
# Context Health — Conversation Context Monitoring

Monitor and maintain healthy conversation context during long-running agent sessions. Detects context degradation before it impacts output quality and recommends corrective actions.

---

## Context Health Indicators

### Degradation Signals

| Signal | Detection Method | Threshold |
|--------|-----------------|-----------|
| Conversation depth | Count user/assistant turns | > 30 turns |
| Token accumulation | Estimate total context tokens | > 80% of model context window |
| Topic drift | Compare current task to original issue scope | Cosine similarity < 0.6 |
| Repeated errors | Track consecutive failed attempts | > 2 failures on same task |
| File staleness | Track time since last file re-read | > 20 turns since last read |
| Tool failure rate | Track tool call success/failure ratio | > 30% failure rate |

### Health Levels

| Level | Status | Action |
|-------|--------|--------|
| Green | Healthy (< 50% indicators triggered) | Continue normally |
| Yellow | Degrading (50-70% indicators triggered) | Refresh key context, summarize progress |
| Orange | At risk (70-90% indicators triggered) | Delegate remaining work to sub-agent |
| Red | Degraded (> 90% indicators triggered) | Stop, create checkpoint, spawn fresh agent |

## Monitoring Protocol

### Passive Monitoring (Always Active)

Agents should self-assess context health at natural breakpoints:
- After completing each sub-task or implementation step
- Before starting a new file or module
- After receiving an error or unexpected result
- Every 10 conversation turns

### Self-Assessment Checklist

At each checkpoint, the agent evaluates:
1. **Can I accurately recall the original task requirements without re-reading?**
2. **Am I making progress or cycling on the same issue?**
3. **Are my tool calls succeeding at a reasonable rate?**
4. **Is my understanding of the codebase still current?**
5. **Have I drifted from the issue's acceptance criteria?**

### Corrective Actions

#### Refresh (Yellow)
- Re-read the issue body and acceptance criteria
- Re-read key files that have been modified
- Summarize progress so far in a structured checkpoint

#### Delegate (Orange)
- Create a structured handoff document with: completed work, remaining tasks, key context, file list
- Spawn a sub-agent with the handoff document using the Task tool
- The sub-agent starts fresh with full context window

#### Checkpoint and Stop (Red)
- Save a progress checkpoint: files changed, tests written, current blockers
- Post a status comment on the GitHub issue with progress
- Recommend the user start a new conversation for the remaining work

## Integration with Board Pickup

When `board-pickup` operates in auto-advance mode:
- Context health is checked between each issue
- If health drops to Orange, the current issue is completed and a fresh agent handles the next one
- If health drops to Red mid-issue, the issue is marked as PARTIAL and moved back to Ready

## Output Format

```
## Context Health Check

**Level:** GREEN | YELLOW | ORANGE | RED

**Indicators:**
- Conversation depth: {turns} / 30
- Token usage: ~{estimated}% of context window
- Topic coherence: {assessment}
- Error rate: {n} failures in last {m} operations
- File staleness: {n} files not re-read in {m} turns

**Recommendation:** {CONTINUE | REFRESH | DELEGATE | CHECKPOINT}

**Action taken:** {what corrective action was performed, if any}
```

---

## Error Handling

- **Self-assessment failure:** If the agent cannot determine its own health level, default to Yellow and perform a context refresh.
- **Delegation failure:** If sub-agent spawn fails, fall back to Checkpoint and Stop (Red protocol).
- **Board integration failure:** Log warning and continue. Context health operates independently of board state.

---

## Guardrails

- **Never ignore Red status.** A Red assessment always results in a checkpoint and stop.
- **Do not inflate health.** When uncertain, round toward the more degraded level.
- **Passive monitoring is mandatory** during board-pickup auto-advance mode.
- **Handoff documents must be complete.** Never delegate without listing completed work, remaining tasks, key context, and file list.
- **Do not expand scope during refresh.** Re-reading context is not an invitation to add new tasks.
