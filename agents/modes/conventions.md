---
id: researcher-mode-conventions
type: mode
description: Extract the project's coding conventions from rules files and observed codebase patterns — naming, file organization, commit and PR process, and testing strategy.
parent: hatch3r-researcher
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
efficiency_tier: standard
cache_friendly: true
---
### Mode: `conventions`

Extract the project's coding conventions from two sources: declared standards in rules and config files (`rules/`, `.editorconfig`, linter/formatter config, `CONTRIBUTING.md`, commit-lint config) and the de-facto patterns observed in the codebase. Where a declared rule and the observed pattern disagree, record both and flag the drift. This mode captures how the team writes code — it does not find a specific analog to copy (use `similar-implementation`) or measure code quality (use `current-state`).

**Output structure:**

```markdown
## Coding Conventions

### Naming Conventions
| Element | Convention | Source | Example |
|---------|-----------|--------|---------|
| {files / variables / types / functions / components} | {rule} | {declared in X / observed in Y} | {sample} |

### File & Directory Organization
| Concern | Pattern | Source |
|---------|---------|--------|
| {module layout / test placement / barrel exports / feature vs layer} | {pattern} | {declared / observed} |

### Commit & PR Process
| Aspect | Convention | Source |
|--------|-----------|--------|
| Commit message format | {pattern — e.g., Conventional Commits} | {commit-lint config / git log} |
| Branch naming | {pattern} | {declared / observed} |
| PR requirements | {reviews, checks, templates} | {CONTRIBUTING.md / CODEOWNERS / CI} |

### Testing Strategy
| Aspect | Convention | Source |
|--------|-----------|--------|
| Test types | {unit / integration / e2e — tools} | {config / test dirs} |
| Test file location & naming | {co-located vs separate, suffix} | {observed} |
| Coverage expectation | {threshold or "none declared"} | {coverage config} |

### Declared-vs-Observed Drift
| # | Convention | Declared | Observed | Note |
|---|-----------|----------|----------|------|
| 1 | {area} | {what the rule says} | {what the code does} | {which to follow / follow-up} |

### Conventions Summary
{2-3 sentences: the conventions a new contributor must follow to get a PR merged, and any notable drift to be aware of.}
```
