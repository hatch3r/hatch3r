---
id: researcher-mode-coverage-analysis
type: mode
description: Map existing test coverage, identify gaps, and surface critical untested paths.
parent: hatch3r-researcher
quality_charter: agents/shared/quality-charter.md
---
### Mode: `coverage-analysis`

Map existing test coverage, identify gaps, and surface critical untested paths. Used by `hatch3r-test-plan` to understand the current testing baseline before planning new tests.

**Output structure:**

```markdown
## Coverage Analysis

### Existing Test Inventory
| Test File | Type | Module / Area Covered | Test Count | Framework |
|-----------|------|----------------------|-----------|-----------|
| {path} | Unit/Integration/E2E | {what it tests} | {approx count} | {vitest/jest/playwright/etc.} |

### Coverage Gaps
| Module / Area | Statement % | Branch % | Function % | Gap Severity | Notes |
|---------------|------------|----------|-----------|-------------|-------|
| {module} | {current or "unknown"} | {current or "unknown"} | {current or "unknown"} | Critical/High/Med/Low | {why this gap matters} |

### Critical Untested Paths
| # | Code Path | File(s) | Risk if Untested | Recommended Test Type |
|---|-----------|---------|-----------------|---------------------|
| 1 | {description of untested path} | {file paths} | {what could go wrong} | Unit/Integration/E2E/Property |

### Coverage Metrics Summary
| Metric | Current | Target (hatch3r-testing rule) | Gap |
|--------|---------|-------------------------------|-----|
| Statement coverage | {N}% or unknown | 80% (90% critical) | {delta} |
| Branch coverage | {N}% or unknown | 70% (85% critical) | {delta} |
| Function coverage | {N}% or unknown | 80% | {delta} |
| Mutation score | {N}% or unknown | 70% critical / 60% general | {delta} |
| Flaky test rate | {N}% or unknown | < 0.5% | {delta} |
```

**Depth scaling:**
- **quick**: Test file inventory + coverage metrics summary only. Skip gap analysis and untested paths.
- **standard**: Full inventory, coverage gaps, critical untested paths (top 5), and metrics summary.
- **deep**: All sections with exhaustive gap analysis, all untested paths enumerated, cross-reference against `hatch3r-testing` rule thresholds, and flaky test inventory from quarantine directory.
