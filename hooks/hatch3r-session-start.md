---
id: session-start-learnings
type: hook
event: session-start
agent: learnings-loader
description: Load relevant learnings at session start
---
# Hook: session-start → learnings-loader

Activate the learnings-loader agent when a new coding session starts to surface relevant project learnings, recent decisions, and context from previous sessions.

## Agent Behavior

When this hook fires, the assigned agent should:

1. Read the `.agents/learnings/` directory and index all available learning files by area, tags, and recency.
2. Identify the most relevant learnings based on recently modified files in the working tree (using `git diff` and `git log` to infer the active work area).
3. Surface the top 3-5 most relevant learnings as a brief summary, prioritizing: (a) learnings from the last 7 days, (b) learnings matching the current branch's area labels, (c) learnings tagged as high-impact or cross-cutting.
4. If there are recent architectural decisions or convention changes, highlight them prominently.
5. If `.agents/learnings/` does not exist or is empty, skip silently.

## Expected Output

- A concise summary block (max 10 lines) showing relevant learnings, each with: title, area, one-line takeaway, and file path for deeper reading.
- If no relevant learnings are found: skip output entirely (do not emit "no learnings found" noise).

## Configuration

- **Max learnings**: Default 5. Adjust via `maxLearnings` in hook config.
- **Recency window**: Default 7 days. Adjust via `recencyDays` to widen or narrow the time window.
- **Area filter**: If set, only surface learnings matching the specified areas. By default, infers areas from the working tree.
