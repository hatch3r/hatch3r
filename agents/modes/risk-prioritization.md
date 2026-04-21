---
id: researcher-mode-risk-prioritization
type: mode
description: Risk-ranked prioritization of testing effort by business impact and coverage.
tags: [core, review]
parent: hatch3r-researcher
quality_charter: agents/shared/quality-charter.md
---
### Mode: `risk-prioritization`

Produce a risk-ranked prioritization of testing effort considering business impact, security exposure, change frequency, and current coverage. Used by `hatch3r-test-plan` to order test implementation for maximum risk reduction.

**Output structure:**

```markdown
## Risk-Based Test Prioritization

### Risk Matrix
| # | Module / Area | Business Impact | Security Exposure | Change Frequency | Current Coverage | Risk Score | Test Priority |
|---|-------------|----------------|------------------|-----------------|-----------------|-----------|--------------|
| 1 | {module} | Critical/High/Med/Low | Critical/High/Med/Low | High/Med/Low | High/Med/Low/None | {weighted score} | P0/P1/P2/P3 |

### Recommended Test Investment Order
| Priority | Module / Area | Recommended Tests | Effort | Risk Reduction |
|----------|-------------|------------------|--------|---------------|
| P0 | {module} | {test types and count} | S/M/L | {what risk this eliminates} |
| P1 | {module} | {test types and count} | S/M/L | {what risk this reduces} |
| P2 | {module} | {test types and count} | S/M/L | {what risk this reduces} |
| P3 | {module} | {test types and count} | S/M/L | {incremental improvement} |

### Quick Wins
| # | Test to Add | Module | Effort | Risk Reduction | Why It's a Quick Win |
|---|-----------|--------|--------|---------------|---------------------|
| 1 | {specific test description} | {module} | XS/S | {impact} | {already has test infra / simple boundary / high-value assertion} |

### Technical Debt Tests
| # | Debt Item | Module | Current Risk | Recommended Test | Blocks |
|---|----------|--------|-------------|-----------------|--------|
| 1 | {tech debt — e.g., untested legacy module, missing error handling tests} | {module} | {what could go wrong} | {test type and scope} | {what this blocks — e.g., safe refactoring, migration} |
```

**Depth scaling:**
- **quick**: Risk matrix (top 5 modules) + quick wins only.
- **standard**: Full risk matrix, investment order (P0-P2), quick wins, and top 3 technical debt items.
- **deep**: All sections exhaustively. Full risk matrix with weighted scoring, complete investment order (P0-P3), all quick wins, and comprehensive technical debt test inventory.
