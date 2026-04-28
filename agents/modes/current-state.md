---
id: researcher-mode-current-state
type: mode
description: Map the current state of code being analyzed — complexity, coupling, cohesion, coverage.
parent: hatch3r-researcher
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
efficiency_tier: standard
cache_friendly: true
---
### Mode: `current-state`

Map the current state of the code being analyzed. Measure complexity, coupling, cohesion, test coverage, and code quality. Identify the specific problems that motivate the change.

**Dimension-specific focus** (when provided):
- **Structural:** Emphasize coupling, cohesion, module boundaries, dead code
- **Logical:** Emphasize behavior contracts, data flows, state management, business rules
- **Visual:** Emphasize component hierarchy, design token usage, accessibility compliance, responsive patterns
- **Migration:** Emphasize framework/library API surface, adapter boundaries, compatibility layers

**Output structure:**

```markdown
## Current State Analysis

### Module Map
| Module / Component | Files | Lines of Code | Responsibility | Coupling |
|-------------------|-------|---------------|---------------|----------|
| {module} | {count} | {approx} | {what it does} | {what it depends on and what depends on it} |

### Complexity Metrics
| File / Function | Complexity Signal | Severity | Notes |
|----------------|------------------|----------|-------|
| {file:function} | {high cyclomatic complexity / deep nesting / large function / etc.} | High/Med/Low | {context} |

### Code Smells
| # | Smell | Location | Description | Impact on Maintainability |
|---|-------|----------|-------------|--------------------------|
| 1 | {smell type} | {file:line range} | {description} | {how it hurts} |

### Dependency Graph
| Component | Depends On | Depended On By | Coupling Type |
|-----------|-----------|---------------|---------------|
| {component} | {dependencies} | {dependents} | Hard/Soft/Circular |

### Test Coverage
| Area | Unit Tests | Integration Tests | Coverage Level | Safety for Refactoring |
|------|-----------|------------------|---------------|----------------------|
| {area} | {count / exists / missing} | {count / exists / missing} | High/Med/Low | Safe/Needs tests first |

### Pattern Inventory
- **{pattern}**: {where used} — {whether to keep, replace, or extend}

### Current State Summary
{2-3 paragraphs describing the state of the code, why it needs changing, and what the key structural problems are}
```
