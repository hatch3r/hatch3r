---
id: researcher-mode-complexity-risk
type: mode
description: Identify code complexity hotspots and mutation-prone areas for test prioritization.
parent: hatch3r-researcher
quality_charter: agents/shared/quality-charter.md
---
### Mode: `complexity-risk`

Identify code complexity hotspots, mutation-prone areas, and error handling coverage to prioritize where tests will have the highest impact. Used by `hatch3r-test-plan` to focus testing effort on the riskiest code.

**Output structure:**

```markdown
## Complexity & Risk Analysis

### Complexity Hotspots
| # | File / Function | Complexity Signal | Severity | Current Test Coverage | Testing Priority |
|---|----------------|------------------|----------|---------------------|-----------------|
| 1 | {file:function} | {high cyclomatic complexity / deep nesting / large function / many branches} | High/Med/Low | Covered/Partial/None | P0/P1/P2/P3 |

### Mutation-Prone Areas
| # | Module / File | Why Mutation-Prone | Mutation Score (est.) | Recommended Action |
|---|-------------|-------------------|---------------------|-------------------|
| 1 | {path} | {many conditionals / complex state transitions / arithmetic logic} | {estimated or measured}% | {add assertions / property tests / mutation testing} |

### Error Handling Coverage
| # | Error Path | File(s) | Currently Tested? | Failure Impact | Priority |
|---|-----------|---------|------------------|---------------|----------|
| 1 | {error scenario} | {file paths} | Yes/No/Partial | {what happens if this error path is wrong} | P0/P1/P2/P3 |

### Recommended Testing Depth
| Module / Area | Recommended Depth | Rationale |
|---------------|------------------|-----------|
| {module} | Thorough (unit + integration + property) / Standard (unit + integration) / Light (unit only) | {complexity, risk, and coverage factors} |
```

**Depth scaling:**
- **quick**: Top 5 complexity hotspots + recommended testing depth table only.
- **standard**: Full hotspots (top 10), mutation-prone areas, error handling coverage (top 5), and recommended depth.
- **deep**: All sections exhaustively. Cross-reference mutation targets from `hatch3r-testing` rule (70% critical, 60% general). Include estimated mutation scores and specific assertion gaps.
