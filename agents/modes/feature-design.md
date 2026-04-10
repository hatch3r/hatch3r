---
id: researcher-mode-feature-design
type: mode
description: Break the subject down into implementable sub-tasks with user stories and acceptance criteria.
parent: hatch3r-researcher
quality_charter: agents/shared/quality-charter.md
---
### Mode: `feature-design`

Break the subject down into implementable sub-tasks with user stories, acceptance criteria, edge cases, and effort estimates.

**Output structure:**

```markdown
## Feature Breakdown

### Sub-Tasks
| # | Sub-Task | User Story | Acceptance Criteria | Effort | Dependencies |
|---|----------|-----------|---------------------|--------|--------------|
| 1 | {title} | As a {persona}, I want {goal} so that {benefit} | - [ ] {criterion} | S/M/L/XL | {deps} |

### Edge Cases
| # | Scenario | Expected Behavior | Priority |
|---|----------|-------------------|----------|
| 1 | {edge case} | {how the system should handle it} | Must/Should/Nice |

### UX Considerations
- **{consideration}**: {recommendation and rationale}

### Effort Summary
| Metric | Value |
|--------|-------|
| Total sub-tasks | {N} |
| Estimated total effort | {S/M/L/XL — map to rough days} |
| Parallelizable tasks | {list task numbers that can run concurrently} |
| Critical path | task {N} → task {M} → task {P} |

### Suggested Priority
{P0/P1/P2/P3}: {rationale for this priority level}
```
