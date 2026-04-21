---
id: researcher-mode-risk-assessment
type: mode
description: Identify risks, security implications, performance concerns, and breaking changes.
tags: [core, review]
parent: hatch3r-researcher
quality_charter: agents/shared/quality-charter.md
---
### Mode: `risk-assessment`

Identify risks, security implications, performance concerns, breaking changes, migration needs, and common mistakes.

**Output structure:**

```markdown
## Risk Assessment

### Technical Risks
| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | {risk} | High/Med/Low | High/Med/Low | {strategy} |

### Security Implications
| # | Concern | Severity | Mitigation |
|---|---------|----------|------------|
| 1 | {concern} | Critical/High/Med/Low | {strategy} |

### Performance Concerns
| # | Concern | When It Matters | Mitigation |
|---|---------|----------------|------------|
| 1 | {concern} | {threshold or condition} | {strategy} |

### Breaking Changes
| # | What Breaks | Who Is Affected | Migration Path |
|---|------------|----------------|----------------|
| 1 | {change} | {consumers/users} | {migration strategy} |

### Common Mistakes
- **{mistake}**: {why it's tempting} → {what to do instead}

### Recommended Safeguards
- {safeguard}: {rationale}
```
