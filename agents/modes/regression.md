---
id: researcher-mode-regression
type: mode
description: Investigate when an issue was introduced by analyzing git history and changes.
tags: [core, planning, review]
parent: hatch3r-researcher
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
efficiency_tier: standard
cache_friendly: true
---
### Mode: `regression`

Investigate when the issue was likely introduced and what changed. Analyze git history, recent dependency updates, configuration changes, and deployment events in the affected area.

**Output structure:**

```markdown
## Regression Analysis

### Timeline
| Date / Period | Change | Author | Files | Potential Link |
|--------------|--------|--------|-------|---------------|
| {date or range} | {commit message or change description} | {who} | {files changed} | High/Med/Low — {reasoning} |

### Recent Changes in Affected Area
| File | Last Modified | Change Summary | Suspicious? |
|------|-------------|----------------|-------------|
| {file path} | {date} | {what changed} | Yes/No — {why} |

### Dependency Changes
| Dependency | Previous Version | Current Version | Changelog Relevant? |
|-----------|-----------------|----------------|---------------------|
| {package} | {old} | {new} | Yes — {breaking change or bug fix} / No |

### Configuration Changes
| Config | Change | When | Impact |
|--------|--------|------|--------|
| {config file or env var} | {what changed} | {when} | {how it could cause the issue} |

### Most Likely Introduction Window
- **When:** {date range or commit range}
- **What changed:** {description}
- **Confidence:** High/Med/Low
- **Bisect strategy:** {how to narrow down further if needed}

### Previously Working State
- **Last known good:** {version, commit, or date when this worked}
- **Evidence:** {test results, user reports, or deploy logs}
```
