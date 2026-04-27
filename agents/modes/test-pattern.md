---
id: researcher-mode-test-pattern
type: mode
description: Extract existing test conventions, framework usage, mock patterns, and helper libraries.
tags: [core, review]
parent: hatch3r-researcher
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
efficiency_tier: standard
cache_friendly: true
---
### Mode: `test-pattern`

Extract existing test conventions, framework usage, mock patterns, and helper libraries so new tests follow established patterns. Used by `hatch3r-test-plan` to align the test strategy with the project's existing test infrastructure.

**Output structure:**

```markdown
## Test Pattern Analysis

### Framework & Tooling Inventory
| Tool | Version | Config File | Purpose |
|------|---------|------------|---------|
| {vitest/jest/playwright/stryker/etc.} | {version} | {config path} | {unit/integration/E2E/mutation} |

### Directory Conventions
| Test Type | Directory | Naming Pattern | Co-located? |
|-----------|-----------|---------------|-------------|
| Unit | {path} | {pattern — e.g., *.test.ts} | Yes/No |
| Integration | {path} | {pattern} | Yes/No |
| E2E | {path} | {pattern} | Yes/No |
| Fixtures | {path} | {pattern} | — |
| Quarantine | {path or "none"} | {pattern} | — |

### Mock & Fixture Patterns
| Pattern | Where Used | Convention | Compliance with hatch3r-testing |
|---------|-----------|-----------|-------------------------------|
| {fakes / stubs / mocks / MSW / nock / etc.} | {example files} | {how the project uses this pattern} | {aligned — fakes > stubs > mocks / divergent — explain} |

### Test Helper Library
| Helper | Location | Purpose | Used By |
|--------|----------|---------|---------|
| {factory function / builder / custom matcher / setup utility} | {file path} | {what it does} | {which test files use it} |

### Property-Based Testing Usage
| Status | Library | Where Used | Coverage |
|--------|---------|-----------|---------|
| {Active / Not used / Minimal} | {fast-check / etc. or "none"} | {file paths or "N/A"} | {which function types are covered} |

### Convention Compliance
| Convention (hatch3r-testing rule) | Current State | Compliance |
|----------------------------------|--------------|-----------|
| Deterministic (no wall clock) | {compliant / violations found} | {details} |
| Isolated (own setup/teardown) | {compliant / violations found} | {details} |
| Fast (unit < 50ms, integration < 2s) | {compliant / unknown / violations} | {details} |
| Named clearly (behavior descriptions) | {compliant / mixed / non-compliant} | {details} |
| No network in unit tests | {compliant / violations found} | {details} |
| No type escape hatches | {compliant / violations found} | {details} |
| Fakes > stubs > mocks hierarchy | {followed / partially / not followed} | {details} |
| Factory over fixtures | {followed / partially / not followed} | {details} |
```

**Depth scaling:**
- **quick**: Framework inventory + directory conventions only.
- **standard**: Full inventory, directory conventions, mock patterns, and convention compliance summary.
- **deep**: All sections exhaustively. Include test helper library analysis, property-based testing status, and detailed convention compliance with file-level violations.
