---
id: hatch3r-context-health
name: hatch3r-context-health
type: skill
description: Monitors and maintains conversation context health during long sessions. Use when context may be degrading, after many turns, or when experiencing repeated errors.
tags: [maintenance]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
# Context Health Monitoring

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Assess current context health
- [ ] Step 2: Identify degradation signals
- [ ] Step 3: Apply corrective action
- [ ] Step 4: Verify health improvement
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: original task recall, corrective action authority at Orange/Red (delegate vs checkpoint-and-stop), scope of files to re-read, whether to post progress to platform on Red, and irreversible stop (discard unsaved work) vs preserve.

## Fan-out Discipline (P8 B2)

Fan-out scales with task size; token cost never justifies serializing independent work (`rules/hatch3r-fan-out-discipline.md` P8 B2; `agents/shared/efficiency-patterns.md`). Emit `sub_agents_spawned: { count, rationale, task_structure }` in your output.

## Step 1: Assess Context Health

Run through the self-assessment checklist:

1. **Task recall**: Can you state the original task, acceptance criteria, and scope boundaries without looking?
2. **Progress tracking**: List what's been completed and what remains.
3. **Error check**: Count recent failed tool calls or incorrect assumptions.
4. **File currency**: List files you've modified — when did you last read each one?
5. **Scope check**: Compare your current work to the original issue description.

### Model-Aware Threshold Profiles

Default thresholds assume a large-context model. When the active model is known, apply the matching profile to adjust thresholds:

| Model Tier | Context Window | Token Warning | Turn Limit | File Staleness |
|-----------|---------------|---------------|------------|----------------|
| Small (< 32K) | ~32K tokens | > 60% of window | > 15 turns | > 10 turns |
| Medium (32K--128K) | ~128K tokens | > 70% of window | > 25 turns | > 15 turns |
| Large (128K--200K) | ~200K tokens | > 80% of window | > 30 turns | > 20 turns |
| Extended (> 200K) | 200K+ tokens | > 85% of window | > 40 turns | > 25 turns |

Profile resolution: read `models` in `.hatch3r/hatch.json`; default to **Large** if unset. A `contextHealth` section in `hatch.json` with explicit thresholds overrides the profile. Log the active profile at the start of each check: `"Context health using <tier> profile (<window_size> tokens)"`.

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
1. Create a handoff document with all context by invoking the `hatch3r-handoff-preparer` agent (or the `hatch3r-handoff-prepare` skill directly)
2. Spawn a sub-agent using the Task tool with the handoff
3. Monitor the sub-agent's output
4. Aggregate results

### If 5 checks degraded (Red): Checkpoint and Stop
1. Save all progress (files changed, tests written)
2. Document remaining work and blockers
3. Post progress on the issue/work item (GitHub Issue, ADO Work Item, or GitLab Issue — check `platform` in `.hatch3r/hatch.json`)
4. Recommend fresh conversation

## Step 4: Verify Improvement

After corrective action:
- Re-run the assessment checklist
- Confirm health is at Green or Yellow
- Resume work on the original task

## Context Poisoning Detection

During context health checks, also scan for signs of context poisoning -- stale or incorrect information that has accumulated in the conversation:

| Signal | Detection | Action |
|--------|-----------|--------|
| Outdated file content | You reference a file's content but the file has been modified since you last read it | Re-read the file before continuing |
| Stale assumptions | A decision was made based on information that has since changed (e.g., a function was refactored) | Re-verify assumptions against current state |
| Contradictory context | Two pieces of context in the conversation disagree (e.g., "the API uses REST" vs. code showing GraphQL) | Resolve by reading the actual source of truth |
| Accumulated errors | Multiple tool calls have failed, suggesting the mental model of the codebase is wrong | Reset context by re-reading key files from scratch |

Context poisoning is more dangerous than missing context because it leads to confident-but-wrong decisions.

## Error Handling

- **Context degradation detected mid-task**: If health drops to Orange or Red during implementation, stop the current task, summarize progress so far, and recommend delegating the remainder to a fresh sub-agent with the summary as input.
- **Health checks produce conflicting signals**: If some checks indicate Green while others indicate Red, trust the worst signal and investigate the specific check that failed before proceeding.
- **Unable to estimate token usage**: If the platform does not expose token counts, use character-based estimation (1 token per 4 characters) and note the approximation in the report.

## Definition of Done

- [ ] Context health assessed with all 5 checks
- [ ] Context poisoning scan completed (no stale assumptions)
- [ ] Degradation level determined (Green/Yellow/Orange/Red)
- [ ] Appropriate corrective action taken
- [ ] Health verified at Green or Yellow after correction

## Board Pickup Integration

When `board-pickup` operates in auto-advance mode, context health is checked between issues. Orange completes the current issue then a fresh agent handles the next; Red mid-issue marks the issue PARTIAL and moves it back to Ready.

## Related Skills & Agents

- **Command**: `hatch3r-board-pickup` -- auto-advance mode uses context health for session management

## References

- [Token counting — Anthropic API docs](https://docs.anthropic.com/en/docs/build-with-claude/token-counting) — accessed 2026-05-31, official-docs (Anthropic). Source for treating the 1-token-per-4-characters figure as an approximation when the platform does not expose exact token counts (Error Handling, Step 1).
- [Effective context engineering for AI agents — Anthropic engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — accessed 2026-05-31, official-docs (Anthropic). Source for the context-degradation and context-window-pressure signals behind the model-aware threshold profiles and the context-poisoning detection table.
