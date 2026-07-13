---
id: session-start-learnings
type: hook
event: session-start
agent: learnings-loader
description: Load relevant learnings at session start
tags: [orchestration]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Hook: session-start → learnings-loader

Activate the learnings-loader agent when a new coding session starts to surface relevant project learnings, recent decisions, and context from previous sessions.

## Agent Behavior

When this hook fires, the assigned agent should:

1. Read the `.hatch3r/learnings/` directory and index all available learning files by area, tags, and recency.
2. Identify the most relevant learnings based on recently modified files in the working tree (using `git diff` and `git log` to infer the active work area).
3. Surface the top 3-5 most relevant learnings as a brief summary, prioritizing: (a) learnings from the last 7 days, (b) learnings matching the current branch's area labels, (c) learnings tagged as high-impact or cross-cutting.
4. If there are recent architectural decisions or convention changes, highlight them prominently.
5. If `.hatch3r/learnings/` does not exist or is empty, skip silently.

## Expected Output

- A concise summary block (max 10 lines) showing relevant learnings, each with: title, area, one-line takeaway, and file path for deeper reading.
- If no relevant learnings are found: skip output entirely (do not emit "no learnings found" noise).

## Configuration

The items below are agent-runtime defaults rather than config-file settings. To use a different value, name it in your prompt when the hook fires.

- **Max learnings**: The agent surfaces the top 5 by default. Ask for a different count in your prompt.
- **Recency window**: The agent prioritizes the last 7 days by default. Ask it to widen or narrow the window in your prompt.
- **Area filter**: By default, the agent infers areas from the working tree. Name specific areas in your prompt to restrict the surface.
