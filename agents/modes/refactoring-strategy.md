---
id: researcher-mode-refactoring-strategy
type: mode
description: Design the refactoring approach with transformations, invariants, and patterns.
tags: [core, planning, implementation]
parent: hatch3r-researcher
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
efficiency_tier: standard
cache_friendly: true
---
### Mode: `refactoring-strategy`

Design the refactoring approach. Propose specific transformations (extract, inline, rename, restructure, migrate). Define behavioral invariants that must hold throughout. Identify patterns to follow from the existing codebase or from best practices.

**Dimension-specific focus** (when provided):
- **Structural:** Extract module, split file, reduce coupling, enforce boundaries
- **Logical:** Behavior migration, data model evolution, API versioning, state machine redesign
- **Visual:** Component refactoring, design token standardization, accessibility remediation, layout restructuring
- **Migration:** Framework swap, adapter pattern, compatibility shim, incremental migration

**Output structure:**

```markdown
## Refactoring Strategy

### Target Architecture
{Description of the desired end state — how the code should look after refactoring}

### Transformation Plan
| # | Transformation | Type | From → To | Invariants |
|---|---------------|------|-----------|-----------|
| 1 | {what to do} | Extract/Inline/Restructure/Migrate/Replace | {current} → {target} | {what must not change} |

### Behavioral Invariants
| # | Invariant | How to Verify | Current Test Coverage |
|---|-----------|--------------|---------------------|
| 1 | {behavior that must be preserved} | {test or assertion strategy} | Covered/Needs test |

### New Patterns Introduced
| Pattern | Where | Justification | Precedent in Codebase? |
|---------|-------|--------------|----------------------|
| {pattern} | {where it applies} | {why this pattern over alternatives} | Yes — {where} / No — {why new} |

### Patterns Removed
| Pattern | Where | Replacement | Migration Strategy |
|---------|-------|-------------|-------------------|
| {pattern being replaced} | {current locations} | {what replaces it} | {how to migrate} |

### Interface Contracts
| Interface / API | Current Contract | New Contract | Breaking? | Migration |
|----------------|-----------------|-------------|-----------|-----------|
| {interface} | {current shape} | {new shape or "unchanged"} | Yes/No | {strategy} |

### Effort Estimate
| Phase | Effort | Parallelizable? |
|-------|--------|----------------|
| {phase} | S/M/L/XL | Yes/No |
| **Total** | {aggregate} | {parallel lanes} |
```
