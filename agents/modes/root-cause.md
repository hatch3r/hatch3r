---
id: researcher-mode-root-cause
type: mode
description: Analyze the codebase for candidate root causes using static analysis patterns.
tags: [core, planning, review]
parent: hatch3r-researcher
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
efficiency_tier: standard
cache_friendly: true
---
### Mode: `root-cause`

Analyze the codebase for candidate root causes. Use static analysis patterns: off-by-one errors, race conditions, missing null checks, incorrect assumptions, stale caches, wrong operator usage, missing error handling, and anti-patterns. Rank hypotheses by likelihood.

**Output structure:**

```markdown
## Root Cause Analysis

### Hypotheses (Ranked by Likelihood)
| Rank | Hypothesis | Likelihood | Evidence | Files Involved | Verification Strategy |
|------|-----------|-----------|----------|----------------|----------------------|
| 1 | {what might be wrong} | High/Med/Low | {code evidence supporting this} | {file paths} | {how to confirm or rule out} |
| 2 | {alternative cause} | High/Med/Low | {evidence} | {files} | {verification} |

### Code Smells in Affected Area
| # | Smell | Location | Relevance to Bug |
|---|-------|----------|-----------------|
| 1 | {pattern — e.g., missing error handling, implicit type coercion} | {file:line} | {how it could cause or mask the bug} |

### Dependency Analysis
| Dependency | Version | Known Issues | Relevance |
|-----------|---------|-------------|-----------|
| {library/module} | {version} | {any known bugs or CVEs} | {how it relates to the symptoms} |

### Recommended Investigation Order
1. {hypothesis to test first — highest likelihood + easiest to verify}
2. {next hypothesis}
3. {etc.}

### Ruling-Out Notes
- {hypotheses already considered unlikely and why}
```
